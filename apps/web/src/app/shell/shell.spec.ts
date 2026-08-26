import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

function sessionOf(role: 'admin' | 'user', name = 'Ada Lovelace'): SessionValue {
  return {
    data: { user: { id: 'u1', email: 'ada@example.com', name, role }, session: { id: 's1' } },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
}

function setUp(role: 'admin' | 'user') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AUTH_CLIENT,
        useValue: { useSession: createFakeSessionAtom(sessionOf(role)), signOut: async () => ({}) },
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

    const labels = [...fixture.nativeElement.querySelectorAll('mat-nav-list a')].map((el: Element) =>
      el.textContent?.trim(),
    );

    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Users');
  });

  it('hides the admin-only nav entry for a non-admin session', () => {
    const fixture = setUp('user');

    const labels = [...fixture.nativeElement.querySelectorAll('mat-nav-list a')].map((el: Element) =>
      el.textContent?.trim(),
    );

    expect(labels).toContain('Dashboard');
    expect(labels).not.toContain('Users');
  });
});
