import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { pushPublicKeySchema } from '@repo/shared-types';
import { firstValueFrom, map } from 'rxjs';
import { webConfig } from '../config/app-config';

export type PushStatus = 'unsupported' | 'blocked' | 'disabled' | 'enabled';

/**
 * Per-browser web push opt-in. Talks to apps/api's `/v1/push` (same-origin,
 * session cookie sent automatically) and to the browser through Angular's
 * `SwPush`. `SwPush` only exists once `provideServiceWorker` is configured, so
 * it is injected optionally: without it (a development build, or a test) push
 * simply reads as unsupported.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly baseUrl = `${webConfig.apiUrl}/v1/push`;

  readonly unsupportedReason =
    'Push notifications are not available in this browser. On iOS, add the app to your Home Screen first.';

  /** Set when the browser refuses the permission prompt (or already had). */
  private readonly denied = signal(this.permission() === 'denied');
  private readonly subscribed = this.swPush
    ? toSignal(this.swPush.subscription.pipe(map((subscription) => subscription !== null)), { initialValue: false })
    : signal(false);

  /** True while an enable/disable/test request is in flight. */
  readonly pending = signal(false);

  readonly status = computed<PushStatus>(() => {
    if (!this.canReceivePush()) return 'unsupported';
    if (this.denied()) return 'blocked';
    return this.subscribed() ? 'enabled' : 'disabled';
  });

  async enable(): Promise<void> {
    if (!this.swPush || this.status() === 'unsupported') return;
    // A denied permission cannot be re-asked: do not even try.
    if (this.permission() === 'denied') {
      this.denied.set(true);
      return;
    }
    await this.busy(async () => {
      const body = await firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/public-key`));
      const { publicKey } = pushPublicKeySchema.parse(body);
      let subscription: PushSubscription;
      try {
        subscription = await this.swPush!.requestSubscription({ serverPublicKey: publicKey });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          this.denied.set(true);
          return;
        }
        throw error;
      }
      await firstValueFrom(this.http.post<void>(`${this.baseUrl}/subscriptions`, subscription.toJSON()));
    });
  }

  async disable(): Promise<void> {
    if (!this.swPush) return;
    await this.busy(async () => {
      const subscription = await firstValueFrom(this.swPush!.subscription);
      if (subscription) {
        await firstValueFrom(
          this.http.delete<void>(`${this.baseUrl}/subscriptions`, { body: { endpoint: subscription.endpoint } }),
        );
      }
      await this.swPush!.unsubscribe();
    });
  }

  /**
   * Removes this browser's subscription when the user signs out, so the next
   * person to use it receives none of the previous user's notifications. Must
   * run while the session cookie is still valid, and never rejects: a failure
   * here must not stop the sign-out. The browser-side unsubscribe happens even
   * when the server call fails — the dead endpoint is then cleaned up when the
   * push service answers 410.
   */
  async removeCurrentOnSignOut(): Promise<void> {
    if (!this.swPush || this.status() === 'unsupported') return;
    try {
      const subscription = await firstValueFrom(this.swPush.subscription);
      if (!subscription) return;
      try {
        await firstValueFrom(
          this.http.delete<void>(`${this.baseUrl}/subscriptions`, { body: { endpoint: subscription.endpoint } }),
        );
      } catch {
        // Best effort: see above.
      }
      await this.swPush.unsubscribe();
    } catch {
      // Never block a sign-out.
    }
  }

  async sendTest(): Promise<void> {
    await this.busy(() => firstValueFrom(this.http.post<void>(`${this.baseUrl}/test`, null)));
  }

  private canReceivePush(): boolean {
    return !!this.swPush?.isEnabled && typeof Notification !== 'undefined' && typeof PushManager !== 'undefined';
  }

  private permission(): NotificationPermission | undefined {
    return typeof Notification === 'undefined' ? undefined : Notification.permission;
  }

  private async busy<T>(work: () => Promise<T>): Promise<T> {
    this.pending.set(true);
    try {
      return await work();
    } finally {
      this.pending.set(false);
    }
  }
}
