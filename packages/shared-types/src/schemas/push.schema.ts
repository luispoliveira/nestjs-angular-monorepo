import z from 'zod';

/**
 * A browser `PushSubscription` as `PushSubscription.toJSON()` returns it.
 * `endpoint` must be https (push services are); the optional
 * `expirationTime` browsers add is accepted and dropped.
 */
export const pushSubscriptionSchema = z
  .object({
    endpoint: z.url({ protocol: /^https$/ }),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  })
  .meta({ id: 'PushSubscription' });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z
  .object({ endpoint: z.url() })
  .meta({ id: 'PushUnsubscribe' });

export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

/** The VAPID public key a browser needs to create a subscription. */
export const pushPublicKeySchema = z
  .object({ publicKey: z.string().min(1) })
  .meta({ id: 'PushPublicKey' });

export type PushPublicKey = z.infer<typeof pushPublicKeySchema>;
