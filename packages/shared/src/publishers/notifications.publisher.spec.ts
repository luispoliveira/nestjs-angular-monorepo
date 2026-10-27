import { ClientProxy } from '@nestjs/microservices';
import { ClsService } from 'nestjs-cls';
import { EVENT_PATTERNS } from '../constants';
import { NotificationsPublisher } from './notifications.publisher';

describe('NotificationsPublisher', () => {
  let publisher: NotificationsPublisher;
  let client: jest.Mocked<ClientProxy>;
  let clsService: jest.Mocked<ClsService>;

  beforeEach(() => {
    client = { emit: jest.fn() } as unknown as jest.Mocked<ClientProxy>;
    clsService = { get: jest.fn().mockReturnValue('corr-1') } as unknown as jest.Mocked<ClsService>;
    publisher = new NotificationsPublisher(client, clsService);
  });

  it('should emit USER_CREATED on emitUserCreated', () => {
    publisher.emitUserCreated({ userId: 'u1', email: 'a@b.com' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_CREATED,
      expect.objectContaining({ userId: 'u1', email: 'a@b.com' }),
    );
  });

  it('should emit USER_PASSWORD_RESET_REQUESTED on emitUserPasswordResetRequested', () => {
    publisher.emitUserPasswordResetRequested({ userId: 'u1', email: 'a@b.com', resetLink: 'http://x' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_PASSWORD_RESET_REQUESTED,
      expect.objectContaining({ email: 'a@b.com', resetLink: 'http://x' }),
    );
  });

  it('should emit USER_PASSWORD_CHANGED on emitUserPasswordChanged', () => {
    publisher.emitUserPasswordChanged({ userId: 'u1', email: 'a@b.com' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_PASSWORD_CHANGED,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should emit USER_EMAIL_VERIFICATION_REQUESTED on emitUserEmailVerificationRequested', () => {
    publisher.emitUserEmailVerificationRequested({ userId: 'u1', email: 'a@b.com', verificationLink: 'http://v' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_EMAIL_VERIFICATION_REQUESTED,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should emit USER_TWO_FACTOR_ENABLED on emitUserTwoFactorEnabled', () => {
    publisher.emitUserTwoFactorEnabled({ userId: 'u1', email: 'a@b.com' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_TWO_FACTOR_ENABLED,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should emit USER_TWO_FACTOR_DISABLED on emitUserTwoFactorDisabled', () => {
    publisher.emitUserTwoFactorDisabled({ userId: 'u1', email: 'a@b.com' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_TWO_FACTOR_DISABLED,
      expect.objectContaining({ email: 'a@b.com' }),
    );
  });

  it('should emit USER_INVITED on emitUserInvited', () => {
    publisher.emitUserInvited({
      userId: 'u1',
      email: 'a@b.com',
      invitationLink: 'https://app.test/reset-password?token=t',
      expiresAt: '2026-10-26T12:00:00.000Z',
    });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_INVITED,
      expect.objectContaining({
        email: 'a@b.com',
        invitationLink: 'https://app.test/reset-password?token=t',
      }),
    );
  });

  it('should emit USER_ACCOUNT_ACTIVATED on emitUserAccountActivated', () => {
    publisher.emitUserAccountActivated({ userId: 'u1', email: 'a@b.com' });
    expect(client.emit).toHaveBeenCalledWith(
      EVENT_PATTERNS.USER_ACCOUNT_ACTIVATED,
      expect.objectContaining({ userId: 'u1', email: 'a@b.com' }),
    );
  });
});
