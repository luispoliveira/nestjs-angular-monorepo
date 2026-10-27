import { model } from 'mongoose';
import { AuditEventSchema } from './audit-event.schema';

// A mongoose model builds and validates documents without a connection.
const AuditEventModel = model('AuditEventSchemaSpec', AuditEventSchema);

const valid = {
  occurredAt: new Date('2026-10-10T10:00:00.000Z'),
  expireAt: new Date('2027-10-10T10:00:00.000Z'),
  action: 'auth.sign-in',
  outcome: 'success',
};

describe('AuditEventSchema', () => {
  it('accepts a minimal event', () => {
    expect(new AuditEventModel(valid).validateSync()).toBeUndefined();
  });

  it.each(['occurredAt', 'expireAt', 'action', 'outcome'])('requires %s', (field) => {
    const doc = new AuditEventModel({ ...valid, [field]: undefined });
    expect(doc.validateSync()?.errors[field]).toBeDefined();
  });

  it('rejects an action outside the audited list and an unknown outcome', () => {
    expect(new AuditEventModel({ ...valid, action: 'customer.read' }).validateSync()?.errors.action).toBeDefined();
    expect(new AuditEventModel({ ...valid, outcome: 'partial' }).validateSync()?.errors.outcome).toBeDefined();
  });

  it('does not invent an empty changedFields array for events that changed nothing', () => {
    expect(new AuditEventModel(valid).toObject()).not.toHaveProperty('changedFields');
  });

  it('keeps no version key and writes to the audit_events collection', () => {
    expect(AuditEventSchema.get('versionKey')).toBe(false);
    expect(AuditEventSchema.get('collection')).toBe('audit_events');
  });

  it('expires each document at its own expireAt, so retention can change without index conflicts', () => {
    const ttl = AuditEventSchema.indexes().find(([fields]) => 'expireAt' in fields);
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: 0 });
  });
});
