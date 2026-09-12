import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { confirmPasswordSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

/**
 * Deletes the current user's own account immediately — no confirmation
 * email round-trip. `authClient.deleteUser({ password })` bypasses the
 * "fresh session" requirement that would otherwise apply (better-auth's own
 * `api/routes/update-user.mjs`), so this works regardless of how long ago
 * the user signed in, as long as they can still type their password.
 */
@Component({
  selector: 'app-delete-account-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './delete-account-dialog.html',
})
export class DeleteAccountDialog {
  private readonly dialogRef = inject(MatDialogRef<DeleteAccountDialog>);
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
    const { error } = await this.authClient.deleteUser({ password });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Failed to delete account.');
      return;
    }

    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
