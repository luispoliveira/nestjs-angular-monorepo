import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditEvent, AuditEventFields } from './schema/audit-event.schema';
import { EmailLog } from './schema/email-log.schema';
import { Log } from './schema/log.schema';

export interface AuditEventFilter {
  actorId?: string;
  /** Matches `actorEmail` or `attemptedEmail` (a failed sign-in has no actor). */
  actorEmail?: string;
  targetId?: string;
  action?: string;
  outcome?: string;
  from?: Date;
  to?: Date;
}

export type AuditEventRecord = AuditEventFields & { id: string };

@Injectable()
export class MongoService {
  constructor(
    @InjectModel(Log.name) private readonly logModel: Model<Log>,
    @InjectModel(EmailLog.name) private readonly emailLogModel: Model<EmailLog>,
    @InjectModel(AuditEvent.name)
    private readonly auditEventModel: Model<AuditEvent>,
  ) {}

  async createLog(logData: Partial<Log>): Promise<Log> {
    const createdLog = new this.logModel(logData);
    return createdLog.save();
  }

  async updateLog(id: string, updateData: Partial<Log>): Promise<Log | null> {
    return this.logModel
      .findByIdAndUpdate(id, updateData, { returnDocument: 'after' })
      .exec();
  }

  async createEmailLog(emailLogData: Partial<EmailLog>): Promise<EmailLog> {
    const createdEmailLog = new this.emailLogModel(emailLogData);
    return createdEmailLog.save();
  }

  async updateEmailLog(
    id: string,
    updateData: Partial<EmailLog>,
  ): Promise<EmailLog | null> {
    return this.emailLogModel
      .findByIdAndUpdate(id, updateData, { returnDocument: 'after' })
      .exec();
  }

  // Audit events are append-only: there is deliberately no update or delete
  // method here (audit-log spec, "Audit events are immutable").
  async createAuditEvent(data: Partial<AuditEvent>): Promise<AuditEvent> {
    return new this.auditEventModel(data).save();
  }

  async findAuditEvents(
    filter: AuditEventFilter,
    skip: number,
    take: number,
  ): Promise<{ items: AuditEventRecord[]; total: number }> {
    const { from, to, actorEmail, ...equals } = filter;
    const query: Record<string, unknown> = { ...equals };
    if (actorEmail) {
      query.$or = [{ actorEmail }, { attemptedEmail: actorEmail }];
    }
    if (from || to) {
      query.occurredAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const [docs, total] = await Promise.all([
      this.auditEventModel
        .find(query)
        .sort({ occurredAt: -1 })
        .skip(skip)
        .limit(take)
        .lean()
        .exec(),
      this.auditEventModel.countDocuments(query).exec(),
    ]);

    const items = docs.map(({ _id, ...rest }) => ({
      ...(rest as unknown as AuditEventFields),
      id: String(_id),
    }));
    return { items, total };
  }
}
