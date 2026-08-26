import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTH_CLIENT, SessionAtomClient } from './auth-client.token';
import { SessionService } from './session.service';

type FakeSessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

// A minimal nanostores-shaped fake: `.get()` returns the current value,
// `.subscribe()` calls the listener immediately (matching real nanostores
// behaviour) then on every `.set()`, and returns an unsubscribe function.
function createFakeSessionAtom(initial: FakeSessionValue) {
  let value = initial;
  const listeners = new Set<(v: FakeSessionValue) => void>();
  return {
    atom: {
      get: () => value,
      subscribe(listener: (v: FakeSessionValue) => void) {
        listeners.add(listener);
        listener(value);
        return () => listeners.delete(listener);
      },
    } as unknown as SessionAtomClient['useSession'],
    set(next: FakeSessionValue) {
      value = next;
      listeners.forEach((listener) => listener(value));
    },
    listenerCount: () => listeners.size,
  };
}

const unauthenticated: FakeSessionValue = {
  data: null,
  error: null,
  isPending: false,
  isRefetching: false,
} as FakeSessionValue;

const authenticated: FakeSessionValue = {
  data: {
    user: { id: 'u1', email: 'ada@example.com', name: 'Ada', role: 'admin' },
    session: { id: 's1' },
  },
  error: null,
  isPending: false,
  isRefetching: false,
} as FakeSessionValue;

describe('SessionService', () => {
  it('reflects the atom value present at construction', () => {
    const { atom } = createFakeSessionAtom(authenticated);
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_CLIENT, useValue: { useSession: atom } }],
    });

    const service = TestBed.inject(SessionService);

    expect(service.isAuthenticated()).toBe(true);
    expect(service.user()?.['email']).toBe('ada@example.com');
  });

  it('updates the signal on sign-in (unauthenticated → authenticated)', () => {
    const { atom, set } = createFakeSessionAtom(unauthenticated);
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_CLIENT, useValue: { useSession: atom } }],
    });
    const service = TestBed.inject(SessionService);

    expect(service.isAuthenticated()).toBe(false);

    set(authenticated);

    expect(service.isAuthenticated()).toBe(true);
    expect(service.user()?.['email']).toBe('ada@example.com');
  });

  it('updates the signal on sign-out (authenticated → unauthenticated)', () => {
    const { atom, set } = createFakeSessionAtom(authenticated);
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_CLIENT, useValue: { useSession: atom } }],
    });
    const service = TestBed.inject(SessionService);

    expect(service.isAuthenticated()).toBe(true);

    set(unauthenticated);

    expect(service.isAuthenticated()).toBe(false);
    expect(service.user()).toBeNull();
  });

  it('releases the subscription when the injector is destroyed', () => {
    const { atom, listenerCount } = createFakeSessionAtom(unauthenticated);

    // A standalone child injector so SessionService's DestroyRef ties to
    // *this* injector's lifecycle, not the whole TestBed environment.
    const injector = Injector.create({
      providers: [{ provide: AUTH_CLIENT, useValue: { useSession: atom } }, SessionService],
    });

    injector.get(SessionService);
    expect(listenerCount()).toBe(1);

    injector.destroy();

    expect(listenerCount()).toBe(0);
  });
});
