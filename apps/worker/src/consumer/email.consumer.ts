import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  MailService,
  renderAccountActivatedEmail,
  renderAccountInvitationEmail,
} from '@repo/mail';
import {
  JOB_PATTERNS,
  QUEUES,
  SendAccountActivatedEmailInput,
  sendAccountActivatedEmailInputSchema,
  SendAccountInvitationEmailInput,
  sendAccountInvitationEmailInputSchema,
  SendEmailVerificationEmailInput,
  sendEmailVerificationEmailSchema,
  SendPasswordChangedEmailInput,
  sendPasswordChangedEmailInputSchema,
  SendPasswordResetEmailInput,
  sendPasswordResetEmailInputSchema,
  SendTwoFactorDisabledEmailInput,
  SendTwoFactorEnabledEmailInput,
  sendUserTwoFactorDisabledInputSchema,
  sendUserTwoFactorEnabledInputSchema,
  SendWelcomeEmailInput,
  sendWelcomeEmailInputSchema,
  SentryUtil,
} from '@repo/shared';
import { Job, Queue } from 'bullmq';
import z from 'zod';
import { QueueMetricsService } from '../metrics/queue-metrics.service';

@Processor(QUEUES.EMAIL)
export class EmailConsumer extends WorkerHost {
  private readonly logger = new Logger(EmailConsumer.name);

  constructor(
    private readonly mailService: MailService,
    private readonly queueMetrics: QueueMetricsService,
    @InjectQueue(QUEUES.EMAIL_DLQ) private readonly dlqQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_PATTERNS.SEND_WELCOME_EMAIL:
        return this.sendWelcomeEmail(job as Job<SendWelcomeEmailInput>);
      case JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL:
        return this.sendEmailVerificationEmail(
          job as Job<SendEmailVerificationEmailInput>,
        );
      case JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL:
        return this.sendPasswordResetEmail(
          job as Job<SendPasswordResetEmailInput>,
        );
      case JOB_PATTERNS.SEND_PASSWORD_CHANGED_EMAIL:
        return this.sendPasswordChangedEmail(
          job as Job<SendPasswordChangedEmailInput>,
        );
      case JOB_PATTERNS.SEND_TWO_FACTOR_ENABLED_EMAIL:
        return this.sendTwoFactorEnabledEmail(
          job as Job<SendTwoFactorEnabledEmailInput>,
        );
      case JOB_PATTERNS.SEND_TWO_FACTOR_DISABLED_EMAIL:
        return this.sendTwoFactorDisabledEmail(
          job as Job<SendTwoFactorDisabledEmailInput>,
        );
      case JOB_PATTERNS.SEND_ACCOUNT_INVITATION_EMAIL:
        return this.sendAccountInvitationEmail(
          job as Job<SendAccountInvitationEmailInput>,
        );
      case JOB_PATTERNS.SEND_ACCOUNT_ACTIVATED_EMAIL:
        return this.sendAccountActivatedEmail(
          job as Job<SendAccountActivatedEmailInput>,
        );
      default:
        this.logger.warn(`No handler for job ${job.id} with name ${job.name}`);
    }
  }

  private async sendWelcomeEmail(job: Job<SendWelcomeEmailInput>) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendWelcomeEmailInputSchema, job.data);

    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Welcome to Our Service!',
      text: 'Thank you for registering with us.',
    });
  }

  private async sendEmailVerificationEmail(
    job: Job<SendEmailVerificationEmailInput>,
  ) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendEmailVerificationEmailSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Verify your email address',
      text: `Click the following link to verify your email: ${validated.verificationLink}`,
    });
  }

  private async sendPasswordResetEmail(job: Job<SendPasswordResetEmailInput>) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendPasswordResetEmailInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Password Reset Request',
      text: `Click the following link to reset your password: ${validated.resetLink}`,
    });
  }

  private async sendPasswordChangedEmail(
    job: Job<SendPasswordChangedEmailInput>,
  ) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendPasswordChangedEmailInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Your Password Has Been Changed',
      text: 'This is a confirmation that your password has been successfully changed.',
    });
  }

  private async sendTwoFactorEnabledEmail(
    job: Job<SendTwoFactorEnabledEmailInput>,
  ) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendUserTwoFactorEnabledInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Two-factor authentication enabled',
      text: 'Two-factor authentication has been successfully enabled on your account.',
    });
  }

  private async sendTwoFactorDisabledEmail(
    job: Job<SendTwoFactorDisabledEmailInput>,
  ) {
    this.logger.log(
      `Processing job ${job.id} with data: ${JSON.stringify(job.data)}`,
    );
    const validated = z.parse(sendUserTwoFactorDisabledInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      subject: 'Two-factor authentication disabled',
      text: 'Two-factor authentication has been successfully disabled on your account.',
    });
  }

  // The job data holds a live invitation link, so it is never logged.
  private async sendAccountInvitationEmail(
    job: Job<SendAccountInvitationEmailInput>,
  ) {
    this.logger.log(`Processing job ${job.id} (account invitation)`);
    const validated = z.parse(sendAccountInvitationEmailInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      ...renderAccountInvitationEmail({
        invitationLink: validated.invitationLink,
      }),
    });
  }

  private async sendAccountActivatedEmail(
    job: Job<SendAccountActivatedEmailInput>,
  ) {
    this.logger.log(`Processing job ${job.id} (account activated)`);
    const validated = z.parse(sendAccountActivatedEmailInputSchema, job.data);
    await this.mailService.send({
      to: [{ email: validated.email }],
      ...renderAccountActivatedEmail(),
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    const durationMs =
      (job.finishedOn ?? Date.now()) - (job.processedOn ?? Date.now());
    this.queueMetrics.recordDuration(job.name, durationMs);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.queueMetrics.recordFailure(job.name);
    SentryUtil.captureException(error, {
      extra: { jobId: job.id, jobName: job.name, data: job.data },
      tags: { queue: QUEUES.EMAIL, app: 'worker' },
    });

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void this.dlqQueue.add(job.name, job.data, {
        removeOnFail: { count: 1000, age: 2592000 },
        removeOnComplete: true,
      });
    }
  }
}
