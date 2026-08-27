import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { setUserPasswordSchema, User, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../../auth/auth-client.token';

export interface SetPasswordDialogData {
  user: User;
}

/**
 * Admin sets a user's password directly — no reset-email round-trip. The
 * affected user is notified server-side (`apps/auth`'s
 * `handleAdminSetPassword` `AfterHook`), not from here.
 */
@Component({
  selector: 'app-set-password-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './set-password-dialog.html',
})
export class SetPasswordDialog {
  protected readonly data = inject<SetPasswordDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SetPasswordDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly form = this.formBuilder.nonNullable.group(
    { newPassword: [''] },
    { validators: zodValidator(setUserPasswordSchema) },
  );

  protected readonly serverError = signal<string | null>(null);

  protected readonly setPassword = injectMutation(() => ({
    mutationFn: async () => {
      const { newPassword } = this.form.getRawValue();
      const { error } = await this.authClient.admin.setUserPassword({
        userId: this.data.user.id,
        newPassword,
      });
      if (error) throw new Error(error.message ?? 'Failed to set password.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);

    try {
      await this.setPassword.mutateAsync();
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to set password.');
      return;
    }

    this.snackBar.open('Password updated', 'Dismiss', { duration: 5000 });
    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
