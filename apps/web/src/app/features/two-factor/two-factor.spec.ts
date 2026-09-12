import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AUTH_CLIENT, SessionAtomClient } from '../../auth/auth-client.token';
import { TwoFactor } from './two-factor';

@Component({ selector: 'app-dashboard-stub', template: 'dashboard page' })
class DashboardStub {}

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

const unauthenticated = { data: null, error: null, isPending: false, isRefetching: false } as SessionValue;
const authenticated = {
  data: { user: { id: 'u1', email: 'ada@example.com', name: 'Ada' }, session: { id: 's1' } },
  error: null,
  isPending: false,
  isRefetching: false,
} as SessionValue;

// Mutable so a verifyTotp/verifyBackupCode mock can flip it to authenticated
// and notify subscribers — matching better-auth's real atom, whose refetch
// after a successful 2FA verify updates `data` asynchronously (see
// SessionService.signedIn).
function fakeSessionAtom(initial: SessionValue) {
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
    set(next: SessionValue) {
      value = next;
      listeners.forEach((listener) => listener(value));
    },
  };
}

// Each mock factory receives `setSession` so a successful verify can flip
// the atom to authenticated, matching better-auth's real post-verify refresh.
async function setUp(
  makeVerifyTotp: (setSession: (v: SessionValue) => void) => (args: unknown) => Promise<unknown>,
  makeVerifyBackupCode: (setSession: (v: SessionValue) => void) => (args: unknown) => Promise<unknown> = () => vi.fn(),
) {
  const { atom, set } = fakeSessionAtom(unauthenticated);
  const verifyTotp = makeVerifyTotp(set);
  const verifyBackupCode = makeVerifyBackupCode(set);
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { useSession: atom, twoFactor: { verifyTotp, verifyBackupCode } } },
      provideRouter([
        { path: 'two-factor', component: TwoFactor },
        { path: 'dashboard', component: DashboardStub },
      ]),
    ],
  });
  return { harness: await RouterTestingHarness.create('/two-factor'), verifyTotp, verifyBackupCode };
}

describe('TwoFactor', () => {
  it('verifies the TOTP code, waits for the session to refresh, and navigates to /dashboard', async () => {
    const { harness, verifyTotp } = await setUp(
      (setSession) =>
        vi.fn().mockImplementation(async () => {
          setSession(authenticated);
          return { error: null };
        }),
    );
    const instance = harness.routeDebugElement?.componentInstance as TwoFactor;

    instance['form'].setValue({ code: '123456', trustDevice: false });
    await instance['onSubmit']();

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false });
    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('shows a server error and does not navigate on an invalid code', async () => {
    const { harness } = await setUp(() => vi.fn().mockResolvedValue({ error: { message: 'Invalid code' } }));
    const instance = harness.routeDebugElement?.componentInstance as TwoFactor;

    instance['form'].setValue({ code: '000000', trustDevice: false });
    await instance['onSubmit']();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/two-factor');
    expect(harness.routeNativeElement?.textContent).toContain('Invalid code');
  });

  it('switches to backup-code verification when toggled', async () => {
    const { harness, verifyTotp, verifyBackupCode } = await setUp(
      () => vi.fn(),
      (setSession) =>
        vi.fn().mockImplementation(async () => {
          setSession(authenticated);
          return { error: null };
        }),
    );
    const instance = harness.routeDebugElement?.componentInstance as TwoFactor;

    instance['toggleBackupCode']();
    instance['form'].setValue({ code: 'aaaaa-11111', trustDevice: false });
    await instance['onSubmit']();

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'aaaaa-11111', trustDevice: false });
    expect(verifyTotp).not.toHaveBeenCalled();
  });

  it('blocks submission when the code is too short', async () => {
    const { harness, verifyTotp } = await setUp(() => vi.fn());
    const instance = harness.routeDebugElement?.componentInstance as TwoFactor;

    instance['form'].setValue({ code: '123', trustDevice: false });
    await instance['onSubmit']();

    expect(verifyTotp).not.toHaveBeenCalled();
  });
});
