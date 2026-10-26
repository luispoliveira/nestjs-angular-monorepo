import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { BaseProducer } from '../../abstracts';
import { JOB_PATTERNS, QUEUES } from '../../constants';
import {
  SendAccountActivatedEmailInput,
  SendAccountInvitationEmailInput,
  SendEmailVerificationEmailInput,
  SendPasswordChangedEmailInput,
  SendPasswordResetEmailInput,
  SendTwoFactorDisabledEmailInput,
  SendTwoFactorEnabledEmailInput,
  SendWelcomeEmailInput,
} from '../input';

@Injectable()
export class EmailProducer extends BaseProducer {
  constructor(
    @InjectQueue(QUEUES.EMAIL) emailQueue: Queue,
    protected clsService: ClsService,
  ) {
    super(emailQueue, clsService);
  }

  async sendWelcomeEmail(payload: SendWelcomeEmailInput) {
    const { email } = payload;

    await this.addJob(JOB_PATTERNS.SEND_WELCOME_EMAIL, { email });
  }

  async sendPasswordResetEmail(payload: SendPasswordResetEmailInput) {
    const { email, resetLink } = payload;

    await this.addJob(JOB_PATTERNS.SEND_PASSWORD_RESET_EMAIL, {
      email,
      resetLink,
    });
  }

  async sendPasswordChangedEmail(payload: SendPasswordChangedEmailInput) {
    const { email } = payload;

    await this.addJob(JOB_PATTERNS.SEND_PASSWORD_CHANGED_EMAIL, {
      email,
    });
  }

  async sendEmailVerificationEmail(payload: SendEmailVerificationEmailInput) {
    const { email, verificationLink } = payload;

    await this.addJob(JOB_PATTERNS.SEND_EMAIL_VERIFICATION_EMAIL, {
      email,
      verificationLink,
    });
  }

  sendTwoFactorEnabledEmail(payload: SendTwoFactorEnabledEmailInput) {
    const { email } = payload;

    return this.addJob(JOB_PATTERNS.SEND_TWO_FACTOR_ENABLED_EMAIL, {
      email,
    });
  }

  sendTwoFactorDisabledEmail(payload: SendTwoFactorDisabledEmailInput) {
    const { email } = payload;

    return this.addJob(JOB_PATTERNS.SEND_TWO_FACTOR_DISABLED_EMAIL, {
      email,
    });
  }

  sendAccountInvitationEmail(payload: SendAccountInvitationEmailInput) {
    const { email, invitationLink } = payload;

    return this.addJob(JOB_PATTERNS.SEND_ACCOUNT_INVITATION_EMAIL, {
      email,
      invitationLink,
    });
  }

  sendAccountActivatedEmail(payload: SendAccountActivatedEmailInput) {
    const { email } = payload;

    return this.addJob(JOB_PATTERNS.SEND_ACCOUNT_ACTIVATED_EMAIL, { email });
  }
}
