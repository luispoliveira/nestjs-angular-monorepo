import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import { PushService } from './push.service';

const subscriptionJson = {
  endpoint: 'https://push.example.com/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};
const fakeSubscription = { endpoint: subscriptionJson.endpoint, toJSON: () => subscriptionJson };

interface FakeSwPush {
  isEnabled: boolean;
  subscription: BehaviorSubject<unknown>;
  requestSubscription: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function setUp(options: { swPush?: Partial<FakeSwPush> | null; permission?: NotificationPermission } = {}) {
  vi.stubGlobal('Notification', { permission: options.permission ?? 'default' });
  vi.stubGlobal('PushManager', class {});
  const swPush: FakeSwPush | null =
    options.swPush === null
      ? null
      : {
          isEnabled: true,
          subscription: new BehaviorSubject<unknown>(null),
          requestSubscription: vi.fn().mockResolvedValue(fakeSubscription),
          unsubscribe: vi.fn().mockResolvedValue(undefined),
          ...options.swPush,
        };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ...(swPush ? [{ provide: SwPush, useValue: swPush }] : []),
    ],
  });
  return { service: TestBed.inject(PushService), http: TestBed.inject(HttpTestingController), swPush };
}

describe('PushService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.unstubAllGlobals();
  });

  describe('support', () => {
    it('is enabled-off when the browser can receive push and nothing is subscribed', () => {
      const { service } = setUp();
      expect(service.status()).toBe('disabled');
    });

    it('is unsupported, with a reason, when the service worker is not enabled', () => {
      const { service } = setUp({ swPush: { isEnabled: false } });
      expect(service.status()).toBe('unsupported');
      expect(service.unsupportedReason).toMatch(/not available/i);
    });

    it('is unsupported when there is no SwPush at all (no service worker registered)', () => {
      const { service } = setUp({ swPush: null });
      expect(service.status()).toBe('unsupported');
    });

    it('is unsupported where the browser has no PushManager (e.g. iOS outside the home screen)', () => {
      const { service } = setUp();
      vi.stubGlobal('PushManager', undefined);
      expect(service.status()).toBe('unsupported');
    });

    it('is blocked when the browser permission was already denied', () => {
      const { service } = setUp({ permission: 'denied' });
      expect(service.status()).toBe('blocked');
    });

    it('is enabled when the browser already holds a subscription', () => {
      const { service, swPush } = setUp();
      swPush!.subscription.next(fakeSubscription);
      expect(service.status()).toBe('enabled');
    });
  });

  describe('enable()', () => {
    it('subscribes with the server key and stores the subscription', async () => {
      const { service, http, swPush } = setUp();

      const promise = service.enable();
      http.expectOne('/api/v1/push/public-key').flush({ publicKey: 'server-public-key' });
      const post = await vi.waitFor(() => http.expectOne('/api/v1/push/subscriptions'));
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual(subscriptionJson);
      post.flush(null, { status: 204, statusText: 'No Content' });
      await promise;

      expect(swPush!.requestSubscription).toHaveBeenCalledWith({ serverPublicKey: 'server-public-key' });
    });

    it('reports blocked and stores nothing when the user denies the permission prompt', async () => {
      const { service, http, swPush } = setUp();
      swPush!.requestSubscription.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

      const promise = service.enable();
      http.expectOne('/api/v1/push/public-key').flush({ publicKey: 'k' });
      await promise;

      http.expectNone('/api/v1/push/subscriptions');
      expect(service.status()).toBe('blocked');
    });

    it('does not even ask for permission when it is already denied', async () => {
      const { service, http, swPush } = setUp({ permission: 'denied' });
      await service.enable();
      http.expectNone('/api/v1/push/public-key');
      expect(swPush!.requestSubscription).not.toHaveBeenCalled();
    });

    it('rejects a malformed public-key response instead of subscribing', async () => {
      const { service, http, swPush } = setUp();
      const promise = service.enable();
      http.expectOne('/api/v1/push/public-key').flush({ nope: true });
      await expect(promise).rejects.toThrow();
      expect(swPush!.requestSubscription).not.toHaveBeenCalled();
    });
  });

  describe('disable()', () => {
    it('removes the subscription on the server, then in the browser', async () => {
      const { service, http, swPush } = setUp();
      swPush!.subscription.next(fakeSubscription);

      const promise = service.disable();
      const del = await vi.waitFor(() => http.expectOne('/api/v1/push/subscriptions'));
      expect(del.request.method).toBe('DELETE');
      expect(del.request.body).toEqual({ endpoint: subscriptionJson.endpoint });
      del.flush(null, { status: 204, statusText: 'No Content' });
      await promise;

      expect(swPush!.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('removeCurrentOnSignOut()', () => {
    it('does nothing when this browser has no subscription', async () => {
      const { service, http, swPush } = setUp();
      await service.removeCurrentOnSignOut();
      http.expectNone('/api/v1/push/subscriptions');
      expect(swPush!.unsubscribe).not.toHaveBeenCalled();
    });

    it('does nothing when push is unsupported', async () => {
      const { service, http } = setUp({ swPush: null });
      await expect(service.removeCurrentOnSignOut()).resolves.toBeUndefined();
      http.expectNone('/api/v1/push/subscriptions');
    });

    it('removes the subscription on the server and in the browser', async () => {
      const { service, http, swPush } = setUp();
      swPush!.subscription.next(fakeSubscription);

      const promise = service.removeCurrentOnSignOut();
      (await vi.waitFor(() => http.expectOne('/api/v1/push/subscriptions'))).flush(null, {
        status: 204,
        statusText: 'No Content',
      });
      await promise;

      expect(swPush!.unsubscribe).toHaveBeenCalled();
    });

    it('never rejects when the server call fails, and still unsubscribes the browser', async () => {
      const { service, http, swPush } = setUp();
      swPush!.subscription.next(fakeSubscription);

      const promise = service.removeCurrentOnSignOut();
      (await vi.waitFor(() => http.expectOne('/api/v1/push/subscriptions'))).flush('boom', {
        status: 500,
        statusText: 'Server Error',
      });

      await expect(promise).resolves.toBeUndefined();
      expect(swPush!.unsubscribe).toHaveBeenCalled();
    });

    it('never rejects when unsubscribing the browser fails too', async () => {
      const { service, http, swPush } = setUp();
      swPush!.subscription.next(fakeSubscription);
      swPush!.unsubscribe.mockRejectedValue(new Error('no'));

      const promise = service.removeCurrentOnSignOut();
      (await vi.waitFor(() => http.expectOne('/api/v1/push/subscriptions'))).flush(null, {
        status: 204,
        statusText: 'No Content',
      });

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('sendTest()', () => {
    it('asks the API to push a test notification to the caller', async () => {
      const { service, http } = setUp();
      const promise = service.sendTest();
      const req = http.expectOne('/api/v1/push/test');
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 202, statusText: 'Accepted' });
      await promise;
    });
  });
});
