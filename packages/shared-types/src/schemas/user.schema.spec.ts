import {
  banUserSchema,
  changePasswordSchema,
  setUserPasswordSchema,
  updateProfileSchema,
  userSessionSchema,
  userSessionsListResponseSchema,
  usersListResponseSchema,
} from './user.schema.js';

// Modeled on what `authClient.admin.listUsers()` (better-auth's client)
// actually hands to consuming code (see design.md → D6, user.schema.ts's
// `createdAt` comment) — confirmed via a live browser check against a
// running apps/auth instance. The client parses `createdAt`/`updatedAt`
// into real `Date` instances before this schema ever sees the value, even
// though the raw HTTP wire payload underneath is an ISO string. Extra
// fields the schema doesn't model (emailVerified, image, twoFactorEnabled,
// updatedAt, limit) are expected to be present and silently stripped — the
// schema only asserts what the UI actually reads (banReason/banExpires are
// now modeled, see the banned-with-reason test below).
const realListUsersPayload = {
  users: [
    {
      name: 'Admin',
      email: 'admin@test.example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-08-26T13:15:02.787Z'),
      updatedAt: new Date('2026-08-26T13:15:02.805Z'),
      twoFactorEnabled: false,
      role: 'admin',
      banned: false,
      banReason: null,
      banExpires: null,
      id: 'b41np2CraLfQk5WpWbxjjZwzaNYLzk6v',
    },
    {
      name: 'Shape Capture',
      email: 'shape-capture-1787750102810@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-08-26T13:15:02.856Z'),
      updatedAt: new Date('2026-08-26T13:15:02.866Z'),
      twoFactorEnabled: false,
      role: 'admin',
      banned: false,
      banReason: null,
      banExpires: null,
      id: 'rxNdKAvYBgBiAR8HwQB2LytKHk2RQ22e',
    },
  ],
  total: 2,
  limit: 5,
};

describe('usersListResponseSchema', () => {
  it('parses a real captured listUsers response', () => {
    const result = usersListResponseSchema.parse(realListUsersPayload);

    expect(result.total).toBe(2);
    expect(result.users).toHaveLength(2);
    expect(result.users[0]).toMatchObject({
      id: 'b41np2CraLfQk5WpWbxjjZwzaNYLzk6v',
      name: 'Admin',
      email: 'admin@test.example.com',
      role: 'admin',
      banned: false,
    });
    expect(result.users[0].createdAt).toBeInstanceOf(Date);
    expect(result.users[0].createdAt.toISOString()).toBe('2026-08-26T13:15:02.787Z');
  });

  it('rejects a response missing the required total field', () => {
    const { total: _total, ...withoutTotal } = realListUsersPayload;
    expect(() => usersListResponseSchema.parse(withoutTotal)).toThrow();
  });

  it('rejects a user missing a required field', () => {
    const [firstUser, ...restUsers] = realListUsersPayload.users;
    const { email: _email, ...userWithoutEmail } = firstUser;
    const broken = { ...realListUsersPayload, users: [userWithoutEmail, ...restUsers] };
    expect(() => usersListResponseSchema.parse(broken)).toThrow();
  });

  it('parses a banned user with a reason and an expiry', () => {
    const [firstUser, ...restUsers] = realListUsersPayload.users;
    const banned = {
      ...firstUser,
      banned: true,
      banReason: 'Spamming',
      banExpires: new Date('2026-09-02T13:15:02.787Z'),
    };
    const result = usersListResponseSchema.parse({ ...realListUsersPayload, users: [banned, ...restUsers] });

    expect(result.users[0].banReason).toBe('Spamming');
    expect(result.users[0].banExpires).toBeInstanceOf(Date);
  });
});

describe('banUserSchema', () => {
  it('accepts a reason and an expiry', () => {
    expect(banUserSchema.parse({ reason: 'Spamming', expiresInSeconds: 60 * 60 * 24 })).toEqual({
      reason: 'Spamming',
      expiresInSeconds: 60 * 60 * 24,
    });
  });

  it('accepts no fields at all', () => {
    expect(banUserSchema.parse({})).toEqual({});
  });

  it('accepts a null expiry (never expires)', () => {
    expect(banUserSchema.parse({ expiresInSeconds: null })).toEqual({ expiresInSeconds: null });
  });

  it('rejects a non-positive expiry', () => {
    expect(() => banUserSchema.parse({ expiresInSeconds: 0 })).toThrow();
  });
});

describe('setUserPasswordSchema', () => {
  it('accepts a password meeting the minimum length', () => {
    expect(setUserPasswordSchema.parse({ newPassword: 'longenough' })).toEqual({ newPassword: 'longenough' });
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(() => setUserPasswordSchema.parse({ newPassword: 'short' })).toThrow();
  });
});

describe('updateProfileSchema', () => {
  it('accepts a valid name and email', () => {
    expect(updateProfileSchema.parse({ name: 'Jane Doe', email: 'jane@example.com' })).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('rejects a blank name', () => {
    expect(() => updateProfileSchema.parse({ name: '', email: 'jane@example.com' })).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => updateProfileSchema.parse({ name: 'Jane Doe', email: 'not-an-email' })).toThrow();
  });
});

describe('changePasswordSchema', () => {
  it('accepts a current password and a matching new password meeting the minimum length', () => {
    expect(
      changePasswordSchema.parse({
        currentPassword: 'oldpass1',
        newPassword: 'longenough',
        confirmPassword: 'longenough',
      }),
    ).toEqual({
      currentPassword: 'oldpass1',
      newPassword: 'longenough',
      confirmPassword: 'longenough',
    });
  });

  it('rejects a blank current password', () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: '', newPassword: 'longenough', confirmPassword: 'longenough' }),
    ).toThrow();
  });

  it('rejects a new password shorter than 8 characters', () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: 'oldpass1', newPassword: 'short', confirmPassword: 'short' }),
    ).toThrow();
  });

  it('rejects a confirmation that does not match the new password', () => {
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: 'oldpass1',
        newPassword: 'longenough',
        confirmPassword: 'different',
      }),
    ).toThrow();
  });
});

describe('userSessionSchema / userSessionsListResponseSchema', () => {
  const realSession = {
    id: 'sess_1',
    token: 'session_token_here',
    createdAt: new Date('2026-08-26T13:15:02.787Z'),
    expiresAt: new Date('2026-09-02T13:15:02.787Z'),
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
  };

  it('parses a single session', () => {
    expect(userSessionSchema.parse(realSession)).toMatchObject({ id: 'sess_1', token: 'session_token_here' });
  });

  it('parses a session with null ip/userAgent', () => {
    expect(userSessionSchema.parse({ ...realSession, ipAddress: null, userAgent: null })).toMatchObject({
      ipAddress: null,
      userAgent: null,
    });
  });

  it('rejects a session missing a required field', () => {
    const { token: _token, ...withoutToken } = realSession;
    expect(() => userSessionSchema.parse(withoutToken)).toThrow();
  });

  it('parses a sessions list response', () => {
    const result = userSessionsListResponseSchema.parse({ sessions: [realSession] });
    expect(result.sessions).toHaveLength(1);
  });
});
