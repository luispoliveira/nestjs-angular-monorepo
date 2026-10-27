import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { redactJobData } from '@repo/shared';

type AdapterArgs = ConstructorParameters<typeof BullMQAdapter>;

/**
 * Bull Board builds its adapters itself (`forFeature` takes the class) and
 * formatters can't be passed as options, so the redaction is installed here.
 * The formatter only shapes what the dashboard displays: the job in Redis, and
 * so a DLQ replay, keeps its real data.
 */
export class RedactingBullMQAdapter extends BullMQAdapter {
  constructor(...args: AdapterArgs) {
    super(...args);
    this.setFormatter('data', redactJobData);
  }
}
