import { sendPushNotificationInputSchema } from './send-push-notification.input';

const valid = {
  userIds: ['u1', 'u2'],
  title: 'Customer updated',
  body: 'Ana Silva was edited',
  url: '/customers/c1',
};

describe('sendPushNotificationInputSchema', () => {
  it('accepts a complete payload, with or without a tag', () => {
    expect(sendPushNotificationInputSchema.safeParse(valid).success).toBe(true);
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, tag: 'customer-c1' })
        .success,
    ).toBe(true);
  });

  it('requires at least one recipient', () => {
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, userIds: [] }).success,
    ).toBe(false);
  });

  it.each(['title', 'body', 'url'])('rejects a payload without %s', (field) => {
    const { [field]: _omit, ...rest } = valid as Record<string, unknown>;
    expect(sendPushNotificationInputSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    'https://evil.example/',
    '//evil.example/x',
    'customers/c1',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
  ])('rejects the destination %p: it must be a path inside the app', (url) => {
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, url }).success,
    ).toBe(false);
  });

  it('accepts a path with a query string', () => {
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, url: '/account?tab=push' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty title or body', () => {
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, title: '' }).success,
    ).toBe(false);
    expect(
      sendPushNotificationInputSchema.safeParse({ ...valid, body: '' }).success,
    ).toBe(false);
  });
});
