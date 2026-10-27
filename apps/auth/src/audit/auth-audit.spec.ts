import { AuditService } from '@repo/shared';
import {
  AUTH_AUDIT_PATHS,
  AuthAuditContext,
  buildAuthEvent,
} from './auth-audit';
import { AUDIT_HOOK_MAX_WAIT_MS, AuthAuditHook } from './auth-audit.hook';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Hook: () => () => undefined,
  AfterHook: () => () => undefined,
  BeforeHook: () => () => undefined,
  AuthService: class MockAuthService {},
}));

// better-auth surfaces failures as an APIError: an Error with a numeric
// `statusCode` and a `body.code` — modelled by shape so this spec does not
// load the ESM better-auth package.
const apiError = (statusCode: number, code: string) =>
  Object.assign(new Error(code), {
    statusCode,
    status: 'ERROR',
    body: { code, message: code },
  });

const user = (id: string, email = `${id}@example.com`) => ({ id, email });
const session = (
  u: { id: string; email: string },
  impersonatedBy?: string,
) => ({
  user: u,
  session: {
    id: `s-${u.id}`,
    token: 'SESSION-TOKEN',
    impersonatedBy: impersonatedBy ?? null,
  },
});

const ctx = (
  path: string,
  overrides: Partial<AuthAuditContext['context']> & {
    body?: unknown;
    headers?: Headers;
  } = {},
): AuthAuditContext => {
  const { body, headers, ...context } = overrides;
  return {
    path,
    body,
    headers:
      headers ??
      new Headers({
        'user-agent': 'jest',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      }),
    context: {
      returned: undefined,
      session: null,
      newSession: null,
      ...context,
    },
  };
};

// design.md → D3a: the contract between a better-auth path and an audit action.
const EXPECTED_ACTIONS: Record<string, string> = {
  '/sign-in/email': 'auth.sign-in',
  '/sign-up/email': 'auth.sign-up',
  '/sign-out': 'auth.sign-out',
  '/change-password': 'auth.change-password',
  '/request-password-reset': 'auth.password-reset.request',
  '/reset-password': 'auth.password-reset.complete',
  '/change-email': 'auth.change-email',
  '/verify-email': 'auth.verify-email',
  '/update-user': 'auth.update-user',
  '/delete-user': 'auth.delete-user',
  '/revoke-session': 'auth.revoke-session',
  '/revoke-sessions': 'auth.revoke-sessions',
  '/revoke-other-sessions': 'auth.revoke-other-sessions',
  '/two-factor/enable': 'auth.two-factor.enable',
  '/two-factor/disable': 'auth.two-factor.disable',
  '/two-factor/generate-backup-codes': 'auth.two-factor.backup-codes',
  '/two-factor/verify-totp': 'auth.two-factor.verify',
  '/two-factor/verify-otp': 'auth.two-factor.verify',
  '/two-factor/verify-backup-code': 'auth.two-factor.verify',
  '/admin/create-user': 'admin.user.create',
  '/admin/update-user': 'admin.user.update',
  '/admin/remove-user': 'admin.user.remove',
  '/admin/ban-user': 'admin.user.ban',
  '/admin/unban-user': 'admin.user.unban',
  '/admin/set-role': 'admin.user.set-role',
  '/admin/set-user-password': 'admin.user.set-password',
  '/admin/impersonate-user': 'admin.user.impersonate',
  '/admin/stop-impersonating': 'admin.user.stop-impersonating',
  '/admin/revoke-user-session': 'admin.user.revoke-session',
  '/admin/revoke-user-sessions': 'admin.user.revoke-sessions',
};

describe('AUTH_AUDIT_PATHS', () => {
  it('maps exactly the audited better-auth paths to their actions', () => {
    const actual = Object.fromEntries(
      Object.entries(AUTH_AUDIT_PATHS).map(([path, spec]) => [
        path,
        spec.action,
      ]),
    );
    expect(actual).toEqual(EXPECTED_ACTIONS);
  });
});

