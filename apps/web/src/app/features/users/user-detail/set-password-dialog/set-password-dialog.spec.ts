import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum, User } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../../auth/auth-client.token';
import { SetPasswordDialog } from './set-password-dialog';

function user(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    role: RoleEnum.USER,
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function waitForSettled(fixture: ComponentFixture<SetPasswordDialog>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.componentInstance['setPassword'].isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(setUserPassword: (args: unknown) => Promise<unknown>, target: User = user()) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(new QueryClient()),
      { provide: AUTH_CLIENT, useValue: { admin: { setUserPassword } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
      { provide: MAT_DIALOG_DATA, useValue: { user: target } },
    ],
  });
  const fixture = TestBed.createComponent(SetPasswordDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('SetPasswordDialog', () => {
  it('sets the password and closes on success', async () => {
    const setUserPassword = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(setUserPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough' });
    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(setUserPassword).toHaveBeenCalledWith({ userId: '1', newPassword: 'longenough' });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('rejects a password shorter than the policy minimum without calling the server', async () => {
    const setUserPassword = vi.fn();
    const { fixture, dialogRefClose } = setUp(setUserPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'short' });
    await fixture.componentInstance['onSubmit']();

    expect(setUserPassword).not.toHaveBeenCalled();
    expect(dialogRefClose).not.toHaveBeenCalled();
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const setUserPassword = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const { fixture, dialogRefClose } = setUp(setUserPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough' });
    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });
});
