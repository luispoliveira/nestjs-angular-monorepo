import { ContextUtil, type AuditInput } from '@repo/shared';
import type { AuditAction } from '@repo/shared-types';

type SessionLike =
  | {
      user?: { id?: string; email?: string };
      session?: { impersonatedBy?: string | null };
    }
  | null
  | undefined;

/** The slice of better-auth's after-hook context this module reads. */
export interface AuthAuditContext {
  path: string;
  body?: unknown;
  headers?: Headers;
  context: {
    returned?: unknown;
    session?: SessionLike;
    newSession?: SessionLike;
    /**
     * Stashed by AuthAuditHook's before hook for `/sign-out`: by the time the
     * after hook runs better-auth has already cleared the session.
     */
    auditSession?: SessionLike;
    /**
     * Stashed by AuthAuditHook's before hook for `/admin/revoke-user-session`,
     * whose request carries a session token, not the user id.
     */
    auditTargetId?: string;
  };
}

type Body = Record<string, unknown>;

interface AuthAuditSpec {
  action: AuditAction;
  /**
   * Whose session names the actor. `new-first` (default): the session a
   * sign-in/verification just created, else the request's session.
   * `session-first`: the request's own session (impersonation: the admin that
   * started it). `returned`: the user in the response (sign-in/up, where no
   * session exists beforehand).
   */
  actor?: 'new-first' | 'session-first' | 'returned';
  target?:
    'self' | 'body.userId' | 'returned.user' | 'previous-session' | 'stashed';
  /** Record `body.email` as the attempted email when no actor can be identified. */
  attemptedEmail?: boolean;
  /** Field NAMES that changed — never values. */
  changedFields?: readonly string[] | 'body' | 'body.data';
  /** Values to store; the audit service additionally filters them to the safe list. */
  changes?: (body: Body) => Record<string, unknown> | undefined;
}

/**
 * The single list of audited better-auth endpoints (design.md → D3a), for
 * better-auth 1.7.x. A path missing here is simply not audited, which keeps
 * every read endpoint (get-session, list-*, get-user) out by default. A unit
 * test pins this table, so an upgrade that renames a path fails loudly.
 */
export const AUTH_AUDIT_PATHS: Record<string, AuthAuditSpec> = {
  // self-service
  '/sign-in/email': {
    action: 'auth.sign-in',
    actor: 'returned',
    attemptedEmail: true,
  },
  '/sign-up/email': { action: 'auth.sign-up', actor: 'returned' },
  '/sign-out': { action: 'auth.sign-out' },
  '/change-password': {
    action: 'auth.change-password',
    target: 'self',
    changedFields: ['password'],
  },
  '/request-password-reset': {
    action: 'auth.password-reset.request',
    attemptedEmail: true,
  },
  '/reset-password': { action: 'auth.password-reset.complete' },
  '/change-email': {
    action: 'auth.change-email',
    target: 'self',
    changedFields: ['email'],
  },
  '/verify-email': { action: 'auth.verify-email', changedFields: ['email'] },
  '/update-user': {
    action: 'auth.update-user',
    target: 'self',
    changedFields: 'body',
  },
  '/delete-user': { action: 'auth.delete-user', target: 'self' },
  '/revoke-session': { action: 'auth.revoke-session', target: 'self' },
  '/revoke-sessions': { action: 'auth.revoke-sessions', target: 'self' },
  '/revoke-other-sessions': {
    action: 'auth.revoke-other-sessions',
    target: 'self',
  },
  '/two-factor/enable': { action: 'auth.two-factor.enable', target: 'self' },
  '/two-factor/disable': { action: 'auth.two-factor.disable', target: 'self' },
  '/two-factor/generate-backup-codes': {
    action: 'auth.two-factor.backup-codes',
    target: 'self',
  },
  '/two-factor/verify-totp': { action: 'auth.two-factor.verify' },
  '/two-factor/verify-otp': { action: 'auth.two-factor.verify' },
  '/two-factor/verify-backup-code': { action: 'auth.two-factor.verify' },
  // admin plugin
  '/admin/create-user': {
    action: 'admin.user.create',
    target: 'returned.user',
    changedFields: 'body',
    changes: (body) =>
      body.role !== undefined ? { role: body.role } : undefined,
  },
  '/admin/update-user': {
    action: 'admin.user.update',
    target: 'body.userId',
    changedFields: 'body.data',
    changes: (body) => {
      const data = asRecord(body.data);
      return data?.role !== undefined ? { role: data.role } : undefined;
    },
  },
  '/admin/remove-user': { action: 'admin.user.remove', target: 'body.userId' },
  '/admin/ban-user': {
    action: 'admin.user.ban',
    target: 'body.userId',
    changedFields: ['banned', 'banReason'],
    changes: (body) => ({
      banned: true,
      ...(typeof body.banReason === 'string'
        ? { banReason: body.banReason }
        : {}),
    }),
  },
  '/admin/unban-user': {
    action: 'admin.user.unban',
    target: 'body.userId',
    changedFields: ['banned'],
    changes: () => ({ banned: false }),
  },
  '/admin/set-role': {
    action: 'admin.user.set-role',
    target: 'body.userId',
    changedFields: ['role'],
    changes: (body) =>
      body.role !== undefined ? { role: body.role } : undefined,
  },
  '/admin/set-user-password': {
    action: 'admin.user.set-password',
    target: 'body.userId',
    changedFields: ['password'],
  },
  '/admin/impersonate-user': {
    action: 'admin.user.impersonate',
    actor: 'session-first',
    target: 'body.userId',
  },
  '/admin/stop-impersonating': {
    action: 'admin.user.stop-impersonating',
    target: 'previous-session',
  },
  '/admin/revoke-user-session': {
    action: 'admin.user.revoke-session',
    target: 'stashed',
  },
  '/admin/revoke-user-sessions': {
    action: 'admin.user.revoke-sessions',
    target: 'body.userId',
  },
};

