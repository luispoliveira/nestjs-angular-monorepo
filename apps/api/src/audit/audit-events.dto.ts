import {
  auditEventListQuerySchema,
  auditEventsListResponseSchema,
} from '@repo/shared-types';
import { createZodDto } from 'nestjs-zod';

export class AuditEventListQueryDto extends createZodDto(
  auditEventListQuerySchema,
) {}

// `codec: true` encodes Date → ISO string on the way out; unknown keys such as
// the internal `expireAt` are stripped by the shared response schema.
export class AuditEventsListDto extends createZodDto(
  auditEventsListResponseSchema,
  { codec: true },
) {}
