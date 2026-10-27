import {
  createCustomerSchema,
  customerListQuerySchema,
  customerSchema,
  customersListResponseSchema,
  updateCustomerSchema,
} from '@repo/shared-types';
import { createZodDto } from 'nestjs-zod';

// Request DTOs reuse the exact schemas apps/web validates its forms with.
export class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(updateCustomerSchema) {}
export class CustomerListQueryDto extends createZodDto(
  customerListQuerySchema,
) {}

// Response DTOs: `codec: true` encodes Date → ISO string, and unknown keys
// (taxIdEncrypted / taxIdHash) are stripped even if the mapper regresses.
export class CustomerDto extends createZodDto(customerSchema, {
  codec: true,
}) {}
export class CustomersListDto extends createZodDto(
  customersListResponseSchema,
  { codec: true },
) {}
