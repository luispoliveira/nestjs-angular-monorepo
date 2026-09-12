import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum, User } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { BanUserDialog } from './ban-user-dialog';

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

async function waitForSettled(fixture: ComponentFixture<BanUserDialog>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.componentInstance['banUser'].isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(banUser: (args: unknown) => Promise<unknown>, target: User = user()) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(new QueryClient()),
      { provide: AUTH_CLIENT, useValue: { admin: { banUser } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
      { provide: MAT_DIALOG_DATA, useValue: { user: target } },
    ],
  });
  const fixture = TestBed.createComponent(BanUserDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('BanUserDialog', () => {
  it('bans with no reason or expiry by default', async () => {
    const banUser = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(banUser);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(banUser).toHaveBeenCalledWith({ userId: '1', banReason: undefined, banExpiresIn: undefined });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('bans with a reason and an expiry', async () => {
    const banUser = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp(banUser);

    fixture.componentInstance['form'].setValue({ reason: 'Spamming', expiresInSeconds: 60 * 60 * 24 * 7 });
    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(banUser).toHaveBeenCalledWith({
      userId: '1',
      banReason: 'Spamming',
      banExpiresIn: 60 * 60 * 24 * 7,
    });
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const banUser = vi.fn().mockResolvedValue({ error: { message: 'Not allowed' } });
    const { fixture, dialogRefClose } = setUp(banUser);

    await fixture.componentInstance['onSubmit']();
    await waitForSettled(fixture);

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Not allowed',
    );
  });
});
