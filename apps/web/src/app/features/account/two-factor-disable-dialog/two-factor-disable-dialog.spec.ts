import { TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { TwoFactorDisableDialog } from './two-factor-disable-dialog';

function setUp(disable: (args: unknown) => Promise<unknown>) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      { provide: AUTH_CLIENT, useValue: { twoFactor: { disable } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
    ],
  });
  const fixture = TestBed.createComponent(TwoFactorDisableDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('TwoFactorDisableDialog', () => {
  it('disables two-factor and closes with true on success', async () => {
    const disable = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(disable);

    fixture.componentInstance['form'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmit']();

    expect(disable).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('shows a server error and keeps the dialog open on rejection', async () => {
    const disable = vi.fn().mockResolvedValue({ error: { message: 'Invalid password' } });
    const { fixture, dialogRefClose } = setUp(disable);

    fixture.componentInstance['form'].setValue({ password: 'wrong' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Invalid password',
    );
  });

  it('rejects an empty password without calling the server', async () => {
    const disable = vi.fn();
    const { fixture, dialogRefClose } = setUp(disable);

    await fixture.componentInstance['onSubmit']();

    expect(disable).not.toHaveBeenCalled();
    expect(dialogRefClose).not.toHaveBeenCalled();
  });
});
