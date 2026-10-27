import { pushSubscriptionSchema, pushUnsubscribeSchema } from './push.schema.js';

const subscription = {
  endpoint: 'https://push.example.com/send/abc123',
  keys: { p256dh: 'BNc-key', auth: 'auth-secret' },
};

describe('pushSubscriptionSchema', () => {
  it('accepts a browser PushSubscription JSON', () => {
    expect(pushSubscriptionSchema.safeParse(subscription).success).toBe(true);
  });

  it('accepts the optional expirationTime a browser may send (and ignores it)', () => {
    const parsed = pushSubscriptionSchema.parse({ ...subscription, expirationTime: null });
    expect(parsed).not.toHaveProperty('expirationTime');
  });

  it.each([
    { ...subscription, endpoint: 'not-a-url' },
    { ...subscription, endpoint: 'http://push.example.com/x' },
    { ...subscription, keys: { p256dh: 'k' } },
    { ...subscription, keys: { p256dh: '', auth: 'a' } },
    { endpoint: subscription.endpoint },
  ])('rejects %j', (value) => {
    expect(pushSubscriptionSchema.safeParse(value).success).toBe(false);
  });
});

describe('pushUnsubscribeSchema', () => {
  it('needs just the endpoint', () => {
    expect(pushUnsubscribeSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(true);
    expect(pushUnsubscribeSchema.safeParse({}).success).toBe(false);
    expect(pushUnsubscribeSchema.safeParse({ endpoint: 'nope' }).success).toBe(false);
  });
});
