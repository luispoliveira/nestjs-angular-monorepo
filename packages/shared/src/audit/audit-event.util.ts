import type { AuditOutcome } from '@repo/shared-types';
import { AuditMetadata } from './audit.decorator';
import { AuditInput } from './audit.service';

/** The request fields the audit helpers read (an Express request plus what the guards add). */
export interface AuditedRequest {
  params?: Record<string, string | undefined>;
  body?: unknown;
  user?: { id?: string; email?: string; impersonatedBy?: string | null };
  ip?: string;
  headers?: Record<string, unknown>;
  /** Set by AuditContextGuard from the handler's @Audit metadata. */
  audit?: AuditMetadata;
  /** Set once an interceptor has recorded this request, so the filter does not repeat it. */
  auditRecorded?: boolean;
}

/** Builds an audit event for a write request. Never includes body values, only field names. */
export function buildRequestAuditEvent(
  request: AuditedRequest,
  meta: AuditMetadata,
  outcome: AuditOutcome,
  errorCode?: string,
  responseBody?: unknown,
): AuditInput {
  const targetId =
    request.params?.[meta.targetParam ?? 'id'] ??
    (responseBody as { id?: string } | undefined | null)?.id;
  const userAgent = request.headers?.['user-agent'];

  const event: AuditInput = {
    action: meta.action,
    outcome,
    errorCode,
    actorId: request.user?.id,
    actorEmail: request.user?.email,
    impersonatedById: request.user?.impersonatedBy ?? undefined,
    targetType: meta.targetType,
    targetId,
    changedFields: changedFields(request.body, meta.fields),
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  };
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  ) as unknown as AuditInput;
}

function changedFields(
  body: unknown,
  declared: readonly string[] | undefined,
): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const keys = Object.keys(body);
  return declared ? keys.filter((key) => declared.includes(key)) : keys;
}
