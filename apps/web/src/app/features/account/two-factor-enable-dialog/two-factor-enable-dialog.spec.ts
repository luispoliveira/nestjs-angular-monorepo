import { TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { TwoFactorEnableDialog } from './two-factor-enable-dialog';

function setUp(
  enable: (args: unknown) => Promise<unknown>,
  verifyTotp: (args: unknown) => Promise<unknown> = vi.fn(),
) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      { provide: AUTH_CLIENT, useValue: { twoFactor: { enable, verifyTotp } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
    ],
  });
  const fixture = TestBed.createComponent(TwoFactorEnableDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

const totpURI = 'otpauth://totp/Nes(x)tJs%20Template:admin@admin.com?secret=JBSWY3DPEHPK3PXP&issuer=Nes(x)tJs%20Template';

describe('TwoFactorEnableDialog', () => {
  it('moves to the confirmation step and extracts the manual setup key on success', async () => {
    const enable = vi.fn().mockResolvedValue({
      data: { method: 'totp', totpURI, backupCodes: ['aaaaa-11111', 'bbbbb-22222'] },
      error: null,
    });
    const { fixture } = setUp(enable);

    fixture.componentInstance['passwordForm'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmitPassword']();
    fixture.detectChanges();

    expect(enable).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(fixture.componentInstance['step']()).toBe('confirm');
    expect(fixture.componentInstance['setupKey']()).toBe('JBSWY3DPEHPK3PXP');
    expect(fixture.componentInstance['backupCodes']()).toEqual(['aaaaa-11111', 'bbbbb-22222']);
  });

  it('shows a server error and stays on the password step on rejection', async () => {
    const enable = vi.fn().mockResolvedValue({ data: null, error: { message: 'Invalid password' } });
    const { fixture } = setUp(enable);

    fixture.componentInstance['passwordForm'].setValue({ password: 'wrong' });
    await fixture.componentInstance['onSubmitPassword']();
    fixture.detectChanges();

    expect(fixture.componentInstance['step']()).toBe('password');
    expect(fixture.nativeElement.querySelector('[data-testid="password-error"]')?.textContent?.trim()).toBe(
      'Invalid password',
    );
  });

  it('confirms the TOTP code and closes with true on success', async () => {
    const enable = vi
      .fn()
      .mockResolvedValue({ data: { method: 'totp', totpURI, backupCodes: ['aaaaa-11111'] }, error: null });
    const verifyTotp = vi.fn().mockResolvedValue({ error: null });
    const { fixture, dialogRefClose } = setUp(enable, verifyTotp);

    fixture.componentInstance['passwordForm'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmitPassword']();
    fixture.componentInstance['codeForm'].setValue({ code: '123456' });
    await fixture.componentInstance['onSubmitCode']();

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(dialogRefClose).toHaveBeenCalledWith(true);
  });

  it('shows an error and keeps the backup codes visible when the code is wrong', async () => {
    const enable = vi
      .fn()
      .mockResolvedValue({ data: { method: 'totp', totpURI, backupCodes: ['aaaaa-11111'] }, error: null });
    const verifyTotp = vi.fn().mockResolvedValue({ error: { message: 'Invalid code' } });
    const { fixture, dialogRefClose } = setUp(enable, verifyTotp);

    fixture.componentInstance['passwordForm'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmitPassword']();
    fixture.componentInstance['codeForm'].setValue({ code: '000000' });
    await fixture.componentInstance['onSubmitCode']();
    fixture.detectChanges();

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.componentInstance['backupCodes']()).toEqual(['aaaaa-11111']);
    expect(fixture.nativeElement.querySelector('[data-testid="confirm-error"]')?.textContent?.trim()).toBe(
      'Invalid code',
    );
  });
});
