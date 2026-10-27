---
name: push-notification
description: Add a new browser push notification type, such as "notify a user when a customer is assigned to them", following the event → apps/notifications → PushProducer pattern. Covers the event pattern and its Zod payload, the emit at the source, the recipient and content handler, the privacy rule for push content, and the tests. Use when asked to "send a push when X", "notify Y in the browser", or "add a notification for X".
license: MIT
compatibility: NestJS + Angular monorepo
metadata:
  author: project
  version: "1.0"
---

Adds one push notification type. **Only two places change: where the event is emitted and
its handler in `apps/notifications`.** The queue (`QUEUES.PUSH`), the job
(`JOB_PATTERNS.SEND_PUSH_NOTIFICATION`), the worker (`PushConsumer`) and the web opt-in are
shared by every type and never change for a new one — a new type needs no new job pattern,
producer method or consumer branch.

The template ships the channel and a **test push** (`POST /push/test`, `PushService.sendTest`
in `apps/api/src/push/`) but no domain event. That test push is the reference for the
payload shape; there is no worked example of an event handler yet, so the first one you add
sets the pattern (put a copy of it in this file when you do).

## Before you start

1. **Who receives it?** Resolve the recipients **in `apps/notifications`**, never at the
   source. Push needs **user ids** (`User.id`, a `String`), not emails. A person with no
   user account simply gets no push.
2. **Is there already an event for it?** If the event exists with an email handler, add
   the push to that handler next to the email. Do not add a second event.
3. **Can the title and body say what happened without personal detail?** See the privacy
   rule below.

## Step 1 — event pattern and payload (only if the event is new)

- `packages/shared/src/constants/events.ts`: add `EVENT_PATTERNS.<DOMAIN>_<EVENT>: '<domain>:<event>'`.
- `packages/shared/src/publishers/input/<domain>-<event>.input.ts`: a Zod schema with
  `.meta({ id })` and a `createZodDto` class (copy `user-invited.input.ts`). Export it from
  `input/index.ts`.
- **Carry ids, not display fields.** The handler reads everything else from the database.
- `packages/shared/src/publishers/notifications.publisher.ts`: add
  `emit<Domain><Event>(data)` → `this.publish(EVENT_PATTERNS.X, data)`, plus a case in
  `notifications.publisher.spec.ts`.

## Step 2 — emit at the source

Call `notificationsPublisher.emit<Domain><Event>({ ... })` where the thing happens, **after
the write commits and never inside a transaction**: the handler re-reads the database, and
an emit is fire-and-forget. A scheduled notification emits from an `apps/cron` job instead,
and the job holds no recipient logic.

## Step 3 — handler in `apps/notifications`

- **Controller** (`app.controller.ts`): `@EventPattern(EVENT_PATTERNS.X)`, `z.parse(schema, data)`,
  delegate to a service. Log the recipient, never a payload field that is a link or token.
- **Service**: resolve the recipients' user ids, then:

```typescript
await this.pushProducer.send({
  userIds,                    // non-empty; skip the call when there are none
  title: 'Customer assigned', // short; shown on the lock screen
  body: 'Ana Silva was assigned to you',
  url: `/customers/${customer.id}`, // an in-app path; the schema refuses an absolute URL
  tag: `customer-${customer.id}`,   // same tag = the device replaces instead of stacking
});
```

- **Register the queue.** `apps/notifications/src/app.module.ts` currently registers only
  `QueueModule.registerQueues([QUEUES.EMAIL])`. The first push type changes it to
  `[QUEUES.EMAIL, QUEUES.PUSH]`, which is what makes `PushProducer` injectable there
  (`QueueModule` provides a producer only for the queues it registers). The worker
  already consumes `QUEUES.PUSH` and needs no change.
- If the same event also sends an email, run both so that a push that cannot be enqueued
  never stops the email (`Promise.allSettled`). If the handler pushes to many recipients
  one by one, catch per recipient.

## Privacy rule (mandatory)

The title and body show on the lock screen and pass through the browser vendor's push
service. They **never** contain personal or sensitive data beyond a person's name: no
tax id (NIF), email address, phone number, free text a user wrote, money, or any field
the project encrypts or redacts (`SanitizeUtil`, `pii-field-encryption`). A name and the
kind of event are allowed. The URL carries an id only. Every detail lives behind the click,
in an authenticated page. Prove it in a test (step 4).

## Tag and URL conventions

- `tag`: `<kind>-<id>` for a notification about one record (`customer-42`), or
  `<kind>-<period>` for a recurring one, so today's replaces yesterday's.
- `url`: the web route of the record, checked against `apps/web/src/app/app.routes.ts`.
  It is opened through `ngsw-worker.js`'s `navigateLastFocusedOrOpen`, behind the normal
  sign-in. `sendPushNotificationInputSchema` rejects absolute URLs and `//`, `/\` prefixes.

## Step 4 — tests

In the handler's service spec, with `PushProducer` mocked as `{ send: jest.fn() }`:

- the push goes to exactly the intended user ids;
- a recipient without a user account gets no push (and still gets the email, if any);
- **the title and body match none of the sensitive values in the fixture** (assert with a
  regex over the fixture's email, tax id and free text);
- a push enqueue failure does not stop the email or the other recipients.

## Verify before declaring done

```bash
pnpm --filter notifications test
pnpm --filter @repo/shared test        # if you added an event
pnpm build
```

On a real device: the service worker only runs on a **production** web build, never under
`ng serve`. Enable push on the account page, trigger the event, and click the notification.

## Read also

- `.claude/CORNER_CASES.md` → "The Angular service worker serves `index.html` for `/api/**`
  navigations" and the push entries
- `apps/worker/src/consumer/push.consumer.ts` (delivery, dead-subscription cleanup) — not
  something to edit for a new type
