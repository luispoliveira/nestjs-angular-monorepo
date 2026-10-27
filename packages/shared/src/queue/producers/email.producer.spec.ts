import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { JOB_PATTERNS } from '../../constants';
import { EmailProducer } from './email.producer';

describe('EmailProducer', () => {
  let producer: EmailProducer;
  let queue: jest.Mocked<Queue>;
  let clsService: jest.Mocked<ClsService>;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<Queue>;
    clsService = { get: jest.fn().mockReturnValue('corr-email') } as unknown as jest.Mocked<ClsService>;
    producer = new EmailProducer(queue, clsService);
  });

  it('should add SEND_WELCOME_EMAIL job with email', async () => {
    await producer.sendWelcomeEmail({ email: 'a@b.com' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_WELCOME_EMAIL,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should add SEND_PASSWORD_RESET_EMAIL job with email and resetLink', async () => {
    await producer.sendPasswordResetEmail({ email: 'a@b.com', resetLink: 'http://reset' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL,
      expect.objectContaining({ email: 'a@b.com', resetLink: 'http://reset' }),
    );
  });

  it('should add SEND_PASSWORD_CHANGED_EMAIL job with email', async () => {
    await producer.sendPasswordChangedEmail({ email: 'a@b.com' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_PASSWORD_CHANGED_EMAIL,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should add SEND_EMAIL_VERIFICATION_EMAIL job with email and verificationLink', async () => {
    await producer.sendEmailVerificationEmail({ email: 'a@b.com', verificationLink: 'http://verify' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL,
      expect.objectContaining({ email: 'a@b.com', verificationLink: 'http://verify' }),
    );
  });

  it('should add SEND_TWO_FACTOR_ENABLED_EMAIL job with email', async () => {
    await producer.sendTwoFactorEnabledEmail({ email: 'a@b.com' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_TWO_FACTOR_ENABLED_EMAIL,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should add SEND_TWO_FACTOR_DISABLED_EMAIL job with email', async () => {
    await producer.sendTwoFactorDisabledEmail({ email: 'a@b.com' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_TWO_FACTOR_DISABLED_EMAIL,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should add SEND_ACCOUNT_INVITATION_EMAIL job with email and invitationLink', async () => {
    await producer.sendAccountInvitationEmail({
      email: 'a@b.com',
      invitationLink: 'https://app.test/reset-password?token=t',
    });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_ACCOUNT_INVITATION_EMAIL,
      expect.objectContaining({
        email: 'a@b.com',
        invitationLink: 'https://app.test/reset-password?token=t',
      }),
    );
  });

  it('should add SEND_ACCOUNT_ACTIVATED_EMAIL job with email', async () => {
    await producer.sendAccountActivatedEmail({ email: 'a@b.com' });
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_ACCOUNT_ACTIVATED_EMAIL,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });
});
