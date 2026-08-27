import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AUTH_CLIENT, SessionAtomClient } from './auth-client.token';
import { authGuard, guestGuard } from './auth.guard';
import { adminGuard } from './admin.guard';

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

function sessionOf(role: 'admin' | 'user' | null): SessionValue {
  return {
    data:
      role === null
        ? null
        : { user: { id: 'u1', email: 'u@example.com', name: 'U', role }, session: { id: 's1' } },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
}

const pendingSession: SessionValue = {
  data: null,
  error: null,
  isPending: true,
  isRefetching: false,
} as SessionValue;

/** A fake atom whose value can be pushed after construction, so a test can
 * hold the session "pending" and resolve it on demand. */
function createControllableSessionAtom(initial: SessionValue) {
  let value = initial;
  const listeners = new Set<(v: SessionValue) => void>();
  return {
    atom: {
      get: () => value,
      subscribe(listener: (v: SessionValue) => void) {
        listeners.add(listener);
        listener(value);
        return () => listeners.delete(listener);
      },
    } as unknown as SessionAtomClient['useSession'],
    resolve(next: SessionValue) {
      value = next;
      listeners.forEach((listener) => listener(value));
    },
  };
}

@Component({ selector: 'app-sign-in-stub', template: 'sign-in page' })
class SignInStub {}

@Component({ selector: 'app-dashboard-stub', template: 'dashboard page' })
class DashboardStub {}

@Component({ selector: 'app-users-stub', template: 'user data: secret-user-list' })
class UsersStub {}

/** Configures TestBed with a fake session and the guarded test routes, and
 * returns a fresh RouterTestingHarness to navigate with. */
async function setUp(role: 'admin' | 'user' | null) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { useSession: createFakeSessionAtom(sessionOf(role)) } },
      provideRouter([
        { path: 'sign-in', component: SignInStub, canActivate: [guestGuard] },
        { path: 'dashboard', component: DashboardStub, canActivate: [authGuard] },
        { path: 'users', component: UsersStub, canActivate: [adminGuard] },
      ]),
    ],
  });
  return RouterTestingHarness.create();
}

describe('route guards', () => {
  it('redirects an unauthenticated user away from /users to /sign-in without rendering user data', async () => {
    const harness = await setUp(null);

    await harness.navigateByUrl('/users');

    expect(TestBed.inject(Router).url).toBe('/sign-in');
    expect(harness.routeNativeElement?.textContent).not.toContain('secret-user-list');
  });

  it('redirects a non-admin authenticated user away from /users to /dashboard', async () => {
    const harness = await setUp('user');

    await harness.navigateByUrl('/users');

    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(harness.routeNativeElement?.textContent).not.toContain('secret-user-list');
  });

  it('allows an admin to reach /users', async () => {
    const harness = await setUp('admin');

    await harness.navigateByUrl('/users');

    expect(TestBed.inject(Router).url).toBe('/users');
    expect(harness.routeNativeElement?.textContent).toContain('secret-user-list');
  });

  it('redirects an authenticated user away from /sign-in to /dashboard', async () => {
    const harness = await setUp('user');

    await harness.navigateByUrl('/sign-in');

    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('lets an unauthenticated user reach /sign-in', async () => {
    const harness = await setUp(null);

    await harness.navigateByUrl('/sign-in');

    expect(TestBed.inject(Router).url).toBe('/sign-in');
    expect(harness.routeNativeElement?.textContent).toContain('sign-in page');
  });

  it('renders no protected content while the session is pending, then renders it once resolved', async () => {
    const { atom, resolve } = createControllableSessionAtom(pendingSession);
    TestBed.configureTestingModule({
      providers: [
        { provide: AUTH_CLIENT, useValue: { useSession: atom } },
        provideRouter([{ path: 'users', component: UsersStub, canActivate: [adminGuard] }]),
      ],
    });
    const harness = await RouterTestingHarness.create();

    const navigation = harness.navigateByUrl('/users');
    // The guard's `await session.ready()` has not resolved yet — the route
    // must not have activated, so no protected content can be present.
    expect(harness.routeNativeElement?.textContent ?? '').not.toContain('secret-user-list');

    resolve(sessionOf('admin'));
    await navigation;

    expect(TestBed.inject(Router).url).toBe('/users');
    expect(harness.routeNativeElement?.textContent).toContain('secret-user-list');
  });

  it('redirects to /sign-in once a pending session resolves to unauthenticated', async () => {
    const { atom, resolve } = createControllableSessionAtom(pendingSession);
    TestBed.configureTestingModule({
      providers: [
        { provide: AUTH_CLIENT, useValue: { useSession: atom } },
        provideRouter([
          { path: 'sign-in', component: SignInStub, canActivate: [guestGuard] },
          { path: 'dashboard', component: DashboardStub, canActivate: [authGuard] },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();

    const navigation = harness.navigateByUrl('/dashboard');
    expect(harness.routeNativeElement?.textContent ?? '').not.toContain('dashboard page');

    resolve(sessionOf(null));
    await navigation;

    expect(TestBed.inject(Router).url).toBe('/sign-in');
  });
});
