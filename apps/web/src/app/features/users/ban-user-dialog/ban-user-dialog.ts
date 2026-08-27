import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { banUserSchema, User, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

export interface BanUserDialogData {
  user: User;
}

const EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Never', value: null },
  { label: '1 day', value: 60 * 60 * 24 },
  { label: '7 days', value: 60 * 60 * 24 * 7 },
  { label: '30 days', value: 60 * 60 * 24 * 30 },
];

/** Replaces the bare `ConfirmDialog` the ban action used to open (design.md → "Ban dialog gains optional fields"). */
@Component({
  selector: 'app-ban-user-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './ban-user-dialog.html',
})
export class BanUserDialog {
  protected readonly data = inject<BanUserDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<BanUserDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly expiryOptions = EXPIRY_OPTIONS;

  protected readonly form = this.formBuilder.nonNullable.group(
    { reason: [''], expiresInSeconds: [null as number | null] },
    { validators: zodValidator(banUserSchema) },
  );

  protected readonly serverError = signal<string | null>(null);

  protected readonly banUser = injectMutation(() => ({
    mutationFn: async () => {
      const { reason, expiresInSeconds } = this.form.getRawValue();
      const { error } = await this.authClient.admin.banUser({
        userId: this.data.user.id,
        banReason: reason.trim() || undefined,
        banExpiresIn: expiresInSeconds ?? undefined,
      });
      if (error) throw new Error(error.message ?? 'Failed to ban user.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);

    try {
      await this.banUser.mutateAsync();
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to ban user.');
      return;
    }

    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User banned', 'Dismiss', { duration: 5000 });
    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
