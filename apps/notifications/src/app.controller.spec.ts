import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: jest.Mocked<AppService>;

  beforeEach(async () => {
    service = {
      sendUserCreatedNotification: jest.fn().mockResolvedValue(undefined),
      sendEmailVerificationNotification: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetNotification: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangeConfirmation: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorEnabledNotification: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorDisabledNotification: jest.fn().mockResolvedValue(undefined),
      sendAccountInvitationNotification: jest.fn().mockResolvedValue(undefined),
      sendAccountActivatedNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AppService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: service }],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  describe('sendUserCreatedNotification()', () => {
    it('should call service with validated email', async () => {
      await controller.sendUserCreatedNotification({
        userId: 'user-1',
        email: 'user@example.com',
      });

      expect(service.sendUserCreatedNotification).toHaveBeenCalledWith(
        'user@example.com',
      );
    });
  });

  describe('sendPasswordResetNotification()', () => {
    it('should call service with email and resetToken', () => {
      controller.sendPasswordResetNotification({
        userId: 'user-1',
        email: 'user@example.com',
        resetToken: 'token-abc',
        expiresAt: new Date().toISOString(),
      });

      expect(service.sendPasswordResetNotification).toHaveBeenCalledWith(
        'user@example.com',
        'token-abc',
      );
    });
  });

  describe('sendPasswordChangeConfirmation()', () => {
    it('should call service with email', () => {
      controller.sendPasswordChangeConfirmation({
        userId: 'user-1',
        email: 'user@example.com',
        reason: 'User changed password',
      });

      expect(service.sendPasswordChangeConfirmation).toHaveBeenCalledWith(
        'user@example.com',
      );
    });
  });

  describe('sendEmailVerificationNotification()', () => {
    it('should call service with email and verificationLink', () => {
      controller.sendEmailVerificationNotification({
        userId: 'user-1',
        email: 'user@example.com',
        verificationLink: 'https://example.com/verify?token=abc',
      });

      expect(service.sendEmailVerificationNotification).toHaveBeenCalledWith(
        'user@example.com',
        'https://example.com/verify?token=abc',
      );
    });
  });

  describe('sendTwoFactorEnabledNotification()', () => {
    it('should call service with email', () => {
      controller.sendTwoFactorEnabledNotification({
        userId: 'user-1',
        email: 'user@example.com',
      });

      expect(service.sendTwoFactorEnabledNotification).toHaveBeenCalledWith(
        'user@example.com',
      );
    });
  });

  describe('sendTwoFactorDisabledNotification()', () => {
    it('should call service with email', () => {
      controller.sendTwoFactorDisabledNotification({
        userId: 'user-1',
        email: 'user@example.com',
      });

      expect(service.sendTwoFactorDisabledNotification).toHaveBeenCalledWith(
        'user@example.com',
      );
    });
  });

  describe('sendAccountInvitationNotification()', () => {
    it('should call service with email and invitationLink', () => {
      controller.sendAccountInvitationNotification({
        userId: 'user-1',
        email: 'user@example.com',
        invitationLink: 'https://app.test/reset-password?token=t',
        expiresAt: new Date().toISOString(),
      });

      expect(service.sendAccountInvitationNotification).toHaveBeenCalledWith(
        'user@example.com',
        'https://app.test/reset-password?token=t',
      );
    });

    it('should reject a payload whose invitationLink is not a URL', () => {
      expect(() =>
        controller.sendAccountInvitationNotification({
          userId: 'user-1',
          email: 'user@example.com',
          invitationLink: 'nope',
          expiresAt: new Date().toISOString(),
        }),
      ).toThrow();
      expect(service.sendAccountInvitationNotification).not.toHaveBeenCalled();
    });
  });

  describe('sendAccountActivatedNotification()', () => {
    it('should call service with email', () => {
      controller.sendAccountActivatedNotification({
        userId: 'user-1',
        email: 'user@example.com',
      });

      expect(service.sendAccountActivatedNotification).toHaveBeenCalledWith(
        'user@example.com',
      );
    });
  });
});
