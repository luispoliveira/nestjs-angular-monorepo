import { usersListResponseSchema } from './user.schema.js';

// Modeled on what `authClient.admin.listUsers()` (better-auth's client)
// actually hands to consuming code (see design.md → D6, user.schema.ts's
// `createdAt` comment) — confirmed via a live browser check against a
// running apps/auth instance. The client parses `createdAt`/`updatedAt`
// into real `Date` instances before this schema ever sees the value, even
// though the raw HTTP wire payload underneath is an ISO string. Extra
// fields the schema doesn't model (emailVerified, image, twoFactorEnabled,
// banReason, banExpires, updatedAt, limit) are expected to be present and
// silently stripped — the schema only asserts what the UI actually reads.
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
});
