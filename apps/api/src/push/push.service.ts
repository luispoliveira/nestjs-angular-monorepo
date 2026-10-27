import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@repo/database';
import { PushProducer } from '@repo/shared';
import { PushPublicKey, PushSubscriptionInput } from '@repo/shared-types';

@Injectable()
export class PushService {
  constructor(
    private readonly db: DatabaseService,
    private readonly producer: PushProducer,
    private readonly config: ConfigService,
  ) {}

  /** The public application key only — the private key never leaves the worker. */
  publicKey(): PushPublicKey {
    return { publicKey: this.config.getOrThrow<string>('VAPID_PUBLIC_KEY') };
  }

  /**
   * One row per browser (`endpoint` is unique). Subscribing a browser that
   * already belongs to someone else hands it to the caller, and a removed
   * subscription comes back to life.
   */
  async subscribe(
    userId: string,
    subscription: PushSubscriptionInput,
    userAgent: string | undefined,
  ): Promise<void> {
    const { endpoint, keys } = subscription;
    await this.db.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
      },
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
        deletedAt: null,
      },
    });
  }

  /**
   * Only the caller's own live subscription is removed; an unknown endpoint or
   * someone else's removes nothing and is not an error (so the response never
   * reveals whether an endpoint belongs to another user).
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.pushSubscription.updateMany({
      where: { endpoint, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** A push to the caller's own devices, through the same queue as any other. */
  async sendTest(userId: string): Promise<void> {
    await this.producer.send({
      userIds: [userId],
      title: 'Test notification',
      body: 'Push notifications are working on this device.',
      url: '/account',
      tag: 'test',
    });
  }
}
