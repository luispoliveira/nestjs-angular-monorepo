import {
  AUDIT_ACTIONS,
  SAFE_CHANGE_FIELDS,
  auditActionSchema,
  auditEventListQuerySchema,
  auditEventSchema,
  auditEventsListResponseSchema,
} from './audit.schema.js';

// design.md D3a (better-auth paths) + D4 (customer writes) — the contract.
const EXPECTED_ACTIONS = [
  'auth.sign-in',
  'auth.sign-up',
  'auth.sign-out',
  'auth.change-password',
  'auth.password-reset.request',
  'auth.password-reset.complete',
  'auth.change-email',
  'auth.verify-email',
  'auth.update-user',
  'auth.delete-user',
  'auth.revoke-session',
  'auth.revoke-sessions',
  'auth.revoke-other-sessions',
  'auth.two-factor.enable',
  'auth.two-factor.disable',
  'auth.two-factor.backup-codes',
  'auth.two-factor.verify',
  'admin.user.create',
  'admin.user.update',
  'admin.user.remove',
  'admin.user.ban',
  'admin.user.unban',
  'admin.user.set-role',
  'admin.user.set-password',
  'admin.user.impersonate',
  'admin.user.stop-impersonating',
  'admin.user.revoke-session',
  'admin.user.revoke-sessions',
  'customer.create',
  'customer.update',
  'customer.delete',
];

describe('AUDIT_ACTIONS', () => {
  it('contains exactly the actions of the design contract', () => {
    expect([...AUDIT_ACTIONS].sort()).toEqual([...EXPECTED_ACTIONS].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('auditActionSchema accepts a known action and rejects an unknown one', () => {
    expect(auditActionSchema.safeParse('customer.update').success).toBe(true);
    expect(auditActionSchema.safeParse('customer.read').success).toBe(false);
    expect(auditActionSchema.safeParse('auth.get-session').success).toBe(false);
  });
});

describe('SAFE_CHANGE_FIELDS', () => {
  it('lists only the non-sensitive fields whose values may be stored', () => {
    expect([...SAFE_CHANGE_FIELDS].sort()).toEqual(['banExpires', 'banReason', 'banned', 'role']);
  });

  it.each(['password', 'email', 'taxId', 'notes', 'name', 'token'])('does not include %s', (field) => {
    expect((SAFE_CHANGE_FIELDS as readonly string[]).includes(field)).toBe(false);
  });
});

describe('auditEventSchema', () => {
  const wire = {
    id: 'e1',
    occurredAt: '2026-10-10T10:00:00.000Z',
    action: 'admin.user.ban',
    outcome: 'success',
    actorId: 'u-admin',
    actorEmail: 'admin@example.com',
    targetType: 'user',
    targetId: 'u1',
    changedFields: ['banned', 'banReason'],
    changes: { banned: true, banReason: 'spam' },
    ip: '127.0.0.1',
    userAgent: 'vitest',
    correlationId: 'c-1',
  };

  it('decodes occurredAt into a Date', () => {
    expect(auditEventSchema.parse(wire).occurredAt).toBeInstanceOf(Date);
  });

  it('accepts an event with only the required fields', () => {
    const minimal = { id: 'e2', occurredAt: wire.occurredAt, action: 'auth.sign-in', outcome: 'failure' };
    expect(auditEventSchema.safeParse(minimal).success).toBe(true);
  });

  it('accepts null for absent optional fields', () => {
    const nulls = { ...wire, actorId: null, impersonatedById: null, errorCode: null, changes: null };
    expect(auditEventSchema.safeParse(nulls).success).toBe(true);
  });

  it.each(['id', 'occurredAt', 'action', 'outcome'])('rejects an event missing %s', (key) => {
    const copy: Record<string, unknown> = { ...wire };
    delete copy[key];
    expect(auditEventSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects an unknown action and an unknown outcome', () => {
    expect(auditEventSchema.safeParse({ ...wire, action: 'customer.read' }).success).toBe(false);
    expect(auditEventSchema.safeParse({ ...wire, outcome: 'partial' }).success).toBe(false);
  });
});

describe('auditEventListQuerySchema', () => {
  it('applies the pagination defaults', () => {
    expect(auditEventListQuerySchema.parse({})).toEqual({ skip: 0, take: 20 });
  });

  it('rejects take above 100', () => {
    expect(auditEventListQuerySchema.safeParse({ take: '101' }).success).toBe(false);
  });

  it('coerces query-string numbers', () => {
    const q = auditEventListQuerySchema.parse({ skip: '40', take: '10' });
    expect(q.skip).toBe(40);
    expect(q.take).toBe(10);
  });

  it('accepts the filters', () => {
    const q = auditEventListQuerySchema.parse({
      actorId: 'u1',
      targetId: 'u2',
      action: 'admin.user.set-role',
      outcome: 'failure',
    });
    expect(q).toMatchObject({ actorId: 'u1', targetId: 'u2', action: 'admin.user.set-role', outcome: 'failure' });
  });

  it('accepts an actor email filter, trimmed and lowercased', () => {
    expect(auditEventListQuerySchema.parse({ actorEmail: '  Admin@Example.COM ' }).actorEmail).toBe('admin@example.com');
  });

  it('rejects an empty actor email', () => {
    expect(auditEventListQuerySchema.safeParse({ actorEmail: '   ' }).success).toBe(false);
  });

  it('rejects an unknown action and an unknown outcome', () => {
    expect(auditEventListQuerySchema.safeParse({ action: 'customer.read' }).success).toBe(false);
    expect(auditEventListQuerySchema.safeParse({ outcome: 'maybe' }).success).toBe(false);
  });

  it('decodes ISO from/to into Dates', () => {
    const q = auditEventListQuerySchema.parse({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
    expect(q.from).toBeInstanceOf(Date);
    expect(q.to).toBeInstanceOf(Date);
  });

  it('rejects a non-ISO date', () => {
    expect(auditEventListQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('does not offer a sort option (always newest first)', () => {
    expect(auditEventListQuerySchema.parse({ sortBy: 'actorId' })).not.toHaveProperty('sortBy');
  });
});

describe('auditEventsListResponseSchema', () => {
  const item = { id: 'e1', occurredAt: '2026-10-10T10:00:00.000Z', action: 'auth.sign-in', outcome: 'success' };

  it('accepts a well-formed page', () => {
    const result = auditEventsListResponseSchema.safeParse({
      items: [item],
      meta: { page: 1, pageSize: 20, totalPages: 1, total: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a page without meta.total', () => {
    expect(
      auditEventsListResponseSchema.safeParse({ items: [item], meta: { page: 1, pageSize: 20, totalPages: 1 } }).success,
    ).toBe(false);
  });
});
