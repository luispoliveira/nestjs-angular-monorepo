import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AUDIT_ACTIONS } from '@repo/shared-types';
import type {
  AuditAction,
  AuditOutcome,
  AuditTargetType,
} from '@repo/shared-types';
import { Document } from 'mongoose';

/** The plain fields of an audit event, as stored and as returned by queries (plus `id`). */
export interface AuditEventFields {
  occurredAt: Date;
  expireAt: Date;
  action: AuditAction;
  outcome: AuditOutcome;
  errorCode?: string;
  actorId?: string;
  actorEmail?: string;
  impersonatedById?: string;
  attemptedEmail?: string;
  targetType?: AuditTargetType;
  targetId?: string;
  changedFields?: string[];
  changes?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

// No `timestamps` and no `versionKey`: an audit event is written once and
// never updated. Retention is per document (`expireAt`), so changing
// AUDIT_RETENTION_DAYS never alters an existing TTL index (design.md → D1).
@Schema({ collection: 'audit_events', versionKey: false })
export class AuditEvent extends Document implements AuditEventFields {
  @Prop({ required: true })
  occurredAt!: Date;
  @Prop({ required: true })
  expireAt!: Date;
  @Prop({ required: true, type: String, enum: [...AUDIT_ACTIONS] })
  action!: AuditAction;
  @Prop({ required: true, type: String, enum: ['success', 'failure'] })
  outcome!: AuditOutcome;
  @Prop()
  errorCode?: string;
  @Prop()
  actorId?: string;
  @Prop()
  actorEmail?: string;
  @Prop()
  impersonatedById?: string;
  @Prop()
  attemptedEmail?: string;
  @Prop({ type: String, enum: ['user', 'customer'] })
  targetType?: AuditTargetType;
  @Prop()
  targetId?: string;
  // `default: undefined`: mongoose would otherwise store [] on every event.
  @Prop({ type: [String], default: undefined })
  changedFields?: string[];
  @Prop({ type: Object })
  changes?: Record<string, unknown>;
  @Prop()
  ip?: string;
  @Prop()
  userAgent?: string;
  @Prop()
  correlationId?: string;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
AuditEventSchema.index({ occurredAt: -1 });
AuditEventSchema.index({ actorId: 1, occurredAt: -1 });
AuditEventSchema.index({ targetId: 1, occurredAt: -1 });
AuditEventSchema.index({ action: 1, occurredAt: -1 });
AuditEventSchema.index({ outcome: 1, occurredAt: -1 });
