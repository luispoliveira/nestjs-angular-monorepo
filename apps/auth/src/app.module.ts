import { prismaAdapter } from '@better-auth/prisma-adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ClientsModule } from '@nestjs/microservices';
import { DatabaseModule, DatabaseService } from '@repo/database';
import {
  ClsService,
  MicroserviceUtil,
  NotificationsPublisher,
  SharedModule,
} from '@repo/shared';
import { AuthGuard, AuthModule } from '@thallesp/nestjs-better-auth';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { twoFactor } from 'better-auth/plugins/two-factor';
import Redis from 'ioredis';
import { AuthAuditHook } from './audit/auth-audit.hook';
import { withCorrelationId } from './audit/correlation.middleware';
import { AuthController } from './auth.controller';
import { authEnvSchema } from './env';
import { LocalAuthService, publisherProxy } from './local-auth.service';
import { createRedisRateLimitStorage } from './rate-limit.storage';

@Module({
  imports: [
    SharedModule.register({ validate: (c) => authEnvSchema.parse(c) }),
    ClientsModule.registerAsync([
      MicroserviceUtil.registerNotificationsService(),
    ]),
    AuthModule.forRootAsync({
      imports: [DatabaseModule, ConfigModule],
      useFactory: (
        database: DatabaseService,
        configService: ConfigService,
        cls: ClsService,
      ) => {
        const googleClientId = configService.get<string>('GOOGLE_CLIENT_ID');
        const googleClientSecret = configService.get<string>(
          'GOOGLE_CLIENT_SECRET',
        );
        // Shared Redis counter for the auth rate limiter, so the limit holds
        // across auth workers.
        const rateLimitRedis = new Redis({
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
          // Connect on the first rate-limit check, not at boot: the limiter is
          // off in `test`, and an eager socket would keep the e2e process alive.
          lazyConnect: true,
        });
        const uiUrl =
          configService.get<string>('UI_URL') ?? 'http://localhost:4200';
        // Bound to a name so the hooks below can call `auth.api` — only
        // dereferenced at request time, long after construction.
        const auth = betterAuth({
          appName: 'Nes(x)tJs Template',
          plugins: [twoFactor(), admin()],
          baseURL:
            configService.get<string>('BETTER_AUTH_URL') ||
            'http://localhost:3000/api/auth',
          trustedOrigins: configService
            .getOrThrow<string>('CORS_ORIGIN')
            .split(',')
            .filter((origin) => origin !== '*'),
          // /api/auth/* is served outside the Nest guard pipeline, so the
          // global throttler never reaches it. Enabled everywhere but `test`
          // (e2e suites hammer sign-in), backed by shared Redis, with strict
          // rules on the brute-forceable credential paths.
          rateLimit: {
            enabled: configService.get<string>('NODE_ENV') !== 'test',
            window: 60,
            max: 100,
            customRules: {
              '/sign-in/email': { window: 60, max: 10 },
              '/sign-up/email': { window: 60, max: 5 },
              '/two-factor/verify-totp': { window: 60, max: 10 },
              '/two-factor/verify-backup-code': { window: 60, max: 10 },
              '/request-password-reset': { window: 60, max: 3 },
              '/reset-password': { window: 60, max: 5 },
            },
            customStorage: createRedisRateLimitStorage(rateLimitRedis),
          },
          advanced: {
            // better-auth silently skips origin validation whenever
            // NODE_ENV=test (its own isTest() heuristic), unless this is
            // set explicitly — pin it so origin/CSRF checks are exercised
            // by tests and can never vanish from a misconfigured NODE_ENV.
            disableOriginCheck: false,
            ...(configService.get<string>('COOKIE_DOMAIN')
              ? {
                  crossSubDomainCookies: {
                    enabled: true,
                    domain: configService.getOrThrow<string>('COOKIE_DOMAIN'),
                  },
                }
              : {}),
          },
          ...(googleClientId &&
            googleClientSecret && {
              socialProviders: {
                google: {
                  clientId: googleClientId,
                  clientSecret: googleClientSecret,
                },
              },
            }),
          database: prismaAdapter(database, {
            provider: 'postgresql',
          }),
          user: {
            // Reuses `emailVerification.sendVerificationEmail` below to
            // deliver the confirmation link — better-auth falls back to it
            // when `sendChangeEmailConfirmation` isn't set (confirmed
            // against better-auth's own `api/routes/update-user.mjs`).
            changeEmail: { enabled: true },
            // Self-service account deletion (`authClient.deleteUser`) is
            // disabled by default in better-auth — opt in explicitly. No
            // `sendDeleteAccountVerification` hook: deletion requires the
            // current password and happens immediately, same trade-off as
            // admin's set-password-dialog bypassing the reset-email flow.
            deleteUser: { enabled: true },
          },
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: true,
            // One reset flow, two emails: an account with no credential
            // account never set a password, so it is an invited user.
            sendResetPassword: async ({ user, token }): Promise<void> => {
              if (!publisherProxy.instance) {
                console.warn(
                  '[auth] NotificationsPublisher not ready — skipping sendResetPassword hook',
                );
                return;
              }

              const resetUrl = `${uiUrl}/reset-password?token=${token}`;
              const expiresAt = new Date(
                Date.now() + 60 * 60 * 1000,
              ).toISOString();

              const credential = await database.account.findFirst({
                where: { userId: user.id, providerId: 'credential' },
                select: { id: true },
              });

              if (!credential) {
                publisherProxy.instance.emitUserInvited({
                  userId: user.id,
                  email: user.email,
                  invitationLink: resetUrl,
                  expiresAt,
                });
                return;
              }

              publisherProxy.instance.emitUserPasswordResetRequested({
                userId: user.id,
                email: user.email,
                resetToken: resetUrl,
                expiresAt,
              });
            },
            // `user` is the row loaded *before* the reset, so an unverified
            // user here is setting their first password: following the
            // emailed link proves they own the address, so verify it and
            // send "activated" instead of "password changed". (Not keyed
            // on afterEmailVerification, which also fires on email change.)
            onPasswordReset: async ({ user }): Promise<void> => {
              if (!publisherProxy.instance) {
                console.warn(
                  '[auth] NotificationsPublisher not ready — skipping onPasswordReset hook',
                );
                return;
              }

              if (!user.emailVerified) {
                await database.user.update({
                  where: { id: user.id },
                  data: { emailVerified: true },
                });
                publisherProxy.instance.emitUserAccountActivated({
                  userId: user.id,
                  email: user.email,
                });
                return;
              }

              publisherProxy.instance.emitUserPasswordChanged({
                userId: user.id,
                email: user.email,
                reason: 'Password reset requested by user',
              });
            },
          },
          emailVerification: {
            sendVerificationEmail: ({ user, token }): Promise<void> => {
              if (!publisherProxy.instance) {
                console.warn(
                  '[auth] NotificationsPublisher not ready — skipping sendVerificationEmail hook',
                );
                return Promise.resolve();
              }

              const verificationUrl = `${uiUrl}/verify-email?token=${token}`;

              publisherProxy.instance.emitUserEmailVerificationRequested({
                userId: user.id,
                email: user.email,
                verificationLink: verificationUrl,
              });

              return Promise.resolve();
            },
          },
          hooks: {},
          databaseHooks: {
            user: {
              create: {
                // Runs after the creating transaction commits, so the user
                // is already findable by `requestPasswordReset`.
                after: async (user, context): Promise<void> => {
                  const adminEmail =
                    configService.getOrThrow<string>('ADMIN_EMAIL');
                  if (user.email === adminEmail) return;

                  if (!publisherProxy.instance) {
                    console.warn(
                      '[auth] NotificationsPublisher not ready — skipping user.create.after hook',
                    );
                    return;
                  }

                  // `admin.createUser` sends no email and leaves the account
                  // unverified with no password: the invitation is a password
                  // reset, which `sendResetPassword` turns into an invitation.
                  // No welcome email — the invitation is the only one.
                  if (context?.path === '/admin/create-user') {
                    try {
                      await auth.api.requestPasswordReset({
                        body: {
                          email: user.email,
                          redirectTo: `${uiUrl}/reset-password`,
                        },
                      });
                    } catch (error) {
                      // The account exists; a failed invitation must not
                      // turn the admin's action into an error. The user can
                      // request a fresh link from the sign-in page.
                      console.error(
                        `[auth] failed to send the invitation to ${user.email}`,
                        error,
                      );
                    }
                    return;
                  }

                  publisherProxy.instance.emitUserCreated({
                    userId: user.id,
                    email: user.email,
                  });
                },
              },
            },
          },
        });
        return {
          // Gives audit events recorded inside better-auth hooks a
          // correlation id (better-auth bypasses Nest's CLS middleware).
          middleware: withCorrelationId(cls),
          bodyParser: {
            json: { limit: '10mb' },
            urlencoded: { limit: '10mb', extended: true },
            rawBody: true,
          },
          auth,
        };
      },
      inject: [DatabaseService, ConfigService, ClsService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    NotificationsPublisher,
    LocalAuthService,
    AuthAuditHook,
  ],
})
export class AppModule {}
