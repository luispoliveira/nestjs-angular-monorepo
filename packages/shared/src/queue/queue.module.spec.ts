import { QUEUES } from '../constants';
import { QueueModule } from './queue.module';
import { EmailProducer, PushProducer } from './producers';

describe('QueueModule.registerQueues', () => {
  it('provides only the producer of a registered queue', () => {
    const email = QueueModule.registerQueues([QUEUES.EMAIL]);
    expect(email.providers).toEqual([EmailProducer]);
    expect(email.exports).toContain(EmailProducer);
    expect(email.exports).not.toContain(PushProducer);

    const push = QueueModule.registerQueues([QUEUES.PUSH]);
    expect(push.providers).toEqual([PushProducer]);
    expect(push.exports).toContain(PushProducer);
    expect(push.exports).not.toContain(EmailProducer);
  });

  it('provides both producers when both queues are registered', () => {
    const both = QueueModule.registerQueues([QUEUES.EMAIL, QUEUES.PUSH]);
    expect(both.providers).toEqual([EmailProducer, PushProducer]);
  });

  it('registers a dead-letter companion named <queue>-dlq for every queue', () => {
    const module = QueueModule.registerQueues([QUEUES.EMAIL, QUEUES.PUSH]);
    // 2 queues + their 2 DLQs
    expect(module.imports).toHaveLength(4);
    expect(QUEUES.PUSH_DLQ).toBe(`${QUEUES.PUSH}-dlq`);
    expect(QUEUES.EMAIL_DLQ).toBe(`${QUEUES.EMAIL}-dlq`);
  });
});
