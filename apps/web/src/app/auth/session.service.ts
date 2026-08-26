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
}
