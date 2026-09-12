import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';
import { NotificationsPublisher } from '@repo/shared';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { LocalAuthService, publisherProxy } from './local-auth.service';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  AuthService: class MockAuthService {
    api = { getSession: jest.fn(), signUpEmail: jest.fn() };
  },
  BetterAuthModule: { forRoot: jest.fn() },
  InjectBetterAuth: () => () => undefined,
  Hook: () => () => undefined,
  AfterHook: () => () => undefined,
}));

describe('LocalAuthService', () => {
  let service: LocalAuthService;
  let configService: jest.Mocked<ConfigService>;
  let authService: { api: { getSession: jest.Mock; signUpEmail: jest.Mock } };
  let databaseService: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let notificationsPublisher: jest.Mocked<NotificationsPublisher>;

  beforeEach(async () => {
    configService = {
      getOrThrow: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    authService = {
      api: {
        getSession: jest.fn(),
        signUpEmail: jest.fn().mockResolvedValue({}),
      },
    };

    databaseService = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    notificationsPublisher = {
      emitUserPasswordChanged: jest.fn(),
      emitUserTwoFactorEnabled: jest.fn(),
      emitUserTwoFactorDisabled: jest.fn(),
      emitUserCreated: jest.fn(),
      emitUserPasswordResetRequested: jest.fn(),
      emitUserEmailVerificationRequested: jest.fn(),
    } as unknown as jest.Mocked<NotificationsPublisher>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalAuthService,
        { provide: ConfigService, useValue: configService },
        { provide: AuthService, useValue: authService },
        { provide: DatabaseService, useValue: databaseService },
        { provide: NotificationsPublisher, useValue: notificationsPublisher },
      ],
    }).compile();

    service = module.get<LocalAuthService>(LocalAuthService);
  });

  // ===========================================================================
  // onModuleInit() Tests
  // ===========================================================================

  describe('onModuleInit()', () => {
    it('should set publisherProxy.instance and call ensureAdminUser', async () => {
      configService.getOrThrow.mockReturnValue('admin@example.com');
      databaseService.user.findUnique.mockResolvedValue({ id: 'admin-id' });

      await service.onModuleInit();

      expect(publisherProxy.instance).toBe(notificationsPublisher);
    });
  });

  // ===========================================================================
  // ensureAdminUser() Tests
  // ===========================================================================

  describe('ensureAdminUser()', () => {
    it('should skip creation when admin user already exists', async () => {
      configService.getOrThrow.mockReturnValue('admin@example.com');
      databaseService.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await service.ensureAdminUser();

      expect(authService.api.signUpEmail).not.toHaveBeenCalled();
      expect(databaseService.user.update).not.toHaveBeenCalled();
    });

    it('should create admin and promote to admin role when user does not exist', async () => {
      configService.getOrThrow
        .mockReturnValueOnce('admin@example.com')
        .mockReturnValueOnce('securepassword');
      databaseService.user.findUnique.mockResolvedValue(null);

      await service.ensureAdminUser();

      expect(authService.api.signUpEmail).toHaveBeenCalledWith({
        body: {
          email: 'admin@example.com',
          password: 'securepassword',
          name: 'Admin',
        },
      });
      expect(databaseService.user.update).toHaveBeenCalledWith({
        where: { email: 'admin@example.com' },
        data: { emailVerified: true, role: 'admin' },
      });
    });
  });

  // ===========================================================================
  // handlePasswordChanged() Tests
  // ===========================================================================

  describe('handlePasswordChanged()', () => {
    it('should emit emitUserPasswordChanged from the original session', () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };

      service.handlePasswordChanged({
        context: { session: { user: mockUser } },
      } as never);

      expect(
        notificationsPublisher.emitUserPasswordChanged,
      ).toHaveBeenCalledWith({
        userId: mockUser.id,
        email: mockUser.email,
        reason: 'User changed password',
      });
      expect(authService.api.getSession).not.toHaveBeenCalled();
    });

    it('should prefer the rotated session when revokeOtherSessions replaced it', () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };

      service.handlePasswordChanged({
        context: {
          session: { user: { id: 'stale', email: 'stale@example.com' } },
          newSession: { user: mockUser },
        },
      } as never);

      expect(
        notificationsPublisher.emitUserPasswordChanged,
      ).toHaveBeenCalledWith({
        userId: mockUser.id,
        email: mockUser.email,
        reason: 'User changed password',
      });
    });

    it('should throw when neither session nor newSession carries a user', () => {
      expect(() =>
        service.handlePasswordChanged({ context: {} } as never),
      ).toThrow('Session not found');
    });
  });

  // ===========================================================================
  // handleTwoFactorEnabled() Tests
  // ===========================================================================

  describe('handleTwoFactorEnabled()', () => {
    it('should emit emitUserTwoFactorEnabled from the original session', () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };

      service.handleTwoFactorEnabled({
        context: { session: { user: mockUser } },
      } as never);

      expect(
        notificationsPublisher.emitUserTwoFactorEnabled,
      ).toHaveBeenCalledWith({
        userId: mockUser.id,
        email: mockUser.email,
      });
    });

    it('should throw when neither session nor newSession carries a user', () => {
      expect(() =>
        service.handleTwoFactorEnabled({ context: {} } as never),
      ).toThrow('Session not found');
    });
  });

  // ===========================================================================
  // handleTwoFactorDisabled() Tests
  // ===========================================================================

  describe('handleTwoFactorDisabled()', () => {
    it('should emit emitUserTwoFactorDisabled from the rotated session', () => {
      const mockUser = { id: 'user-1', email: 'user@example.com' };

      // /two-factor/disable always rotates the session, so the hook must
      // read newSession, not the (by-then-deleted) original session.
      service.handleTwoFactorDisabled({
        context: {
          session: { user: { id: 'stale', email: 'stale@example.com' } },
          newSession: { user: mockUser },
        },
      } as never);

      expect(
        notificationsPublisher.emitUserTwoFactorDisabled,
      ).toHaveBeenCalledWith({
        userId: mockUser.id,
        email: mockUser.email,
      });
      expect(authService.api.getSession).not.toHaveBeenCalled();
    });

    it('should throw when neither session nor newSession carries a user', () => {
      expect(() =>
        service.handleTwoFactorDisabled({ context: {} } as never),
      ).toThrow('Session not found');
    });
  });

  // ===========================================================================
  // handleAdminSetPassword() Tests
  // ===========================================================================

  describe('handleAdminSetPassword()', () => {
    it('should emit emitUserPasswordChanged for the target user, not the admin', async () => {
      const targetUser = { id: 'user-1', email: 'user@example.com' };
      databaseService.user.findUnique.mockResolvedValue(targetUser);

      await service.handleAdminSetPassword({
        body: { userId: 'user-1', newPassword: 'new-password' },
      } as never);

      expect(databaseService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(
        notificationsPublisher.emitUserPasswordChanged,
      ).toHaveBeenCalledWith({
        userId: targetUser.id,
        email: targetUser.email,
        reason: 'Password set by an administrator',
      });
      expect(authService.api.getSession).not.toHaveBeenCalled();
    });

    it('should throw when the target user is not found', async () => {
      databaseService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.handleAdminSetPassword({
          body: { userId: 'missing', newPassword: 'new-password' },
        } as never),
      ).rejects.toThrow('User not found');
    });
  });
});
