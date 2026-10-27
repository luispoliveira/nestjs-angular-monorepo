import {
  userAccountActivatedInputSchema,
  userInvitedInputSchema,
} from '../../publishers/input';
import {
  sendAccountActivatedEmailInputSchema,
  sendAccountInvitationEmailInputSchema,
} from './index';

describe('account invitation inputs', () => {
  describe('userInvitedInputSchema', () => {
    const valid = {
      userId: 'u1',
      email: 'a@b.com',
      invitationLink: 'https://app.test/reset-password?token=t',
      expiresAt: '2026-10-26T12:00:00.000Z',
    };

    it('accepts a complete payload', () => {
      expect(userInvitedInputSchema.safeParse(valid).success).toBe(true);
    });

    it.each(['userId', 'email', 'invitationLink', 'expiresAt'])(
      'rejects a payload without %s',
      (field) => {
        const { [field]: _omit, ...rest } = valid as Record<string, string>;
        expect(userInvitedInputSchema.safeParse(rest).success).toBe(false);
      },
    );

    it('rejects an invitationLink that is not a URL', () => {
      expect(
        userInvitedInputSchema.safeParse({ ...valid, invitationLink: 'nope' })
          .success,
      ).toBe(false);
    });
  });

  describe('userAccountActivatedInputSchema', () => {
    it('accepts userId and email', () => {
      expect(
        userAccountActivatedInputSchema.safeParse({
          userId: 'u1',
          email: 'a@b.com',
        }).success,
      ).toBe(true);
    });

    it('rejects an invalid email', () => {
      expect(
        userAccountActivatedInputSchema.safeParse({ userId: 'u1', email: 'x' })
          .success,
      ).toBe(false);
    });
  });

  describe('sendAccountInvitationEmailInputSchema', () => {
    it('requires a valid email and invitationLink', () => {
      expect(
        sendAccountInvitationEmailInputSchema.safeParse({
          email: 'a@b.com',
          invitationLink: 'https://app.test/reset-password?token=t',
        }).success,
      ).toBe(true);
      expect(
        sendAccountInvitationEmailInputSchema.safeParse({ email: 'a@b.com' })
          .success,
      ).toBe(false);
    });
  });

  describe('sendAccountActivatedEmailInputSchema', () => {
    it('requires only a valid email', () => {
      expect(
        sendAccountActivatedEmailInputSchema.safeParse({ email: 'a@b.com' })
          .success,
      ).toBe(true);
      expect(
        sendAccountActivatedEmailInputSchema.safeParse({ email: 'x' }).success,
      ).toBe(false);
    });
  });
});
