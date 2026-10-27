import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { AUDIT_ACTIONS, AuditAction, AuditEventListQuery, AuditOutcome } from '@repo/shared-types';
import { debounceTime } from 'rxjs';
import { AuditApi } from './audit.api';

const PAGE_SIZE = 20;
const COLUMNS = ['occurredAt', 'actor', 'impersonatedBy', 'action', 'target', 'outcome'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** Admin-only (see the `audit` route) read-only view of the audit trail. */
@Component({
  selector: 'app-audit',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './audit.html',
})
export class Audit {
  private readonly api = inject(AuditApi);

  protected readonly actions = AUDIT_ACTIONS;
  protected readonly displayedColumns = COLUMNS;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly page = signal(0);

  protected readonly filters = new FormGroup({
    action: new FormControl<AuditAction | ''>('', { nonNullable: true }),
    outcome: new FormControl<AuditOutcome | ''>('', { nonNullable: true }),
    // An email (contains "@") or a user id.
    actor: new FormControl('', { nonNullable: true }),
    targetId: new FormControl('', { nonNullable: true }),
    range: new FormGroup({
      start: new FormControl<Date | null>(null),
      end: new FormControl<Date | null>(null),
    }),
  });

  /** The filters as last applied (debounced), so typing does not fire a request per key. */
  private readonly applied = signal(this.filters.getRawValue());

  protected readonly eventsQuery = injectQuery(() => {
    const query = this.buildQuery(this.applied(), this.page());
    return {
      queryKey: ['audit', 'list', query],
      queryFn: () => this.api.list(query),
    };
  });

  protected readonly events = computed(() => this.eventsQuery.data()?.items ?? []);
  protected readonly total = computed(() => this.eventsQuery.data()?.meta.total ?? 0);

  constructor() {
    this.filters.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe(() => {
      this.applied.set(this.filters.getRawValue());
      this.page.set(0);
    });
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event.pageIndex);
  }

  protected clearFilters(): void {
    this.filters.reset();
  }

  private buildQuery(f: ReturnType<typeof this.filters.getRawValue>, page: number): Partial<AuditEventListQuery> {
    const query: Partial<AuditEventListQuery> = { skip: page * PAGE_SIZE, take: PAGE_SIZE };
    if (f.action) query.action = f.action;
    if (f.outcome) query.outcome = f.outcome;
    const actor = f.actor.trim();
    if (actor.includes('@')) query.actorEmail = actor.toLowerCase();
    else if (actor) query.actorId = actor;
    const targetId = f.targetId.trim();
    if (targetId) query.targetId = targetId;
    if (f.range.start) query.from = startOfDay(f.range.start);
    if (f.range.end) query.to = endOfDay(f.range.end);
    return query;
  }
}
