import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ClsService } from 'nestjs-cls';
import { BasePublisher } from '../abstracts';
import { EVENT_PATTERNS, SERVICES } from '../constants';
import {
  UserAccountActivatedInput,
  UserCreatedInput,
  UserEmailVerificationRequestedInput,
  UserInvitedInput,
  UserPasswordChangedInput,
  UserPasswordResetRequestedInput,
  UserTwoFactorDisabledInput,
  UserTwoFactorEnabledInput,
} from './input';

@Injectable()
export class NotificationsPublisher extends BasePublisher {
  constructor(
    @Inject(SERVICES.NOTIFICATIONS)
    private readonly notificationsClient: ClientProxy,
    protected clsService: ClsService,
  ) {
    super(notificationsClient, clsService);
  }

  emitUserCreated(data: UserCreatedInput) {
    this.publish<UserCreatedInput>(EVENT_PATTERNS.USER_CREATED, data);
  }

  emitUserPasswordResetRequested(data: UserPasswordResetRequestedInput) {
    this.publish<UserPasswordResetRequestedInput>(
      EVENT_PATTERNS.USER_PASSWORD_RESET_REQUESTED,
      data,
    );
  }

  emitUserPasswordChanged(data: UserPasswordChangedInput) {
    this.publish<UserPasswordChangedInput>(
      EVENT_PATTERNS.USER_PASSWORD_CHANGED,
      data,
    );
  }

  emitUserEmailVerificationRequested(
    data: UserEmailVerificationRequestedInput,
  ) {
    this.publish<UserEmailVerificationRequestedInput>(
      EVENT_PATTERNS.USER_EMAIL_VERIFICATION_REQUESTED,
      data,
    );
  }

  emitUserTwoFactorEnabled(data: UserTwoFactorEnabledInput) {
    this.publish<UserTwoFactorEnabledInput>(
      EVENT_PATTERNS.USER_TWO_FACTOR_ENABLED,
      data,
    );
  }

  emitUserTwoFactorDisabled(data: UserTwoFactorDisabledInput) {
    this.publish<UserTwoFactorDisabledInput>(
      EVENT_PATTERNS.USER_TWO_FACTOR_DISABLED,
      data,
    );
  }

  emitUserInvited(data: UserInvitedInput) {
    this.publish<UserInvitedInput>(EVENT_PATTERNS.USER_INVITED, data);
  }

  emitUserAccountActivated(data: UserAccountActivatedInput) {
    this.publish<UserAccountActivatedInput>(
      EVENT_PATTERNS.USER_ACCOUNT_ACTIVATED,
      data,
    );
  }
}
