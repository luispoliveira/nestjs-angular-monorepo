import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AUTH_CLIENT, SessionAtomClient } from '../auth/auth-client.token';
import { Shell } from './shell';

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

function createFakeSessionAtom(value: SessionValue) {
  return {
    get: () => value,
    subscribe(listener: (v: SessionValue) => void) {
      listener(value);
      return () => undefined;
    },
  } as unknown as SessionAtomClient['useSession'];
}

function sessionOf(role: 'admin' | 'user', name = 'Ada Lovelace', impersonatedBy?: string): SessionValue {
  return {
    data: {
      user: { id: 'u1', email: 'ada@example.com', name, role },
      session: { id: 's1', ...(impersonatedBy ? { impersonatedBy } : {}) },
    },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
}

function setUp(role: 'admin' | 'user', options?: { impersonatedBy?: string; stopImpersonating?: () => Promise<unknown> }) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: createFakeSessionAtom(sessionOf(role, undefined, options?.impersonatedBy)),
          signOut: async () => ({}),
          admin: { stopImpersonating: options?.stopImpersonating ?? (async () => ({})) },
        },
      },
      provideRouter([]),
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  return fixture;
}

describe('Shell', () => {
  it('shows the signed-in user name in the top bar', () => {
    const fixture = setUp('admin');

    const nameEl = fixture.nativeElement.querySelector('[data-testid="user-name"]');

    expect(nameEl?.textContent?.trim()).toBe('Ada Lovelace');
  });

  it('shows the admin-only nav entry for an admin session', () => {
    const fixture = setUp('admin');

    const labels = [...fixture.nativeElement.querySelectorAll('mat-nav-list [matListItemTitle]')].map(
      (el: Element) => el.textContent?.trim(),
    );

    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Users');
  });

  it('hides the admin-only nav entry for a non-admin session', () => {
    const fixture = setUp('user');

    const labels = [...fixture.nativeElement.querySelectorAll('mat-nav-list [matListItemTitle]')].map(
      (el: Element) => el.textContent?.trim(),
    );

    expect(labels).toContain('Dashboard');
    expect(labels).not.toContain('Users');
  });

  it('does not show the impersonation banner for a normal session', () => {
    const fixture = setUp('admin');

    expect(fixture.nativeElement.querySelector('[data-testid="impersonation-banner"]')).toBeNull();
  });

  it('shows the impersonation banner while impersonating', () => {
    const fixture = setUp('user', { impersonatedBy: 'admin-1' });

    const banner = fixture.nativeElement.querySelector('[data-testid="impersonation-banner"]');
    expect(banner?.textContent).toContain('Ada Lovelace');
  });

  it('stops impersonating and navigates to /users', async () => {
    const stopImpersonating = vi.fn().mockResolvedValue({});
    const fixture = setUp('user', { impersonatedBy: 'admin-1', stopImpersonating });
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.nativeElement.querySelector('[data-testid="stop-impersonating-button"]').click();
    await fixture.whenStable();

    expect(stopImpersonating).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/users');
  });

  it('signs out from the user menu', async () => {
    const fixture = setUp('admin');
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.nativeElement.querySelector('[data-testid="user-menu-button"]').click();
    fixture.detectChanges();
    (document.querySelector('[data-testid="sign-out-button"]') as HTMLElement).click();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith('/sign-in');
  });

  it('exposes a My account link in the user menu', () => {
    const fixture = setUp('admin');

    fixture.nativeElement.querySelector('[data-testid="user-menu-button"]').click();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="my-account-link"]')?.getAttribute('href')).toBe('/account');
  });
});