/** Returns the audit event for a better-auth after-hook call, or null when the path is not audited. */
export function buildAuthEvent(ctx: AuthAuditContext): AuditInput | null {
  const spec = AUTH_AUDIT_PATHS[ctx.path];
  if (!spec) return null;

  const body = asRecord(ctx.body) ?? {};
  const returned = ctx.context.returned;
  const failure = isApiError(returned);

  const actorSession = pickActorSession(spec, ctx.context);
  const actorUser =
    spec.actor === 'returned'
      ? failure
        ? undefined
        : asRecord(asRecord(returned)?.user)
      : actorSession?.user;
  const actorId = asString(actorUser?.id);

  const event: AuditInput = {
    action: spec.action,
    outcome: failure ? 'failure' : 'success',
    errorCode: failure ? errorCode(returned) : undefined,
    actorId,
    actorEmail: asString(actorUser?.email),
    impersonatedById:
      spec.actor === 'returned'
        ? undefined
        : (actorSession?.session?.impersonatedBy ?? undefined),
    attemptedEmail:
      spec.attemptedEmail && !actorId ? asString(body.email) : undefined,
    targetType: undefined,
    targetId: undefined,
    changedFields: changedFields(spec, body),
    changes: spec.changes?.(body),
    ...clientInfo(ctx.headers),
  };

  const targetId = resolveTarget(spec, body, returned, actorId, ctx.context);
  if (targetId) {
    event.targetType = 'user';
    event.targetId = targetId;
  }

  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  ) as unknown as AuditInput;
}

function pickActorSession(
  spec: AuthAuditSpec,
  { session, newSession, auditSession }: AuthAuditContext['context'],
): SessionLike {
  if (spec.actor === 'session-first')
    return session ?? newSession ?? auditSession;
  return newSession ?? session ?? auditSession;
}

function resolveTarget(
  spec: AuthAuditSpec,
  body: Body,
  returned: unknown,
  actorId: string | undefined,
  { session, auditTargetId }: AuthAuditContext['context'],
): string | undefined {
  switch (spec.target) {
    case 'self':
      return actorId;
    case 'body.userId':
      return asString(body.userId);
    case 'returned.user':
      return asString(asRecord(asRecord(returned)?.user)?.id);
    case 'previous-session':
      return asString(session?.user?.id);
    case 'stashed':
      return asString(auditTargetId);
    default:
      return undefined;
  }
}

function changedFields(spec: AuthAuditSpec, body: Body): string[] | undefined {
  if (!spec.changedFields) return undefined;
  if (spec.changedFields === 'body') return Object.keys(body);
  if (spec.changedFields === 'body.data') {
    const data = asRecord(body.data);
    return data ? Object.keys(data) : undefined;
  }
  return [...spec.changedFields];
}

function clientInfo(headers: Headers | undefined): {
  ip?: string;
  userAgent?: string;
} {
  if (!headers) return {};
  return {
    // The trusted proxy's entry, never the client-supplied first one.
    ip: ContextUtil.clientIpFromForwardedFor(headers.get('x-forwarded-for')),
    userAgent: headers.get('user-agent') || undefined,
  };
}

// better-auth hands a failed request to its after hooks as an APIError: an
// Error with a numeric `statusCode` and a `body.code`.
function isApiError(
  value: unknown,
): value is Error & { statusCode: number; body?: { code?: string } } {
  return (
    value instanceof Error &&
    typeof (value as { statusCode?: unknown }).statusCode === 'number'
  );
}

function errorCode(error: unknown): string {
  const { statusCode, body } = error as {
    statusCode: number;
    body?: { code?: string };
  };
  return body?.code ? `${statusCode}:${body.code}` : String(statusCode);
}

function asRecord(value: unknown): Body | undefined {
  return value && typeof value === 'object' ? (value as Body) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
