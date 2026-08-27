import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { changePasswordSchema, updateProfileSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SessionService } from '../../auth/session.service';

/**
 * Self-service profile page. Name and email are submitted together but
 * dispatched as two independent better-auth calls (design mirrors D6/D7):
 * `updateUser` rejects an `email` field outright, and `changeEmail` needs a
 * verification round-trip, so each field only fires its own call when it
 * actually changed — resubmitting an unchanged email would otherwise
 * needlessly re-trigger the confirmation email.
 */
@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly session = inject(SessionService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly currentUser = this.session.user;
  protected readonly initials = computed(() => {
    const source = (this.currentUser()?.name || this.currentUser()?.email || '').trim();
    if (!source) return '';
    const parts = source.split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : source.slice(0, 2).toUpperCase();
  });

  protected readonly profileForm = this.formBuilder.nonNullable.group(
    { name: [this.currentUser()?.name ?? ''], email: [this.currentUser()?.email ?? ''] },
    { validators: zodValidator(updateProfileSchema) },
  );

  protected readonly passwordForm = this.formBuilder.nonNullable.group(
    { currentPassword: [''], newPassword: [''], confirmPassword: [''] },
    { validators: zodValidator(changePasswordSchema) },
  );

  protected readonly profileError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);

  protected readonly updateProfile = injectMutation(() => ({
    mutationFn: async () => {
      const { name, email } = this.profileForm.getRawValue();
      const user = this.currentUser();

      if (user && name !== user.name) {
        const { error } = await this.authClient.updateUser({ name });
        if (error) throw new Error(error.message ?? 'Failed to update name.');
      }

      const emailChanged = !!user && email !== user.email;
      if (emailChanged) {
        const { error } = await this.authClient.changeEmail({ newEmail: email });
        if (error) throw new Error(error.message ?? 'Failed to change email.');
      }

      return { emailChanged };
    },
  }));

  protected readonly changePassword = injectMutation(() => ({
    mutationFn: async () => {
      const { currentPassword, newPassword } = this.passwordForm.getRawValue();
      const { error } = await this.authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) throw new Error(error.message ?? 'Failed to change password.');
    },
  }));

  protected cancelProfile(): void {
    const user = this.currentUser();
    this.profileForm.reset({ name: user?.name ?? '', email: user?.email ?? '' });
    this.profileError.set(null);
  }

  protected async onSubmitProfile(): Promise<void> {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.profileError.set(null);

    let result: { emailChanged: boolean };
    try {
      result = await this.updateProfile.mutateAsync();
    } catch (error) {
      this.profileError.set(error instanceof Error ? error.message : 'Failed to update profile.');
      return;
    }

    this.snackBar.open(
      result.emailChanged ? 'Profile updated. Check your inbox to confirm the new email.' : 'Profile updated',
      'Dismiss',
      { duration: 5000 },
    );
  }

  protected async onSubmitPassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.passwordError.set(null);

    try {
      await this.changePassword.mutateAsync();
    } catch (error) {
      this.passwordError.set(error instanceof Error ? error.message : 'Failed to change password.');
      return;
    }

    this.passwordForm.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    this.snackBar.open('Password changed', 'Dismiss', { duration: 5000 });
  }
}
