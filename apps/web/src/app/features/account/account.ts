import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { changePasswordSchema, updateProfileSchema, userSessionSchema, zodValidator } from '@repo/shared-types';
import { z } from 'zod';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SessionService } from '../../auth/session.service';
import { DeleteAccountDialog } from './delete-account-dialog/delete-account-dialog';
import { RegenerateBackupCodesDialog } from './regenerate-backup-codes-dialog/regenerate-backup-codes-dialog';
import { TwoFactorDisableDialog } from './two-factor-disable-dialog/two-factor-disable-dialog';
import { TwoFactorEnableDialog } from './two-factor-enable-dialog/two-factor-enable-dialog';

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
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly session = inject(SessionService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

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
    // revokeOtherSessions: true (above) just killed every other session — the
    // list would otherwise keep showing them as still active until an
    // unrelated refetch happened to occur.
    await this.invalidateSessions();
    this.snackBar.open('Password changed', 'Dismiss', { duration: 5000 });
  }

  // ── Active sessions ────────────────────────────────────────────────────

  protected readonly currentSessionToken = computed(
    () => (this.session.session() as { session?: { token?: string } } | null)?.session?.token,
  );

  protected readonly sessionsQuery = injectQuery(() => ({
    queryKey: ['account', 'sessions'],
    queryFn: async () => {
      const { data, error } = await this.authClient.listSessions();
      if (error) throw new Error(error.message ?? 'Failed to load sessions.');
      return z.array(userSessionSchema).parse(data ?? []);
    },
  }));

  protected readonly sessions = computed(() => this.sessionsQuery.data() ?? []);

  private async invalidateSessions(): Promise<void> {
    await this.queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
  }

  protected async revokeSession(token: string): Promise<void> {
    const { error } = await this.authClient.revokeSession({ token });
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to revoke session.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.invalidateSessions();
    this.snackBar.open('Session revoked', 'Dismiss', { duration: 5000 });
  }

  protected async revokeOtherSessions(): Promise<void> {
    const { error } = await this.authClient.revokeOtherSessions();
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to revoke other sessions.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.invalidateSessions();
    this.snackBar.open('Other sessions revoked', 'Dismiss', { duration: 5000 });
  }

  // ── Two-factor authentication ──────────────────────────────────────────

  protected readonly twoFactorEnabled = computed(
    () => !!(this.currentUser() as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled,
  );

  protected openEnableTwoFactor(): void {
    this.dialog
      .open(TwoFactorEnableDialog)
      .afterClosed()
      .subscribe((enabled: boolean) => {
        if (enabled) this.snackBar.open('Two-factor authentication enabled', 'Dismiss', { duration: 5000 });
      });
  }

  protected openDisableTwoFactor(): void {
    this.dialog
      .open(TwoFactorDisableDialog)
      .afterClosed()
      .subscribe((disabled: boolean) => {
        if (disabled) this.snackBar.open('Two-factor authentication disabled', 'Dismiss', { duration: 5000 });
      });
  }

  protected openRegenerateBackupCodes(): void {
    this.dialog.open(RegenerateBackupCodesDialog);
  }

  // ── Delete account ─────────────────────────────────────────────────────

  protected openDeleteAccount(): void {
    this.dialog
      .open(DeleteAccountDialog)
      .afterClosed()
      .subscribe(async (deleted: boolean) => {
        if (!deleted) return;
        await this.session.signedOut();
        await this.router.navigateByUrl('/sign-in');
      });
  }
}
