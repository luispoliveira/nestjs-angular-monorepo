import { prismaAdapter } from '@better-auth/prisma-adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ClientsModule } from '@nestjs/microservices';
import { DatabaseModule, DatabaseService } from '@repo/database';
import {
  MicroserviceUtil,
  NotificationsPublisher,
  SharedModule,
} from '@repo/shared';
import { AuthGuard, AuthModule } from '@thallesp/nestjs-better-auth';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { AuthController } from './auth.controller';
import { authEnvSchema } from './env';
import { LocalAuthService, publisherProxy } from './local-auth.service';

@Module({
  imports: [
    SharedModule.register({ validate: (c) => authEnvSchema.parse(c) }),
    ClientsModule.registerAsync([
      MicroserviceUtil.registerNotificationsService(),
    ]),
    AuthModule.forRootAsync({
      imports: [DatabaseModule, ConfigModule],
      useFactory: (database: DatabaseService, configService: ConfigService) => {
        const googleClientId = configService.get<string>('GOOGLE_CLIENT_ID');
        const googleClientSecret = configService.get<string>(
          'GOOGLE_CLIENT_SECRET',
        );
        return {
          bodyParser: {
            json: { limit: '10mb' },
            urlencoded: { limit: '10mb', extended: true },
            rawBody: true,
          },
          auth: betterAuth({
            appName: 'Nes(x)tJs Template',
            plugins: [twoFactor(), admin()],
            baseURL:
              configService.get<string>('BETTER_AUTH_URL') ||
              'http://localhost:3000/api/auth',
            trustedOrigins: configService
              .getOrThrow<string>('CORS_ORIGIN')
              .split(',')
              .filter((origin) => origin !== '*'),
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
              sendResetPassword: ({ user, token }): Promise<void> => {
                if (!publisherProxy.instance) {
                  console.warn(
                    '[auth] NotificationsPublisher not ready — skipping sendResetPassword hook',
                  );
                  return Promise.resolve();
                }

                const uiUrl =
                  configService.get<string>('UI_URL') ??
                  'http://localhost:4200';
                const resetUrl = `${uiUrl}/reset-password?token=${token}`;
                const expiresAt = new Date(
                  Date.now() + 60 * 60 * 1000,
                ).toISOString();

                publisherProxy.instance.emitUserPasswordResetRequested({
                  userId: user.id,
                  email: user.email,
                  resetToken: resetUrl,
                  expiresAt,
                });

                return Promise.resolve();
              },
              onPasswordReset: ({ user }): Promise<void> => {
                if (!publisherProxy.instance) {
                  console.warn(
                    '[auth] NotificationsPublisher not ready — skipping onPasswordReset hook',
                  );
                  return Promise.resolve();
                }

                publisherProxy.instance.emitUserPasswordChanged({
                  userId: user.id,
                  email: user.email,
                  reason: 'Password reset requested by user',
                });

                return Promise.resolve();
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

                const uiUrl =
                  configService.get<string>('UI_URL') ??
                  'http://localhost:4200';

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
                  after: (user): Promise<void> => {
                    const adminEmail =
                      configService.getOrThrow<string>('ADMIN_EMAIL');
                    if (user.email === adminEmail) return Promise.resolve();

                    if (!publisherProxy.instance) {
                      console.warn(
                        '[auth] NotificationsPublisher not ready — skipping user.create.after hook',
                      );
                      return Promise.resolve();
                    }

                    publisherProxy.instance.emitUserCreated({
                      userId: user.id,
                      email: user.email,
                    });

                    return Promise.resolve();
                  },
                },
              },
            },
          }),
        };
      },
      inject: [DatabaseService, ConfigService],
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
  ],
})
export class AppModule {}