describe('buildAuthEvent', () => {
  describe('paths that are not audited', () => {
    it.each([
      '/get-session',
      '/list-sessions',
      '/list-accounts',
      '/admin/list-users',
      '/admin/get-user',
      '/admin/list-user-sessions',
      '/ok',
    ])('returns null for %s', (path) => {
      expect(
        buildAuthEvent(ctx(path, { returned: { anything: true } })),
      ).toBeNull();
    });
  });

  describe('sign-in', () => {
    it('records a success with the returned user as actor, never the token', () => {
      const event = buildAuthEvent(
        ctx('/sign-in/email', {
          body: { email: 'a@x.y', password: 'Sup3rSecret!' },
          returned: { token: 'SESSION-TOKEN', user: user('u1', 'a@x.y') },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-in',
        outcome: 'success',
        actorId: 'u1',
        actorEmail: 'a@x.y',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(event).not.toHaveProperty('errorCode');
      expect(JSON.stringify(event)).not.toMatch(/Sup3rSecret|SESSION-TOKEN/);
    });

    it('records a wrong password as a failure with the attempted email and the error code', () => {
      const event = buildAuthEvent(
        ctx('/sign-in/email', {
          body: { email: 'a@x.y', password: 'WrongPass1!' },
          returned: apiError(401, 'INVALID_EMAIL_OR_PASSWORD'),
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-in',
        outcome: 'failure',
        errorCode: '401:INVALID_EMAIL_OR_PASSWORD',
        attemptedEmail: 'a@x.y',
      });
      expect(event).not.toHaveProperty('actorId');
      expect(JSON.stringify(event)).not.toContain('WrongPass1!');
    });

    it('records an unknown email the same way, with no actor', () => {
      const event = buildAuthEvent(
        ctx('/sign-in/email', {
          body: { email: 'nobody@x.y', password: 'x' },
          returned: apiError(401, 'INVALID_EMAIL_OR_PASSWORD'),
        }),
      );

      expect(event).toMatchObject({
        outcome: 'failure',
        attemptedEmail: 'nobody@x.y',
      });
      expect(event).not.toHaveProperty('actorId');
    });

    it('records a password-correct sign-in that still needs 2FA with the attempted email', () => {
      const event = buildAuthEvent(
        ctx('/sign-in/email', {
          body: { email: 'a@x.y', password: 'x' },
          returned: { twoFactorRedirect: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-in',
        outcome: 'success',
        attemptedEmail: 'a@x.y',
      });
      expect(event).not.toHaveProperty('actorId');
    });
  });

  describe('self-service paths', () => {
    it('sign-up: the created user is the actor', () => {
      const event = buildAuthEvent(
        ctx('/sign-up/email', {
          body: { email: 'n@x.y', password: 'x', name: 'N' },
          returned: { token: 't', user: user('n1', 'n@x.y') },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-up',
        outcome: 'success',
        actorId: 'n1',
        actorEmail: 'n@x.y',
      });
    });

    it('sign-out: the session user is the actor', () => {
      const event = buildAuthEvent(
        ctx('/sign-out', {
          session: session(user('u1')),
          returned: { success: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-out',
        outcome: 'success',
        actorId: 'u1',
      });
    });

    it('change-password lists the field name only, never a value', () => {
      const event = buildAuthEvent(
        ctx('/change-password', {
          session: session(user('u1')),
          body: { currentPassword: 'OldPass1!', newPassword: 'NewPass1!' },
          returned: { user: user('u1') },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.change-password',
        actorId: 'u1',
        targetType: 'user',
        targetId: 'u1',
        changedFields: ['password'],
      });
      expect(JSON.stringify(event)).not.toMatch(/OldPass1|NewPass1/);
    });

    it('password reset request records the attempted email with no actor', () => {
      const event = buildAuthEvent(
        ctx('/request-password-reset', {
          body: { email: 'a@x.y' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.password-reset.request',
        attemptedEmail: 'a@x.y',
      });
      expect(event).not.toHaveProperty('actorId');
    });

    it('password reset completion never records the token or the new password', () => {
      const event = buildAuthEvent(
        ctx('/reset-password', {
          body: { newPassword: 'NewPass1!', token: 'RESET-TOKEN' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.password-reset.complete',
        outcome: 'success',
      });
      expect(JSON.stringify(event)).not.toMatch(/NewPass1|RESET-TOKEN/);
    });

    it('update-user lists the changed field names without values', () => {
      const event = buildAuthEvent(
        ctx('/update-user', {
          session: session(user('u1')),
          body: { name: 'Ana Silva', image: 'http://i/x.png' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.update-user',
        actorId: 'u1',
        targetId: 'u1',
        changedFields: ['name', 'image'],
      });
      expect(event).not.toHaveProperty('changes');
      expect(JSON.stringify(event)).not.toMatch(/Ana Silva|i\/x\.png/);
    });

    it('change-email lists "email" as changed without the address', () => {
      const event = buildAuthEvent(
        ctx('/change-email', {
          session: session(user('u1')),
          body: { newEmail: 'new@x.y' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.change-email',
        changedFields: ['email'],
      });
      expect(JSON.stringify(event)).not.toContain('new@x.y');
    });

    it('two-factor enable never records the password or the secret', () => {
      const event = buildAuthEvent(
        ctx('/two-factor/enable', {
          session: session(user('u1')),
          body: { password: 'Pass1!' },
          returned: { totpURI: 'otpauth://SECRET', backupCodes: ['BACKUP-1'] },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.two-factor.enable',
        actorId: 'u1',
        targetId: 'u1',
      });
      expect(JSON.stringify(event)).not.toMatch(/Pass1|SECRET|BACKUP-1/);
    });

    it('two-factor verification takes the actor from the new session and never records the code', () => {
      const event = buildAuthEvent(
        ctx('/two-factor/verify-totp', {
          newSession: session(user('u1')),
          body: { code: '123456' },
          returned: { token: 't', user: user('u1') },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.two-factor.verify',
        outcome: 'success',
        actorId: 'u1',
      });
      expect(JSON.stringify(event)).not.toContain('123456');
    });

    it('a failed two-factor verification is recorded as a failure', () => {
      const event = buildAuthEvent(
        ctx('/two-factor/verify-totp', {
          session: null,
          body: { code: '000000' },
          returned: apiError(401, 'INVALID_TWO_FACTOR_CODE'),
        }),
      );

      expect(event).toMatchObject({
        outcome: 'failure',
        errorCode: '401:INVALID_TWO_FACTOR_CODE',
      });
      expect(JSON.stringify(event)).not.toContain('000000');
    });
  });

  describe('admin paths', () => {
    const admin = session(user('admin-1', 'admin@example.com'));

    it('ban: admin actor, user target, banned and the reason as changed values', () => {
      const event = buildAuthEvent(
        ctx('/admin/ban-user', {
          session: admin,
          body: { userId: 'u9', banReason: 'spam', banExpiresIn: 3600 },
          returned: { user: user('u9') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.ban',
        outcome: 'success',
        actorId: 'admin-1',
        actorEmail: 'admin@example.com',
        targetType: 'user',
        targetId: 'u9',
        changes: { banned: true, banReason: 'spam' },
      });
      expect(event?.changedFields).toEqual(
        expect.arrayContaining(['banned', 'banReason']),
      );
    });

    it('unban records banned=false', () => {
      const event = buildAuthEvent(
        ctx('/admin/unban-user', {
          session: admin,
          body: { userId: 'u9' },
          returned: { user: user('u9') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.unban',
        targetId: 'u9',
        changes: { banned: false },
      });
    });

    it('set-role records the new role', () => {
      const event = buildAuthEvent(
        ctx('/admin/set-role', {
          session: admin,
          body: { userId: 'u9', role: 'admin' },
          returned: { user: user('u9') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.set-role',
        targetId: 'u9',
        changedFields: ['role'],
        changes: { role: 'admin' },
      });
    });

    it('set-user-password lists the field name only', () => {
      const event = buildAuthEvent(
        ctx('/admin/set-user-password', {
          session: admin,
          body: { userId: 'u9', newPassword: 'AdminSet1!' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.set-password',
        targetId: 'u9',
        changedFields: ['password'],
      });
      expect(JSON.stringify(event)).not.toContain('AdminSet1!');
    });

    it('update-user lists every changed field but stores values for the safe ones only', () => {
      const event = buildAuthEvent(
        ctx('/admin/update-user', {
          session: admin,
          body: {
            userId: 'u9',
            data: { name: 'New Name', role: 'admin', email: 'e@x.y' },
          },
          returned: user('u9'),
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.update',
        targetId: 'u9',
        changedFields: ['name', 'role', 'email'],
        changes: { role: 'admin' },
      });
      expect(JSON.stringify(event)).not.toMatch(/New Name|e@x\.y/);
    });

    it('create-user: the created user is the target; the password is never recorded', () => {
      const event = buildAuthEvent(
        ctx('/admin/create-user', {
          session: admin,
          body: {
            email: 'n@x.y',
            password: 'Generated1!',
            name: 'N',
            role: 'user',
          },
          returned: { user: user('n1') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.create',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'n1',
        changes: { role: 'user' },
      });
      expect(JSON.stringify(event)).not.toMatch(/Generated1|n@x\.y/);
    });

    it('remove-user and session revocations target the user in the body', () => {
      expect(
        buildAuthEvent(
          ctx('/admin/remove-user', {
            session: admin,
            body: { userId: 'u9' },
            returned: { success: true },
          }),
        ),
      ).toMatchObject({
        action: 'admin.user.remove',
        targetId: 'u9',
      });
      const revoke = buildAuthEvent(
        ctx('/admin/revoke-user-session', {
          session: admin,
          auditTargetId: 'u9',
          body: { sessionToken: 'SESSION-TOKEN-X' },
          returned: { success: true },
        }),
      );
      expect(revoke).toMatchObject({
        action: 'admin.user.revoke-session',
        actorId: 'admin-1',
        targetType: 'user',
        targetId: 'u9',
      });
      expect(JSON.stringify(revoke)).not.toContain('SESSION-TOKEN-X');
      expect(
        buildAuthEvent(
          ctx('/admin/revoke-user-sessions', {
            session: admin,
            body: { userId: 'u9' },
            returned: { success: true },
          }),
        ),
      ).toMatchObject({
        action: 'admin.user.revoke-sessions',
        targetId: 'u9',
      });
    });

    it('impersonate: the admin that started it is the actor, the impersonated user the target', () => {
      const event = buildAuthEvent(
        ctx('/admin/impersonate-user', {
          session: session(user('a0', 'a0@example.com')),
          newSession: session(user('u1'), 'a0'),
          body: { userId: 'u1' },
          returned: { user: user('u1') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.impersonate',
        actorId: 'a0',
        targetId: 'u1',
      });
      expect(event).not.toHaveProperty('impersonatedById');
    });

    it('stop-impersonating: the restored admin is the actor, the impersonated user the target', () => {
      const event = buildAuthEvent(
        ctx('/admin/stop-impersonating', {
          session: session(user('u1'), 'a0'),
          newSession: session(user('a0', 'a0@example.com')),
          returned: { user: user('a0') },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.stop-impersonating',
        actorId: 'a0',
        targetId: 'u1',
      });
    });

    it('a rejected admin action is a failure carrying the actor, target and code', () => {
      const event = buildAuthEvent(
        ctx('/admin/set-role', {
          session: session(user('u2')),
          body: { userId: 'u9', role: 'admin' },
          returned: apiError(403, 'YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE'),
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.set-role',
        outcome: 'failure',
        errorCode: '403:YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE',
        actorId: 'u2',
        targetId: 'u9',
      });
    });
  });

  describe('sign-out actor remembered before the session is cleared', () => {
    it('uses the session stashed by the before hook when better-auth no longer has one', () => {
      const event = buildAuthEvent(
        ctx('/sign-out', {
          session: null,
          newSession: null,
          auditSession: session(user('u1', 'u1@example.com')),
          returned: { success: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'auth.sign-out',
        actorId: 'u1',
        actorEmail: 'u1@example.com',
      });
    });

    it('prefers a live session over the stashed one', () => {
      const event = buildAuthEvent(
        ctx('/sign-out', {
          session: session(user('u2')),
          auditSession: session(user('u1')),
        }),
      );

      expect(event).toMatchObject({ actorId: 'u2' });
    });
  });

  describe('revoke-user-session target (the request carries a token, not a user id)', () => {
    it('has no target when the session owner could not be resolved', () => {
      const event = buildAuthEvent(
        ctx('/admin/revoke-user-session', {
          session: session(user('admin-1')),
          body: { sessionToken: 'x' },
          returned: { success: true },
        }),
      );

      expect(event).toMatchObject({
        action: 'admin.user.revoke-session',
        actorId: 'admin-1',
      });
      expect(event).not.toHaveProperty('targetId');
    });
  });

  describe('impersonation', () => {
    it('an action during an impersonation names the impersonated user as actor and the real admin', () => {
      const event = buildAuthEvent(
        ctx('/update-user', {
          session: session(user('u1'), 'a0'),
          body: { name: 'X' },
          returned: { status: true },
        }),
      );

      expect(event).toMatchObject({ actorId: 'u1', impersonatedById: 'a0' });
    });
  });

  describe('client info', () => {
    it('takes the address the trusted proxy appended, not the first (client-supplied) hop', () => {
      const event = buildAuthEvent(
        ctx('/sign-out', { session: session(user('u1')) }),
      );

      // ctx() sends "203.0.113.7, 10.0.0.1": the first hop is whatever the client claimed.
      expect(event?.ip).toBe('10.0.0.1');
    });

    it('does not trust a forged single-entry header over nothing, and ignores x-real-ip', () => {
      const real = buildAuthEvent(
        ctx('/sign-out', {
          session: session(user('u1')),
          headers: new Headers({ 'x-real-ip': '198.51.100.9' }),
        }),
      );

      expect(real).not.toHaveProperty('ip');
    });

    it('records no address when the trusted entry is not an IP, rather than arbitrary client text', () => {
      const event = buildAuthEvent(
        ctx('/sign-out', {
          session: session(user('u1')),
          headers: new Headers({ 'x-forwarded-for': 'evil<script>' }),
        }),
      );

      expect(event).toMatchObject({ actorId: 'u1' });
      expect(event).not.toHaveProperty('ip');
    });

    it('works without headers', () => {
      const event = buildAuthEvent({
        path: '/sign-out',
        context: {
          returned: undefined,
          session: session(user('u1')),
          newSession: null,
        },
      });

      expect(event).toMatchObject({ action: 'auth.sign-out', actorId: 'u1' });
      expect(event).not.toHaveProperty('ip');
    });
  });

  describe('secrets', () => {
    const SECRETS = [
      'SECRET-PASSWORD',
      'SECRET-TOKEN',
      'SECRET-CODE',
      'SECRET-SESSION',
    ];

    it.each(Object.keys(EXPECTED_ACTIONS))(
      '%s never puts a password, token, code or session id in the event',
      (path) => {
        const event = buildAuthEvent(
          ctx(path, {
            session: session(user('u1')),
            newSession: session(user('u1')),
            body: {
              userId: 'u9',
              password: SECRETS[0],
              newPassword: SECRETS[0],
              currentPassword: SECRETS[0],
              token: SECRETS[1],
              code: SECRETS[2],
              sessionToken: SECRETS[3],
              data: { password: SECRETS[0] },
            },
            returned: {
              token: SECRETS[1],
              user: user('u1'),
              session: { token: SECRETS[3] },
              backupCodes: [SECRETS[2]],
            },
          }),
        );

        expect(event).not.toBeNull();
        const json = JSON.stringify(event);
        for (const secret of SECRETS) expect(json).not.toContain(secret);
      },
    );
  });
});

describe('AuthAuditHook', () => {
  let audit: { record: jest.Mock };
  let authService: { api: { getSession: jest.Mock } };
  let hook: AuthAuditHook;

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    authService = { api: { getSession: jest.fn() } };
    hook = new AuthAuditHook(
      audit as unknown as AuditService,
      authService as never,
    );
  });

  const run = (c: AuthAuditContext) => hook.onAfter(c as never);

  it('records the built event for an audited path', async () => {
    await run(
      ctx('/admin/ban-user', {
        session: session(user('admin-1')),
        body: { userId: 'u9' },
        returned: { user: user('u9') },
      }),
    );

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user.ban', targetId: 'u9' }),
    );
  });

  it.each(['/get-session', '/admin/list-users', '/list-sessions'])(
    'records nothing for %s',
    async (path) => {
      await run(ctx(path, { returned: {} }));

      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('never throws, so it cannot replace the real response with an error', async () => {
    audit.record.mockRejectedValue(new Error('mongo down'));
    await expect(
      run(ctx('/sign-out', { session: session(user('u1')) })),
    ).resolves.toBeUndefined();

    const broken = {
      path: '/sign-in/email',
      get body(): unknown {
        throw new Error('boom');
      },
      context: { returned: undefined, session: null, newSession: null },
    };
    await expect(
      run(broken as unknown as AuthAuditContext),
    ).resolves.toBeUndefined();
  });

  describe('rememberSignOutSession (before hook)', () => {
    it('stashes the live session on the context so the after hook can name the actor', async () => {
      const found = session(user('u1', 'u1@example.com'));
      authService.api.getSession.mockResolvedValue(found);
      const headers = new Headers({ cookie: 'better-auth.session_token=abc' });
      const c = ctx('/sign-out', { headers });

      await hook.rememberSignOutSession(c as never);

      expect(authService.api.getSession).toHaveBeenCalledWith({ headers });
      expect((c.context as Record<string, unknown>).auditSession).toBe(found);
    });

    it('stashes nothing when there is no session', async () => {
      authService.api.getSession.mockResolvedValue(null);
      const c = ctx('/sign-out');

      await hook.rememberSignOutSession(c as never);

      expect(c.context).not.toHaveProperty('auditSession');
    });

    it('never throws when the lookup fails', async () => {
      authService.api.getSession.mockRejectedValue(new Error('db down'));

      await expect(
        hook.rememberSignOutSession(ctx('/sign-out') as never),
      ).resolves.toBeUndefined();
    });
  });

  describe('waiting for the audit write (Mongo outage must not stall the response)', () => {
    afterEach(() => jest.useRealTimers());

    it('returns as soon as the write finishes, leaving no timer behind', async () => {
      jest.useFakeTimers();
      audit.record.mockResolvedValue(undefined);

      await run(ctx('/sign-out', { session: session(user('u1')) }));

      expect(audit.record).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('stops waiting after AUDIT_HOOK_MAX_WAIT_MS when the write hangs', async () => {
      jest.useFakeTimers();
      audit.record.mockReturnValue(new Promise(() => undefined));
      let done = false;

      const pending = run(
        ctx('/sign-out', { session: session(user('u1')) }),
      ).then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(AUDIT_HOOK_MAX_WAIT_MS - 1);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(2);
      await pending;

      expect(done).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the wait short enough for a client timeout of 30s', () => {
      expect(AUDIT_HOOK_MAX_WAIT_MS).toBeLessThanOrEqual(5000);
    });
  });

  describe('rememberRevokedSessionOwner (before hook)', () => {
    const hookCtx = (findSession: jest.Mock, body: unknown) =>
      ({ body, context: { internalAdapter: { findSession } } }) as never;

    it('stashes the owner of the session being revoked so the after hook can name the target', async () => {
      const findSession = jest
        .fn()
        .mockResolvedValue({ session: { token: 't' }, user: { id: 'u9' } });
      const c = hookCtx(findSession, { sessionToken: 'tok' });

      await hook.rememberRevokedSessionOwner(c);

      expect(findSession).toHaveBeenCalledWith('tok');
      expect(
        (c as { context: Record<string, unknown> }).context.auditTargetId,
      ).toBe('u9');
    });

    it('stashes nothing for an unknown token or a missing token', async () => {
      const unknown = hookCtx(jest.fn().mockResolvedValue(null), {
        sessionToken: 'nope',
      });
      const missing = hookCtx(jest.fn(), {});

      await hook.rememberRevokedSessionOwner(unknown);
      await hook.rememberRevokedSessionOwner(missing);

      expect(
        (unknown as { context: Record<string, unknown> }).context,
      ).not.toHaveProperty('auditTargetId');
      expect(
        (
          missing as {
            context: { internalAdapter: { findSession: jest.Mock } };
          }
        ).context.internalAdapter.findSession,
      ).not.toHaveBeenCalled();
    });

    it('never throws when the lookup fails', async () => {
      const c = hookCtx(jest.fn().mockRejectedValue(new Error('db down')), {
        sessionToken: 'tok',
      });

      await expect(
        hook.rememberRevokedSessionOwner(c),
      ).resolves.toBeUndefined();
    });
  });
});
