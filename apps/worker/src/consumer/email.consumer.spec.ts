import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from '@repo/mail';

import { QUEUES, SendWelcomeEmailInput } from '@repo/shared';
import { Job } from 'bullmq';
import { QueueMetricsService } from '../metrics/queue-metrics.service';
import { EmailConsumer } from './email.consumer';

const mockDlqQueue = { add: jest.fn().mockResolvedValue(undefined) };
const mockQueueMetrics: Partial<QueueMetricsService> = {
  recordDuration: jest.fn(),
  recordFailure: jest.fn(),
};

describe('EmailConsumer', () => {
  let consumer: EmailConsumer;
  let mailService: jest.Mocked<MailService>;

  beforeEach(async () => {
    mailService = {
      send: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailService>;

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailConsumer,
        { provide: MailService, useValue: mailService },
        { provide: QueueMetricsService, useValue: mockQueueMetrics },
        {
          provide: getQueueToken(QUEUES.EMAIL_DLQ),
          useValue: mockDlqQueue,
        },
      ],
    }).compile();

    consumer = module.get<EmailConsumer>(EmailConsumer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('sendWelcomeEmail()', () => {
    it('should call mailService.send with the correct payload', async () => {
      // Arrange — create a mock Bull job
      const job = {
        id: 'job-1',
        data: { email: 'welcome@example.com' },
      } as unknown as Job<SendWelcomeEmailInput>;

      // Act
      await (consumer as any).sendWelcomeEmail(job);

      // Assert
      expect(mailService.send).toHaveBeenCalledTimes(1);
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: [{ email: 'welcome@example.com' }] }),
      );
    });

    it('should throw when job data is missing email', async () => {
      // Arrange
      const job = {
        id: 'job-2',
        data: {},
      } as unknown as Job<SendWelcomeEmailInput>;

      // Act & Assert
      await expect((consumer as any).sendWelcomeEmail(job)).rejects.toThrow();
      expect(mailService.send).not.toHaveBeenCalled();
    });
  });

  describe('sendPasswordResetEmail()', () => {
    it('should call mailService.send with the password-reset payload', async () => {
      const job = {
        id: 'job-10',
        data: {
          email: 'user@example.com',
          resetLink: 'https://example.com/reset',
        },
      } as Job;
      await consumer['sendPasswordResetEmail'](
        job as Job<{ email: string; resetLink: string }>,
      );
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [{ email: 'user@example.com' }],
          subject: expect.stringContaining('Password Reset'),
        }),
      );
    });
  });

  describe('sendEmailVerificationEmail()', () => {
    it('should call mailService.send with the verification payload', async () => {
      const job = {
        id: 'job-11',
        data: {
          email: 'user@example.com',
          verificationLink: 'https://example.com/verify',
        },
      } as Job;
      await consumer['sendEmailVerificationEmail'](
        job as Job<{ email: string; verificationLink: string }>,
      );
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [{ email: 'user@example.com' }],
          subject: expect.stringContaining('Verify'),
        }),
      );
    });
  });

  describe('sendPasswordChangedEmail()', () => {
    it('should call mailService.send with the password-changed payload', async () => {
      const job = { id: 'job-12', data: { email: 'user@example.com' } } as Job;
      await consumer['sendPasswordChangedEmail'](job as Job<{ email: string }>);
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: [{ email: 'user@example.com' }] }),
      );
    });
  });

  describe('sendTwoFactorEnabledEmail()', () => {
    it('should call mailService.send with the 2FA-enabled payload', async () => {
      const job = { id: 'job-13', data: { email: 'user@example.com' } } as Job;
      await consumer['sendTwoFactorEnabledEmail'](
        job as Job<{ email: string }>,
      );
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: [{ email: 'user@example.com' }] }),
      );
    });
  });

  describe('sendTwoFactorDisabledEmail()', () => {
    it('should call mailService.send with the 2FA-disabled payload', async () => {
      const job = { id: 'job-14', data: { email: 'user@example.com' } } as Job;
      await consumer['sendTwoFactorDisabledEmail'](
        job as Job<{ email: string }>,
      );
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: [{ email: 'user@example.com' }] }),
      );
    });
  });

  describe('sendAccountInvitationEmail()', () => {
    const link = 'https://app.test/reset-password?token=abc';

    it('should send the rendered invitation with html and text bodies', async () => {
      const job = {
        id: 'job-20',
        data: { email: 'user@example.com', invitationLink: link },
      } as Job;
      await consumer['sendAccountInvitationEmail'](job as never);
      expect(mailService.send).toHaveBeenCalledTimes(1);
      const mail = mailService.send.mock.calls[0]![0];
      expect(mail.to).toEqual([{ email: 'user@example.com' }]);
      expect(mail.subject).toBe('Your account has been created');
      expect(mail.html).toContain(link);
      expect(mail.text).toContain(link);
    });

    it('should not write the invitation link to the logs', async () => {
      const logSpy = jest.spyOn(consumer['logger'], 'log');
      const job = {
        id: 'job-21',
        data: { email: 'user@example.com', invitationLink: link },
      } as Job;
      await consumer['sendAccountInvitationEmail'](job as never);
      for (const call of logSpy.mock.calls) {
        expect(String(call[0])).not.toContain('token=abc');
      }
    });

    it('should throw when the invitation link is missing', async () => {
      const job = { id: 'job-22', data: { email: 'user@example.com' } } as Job;
      await expect(
        consumer['sendAccountInvitationEmail'](job as never),
      ).rejects.toThrow();
      expect(mailService.send).not.toHaveBeenCalled();
    });
  });

  describe('sendAccountActivatedEmail()', () => {
    it('should send the rendered activation email with html and text bodies', async () => {
      const job = { id: 'job-23', data: { email: 'user@example.com' } } as Job;
      await consumer['sendAccountActivatedEmail'](job as never);
      const mail = mailService.send.mock.calls[0]![0];
      expect(mail.to).toEqual([{ email: 'user@example.com' }]);
      expect(mail.subject).toBe('Your account is active');
      expect(mail.html).toContain('You can now sign in');
      expect(mail.text).toContain('You can now sign in');
    });
  });

  describe('process()', () => {
    const makeJob = (name: string, data: Record<string, unknown> = {}) =>
      ({ name, data }) as Job;

    it.each([
      ['job:send_welcome_email', 'sendWelcomeEmail', { email: 'a@b.com' }],
      [
        'job:send_email_verification_email',
        'sendEmailVerificationEmail',
        { email: 'a@b.com', verificationLink: 'https://x.com' },
      ],
      [
        'job:send_password_reset_email',
        'sendPasswordResetEmail',
        { email: 'a@b.com', resetLink: 'https://x.com' },
      ],
      [
        'job:send_password_changed_email',
        'sendPasswordChangedEmail',
        { email: 'a@b.com' },
      ],
      [
        'job:send_two_factor_enabled_email',
        'sendTwoFactorEnabledEmail',
        { email: 'a@b.com' },
      ],
      [
        'job:send_two_factor_disabled_email',
        'sendTwoFactorDisabledEmail',
        { email: 'a@b.com' },
      ],
      [
        'job:send_account_invitation_email',
        'sendAccountInvitationEmail',
        { email: 'a@b.com', invitationLink: 'https://x.com' },
      ],
      [
        'job:send_account_activated_email',
        'sendAccountActivatedEmail',
        { email: 'a@b.com' },
      ],
    ] as const)(
      'should dispatch job "%s" to %s',
      async (jobName, methodName, data) => {
        const spy = jest
          .spyOn(consumer as never, methodName)
          .mockResolvedValue(undefined as never);
        await consumer.process(makeJob(jobName, data));
        expect(spy).toHaveBeenCalled();
      },
    );

    it('should log a warning for unknown job names', async () => {
      const warnSpy = jest
        .spyOn(consumer['logger'], 'warn')
        .mockImplementation(() => undefined);
      const job = { id: 'job-x', name: 'unknown-job', data: {} } as Job;
      await consumer.process(job);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('onCompleted()', () => {
    it('should record duration when job completes', () => {
      const job = {
        name: 'send-welcome-email',
        finishedOn: 2000,
        processedOn: 1000,
      } as unknown as Job;

      consumer.onCompleted(job);

      expect(mockQueueMetrics.recordDuration).toHaveBeenCalledWith(
        'send-welcome-email',
        1000,
      );
    });
  });

  describe('onFailed()', () => {
    it('should call recordFailure and captureException on any failure', () => {
      const job = {
        id: 'job-3',
        name: 'send-welcome-email',
        data: { email: 'test@example.com' },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job;
      const error = new Error('SMTP error');

      consumer.onFailed(job, error);

      expect(mockQueueMetrics.recordFailure).toHaveBeenCalledWith(job.name);
    });

    it('should route to DLQ when all attempts are exhausted', () => {
      const job = {
        id: 'job-4',
        name: 'send-welcome-email',
        data: { email: 'test@example.com' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as unknown as Job;
      const error = new Error('SMTP error');

      consumer.onFailed(job, error);

      expect(mockDlqQueue.add).toHaveBeenCalledWith(
        job.name,
        job.data,
        expect.objectContaining({ removeOnFail: expect.anything() }),
      );
    });

    it('should not route to DLQ when retries remain', () => {
      const job = {
        id: 'job-5',
        name: 'send-welcome-email',
        data: { email: 'test@example.com' },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job;
      const error = new Error('SMTP error');

      consumer.onFailed(job, error);

      expect(mockDlqQueue.add).not.toHaveBeenCalled();
    });
  });
});
