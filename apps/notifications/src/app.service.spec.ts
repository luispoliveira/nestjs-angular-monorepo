import { Test, TestingModule } from '@nestjs/testing';
import { EmailProducer } from '@repo/shared';
import { AppService } from './app.service';

/**
 * Unit tests for AppService (Notifications)
 *
 * Tests cover:
 * - sendUserCreatedNotification() — delegates to EmailProducer.sendWelcomeEmail
 * - sendEmailVerificationNotification() — delegates to EmailProducer.sendEmailVerificationEmail
 * - sendPasswordResetNotification() — delegates to EmailProducer.sendPasswordResetEmail
 *
 * This file serves as a boilerplate for NestJS service unit tests with a mocked producer.
 *
 * @see AppService
 */
describe('AppService', () => {
  let service: AppService;
  let producer: jest.Mocked<EmailProducer>;

  beforeEach(async () => {
    // Create a manual mock of EmailProducer
    producer = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorEnabledEmail: jest.fn().mockResolvedValue(undefined),
      sendTwoFactorDisabledEmail: jest.fn().mockResolvedValue(undefined),
      sendAccountInvitationEmail: jest.fn().mockResolvedValue(undefined),
      sendAccountActivatedEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailProducer>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: EmailProducer,
          useValue: producer,
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  // ===========================================================================
  // sendUserCreatedNotification() Tests
  // ===========================================================================

  describe('sendUserCreatedNotification()', () => {
    /**
     * Test: Delegates to EmailProducer with correct email
     *
     * Scenario: A user was created with a given email
     * Expected: EmailProducer.sendWelcomeEmail is called once with that email
     */
    it('should call producer.sendWelcomeEmail with the correct email', async () => {
      // Arrange
      const email = 'user@example.com';

      // Act
      await service.sendUserCreatedNotification(email);

      // Assert
      expect(producer.sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendWelcomeEmail).toHaveBeenCalledWith({ email });
    });
  });

  // ===========================================================================
  // sendEmailVerificationNotification() Tests
  // ===========================================================================

  describe('sendEmailVerificationNotification()', () => {
    /**
     * Test: Delegates to EmailProducer with email and verification link
     *
     * Scenario: A user requested email verification
     * Expected: EmailProducer.sendEmailVerificationEmail is called with both args
     */
    it('should call producer.sendEmailVerificationEmail with email and link', async () => {
      // Arrange
      const email = 'user@example.com';
      const verificationLink = 'https://example.com/verify?token=abc';

      // Act
      await service.sendEmailVerificationNotification(email, verificationLink);

      // Assert
      expect(producer.sendEmailVerificationEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendEmailVerificationEmail).toHaveBeenCalledWith({
        email,
        verificationLink,
      });
    });
  });

  // ===========================================================================
  // sendPasswordResetNotification() Tests
  // ===========================================================================

  describe('sendPasswordResetNotification()', () => {
    it('should call producer.sendPasswordResetEmail with email and link', async () => {
      const email = 'user@example.com';
      const resetLink = 'https://example.com/reset?token=xyz';

      await service.sendPasswordResetNotification(email, resetLink);

      expect(producer.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendPasswordResetEmail).toHaveBeenCalledWith({
        email,
        resetLink,
      });
    });
  });

  // ===========================================================================
  // sendPasswordChangeConfirmation() Tests
  // ===========================================================================

  describe('sendPasswordChangeConfirmation()', () => {
    it('should call producer.sendPasswordChangedEmail with the correct email', async () => {
      const email = 'user@example.com';

      await service.sendPasswordChangeConfirmation(email);

      expect(producer.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendPasswordChangedEmail).toHaveBeenCalledWith({ email });
    });
  });

  // ===========================================================================
  // sendTwoFactorEnabledNotification() Tests
  // ===========================================================================

  describe('sendTwoFactorEnabledNotification()', () => {
    it('should call producer.sendTwoFactorEnabledEmail with the correct email', async () => {
      const email = 'user@example.com';

      await service.sendTwoFactorEnabledNotification(email);

      expect(producer.sendTwoFactorEnabledEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendTwoFactorEnabledEmail).toHaveBeenCalledWith({
        email,
      });
    });
  });

  // ===========================================================================
  // sendTwoFactorDisabledNotification() Tests
  // ===========================================================================

  describe('sendTwoFactorDisabledNotification()', () => {
    it('should call producer.sendTwoFactorDisabledEmail with the correct email', async () => {
      const email = 'user@example.com';

      await service.sendTwoFactorDisabledNotification(email);

      expect(producer.sendTwoFactorDisabledEmail).toHaveBeenCalledTimes(1);
      expect(producer.sendTwoFactorDisabledEmail).toHaveBeenCalledWith({
        email,
      });
    });
  });

  describe('sendAccountInvitationNotification()', () => {
    it('should call producer.sendAccountInvitationEmail with email and link', async () => {
      await service.sendAccountInvitationNotification(
        'user@example.com',
        'https://app.test/reset-password?token=t',
      );

      expect(producer.sendAccountInvitationEmail).toHaveBeenCalledWith({
        email: 'user@example.com',
        invitationLink: 'https://app.test/reset-password?token=t',
      });
    });
  });

  describe('sendAccountActivatedNotification()', () => {
    it('should call producer.sendAccountActivatedEmail with the email', async () => {
      await service.sendAccountActivatedNotification('user@example.com');

      expect(producer.sendAccountActivatedEmail).toHaveBeenCalledWith({
        email: 'user@example.com',
      });
    });
  });
});
