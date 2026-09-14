import { TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { DeleteAccountDialog } from './delete-account-dialog';

function setUp(deleteUser: (args: unknown) => Promise<unknown>) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      { provide: AUTH_CLIENT, useValue: { deleteUser } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
    ],
  });
  const fixture = TestBed.createComponent(DeleteAccountDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('DeleteAccountDialog', () => {
  it('deletes the account and closes with true on success', async () => {
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(deleteUser);

    fixture.componentInstance['form'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmit']();

    expect(deleteUser).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const deleteUser = vi.fn().mockResolvedValue({ error: { message: 'Invalid password' } });
    const { fixture, dialogRefClose } = setUp(deleteUser);

    fixture.componentInstance['form'].setValue({ password: 'wrong' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Invalid password',
    );
  });

  it('rejects an empty password without calling the server', async () => {
    const deleteUser = vi.fn();
    const { fixture, dialogRefClose } = setUp(deleteUser);

    await fixture.componentInstance['onSubmit']();

    expect(deleteUser).not.toHaveBeenCalled();
    expect(dialogRefClose).not.toHaveBeenCalled();
  });
});
