import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { AUTH_CLIENT } from './auth-client.token';

/**
 * Bridges better-auth's session nanostores atom (`authClient.useSession`) to
 * an Angular signal (design.md → D3) — every other better-auth client method
 * is used directly; only session state needs this bridge, since there is no
 * `better-auth/angular` framework wrapper.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly state = signal(this.authClient.useSession.get());

  readonly session = computed(() => this.state().data);
  readonly user = computed(() => this.state().data?.user ?? null);
  readonly isPending = computed(() => this.state().isPending);
  readonly isAuthenticated = computed(() => this.state().data !== null && this.state().data !== undefined);

  /**
   * True while the current session is an impersonation session started via
   * `authClient.admin.impersonateUser` — better-auth sets `impersonatedBy`
   * (the original admin's user id) on the session record while impersonating
   * (confirmed against better-auth's own `plugins/admin/routes.mjs`).
   */
  readonly isImpersonating = computed(
    () => !!(this.state().data?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy,
  );

  constructor() {
    const unsubscribe = this.authClient.useSession.subscribe((value) => {
      this.state.set(value);
    });
    this.destroyRef.onDestroy(unsubscribe);
  }

  /**
   * Resolves once the session's first fetch has completed (`isPending`
   * turns false) — used by route guards so a route decision is never made
   * against the atom's initial, still-loading value (design.md → D5).
   */
  ready(): Promise<void> {
    if (!this.state().isPending) return Promise.resolve();

    return new Promise((resolve) => {
      const unsubscribe = this.authClient.useSession.subscribe((value) => {
        if (!value.isPending) {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /**
   * Resolves once the session atom's `data` satisfies `predicate`. Shared by
   * `signedOut()`/`signedIn()`: better-auth's client toggles its internal
   * refresh signal in a `setTimeout` (its own "to avoid race conditions"
   * comment) and a re-validation refetch never flips `isPending` — only
   * `isRefetching` — so `ready()` alone returns immediately against the
   * stale value right after a call like `signOut()` or
   * `twoFactor.verifyTotp()` resolves. A caller that navigates to a
   * guard-gated route straight after such a call must await the matching
   * wait method first, or the guard reads the stale session and bounces
   * back (confirmed live for both directions: `guestGuard` after sign-out,
   * `authGuard` after a 2FA-verified sign-in). ponytail: 3s safety timeout
   * in case the post-call refetch errors without ever reaching `predicate`
   * — raise it if that proves too tight.
   */
  private waitFor(predicate: (data: unknown) => boolean): Promise<void> {
    if (predicate(this.state().data)) return Promise.resolve();

    return new Promise((resolve) => {
      let unsubscribe = (): void => undefined;
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 3000);
      unsubscribe = this.authClient.useSession.subscribe((value) => {
        if (predicate(value.data)) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /** Await after `signOut()`/`deleteUser()` before navigating to a guest-only route. */
  signedOut(): Promise<void> {
    return this.waitFor((data) => data === null);
  }

  /** Await after `twoFactor.verifyTotp()`/`verifyBackupCode()` before navigating to a protected route. */
  signedIn(): Promise<void> {
    return this.waitFor((data) => data !== null && data !== undefined);
  }
}
