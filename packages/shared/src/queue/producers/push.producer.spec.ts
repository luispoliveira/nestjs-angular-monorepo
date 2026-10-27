import { Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { JOB_PATTERNS } from '../../constants';
import { PushProducer } from './push.producer';

const payload = {
  userIds: ['u1'],
  title: 'Hello',
  body: 'World',
  url: '/account',
  tag: 'test',
};

describe('PushProducer', () => {
  let producer: PushProducer;
  let queue: jest.Mocked<Queue>;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<Queue>;
    const cls = { get: jest.fn().mockReturnValue('corr-push') } as unknown as jest.Mocked<ClsService>;
    producer = new PushProducer(queue, cls);
  });

  it('adds one SEND_PUSH_NOTIFICATION job carrying the payload and the correlation id', async () => {
    await producer.send(payload);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      JOB_PATTERNS.SEND_PUSH_NOTIFICATION,
      expect.objectContaining({ ...payload, correlationId: 'corr-push' }),
    );
  });

  it('rejects an absolute destination before anything is queued', async () => {
    await expect(
      producer.send({ ...payload, url: 'https://evil.example/' }),
    ).rejects.toThrow();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient list before anything is queued', async () => {
    await expect(producer.send({ ...payload, userIds: [] })).rejects.toThrow();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
