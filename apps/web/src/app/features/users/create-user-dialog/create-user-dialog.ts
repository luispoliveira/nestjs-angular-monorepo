import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { createUserSchema, RoleEnum, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

function generatePassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Ports create-user-dialog.tsx's behaviour (design.md → dialog → MatDialog):
 * the password is generated client-side and never sent anywhere but the
 * create-user call itself, so it must be shown to the admin exactly once —
 * the dialog switches from the form step to a password-reveal step instead
 * of closing immediately, matching the pre-migration flow.
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
    MatIconModule,
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
  protected readonly generatedPassword = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly createUser = injectMutation(() => ({
    mutationFn: async (password: string) => {
      const { name, email, role } = this.form.getRawValue();
      const { error } = await this.authClient.admin.createUser({ name, email, role, password });
      if (error) throw new Error(error.message ?? 'Failed to create user.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);
    const password = generatePassword();

    try {
      await this.createUser.mutateAsync(password);
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to create user.');
      return;
    }

    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User created', 'Dismiss', { duration: 5000 });
    this.generatedPassword.set(password);
  }

  protected async copyPassword(): Promise<void> {
    const password = this.generatedPassword();
    if (!password) return;
    await navigator.clipboard.writeText(password);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
