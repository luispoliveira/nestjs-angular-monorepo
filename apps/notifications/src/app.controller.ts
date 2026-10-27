import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  EVENT_PATTERNS,
  UserAccountActivatedInput,
  userAccountActivatedInputSchema,
  UserCreatedInput,
  userCreatedInputSchema,
  UserEmailVerificationRequestedInput,
  userEmailVerificationRequestedSchema,
  UserInvitedInput,
  userInvitedInputSchema,
  UserPasswordChangedInput,
  userPasswordChangedInputSchema,
  UserPasswordResetRequestedInput,
  userPasswordResetRequestedInputSchema,
  UserTwoFactorDisabledInput,
  userTwoFactorDisabledInputSchema,
  UserTwoFactorEnabledInput,
  userTwoFactorEnabledInputSchema,
} from '@repo/shared';
import z from 'zod';
import { AppService } from './app.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  constructor(private readonly appService: AppService) {}

  @EventPattern(EVENT_PATTERNS.USER_CREATED)
  async sendUserCreatedNotification(@Payload() data: UserCreatedInput) {
    const validated = z.parse(userCreatedInputSchema, data);
    this.logger.log(`Sending USER_CREATED notification to ${validated.email}`);
    await this.appService.sendUserCreatedNotification(validated.email);
  }

  @EventPattern(EVENT_PATTERNS.USER_PASSWORD_RESET_REQUESTED)
  sendPasswordResetNotification(
    @Payload() data: UserPasswordResetRequestedInput,
  ) {
    const validated = z.parse(userPasswordResetRequestedInputSchema, data);
    this.logger.log(
      `Sending USER_PASSWORD_RESET_REQUESTED notification to ${validated.email}`,
    );

    const { email, resetToken } = validated;
    return this.appService.sendPasswordResetNotification(email, resetToken);
  }

  @EventPattern(EVENT_PATTERNS.USER_PASSWORD_CHANGED)
  sendPasswordChangeConfirmation(@Payload() data: UserPasswordChangedInput) {
    const validated = z.parse(userPasswordChangedInputSchema, data);
    this.logger.log(
      `Sending USER_PASSWORD_CHANGED notification to ${validated.email}`,
    );
    return this.appService.sendPasswordChangeConfirmation(validated.email);
  }

  @EventPattern(EVENT_PATTERNS.USER_EMAIL_VERIFICATION_REQUESTED)
  sendEmailVerificationNotification(
    @Payload() data: UserEmailVerificationRequestedInput,
  ) {
    const validated = z.parse(userEmailVerificationRequestedSchema, data);
    this.logger.log(
      `Sending USER_EMAIL_VERIFICATION_REQUESTED notification to ${validated.email}`,
    );
    return this.appService.sendEmailVerificationNotification(
      validated.email,
      validated.verificationLink,
    );
  }

  @EventPattern(EVENT_PATTERNS.USER_TWO_FACTOR_ENABLED)
  sendTwoFactorEnabledNotification(@Payload() data: UserTwoFactorEnabledInput) {
    const validated = z.parse(userTwoFactorEnabledInputSchema, data);
    this.logger.log(
      `Sending USER_TWO_FACTOR_ENABLED notification to ${validated.email}`,
    );
    return this.appService.sendTwoFactorEnabledNotification(validated.email);
  }

  @EventPattern(EVENT_PATTERNS.USER_TWO_FACTOR_DISABLED)
  sendTwoFactorDisabledNotification(
    @Payload() data: UserTwoFactorDisabledInput,
  ) {
    const validated = z.parse(userTwoFactorDisabledInputSchema, data);
    this.logger.log(
      `Sending USER_TWO_FACTOR_DISABLED notification to ${validated.email}`,
    );
    return this.appService.sendTwoFactorDisabledNotification(validated.email);
  }

  @EventPattern(EVENT_PATTERNS.USER_INVITED)
  sendAccountInvitationNotification(@Payload() data: UserInvitedInput) {
    const validated = z.parse(userInvitedInputSchema, data);
    // The invitation link is a live credential: log the recipient only.
    this.logger.log(`Sending USER_INVITED notification to ${validated.email}`);
    return this.appService.sendAccountInvitationNotification(
      validated.email,
      validated.invitationLink,
    );
  }

  @EventPattern(EVENT_PATTERNS.USER_ACCOUNT_ACTIVATED)
  sendAccountActivatedNotification(@Payload() data: UserAccountActivatedInput) {
    const validated = z.parse(userAccountActivatedInputSchema, data);
    this.logger.log(
      `Sending USER_ACCOUNT_ACTIVATED notification to ${validated.email}`,
    );
    return this.appService.sendAccountActivatedNotification(validated.email);
  }
}
