import { TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { RegenerateBackupCodesDialog } from './regenerate-backup-codes-dialog';

function setUp(generateBackupCodes: (args: unknown) => Promise<unknown>) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      { provide: AUTH_CLIENT, useValue: { twoFactor: { generateBackupCodes } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
    ],
  });
  const fixture = TestBed.createComponent(RegenerateBackupCodesDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('RegenerateBackupCodesDialog', () => {
  it('shows the new backup codes on success', async () => {
    const generateBackupCodes = vi.fn().mockResolvedValue({ data: { status: true, backupCodes: ['aaaaa-11111', 'bbbbb-22222'] }, error: null });
    const { fixture } = setUp(generateBackupCodes);

    fixture.componentInstance['form'].setValue({ password: 'correct-password' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(generateBackupCodes).toHaveBeenCalledWith({ password: 'correct-password' });
    expect(fixture.componentInstance['backupCodes']()).toEqual(['aaaaa-11111', 'bbbbb-22222']);
    expect(fixture.nativeElement.querySelector('[data-testid="backup-codes"]')?.textContent).toContain('aaaaa-11111');
  });

  it('shows a server error and keeps the form on rejection', async () => {
    const generateBackupCodes = vi.fn().mockResolvedValue({ data: null, error: { message: 'Invalid password' } });
    const { fixture, dialogRefClose } = setUp(generateBackupCodes);

    fixture.componentInstance['form'].setValue({ password: 'wrong' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(dialogRefClose).not.toHaveBeenCalled();
    expect(fixture.componentInstance['backupCodes']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Invalid password',
    );
  });

  it('closes with true only after codes were generated', () => {
    const { fixture, dialogRefClose } = setUp(vi.fn());

    fixture.componentInstance['close']();

    expect(dialogRefClose).toHaveBeenCalledWith(false);
  });
});
