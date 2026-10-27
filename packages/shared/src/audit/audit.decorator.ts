import { SetMetadata } from '@nestjs/common';
import type { AuditAction, AuditTargetType } from '@repo/shared-types';

export const AUDIT_KEY = 'AUDIT';

export interface AuditOptions {
  targetType?: AuditTargetType;
  /** Route param holding the target id (default `id`); falls back to the response `id`. */
  targetParam?: string;
  /**
   * Body fields that may be listed as changed. Declare it on update handlers:
   * unknown body keys (stripped by validation) must not appear in the event.
   */
  fields?: readonly string[];
}

export interface AuditMetadata extends AuditOptions {
  action: AuditAction;
}

/**
 * Marks a write handler as audited (design.md → D4). Only apps/api uses it;
 * apps/auth audits better-auth routes through its hook instead.
 */
export const Audit = (action: AuditAction, options: AuditOptions = {}) =>
  SetMetadata<string, AuditMetadata>(AUDIT_KEY, { action, ...options });
