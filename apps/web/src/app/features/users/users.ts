import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { RoleEnum, User, usersListResponseSchema } from '@repo/shared-types';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SessionService } from '../../auth/session.service';
import { BanUserDialog } from './ban-user-dialog/ban-user-dialog';
import { ConfirmDialog } from './confirm-dialog/confirm-dialog';
import { CreateUserDialog } from './create-user-dialog/create-user-dialog';
import { EditRoleDialog } from './edit-role-dialog/edit-role-dialog';

type RoleFilter = 'all' | RoleEnum;
type StatusFilter = 'all' | 'active' | 'banned';

const PAGE_SIZE = 20;
const DISPLAYED_COLUMNS = ['name', 'email', 'role', 'status', 'createdAt', 'actions'];

/**
 * Ports the old Next.js users-client.tsx's query-building logic near-verbatim
 * (design.md → D7): the better-auth admin `listUsers` API only supports one
 * `filterField` at a time, so when a status filter AND a role filter are both
 * active, status wins the API call and role is applied client-side after the
 * response comes back.
 */
@Component({
  selector: 'app-users',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    MatTableModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users {
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly session = inject(SessionService);

  protected readonly RoleEnum = RoleEnum;
  protected readonly displayedColumns = DISPLAYED_COLUMNS;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly roleFilter = signal<RoleFilter>('all');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly page = signal(0);

  private readonly debouncedSearch = signal('');

  protected readonly usersQuery = injectQuery(() => {
    const search = this.debouncedSearch();
    const status = this.statusFilter();
    const role = this.roleFilter();
    const pageIndex = this.page();

    const filterParams =
      status !== 'all'
        ? { filterField: 'banned' as const, filterOperator: 'eq' as const, filterValue: status === 'banned' }
        : role !== 'all'
          ? { filterField: 'role' as const, filterOperator: 'eq' as const, filterValue: role }
          : {};
    const searchParams = search
      ? { searchValue: search, searchField: 'email' as const, searchOperator: 'contains' as const }
      : {};

    const query = { limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE, ...searchParams, ...filterParams };

    return {
      queryKey: ['admin', 'users', 'list', query],
      queryFn: async () => {
        const { data, error } = await this.authClient.admin.listUsers({ query });
        if (error) throw new Error(error.message ?? 'Failed to load users.');
        // Network-boundary parse (design.md → D6): throws on a malformed
        // essential field (id/email/total); role/banned are `.nullish()` in
        // userSchema, so an absent non-essential field degrades gracefully
        // instead of failing the whole list.
        return usersListResponseSchema.parse(data);
      },
    };
  });

  protected readonly users = computed(() => {
    const data = this.usersQuery.data();
    if (!data) return [];
    const status = this.statusFilter();
    const role = this.roleFilter();
    return status !== 'all' && role !== 'all' ? data.users.filter((u: User) => u.role === role) : data.users;
  });

  protected readonly total = computed(() => this.usersQuery.data()?.total ?? 0);
  protected readonly currentUserId = computed(() => this.session.user()?.id ?? '');

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.debouncedSearch.set(value.trim());
        this.page.set(0);
      });
  }

  protected setRoleFilter(value: RoleFilter): void {
    this.roleFilter.set(value);
    this.page.set(0);
  }

  protected setStatusFilter(value: StatusFilter): void {
    this.statusFilter.set(value);
    this.page.set(0);
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex);
  }

  protected openCreateUserDialog(): void {
    this.dialog.open(CreateUserDialog);
  }

  protected openEditRoleDialog(user: User): void {
    this.dialog.open(EditRoleDialog, { data: { user } });
  }

  protected async unban(user: User): Promise<void> {
    const { error } = await this.authClient.admin.unbanUser({ userId: user.id });
    if (error) {
      this.snackBar.open(error.message ?? 'Failed to unban user.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    this.snackBar.open('User unbanned', 'Dismiss', { duration: 5000 });
  }

  protected ban(user: User): void {
    this.dialog.open(BanUserDialog, { data: { user } });
  }

  protected delete(user: User): void {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Delete user',
        description: `Are you sure you want to delete ${user.name || user.email}? This action cannot be undone.`,
        confirmLabel: 'Delete',
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const { error } = await this.authClient.admin.removeUser({ userId: user.id });
      if (error) {
        this.snackBar.open(error.message ?? 'Failed to delete user.', 'Dismiss', { duration: 5000 });
        return;
      }
      await this.queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      this.snackBar.open('User deleted', 'Dismiss', { duration: 5000 });
    });
  }
}
