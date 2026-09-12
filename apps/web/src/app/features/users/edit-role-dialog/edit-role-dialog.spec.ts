import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum, User } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { EditRoleDialog } from './edit-role-dialog';

function user(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    emailVerified: true,
    role: RoleEnum.USER,
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function waitForSettled(fixture: ComponentFixture<EditRoleDialog>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.componentInstance['setRole'].isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(setRole: (args: unknown) => Promise<unknown>, target: User = user()) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(new QueryClient()),
      { provide: AUTH_CLIENT, useValue: { admin: { setRole } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
      { provide: MAT_DIALOG_DATA, useValue: { user: target } },
    ],
  });
  const fixture = TestBed.createComponent(EditRoleDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('EditRoleDialog', () => {
  it('persists the new role, refreshes the list and closes on success', async () => {
    const setRole = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(setRole);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    fixture.componentInstance['form'].setValue({ role: RoleEnum.ADMIN });
    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(setRole).toHaveBeenCalledWith({ userId: '1', role: RoleEnum.ADMIN });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    expect(dialogRefClose).toHaveBeenCalled();
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const setRole = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const { fixture, dialogRefClose } = setUp(setRole);

    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });
});
