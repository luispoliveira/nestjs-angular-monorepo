import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum, User } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../../auth/auth-client.token';
import { EditUserDialog } from './edit-user-dialog';

function user(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    emailVerified: false,
    role: RoleEnum.USER,
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function waitForSettled(fixture: ComponentFixture<EditUserDialog>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.componentInstance['updateUser'].isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(updateUser: (args: unknown) => Promise<unknown>, target: User = user()) {
  const dialogRefClose = vi.fn();
  const queryClient = new QueryClient();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(queryClient),
      { provide: AUTH_CLIENT, useValue: { admin: { updateUser } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
      { provide: MAT_DIALOG_DATA, useValue: { user: target } },
    ],
  });
  const fixture = TestBed.createComponent(EditUserDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose, queryClient };
}

describe('EditUserDialog', () => {
  it('prefills the form from the target user', () => {
    const { fixture } = setUp(vi.fn(), user({ name: 'Ada Lovelace', email: 'ada@example.com', emailVerified: true }));

    expect(fixture.componentInstance['form'].getRawValue()).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
    });
  });

  it('persists name/email/emailVerified, refreshes the list and closes on success', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose, queryClient } = setUp(updateUser);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fixture.componentInstance['form'].setValue({ name: 'New Name', email: 'new@example.com', emailVerified: true });
    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(updateUser).toHaveBeenCalledWith({
      userId: '1',
      data: { name: 'New Name', email: 'new@example.com', emailVerified: true },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('rejects an invalid email without calling the server', async () => {
    const updateUser = vi.fn();
    const { fixture, dialogRefClose } = setUp(updateUser);

    fixture.componentInstance['form'].setValue({ name: 'New Name', email: 'not-an-email', emailVerified: false });
    await fixture.componentInstance['onSubmit']();

    expect(updateUser).not.toHaveBeenCalled();
    expect(dialogRefClose).not.toHaveBeenCalled();
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const { fixture, dialogRefClose } = setUp(updateUser);

    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });
});
