import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SAFE_CHANGE_FIELDS } from '@repo/shared-types';
import { ClsService } from 'nestjs-cls';
import { CLS_CORRELATION_ID } from '../constants/cls';
import { MongoService } from '../mongo/mongo.service';
import { AuditEventFields } from '../mongo/schema/audit-event.schema';
import { SentryUtil } from '../utils/sentry.util';

const DEFAULT_RETENTION_DAYS = 365;

/**
 * Upper bounds for fields a client controls (an attempted email, a user
 * agent, the names in a request body). Without them any anonymous request
 * could store an event of megabytes. Truncation is silent: the event still
 * says what happened, just not the whole of an abusive value.
 */
export const AUDIT_LIMITS = {
  email: 254,
  userAgent: 256,
  ip: 64,
  id: 128,
  errorCode: 128,
  changedFields: 50,
  fieldName: 64,
  changeValue: 500,
} as const;

const STRING_LIMITS: Partial<Record<keyof AuditInput, number>> = {
  actorId: AUDIT_LIMITS.id,
  actorEmail: AUDIT_LIMITS.email,
  impersonatedById: AUDIT_LIMITS.id,
  attemptedEmail: AUDIT_LIMITS.email,
  targetId: AUDIT_LIMITS.id,
  correlationId: AUDIT_LIMITS.id,
  ip: AUDIT_LIMITS.ip,
  userAgent: AUDIT_LIMITS.userAgent,
  errorCode: AUDIT_LIMITS.errorCode,
};
const DAY_MS = 24 * 60 * 60 * 1000;

/** What a caller supplies; the service adds the timestamps and the retention. */
export type AuditInput = Omit<AuditEventFields, 'occurredAt' | 'expireAt'>;

/**
 * Records audit events, best-effort: a storage failure is logged and sent to
 * Sentry but never thrown, so the audited action keeps exactly the result it
 * would have had (audit-log spec). `changes` is filtered down to the
 * non-sensitive fields; every other value is dropped here, in one place.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly mongo: MongoService,
    private readonly config: ConfigService,
    private readonly cls: ClsService,
  ) {}

  async record(input: AuditInput): Promise<void> {
    let correlationId = input.correlationId;
    try {
      const occurredAt = new Date();
      const expireAt = new Date(
        occurredAt.getTime() + this.retentionDays() * DAY_MS,
      );
      correlationId ??= this.currentCorrelationId();

      // A failed action changed nothing, so it records no changed fields or
      // values: listing the attempted ones would read as if they had applied.
      const { changes, changedFields, ...rest } = this.bound(input);
      const applied = rest.outcome === 'success';
      const safeChanges = applied ? this.pickSafeChanges(changes) : undefined;
      await this.mongo.createAuditEvent({
        ...rest,
        correlationId,
        occurredAt,
        expireAt,
        ...(applied && changedFields ? { changedFields } : {}),
        ...(safeChanges ? { changes: safeChanges } : {}),
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit event ${input.action} (correlationId=${correlationId ?? '-'})`,
        error instanceof Error ? error.stack : String(error),
      );
      SentryUtil.captureException(error, {
        extra: { action: input.action, correlationId },
        tags: { component: 'audit' },
      });
    }
  }

  private bound(input: AuditInput): AuditInput {
    const bounded: Record<string, unknown> = { ...input };
    for (const [key, max] of Object.entries(STRING_LIMITS)) {
      const value = bounded[key];
      if (typeof value === 'string') bounded[key] = value.slice(0, max);
    }
    if (input.changedFields) {
      bounded.changedFields = input.changedFields
        .slice(0, AUDIT_LIMITS.changedFields)
        .map((field) => field.slice(0, AUDIT_LIMITS.fieldName));
    }
    return bounded as unknown as AuditInput;
  }

  private retentionDays(): number {
    const days = Number(this.config.get('AUDIT_RETENTION_DAYS'));
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  }

  private currentCorrelationId(): string | undefined {
    try {
      return this.cls.get<string>(CLS_CORRELATION_ID);
    } catch {
      return undefined; // outside a CLS context (e.g. a better-auth hook)
    }
  }

  private pickSafeChanges(
    changes: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!changes) return undefined;
    const safe: Record<string, unknown> = {};
    for (const field of SAFE_CHANGE_FIELDS) {
      if (!(field in changes)) continue;
      const value = changes[field];
      safe[field] =
        typeof value === 'string'
          ? value.slice(0, AUDIT_LIMITS.changeValue)
          : value;
    }
    return Object.keys(safe).length > 0 ? safe : undefined;
  }
}
