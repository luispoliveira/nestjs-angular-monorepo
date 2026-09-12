import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { confirmPasswordSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

@Component({
  selector: 'app-two-factor-disable-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './two-factor-disable-dialog.html',
})
export class TwoFactorDisableDialog {
  private readonly dialogRef = inject(MatDialogRef<TwoFactorDisableDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly form = this.formBuilder.nonNullable.group(
    { password: [''] },
    { validators: zodValidator(confirmPasswordSchema) },
  );

  protected readonly serverError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { password } = this.form.getRawValue();
    const { error } = await this.authClient.twoFactor.disable({ password });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Failed to disable two-factor authentication.');
      return;
    }

    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
