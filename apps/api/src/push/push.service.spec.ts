import { ConfigService } from '@nestjs/config';
import { PushProducer } from '@repo/shared';
import { PushService } from './push.service';

const subscription = {
  endpoint: 'https://push.example.com/send/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('PushService', () => {
  let service: PushService;
  let db: { pushSubscription: { upsert: jest.Mock; updateMany: jest.Mock } };
  let producer: { send: jest.Mock };

  beforeEach(() => {
    db = {
      pushSubscription: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    producer = { send: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('public-key-value'),
    } as unknown as ConfigService;
    service = new PushService(
      db as never,
      producer as unknown as PushProducer,
      config,
    );
  });

  it('returns the VAPID public key from config', () => {
    expect(service.publicKey()).toEqual({ publicKey: 'public-key-value' });
  });

  describe('subscribe()', () => {
    it('upserts by endpoint, owned by the caller and live again', async () => {
      await service.subscribe('u1', subscription, 'Mozilla/5.0');

      expect(db.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: subscription.endpoint },
        create: {
          userId: 'u1',
          endpoint: subscription.endpoint,
          p256dh: 'p256dh-key',
          auth: 'auth-key',
          userAgent: 'Mozilla/5.0',
        },
        update: {
          userId: 'u1',
          p256dh: 'p256dh-key',
          auth: 'auth-key',
          userAgent: 'Mozilla/5.0',
          deletedAt: null,
        },
      });
    });

    it('stores a missing user agent as null', async () => {
      await service.subscribe('u1', subscription, undefined);
      expect(
        db.pushSubscription.upsert.mock.calls[0]![0].create.userAgent,
      ).toBeNull();
    });
  });

  describe('unsubscribe()', () => {
    it('soft-deletes only a live subscription that belongs to the caller', async () => {
      await service.unsubscribe('u1', subscription.endpoint);

      expect(db.pushSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          endpoint: subscription.endpoint,
          userId: 'u1',
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('succeeds without error when nothing matched', async () => {
      db.pushSubscription.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.unsubscribe('u1', 'https://push.example.com/other'),
      ).resolves.toBeUndefined();
    });
  });

  describe('sendTest()', () => {
    it('queues one push addressed only to the caller, opening the account page', async () => {
      await service.sendTest('u1');

      expect(producer.send).toHaveBeenCalledTimes(1);
      expect(producer.send).toHaveBeenCalledWith({
        userIds: ['u1'],
        title: expect.any(String),
        body: expect.any(String),
        url: '/account',
        tag: 'test',
      });
    });
  });
});
