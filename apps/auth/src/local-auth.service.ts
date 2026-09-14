import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';
import { NotificationsPublisher } from '@repo/shared';
import * as nestjsBetterAuth from '@thallesp/nestjs-better-auth';

export const publisherProxy: { instance: NotificationsPublisher | null } = {
  instance: null,
};

@nestjsBetterAuth.Hook()
@Injectable()
export class LocalAuthService implements OnModuleInit {
  private readonly logger = new Logger(LocalAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: nestjsBetterAuth.AuthService,
    private readonly databaseService: DatabaseService,
    private readonly notificationsPublisher: NotificationsPublisher,
  ) {}

  async onModuleInit() {
    publisherProxy.instance = this.notificationsPublisher;
    await this.ensureAdminUser();
  }

  async ensureAdminUser() {
    const adminEmail = this.configService.getOrThrow<string>('ADMIN_EMAIL');

    const existingUser = await this.databaseService.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingUser) {
      this.logger.log(`Admin user with email ${adminEmail} already exists.`);
      return;
    }

    const adminPassword =
      this.configService.getOrThrow<string>('ADMIN_PASSWORD');

    await this.authService.api.signUpEmail({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: 'Admin',
      },
    });

    await this.databaseService.user.update({
      where: { email: adminEmail },
      data: { emailVerified: true, role: 'admin' },
    });

    this.logger.log(`Admin user created with email ${adminEmail}.`);
  }

  /**
   * Reads the affected user off the hook's own request context instead of
   * re-fetching the session by the request's original cookie header. All
   * three self-service callers below can rotate or delete that exact
   * session as part of the handler that runs just before this hook fires —
   * `/change-password` with `revokeOtherSessions: true` deletes *every*
   * session for the user (not just the "other" ones) and mints a
   * replacement, `/two-factor/disable` always rotates the session, and
   * `/two-factor/enable`'s TOTP path (the default, no `skipVerificationOnEnable`)
   * does not rotate at all — so `getSession(ctx.headers)` intermittently
   * threw "Session not found" once the DB write it was fetching against no
   * longer existed. `ctx.context.newSession` is what better-auth's own
   * `setSessionCookie` populates for the current dispatch when a handler
   * rotates the session (confirmed against `cookies/index.mjs`); it falls
   * back to `ctx.context.session`, the session that authorized this request
   * in the first place, when no rotation happened.
   */
  private currentUser(ctx: nestjsBetterAuth.AuthHookContext) {
    const session = ctx.context.newSession ?? ctx.context.session;
    if (!session?.user) {
      throw new Error('Session not found');
    }
    return session.user;
  }

  @nestjsBetterAuth.AfterHook('/change-password')
  handlePasswordChanged(ctx: nestjsBetterAuth.AuthHookContext) {
    const user = this.currentUser(ctx);

    this.notificationsPublisher.emitUserPasswordChanged({
      userId: user.id,
      email: user.email,
      reason: 'User changed password',
    });
  }

  @nestjsBetterAuth.AfterHook('/two-factor/enable')
  handleTwoFactorEnabled(ctx: nestjsBetterAuth.AuthHookContext) {
    const user = this.currentUser(ctx);

    this.notificationsPublisher.emitUserTwoFactorEnabled({
      userId: user.id,
      email: user.email,
    });
  }

  @nestjsBetterAuth.AfterHook('/two-factor/disable')
  handleTwoFactorDisabled(ctx: nestjsBetterAuth.AuthHookContext) {
    const user = this.currentUser(ctx);

    this.notificationsPublisher.emitUserTwoFactorDisabled({
      userId: user.id,
      email: user.email,
    });
  }

  /**
   * Unlike the self-service hooks above, the session on this request is the
   * *admin's*, not the target user's — better-auth's `/admin/set-user-password`
   * takes the target `userId` in the request body (confirmed against
   * better-auth's own `admin/routes.mjs`), so the affected user is looked up
   * directly instead of via `getSession`.
   */
  @nestjsBetterAuth.AfterHook('/admin/set-user-password')
  async handleAdminSetPassword(ctx: nestjsBetterAuth.AuthHookContext) {
    const { userId } = ctx.body as { userId: string; newPassword: string };

    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    this.notificationsPublisher.emitUserPasswordChanged({
      userId: user.id,
      email: user.email,
      reason: 'Password set by an administrator',
    });
  }
}
