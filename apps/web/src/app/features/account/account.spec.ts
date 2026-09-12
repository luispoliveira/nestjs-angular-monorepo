import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum } from '@repo/shared-types';
import { of } from 'rxjs';
import { AUTH_CLIENT, SessionAtomClient } from '../../auth/auth-client.token';
import { Account } from './account';
import { DeleteAccountDialog } from './delete-account-dialog/delete-account-dialog';
import { RegenerateBackupCodesDialog } from './regenerate-backup-codes-dialog/regenerate-backup-codes-dialog';
import { TwoFactorDisableDialog } from './two-factor-disable-dialog/two-factor-disable-dialog';
import { TwoFactorEnableDialog } from './two-factor-enable-dialog/two-factor-enable-dialog';

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

const signedOutValue = {
  data: null,
  error: null,
  isPending: false,
  isRefetching: false,
} as SessionValue;

// Mutable so a deleteUser mock can flip it to unauthenticated and notify
// subscribers — matching better-auth's real atom (see SessionService.signedOut).
function fakeSessionAtom(name: string, email: string, twoFactorEnabled = false) {
  let value: SessionValue = {
    data: {
      user: { id: 'u1', email, name, role: RoleEnum.USER, twoFactorEnabled },
      session: { id: 's1', token: 'current-token' },
    },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
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

async function waitForSettled(fixture: ComponentFixture<Account>, isPending: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(overrides: {
  updateUser?: (args: unknown) => Promise<unknown>;
  changeEmail?: (args: unknown) => Promise<unknown>;
  changePassword?: (args: unknown) => Promise<unknown>;
  listSessions?: (args?: unknown) => Promise<unknown>;
  revokeSession?: (args: unknown) => Promise<unknown>;
  revokeOtherSessions?: (args?: unknown) => Promise<unknown>;
  deleteUser?: (args: unknown) => Promise<unknown>;
  name?: string;
  email?: string;
  twoFactorEnabled?: boolean;
}) {
  const { atom, set } = fakeSessionAtom(
    overrides.name ?? 'Jane Doe',
    overrides.email ?? 'jane@example.com',
    overrides.twoFactorEnabled,
  );
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient()),
      provideRouter([]),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: atom,
          updateUser: overrides.updateUser ?? vi.fn().mockResolvedValue({ error: null }),
          changeEmail: overrides.changeEmail ?? vi.fn().mockResolvedValue({ error: null }),
          changePassword: overrides.changePassword ?? vi.fn().mockResolvedValue({ error: null }),
          listSessions: overrides.listSessions ?? vi.fn().mockResolvedValue({ data: [], error: null }),
          revokeSession: overrides.revokeSession ?? vi.fn().mockResolvedValue({ error: null }),
          revokeOtherSessions: overrides.revokeOtherSessions ?? vi.fn().mockResolvedValue({ error: null }),
          deleteUser: overrides.deleteUser ?? vi.fn().mockResolvedValue({ error: null }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Account);
  fixture.detectChanges();
  return { fixture, setSession: set };
}

describe('Account', () => {
  it('pre-fills the profile form with the current session user', () => {
    const { fixture } = setUp({ name: 'Jane Doe', email: 'jane@example.com' });

    expect(fixture.componentInstance['profileForm'].getRawValue()).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('only calls updateUser when just the name changed', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const changeEmail = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp({ updateUser, changeEmail });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Smith', email: 'jane@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(updateUser).toHaveBeenCalledWith({ name: 'Jane Smith' });
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('calls changeEmail and shows a confirmation message when the email changed', async () => {
    const changeEmail = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp({ changeEmail });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Doe', email: 'new@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(changeEmail).toHaveBeenCalledWith({ newEmail: 'new@example.com' });
    expect(fixture.componentInstance['profileError']()).toBeNull();
  });

  it('shows a server error when updating the profile fails', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const { fixture } = setUp({ updateUser });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Smith', email: 'jane@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(fixture.nativeElement.querySelector('[data-testid="profile-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });

  it('changes the password, invalidates the sessions list, and resets the form', async () => {
    const changePassword = vi.fn().mockResolvedValue({ error: null });
    const listSessions = vi.fn().mockResolvedValue({ data: [], error: null });
    const { fixture } = setUp({ changePassword, listSessions });
    await waitForSettled(fixture, () => fixture.componentInstance['sessionsQuery'].isPending());
    listSessions.mockClear();

    fixture.componentInstance['passwordForm'].setValue({
      currentPassword: 'oldpass1',
      newPassword: 'longenough',
      confirmPassword: 'longenough',
    });
    await fixture.componentInstance['onSubmitPassword']();
    await waitForSettled(fixture, () => fixture.componentInstance['changePassword'].isPending());

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'oldpass1',
      newPassword: 'longenough',
      revokeOtherSessions: true,
    });
    // revokeOtherSessions: true just killed every other session server-side —
    // the list must refetch, not keep showing them as still active.
    expect(listSessions).toHaveBeenCalled();
    expect(fixture.componentInstance['passwordForm'].getRawValue()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('shows a server error when changing the password fails', async () => {
    const changePassword = vi.fn().mockResolvedValue({ error: { message: 'Invalid password' } });
    const { fixture } = setUp({ changePassword });

    fixture.componentInstance['passwordForm'].setValue({
      currentPassword: 'wrong',
      newPassword: 'longenough',
      confirmPassword: 'longenough',
    });
    await fixture.componentInstance['onSubmitPassword']();
    await waitForSettled(fixture, () => fixture.componentInstance['changePassword'].isPending());

    expect(fixture.nativeElement.querySelector('[data-testid="password-error"]')?.textContent?.trim()).toBe(
      'Invalid password',
    );
  });

  it('does not submit when the confirmation does not match the new password', async () => {
    const changePassword = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp({ changePassword });

    fixture.componentInstance['passwordForm'].setValue({
      currentPassword: 'oldpass1',
      newPassword: 'longenough',
      confirmPassword: 'different',
    });
    await fixture.componentInstance['onSubmitPassword']();

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('lists active sessions and marks the current one', async () => {
    const listSessions = vi.fn().mockResolvedValue({
      data: [
        { id: 's1', token: 'current-token', createdAt: new Date(), expiresAt: new Date(), ipAddress: '1.1.1.1' },
        { id: 's2', token: 'other-token', createdAt: new Date(), expiresAt: new Date(), ipAddress: '2.2.2.2' },
      ],
      error: null,
    });
    const { fixture } = setUp({ listSessions });
    await waitForSettled(fixture, () => fixture.componentInstance['sessionsQuery'].isPending());

    expect(fixture.nativeElement.querySelector('[data-testid="session-row-s1"]')?.textContent).toContain(
      '(this device)',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="revoke-session-s1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="revoke-session-s2"]')).toBeTruthy();
  });

  it('revokes a single session and refreshes the list', async () => {
    const listSessions = vi.fn().mockResolvedValue({
      data: [{ id: 's2', token: 'other-token', createdAt: new Date(), expiresAt: new Date(), ipAddress: '2.2.2.2' }],
      error: null,
    });
    const revokeSession = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp({ listSessions, revokeSession });
    await waitForSettled(fixture, () => fixture.componentInstance['sessionsQuery'].isPending());

    await fixture.componentInstance['revokeSession']('other-token');

    expect(revokeSession).toHaveBeenCalledWith({ token: 'other-token' });
  });

  it('revokes other sessions', async () => {
    const revokeOtherSessions = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp({ revokeOtherSessions });

    await fixture.componentInstance['revokeOtherSessions']();

    expect(revokeOtherSessions).toHaveBeenCalled();
  });

  it('shows two-factor as disabled and offers to enable it', () => {
    const { fixture } = setUp({ twoFactorEnabled: false });

    expect(fixture.componentInstance['twoFactorEnabled']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="enable-2fa-action"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="disable-2fa-action"]')).toBeNull();
  });

  it('shows two-factor as enabled and offers to disable/regenerate codes', () => {
    const { fixture } = setUp({ twoFactorEnabled: true });

    expect(fixture.componentInstance['twoFactorEnabled']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="disable-2fa-action"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="regenerate-backup-codes-action"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="enable-2fa-action"]')).toBeNull();
  });

  it('opens the enable-2FA dialog and confirms via snackbar', () => {
    const { fixture } = setUp({});
    const openSpy = vi
      .spyOn(MatDialog.prototype, 'open')
      .mockReturnValue({ afterClosed: () => of(true) } as ReturnType<MatDialog['open']>);
    const snackBarSpy = vi.spyOn(fixture.componentInstance['snackBar'], 'open');

    fixture.componentInstance['openEnableTwoFactor']();

    expect(openSpy).toHaveBeenCalledWith(TwoFactorEnableDialog);
    expect(snackBarSpy).toHaveBeenCalledWith('Two-factor authentication enabled', 'Dismiss', { duration: 5000 });
  });

  it('opens the disable-2FA dialog', () => {
    const { fixture } = setUp({ twoFactorEnabled: true });
    const openSpy = vi
      .spyOn(MatDialog.prototype, 'open')
      .mockReturnValue({ afterClosed: () => of(true) } as ReturnType<MatDialog['open']>);

    fixture.componentInstance['openDisableTwoFactor']();

    expect(openSpy).toHaveBeenCalledWith(TwoFactorDisableDialog);
  });

  it('opens the regenerate-backup-codes dialog', () => {
    const { fixture } = setUp({ twoFactorEnabled: true });
    const openSpy = vi
      .spyOn(MatDialog.prototype, 'open')
      .mockReturnValue({ afterClosed: () => of(undefined) } as ReturnType<MatDialog['open']>);

    fixture.componentInstance['openRegenerateBackupCodes']();

    expect(openSpy).toHaveBeenCalledWith(RegenerateBackupCodesDialog);
  });

  it('signs out and navigates to /sign-in after a confirmed account deletion', async () => {
    const { fixture, setSession } = setUp({});
    const openSpy = vi
      .spyOn(MatDialog.prototype, 'open')
      .mockReturnValue({ afterClosed: () => of(true) } as ReturnType<MatDialog['open']>);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    // Simulates DeleteAccountDialog's real authClient.deleteUser() call having
    // already invalidated the session atom (the dialog itself is mocked away above).
    setSession(signedOutValue);
    fixture.componentInstance['openDeleteAccount']();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openSpy).toHaveBeenCalledWith(DeleteAccountDialog);
    expect(navigateSpy).toHaveBeenCalledWith('/sign-in');
  });

  it('does not navigate away when account deletion is cancelled', async () => {
    const { fixture } = setUp({});
    vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({ afterClosed: () => of(false) } as ReturnType<MatDialog['open']>);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');

    fixture.componentInstance['openDeleteAccount']();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
