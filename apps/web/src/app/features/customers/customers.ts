import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { Customer, RoleEnum } from '@repo/shared-types';
import { debounceTime, distinctUntilChanged, firstValueFrom } from 'rxjs';
import { SessionService } from '../../auth/session.service';
import { ConfirmDialog, ConfirmDialogData } from '../users/confirm-dialog/confirm-dialog';
import { CustomerFormDialog } from './customer-form-dialog/customer-form-dialog';
import { CustomersApi } from './customers.api';

const PAGE_SIZE = 20;

/**
 * Reference vertical slice (see README "Reference slice: Customers").
 * Every authenticated user can read; write controls render only for admins.
 * Hiding them is UX only — apps/api enforces the role on every write.
 */
@Component({
  selector: 'app-customers',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './customers.html',
})
export class Customers {
  private readonly api = inject(CustomersApi);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly session = inject(SessionService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly page = signal(0);
  private readonly debouncedSearch = signal('');

  protected readonly isAdmin = computed(() => this.session.user()?.role === RoleEnum.ADMIN);
  protected readonly displayedColumns = computed(() =>
    this.isAdmin() ? ['name', 'email', 'taxId', 'createdAt', 'actions'] : ['name', 'email', 'taxId', 'createdAt'],
  );

  protected readonly customersQuery = injectQuery(() => {
    const query = { skip: this.page() * PAGE_SIZE, take: PAGE_SIZE, search: this.debouncedSearch() };
    return {
      queryKey: ['customers', 'list', query],
      queryFn: () => this.api.list(query),
    };
  });

  protected readonly customers = computed(() => this.customersQuery.data()?.items ?? []);
  protected readonly total = computed(() => this.customersQuery.data()?.meta.total ?? 0);

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.debouncedSearch.set(value.trim());
        this.page.set(0);
      });
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex);
  }

  protected openForm(customer: Customer | null): void {
    this.dialog.open(CustomerFormDialog, { data: customer, width: '32rem' });
  }

  protected async delete(customer: Customer): Promise<void> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: {
        title: 'Delete customer',
        description: `Are you sure you want to delete ${customer.name}?`,
        confirmLabel: 'Delete',
      },
    });
    if (!(await firstValueFrom(ref.afterClosed()))) return;

    try {
      await this.api.remove(customer.id);
    } catch {
      this.snackBar.open('Failed to delete customer.', 'Dismiss', { duration: 5000 });
      return;
    }
    await this.queryClient.invalidateQueries({ queryKey: ['customers'] });
    this.snackBar.open('Customer deleted', 'Dismiss', { duration: 5000 });
  }
}
