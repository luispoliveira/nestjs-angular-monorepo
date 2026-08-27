import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { usersListResponseSchema } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../auth/auth-client.token';

const statResponseSchema = usersListResponseSchema.pick({ total: true });

interface StatConfig {
  label: string;
  icon: string;
  queryKey: readonly string[];
  query: Record<string, string>;
}

const STAT_CONFIGS: readonly StatConfig[] = [
  { label: 'Total Users', icon: 'group', queryKey: ['admin', 'users', 'total'], query: {} },
  {
    label: 'Active Users',
    icon: 'how_to_reg',
    queryKey: ['admin', 'users', 'active'],
    query: { filterField: 'banned', filterOperator: 'ne', filterValue: 'true' },
  },
  {
    label: 'Banned Users',
    icon: 'block',
    queryKey: ['admin', 'users', 'banned'],
    query: { filterField: 'banned', filterOperator: 'eq', filterValue: 'true' },
  },
  {
    label: 'Admins',
    icon: 'verified_user',
    queryKey: ['admin', 'users', 'admins'],
    query: { filterField: 'role', filterOperator: 'eq', filterValue: 'admin' },
  },
];

/**
 * Four independent stat queries run in parallel via TanStack Query
 * (design.md → D7). Each throws on a better-auth error response, or on a
 * response whose `total` fails `statResponseSchema` (design.md → D6's
 * network-boundary `parse`), instead of falling back to 0 — so a failed or
 * malformed fetch renders as an error state rather than a misleadingly
 * plausible zero count. Scoped to `total` only, not the full
 * `usersListResponseSchema`, so a malformed field elsewhere in the response
 * (irrelevant to this screen) can't fail a stat card.
 */
@Component({
  selector: 'app-dashboard',
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly stats = STAT_CONFIGS.map((config) => ({
    label: config.label,
    icon: config.icon,
    query: injectQuery(() => ({
      queryKey: config.queryKey,
      queryFn: async () => {
        const { data, error } = await this.authClient.admin.listUsers({ query: config.query });
        if (error) throw new Error(error.message ?? 'Failed to load user stats.');
        return statResponseSchema.parse(data).total;
      },
    })),
  }));
}
