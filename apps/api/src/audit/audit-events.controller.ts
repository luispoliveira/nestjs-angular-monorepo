import { Controller, Get, Query } from '@nestjs/common';
import { MongoService, PaginatedUtil, Roles } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { ZodSerializerDto } from 'nestjs-zod';
import { AuditEventListQueryDto, AuditEventsListDto } from './audit-events.dto';

/**
 * Read-only, admin-only view of the audit trail. There is deliberately no
 * other route on this resource (audit events are immutable), and its reads
 * are not audited themselves.
 */
@Controller('audit-events')
export class AuditEventsController {
  constructor(private readonly mongo: MongoService) {}

  @Get()
  @Roles(RoleEnum.ADMIN)
  @ZodSerializerDto(AuditEventsListDto)
  async list(@Query() query: AuditEventListQueryDto) {
    const { skip, take, ...filter } = query;
    const { items, total } = await this.mongo.findAuditEvents(
      filter,
      skip,
      take,
    );
    return PaginatedUtil.getPaginatedResponse(items, total, skip, take);
  }
}
