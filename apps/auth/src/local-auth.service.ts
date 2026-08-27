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

  @nestjsBetterAuth.AfterHook('/change-password')
  async handlePasswordChanged(ctx: nestjsBetterAuth.AuthHookContext) {
    const session = await this.authService.api.getSession({
      headers: ctx.headers as Headers,
    });

    if (!session || !session.user) {
      throw new Error('Session not found');
    }

    this.notificationsPublisher.emitUserPasswordChanged({
      userId: session.user.id,
      email: session.user.email,
      reason: 'User changed password',
    });
  }

  @nestjsBetterAuth.AfterHook('/two-factor/enable')
  async handleTwoFactorEnabled(ctx: nestjsBetterAuth.AuthHookContext) {
    const session = await this.authService.api.getSession({
      headers: ctx.headers as Headers,
    });

    if (!session || !session.user) {
      throw new Error('Session not found');
    }

    this.notificationsPublisher.emitUserTwoFactorEnabled({
      userId: session.user.id,
      email: session.user.email,
    });
  }

  @nestjsBetterAuth.AfterHook('/two-factor/disable')
  async handleTwoFactorDisabled(ctx: nestjsBetterAuth.AuthHookContext) {
    const session = await this.authService.api.getSession({
      headers: ctx.headers as Headers,
    });

    if (!session || !session.user) {
      throw new Error('Session not found');
    }

    this.notificationsPublisher.emitUserTwoFactorDisabled({
      userId: session.user.id,
      email: session.user.email,
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
