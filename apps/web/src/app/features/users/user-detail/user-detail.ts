import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { RoleEnum, userSchema, userSessionsListResponseSchema } from '@repo/shared-types';
import { map } from 'rxjs';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { SessionService } from '../../../auth/session.service';
import { BanUserDialog } from '../ban-user-dialog/ban-user-dialog';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';
import { SetPasswordDialog } from './set-password-dialog/set-password-dialog';

/**
 * `/users/:id` — the angular-web-app spec's "Administrators can view a
 * single user's full detail". `getUser`'s response body is the user object
 * itself (not `{ user: ... }`) — confirmed against better-auth's own
 * `plugins/admin/routes.mjs` (`return parseUserOutput(...)`), unlike most
 * other admin endpoints which wrap their payload.
 */
@Component({
  selector: 'app-user-detail',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatDialogModule, MatProgressSpinnerModule],
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.scss',
})
export class UserDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly session = inject(SessionService);

  protected readonly userId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });

  protected readonly userQuery = injectQuery(() => {
    const id = this.userId();
    return {
      queryKey: ['admin', 'users', 'detail', id],
      queryFn: async () => {
        const { data, error } = await this.authClient.admin.getUser({ query: { id } });
        if (error) throw new Error(error.message ?? 'Failed to load user.');
        return userSchema.parse(data);
      },
    };
  });

  protected readonly user = computed(() => this.userQuery.data() ?? null);
  protected readonly initials = computed(() => {
    const target = this.user();
    const source = (target?.name || target?.email || '').trim();
    if (!source) return '';
    const parts = source.split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : source.slice(0, 2).toUpperCase();
  });

  /**
   * better-auth already refuses to impersonate an admin server-side by
   * default (the `impersonate-admins` permission is never granted here) —
   * this disables the control as UX on top of that, and additionally blocks
   * self-impersonation, which better-auth does not block on its own.
   */
  protected readonly canImpersonate = computed(() => {
    const target = this.user();
    if (!target) return false;
    if (target.id === this.session.user()?.id) return false;
    return target.role !== RoleEnum.ADMIN;
  });

  protected impersonate(): void {
    const target = this.user();
    if (!target) return;
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Impersonate user',
        description: `You will be signed in as ${target.name || target.email}. Use "Stop impersonating" to return to your own session.`,
        confirmLabel: 'Impersonate',
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const { error } = await this.authClient.admin.impersonateUser({ userId: target.id });
      if (error) {
        this.snackBar.open(error.message ?? 'Failed to impersonate user.', 'Dismiss', { duration: 5000 });
        return;
      }
      await this.router.navigateByUrl('/dashboard');
    });
  }

  protected ban(): void {
    const user = this.user();
    if (!user) return;
    this.dialog.open(BanUserDialog, { data: { user } });
  }

  protected setPassword(): void {
    const user = this.user();
    if (!user) return;
    this.dialog.open(SetPasswordDialog, { data: { user } });
  }

  protected async unban(): Promise<void> {
    const user = this.user();
    if (!user) return;
    const { error } = await this.authClient.admin.unbanUser({ userId: user.id });
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to unban user.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User unbanned', 'Dismiss', { duration: 5000 });
  }

  protected readonly sessionsQuery = injectQuery(() => {
    const id = this.userId();
    return {
      queryKey: ['admin', 'users', 'sessions', id],
      queryFn: async () => {
        const { data, error } = await this.authClient.admin.listUserSessions({ userId: id });
        if (error) throw new Error(error.message ?? 'Failed to load sessions.');
        return userSessionsListResponseSchema.parse(data).sessions;
      },
    };
  });

  protected readonly sessions = computed(() => this.sessionsQuery.data() ?? []);

  private async invalidateSessions(): Promise<void> {
    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'sessions', this.userId()] });
  }

  protected async revokeSession(token: string): Promise<void> {
    const { error } = await this.authClient.admin.revokeUserSession({ sessionToken: token });
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to revoke session.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.invalidateSessions();
    this.snackBar.open('Session revoked', 'Dismiss', { duration: 5000 });
  }

  protected async revokeAllSessions(): Promise<void> {
    const user = this.user();
    if (!user) return;
    const { error } = await this.authClient.admin.revokeUserSessions({ userId: user.id });
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to revoke sessions.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.invalidateSessions();
    this.snackBar.open('All sessions revoked', 'Dismiss', { duration: 5000 });
  }
}
