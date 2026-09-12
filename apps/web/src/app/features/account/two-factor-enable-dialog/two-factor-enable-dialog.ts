import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { confirmPasswordSchema, twoFactorCodeSchema, zodValidator } from '@repo/shared-types';
import { toDataURL } from 'qrcode';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

/**
 * Three-step 2FA enrollment: (1) confirm the current password — required by
 * better-auth's `/two-factor/enable`; (2) show the TOTP QR code (scannable)
 * and the manual setup key extracted from the `otpauth://` URI, plus the
 * backup codes returned by that call, since enabling doesn't flip
 * `user.twoFactorEnabled` yet (`twoFactor.verified` stays false until step
 * 3); (3) confirm a code from the authenticator app via `verifyTotp`, which
 * is what actually turns 2FA on (confirmed against better-auth's own
 * `plugins/two-factor/totp/index.mjs`).
 */
@Component({
  selector: 'app-two-factor-enable-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  templateUrl: './two-factor-enable-dialog.html',
})
export class TwoFactorEnableDialog {
  private readonly dialogRef = inject(MatDialogRef<TwoFactorEnableDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly passwordForm = this.formBuilder.nonNullable.group(
    { password: [''] },
    { validators: zodValidator(confirmPasswordSchema) },
  );
  protected readonly codeForm = this.formBuilder.nonNullable.group(
    { code: [''] },
    { validators: zodValidator(twoFactorCodeSchema) },
  );

  protected readonly step = signal<'password' | 'confirm'>('password');
  protected readonly setupKey = signal<string | null>(null);
  protected readonly qrCodeDataUrl = signal<string | null>(null);
  protected readonly backupCodes = signal<string[]>([]);
  protected readonly copied = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly submittingPassword = signal(false);
  protected readonly submittingCode = signal(false);

  protected async onSubmitPassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.submittingPassword.set(true);
    this.passwordError.set(null);

    const { password } = this.passwordForm.getRawValue();
    const { data, error } = await this.authClient.twoFactor.enable({ password });

    this.submittingPassword.set(false);

    if (error || !data) {
      this.passwordError.set(error?.message ?? 'Failed to start two-factor setup.');
      return;
    }

    const totpURI = 'totpURI' in data ? data.totpURI : undefined;
    this.setupKey.set(totpURI ? (new URL(totpURI).searchParams.get('secret') ?? totpURI) : null);
    this.qrCodeDataUrl.set(totpURI ? await toDataURL(totpURI, { margin: 1, width: 200 }) : null);
    this.backupCodes.set('backupCodes' in data && data.backupCodes ? data.backupCodes : []);
    this.step.set('confirm');
  }

  protected async copyBackupCodes(): Promise<void> {
    await navigator.clipboard.writeText(this.backupCodes().join('\n'));
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  protected async onSubmitCode(): Promise<void> {
    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    this.submittingCode.set(true);
    this.confirmError.set(null);

    const { code } = this.codeForm.getRawValue();
    const { error } = await this.authClient.twoFactor.verifyTotp({ code });

    this.submittingCode.set(false);

    if (error) {
      this.confirmError.set(error.message ?? 'Invalid code.');
      return;
    }

    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
