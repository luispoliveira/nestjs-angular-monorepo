import z from 'zod';
import { DateToISOString } from './date.schema.js';
import { paginatedSchema } from './paginated.schema.js';
import { paginationSchema } from './pagination.schema.js';

/**
 * Every audited action. The single source of truth: the audit hooks in
 * apps/auth and apps/api, the query filter and the web filter dropdown all
 * derive from it (design.md → D3a/D4). Reads are never audited.
 */
export const AUDIT_ACTIONS = [
  // self-service (better-auth)
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
  // admin user management (better-auth admin plugin)
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
  // business writes (apps/api)
  'customer.create',
  'customer.update',
  'customer.delete',
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * The only fields whose *values* may be stored in an audit event's `changes`.
 * Everything else (name, email, taxId, notes, password, …) is recorded by
 * field name only — see the audit-log spec, "Change details never expose
 * protected values".
 */
export const SAFE_CHANGE_FIELDS = ['role', 'banned', 'banReason', 'banExpires'] as const;
export type SafeChangeField = (typeof SAFE_CHANGE_FIELDS)[number];

export const auditOutcomeSchema = z.enum(['success', 'failure']);
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const auditTargetTypeSchema = z.enum(['user', 'customer']);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

export const auditEventSchema = z
  .object({
    id: z.string(),
    occurredAt: DateToISOString,
    action: auditActionSchema,
    outcome: auditOutcomeSchema,
    errorCode: z.string().nullish(),
    actorId: z.string().nullish(),
    actorEmail: z.string().nullish(),
    impersonatedById: z.string().nullish(),
    attemptedEmail: z.string().nullish(),
    targetType: auditTargetTypeSchema.nullish(),
    targetId: z.string().nullish(),
    changedFields: z.array(z.string()).nullish(),
    changes: z.record(z.string(), z.unknown()).nullish(),
    ip: z.string().nullish(),
    userAgent: z.string().nullish(),
    correlationId: z.string().nullish(),
  })
  .meta({ id: 'AuditEvent' });

export type AuditEvent = z.infer<typeof auditEventSchema>;

// No root `.meta({ id })` — same reason as `paginationSchema`/`customerListQuerySchema`:
// a query DTO with a root id breaks Swagger generation. Events are always
// newest first, so there is deliberately no `sortBy`.
export const auditEventListQuerySchema = paginationSchema
  .pick({ skip: true, take: true })
  .extend({
    actorId: z.string().trim().min(1).optional(),
    // Matches the actor's email and, for failed sign-ins that have no actor,
    // the attempted email. Emails are stored lowercased by better-auth.
    actorEmail: z.string().trim().toLowerCase().min(1).optional(),
    targetId: z.string().trim().min(1).optional(),
    action: auditActionSchema.optional(),
    outcome: auditOutcomeSchema.optional(),
    from: DateToISOString.optional(),
    to: DateToISOString.optional(),
  });

export type AuditEventListQuery = z.infer<typeof auditEventListQuerySchema>;

export const auditEventsListResponseSchema = paginatedSchema(auditEventSchema);

export type AuditEventsListResponse = z.infer<typeof auditEventsListResponseSchema>;
