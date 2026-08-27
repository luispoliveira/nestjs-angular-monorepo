import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum } from '@repo/shared-types';
import { AUTH_CLIENT, SessionAtomClient } from '../../auth/auth-client.token';
import { Account } from './account';

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

function fakeSessionAtom(name: string, email: string): SessionAtomClient['useSession'] {
  const value: SessionValue = {
    data: { user: { id: 'u1', email, name, role: RoleEnum.USER }, session: { id: 's1' } },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
  return {
    get: () => value,
    subscribe(listener: (v: SessionValue) => void) {
      listener(value);
      return () => undefined;
    },
  } as unknown as SessionAtomClient['useSession'];
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
  name?: string;
  email?: string;
}) {
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient()),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: fakeSessionAtom(overrides.name ?? 'Jane Doe', overrides.email ?? 'jane@example.com'),
          updateUser: overrides.updateUser ?? vi.fn().mockResolvedValue({ error: null }),
          changeEmail: overrides.changeEmail ?? vi.fn().mockResolvedValue({ error: null }),
          changePassword: overrides.changePassword ?? vi.fn().mockResolvedValue({ error: null }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Account);
  fixture.detectChanges();
  return fixture;
}

describe('Account', () => {
  it('pre-fills the profile form with the current session user', () => {
    const fixture = setUp({ name: 'Jane Doe', email: 'jane@example.com' });

    expect(fixture.componentInstance['profileForm'].getRawValue()).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('only calls updateUser when just the name changed', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const changeEmail = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ updateUser, changeEmail });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Smith', email: 'jane@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(updateUser).toHaveBeenCalledWith({ name: 'Jane Smith' });
    expect(changeEmail).not.toHaveBeenCalled();
  });

  it('calls changeEmail and shows a confirmation message when the email changed', async () => {
    const changeEmail = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ changeEmail });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Doe', email: 'new@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(changeEmail).toHaveBeenCalledWith({ newEmail: 'new@example.com' });
    expect(fixture.componentInstance['profileError']()).toBeNull();
  });

  it('shows a server error when updating the profile fails', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const fixture = setUp({ updateUser });

    fixture.componentInstance['profileForm'].setValue({ name: 'Jane Smith', email: 'jane@example.com' });
    await fixture.componentInstance['onSubmitProfile']();
    await waitForSettled(fixture, () => fixture.componentInstance['updateProfile'].isPending());

    expect(fixture.nativeElement.querySelector('[data-testid="profile-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });

  it('changes the password and resets the form', async () => {
    const changePassword = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ changePassword });

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
    expect(fixture.componentInstance['passwordForm'].getRawValue()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('shows a server error when changing the password fails', async () => {
    const changePassword = vi.fn().mockResolvedValue({ error: { message: 'Invalid password' } });
    const fixture = setUp({ changePassword });

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
    const fixture = setUp({ changePassword });

    fixture.componentInstance['passwordForm'].setValue({
      currentPassword: 'oldpass1',
      newPassword: 'longenough',
      confirmPassword: 'different',
    });
    await fixture.componentInstance['onSubmitPassword']();

    expect(changePassword).not.toHaveBeenCalled();
  });
});
