import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { updateProfileSchema, User, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../../auth/auth-client.token';

export interface EditUserDialogData {
  user: User;
}

/**
 * Admin edits another user's `name`/`email`/`emailVerified` directly via
 * `authClient.admin.updateUser` — distinct from `authClient.updateUser`
 * (self-service, see account.ts), which only ever touches the caller's own
 * profile. better-auth rejects `password` through this endpoint (use
 * set-password-dialog instead), so it isn't offered here.
 */
@Component({
  selector: 'app-edit-user-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  templateUrl: './edit-user-dialog.html',
})
export class EditUserDialog {
  protected readonly data = inject<EditUserDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<EditUserDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly form = this.formBuilder.nonNullable.group(
    {
      name: [this.data.user.name],
      email: [this.data.user.email],
      emailVerified: [this.data.user.emailVerified],
    },
    { validators: zodValidator(updateProfileSchema) },
  );

  protected readonly serverError = signal<string | null>(null);

  protected readonly updateUser = injectMutation(() => ({
    mutationFn: async () => {
      const { name, email, emailVerified } = this.form.getRawValue();
      const { error } = await this.authClient.admin.updateUser({
        userId: this.data.user.id,
        data: { name, email, emailVerified },
      });
      if (error) throw new Error(error.message ?? 'Failed to update user.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);

    try {
      await this.updateUser.mutateAsync();
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to update user.');
      return;
    }

    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User updated', 'Dismiss', { duration: 5000 });
    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
