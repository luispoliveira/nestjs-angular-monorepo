import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { confirmPasswordSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

/** Invalidates and replaces every existing backup code — the old ones stop working. */
@Component({
  selector: 'app-regenerate-backup-codes-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  templateUrl: './regenerate-backup-codes-dialog.html',
})
export class RegenerateBackupCodesDialog {
  private readonly dialogRef = inject(MatDialogRef<RegenerateBackupCodesDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly form = this.formBuilder.nonNullable.group(
    { password: [''] },
    { validators: zodValidator(confirmPasswordSchema) },
  );

  protected readonly serverError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly backupCodes = signal<string[] | null>(null);
  protected readonly copied = signal(false);

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { password } = this.form.getRawValue();
    const { data, error } = await this.authClient.twoFactor.generateBackupCodes({ password });

    this.submitting.set(false);

    if (error || !data) {
      this.serverError.set(error?.message ?? 'Failed to generate backup codes.');
      return;
    }

    this.backupCodes.set(data.backupCodes);
  }

  protected async copyBackupCodes(): Promise<void> {
    const codes = this.backupCodes();
    if (!codes) return;
    await navigator.clipboard.writeText(codes.join('\n'));
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  protected close(): void {
    this.dialogRef.close(!!this.backupCodes());
  }
}
