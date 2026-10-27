import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { createUserSchema, RoleEnum, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

/**
 * Creates an account without a password: apps/auth emails the new user an
 * invitation to choose their own (account-invitation spec), so no password
 * ever passes through the administrator and the dialog just closes on success.
 */
@Component({
  selector: 'app-create-user-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './create-user-dialog.html',
})
export class CreateUserDialog {
  private readonly dialogRef = inject(MatDialogRef<CreateUserDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly RoleEnum = RoleEnum;

  protected readonly form = this.formBuilder.nonNullable.group(
    { name: [''], email: [''], role: [RoleEnum.USER] },
    { validators: zodValidator(createUserSchema) },
  );

  protected readonly serverError = signal<string | null>(null);

  protected readonly createUser = injectMutation(() => ({
    mutationFn: async () => {
      const { name, email, role } = this.form.getRawValue();
      const { error } = await this.authClient.admin.createUser({ name, email, role });
      if (error) throw new Error(error.message ?? 'Failed to create user.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);

    try {
      await this.createUser.mutateAsync();
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to create user.');
      return;
    }

    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User created — an invitation was emailed to them', 'Dismiss', {
      duration: 5000,
    });
    this.close();
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
