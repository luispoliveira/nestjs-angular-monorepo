import {
  pushPublicKeySchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from '@repo/shared-types';
import { createZodDto } from 'nestjs-zod';

// Same schemas apps/web uses to type what it sends.
export class PushSubscriptionDto extends createZodDto(pushSubscriptionSchema) {}
export class PushUnsubscribeDto extends createZodDto(pushUnsubscribeSchema) {}
export class PushPublicKeyDto extends createZodDto(pushPublicKeySchema) {}
