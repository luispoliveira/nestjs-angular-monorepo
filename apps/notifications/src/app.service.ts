import { Injectable } from '@nestjs/common';
import { EmailProducer } from '@repo/shared';

@Injectable()
export class AppService {
  constructor(private readonly producer: EmailProducer) {}

  async sendUserCreatedNotification(email: string) {
    await this.producer.sendWelcomeEmail({
      email,
    });
  }

  async sendEmailVerificationNotification(
    email: string,
    verificationLink: string,
  ) {
    await this.producer.sendEmailVerificationEmail({
      email,
      verificationLink,
    });
  }

  async sendPasswordResetNotification(email: string, resetLink: string) {
    await this.producer.sendPasswordResetEmail({
      email,
      resetLink,
    });
  }

  async sendPasswordChangeConfirmation(email: string) {
    await this.producer.sendPasswordChangedEmail({
      email,
    });
  }

  async sendTwoFactorEnabledNotification(email: string) {
    await this.producer.sendTwoFactorEnabledEmail({
      email,
    });
  }

  async sendTwoFactorDisabledNotification(email: string) {
    await this.producer.sendTwoFactorDisabledEmail({
      email,
    });
  }

  async sendAccountInvitationNotification(
    email: string,
    invitationLink: string,
  ) {
    await this.producer.sendAccountInvitationEmail({
      email,
      invitationLink,
    });
  }

  async sendAccountActivatedNotification(email: string) {
    await this.producer.sendAccountActivatedEmail({
      email,
    });
  }
}
