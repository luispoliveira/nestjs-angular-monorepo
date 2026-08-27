import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';
import { editRoleSchema, RoleEnum, User, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';

export interface EditRoleDialogData {
  user: User;
}

@Component({
  selector: 'app-edit-role-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './edit-role-dialog.html',
})
export class EditRoleDialog {
  protected readonly data = inject<EditRoleDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<EditRoleDialog>);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly RoleEnum = RoleEnum;

  protected readonly form = this.formBuilder.nonNullable.group(
    { role: [this.data.user.role ?? RoleEnum.USER] },
    { validators: zodValidator(editRoleSchema) },
  );

  protected readonly serverError = signal<string | null>(null);

  protected readonly setRole = injectMutation(() => ({
    mutationFn: async () => {
      const { error } = await this.authClient.admin.setRole({
        userId: this.data.user.id,
        role: this.form.getRawValue().role,
      });
      if (error) throw new Error(error.message ?? 'Failed to update role.');
    },
  }));

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.serverError.set(null);

    try {
      await this.setRole.mutateAsync();
    } catch (error) {
      this.serverError.set(error instanceof Error ? error.message : 'Failed to update role.');
      return;
    }

    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('Role updated', 'Dismiss', { duration: 5000 });
    this.dialogRef.close();
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
