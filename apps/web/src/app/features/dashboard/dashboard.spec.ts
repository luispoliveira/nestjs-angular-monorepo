import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { Dashboard } from './dashboard';

function totalForQuery(query: Record<string, string>): number {
  if (query['filterField'] === 'banned' && query['filterOperator'] === 'ne') return 8;
  if (query['filterField'] === 'banned' && query['filterOperator'] === 'eq') return 2;
  if (query['filterField'] === 'role') return 1;
  return 10;
}

/**
 * Polls with real macrotask ticks + detectChanges until no stat card is
 * still loading — TanStack Query's PendingTasks integration doesn't
 * reliably unblock ComponentFixture.whenStable() in this Angular/vitest
 * combination, so we wait on the actual DOM outcome instead.
 */
async function waitForStatsToSettle(fixture: ComponentFixture<Dashboard>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.nativeElement.querySelector('[data-testid="stat-loading"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Stat queries did not settle in time');
}

async function setUp(listUsers: (args: { query: Record<string, string> }) => Promise<unknown>) {
  TestBed.configureTestingModule({
    providers: [
      // retry: false — a query that errors would otherwise retry with
      // backoff delays, and never settle within this test's poll window.
      provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      { provide: AUTH_CLIENT, useValue: { admin: { listUsers } } },
    ],
  });
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  await waitForStatsToSettle(fixture);
  return fixture;
}

describe('Dashboard', () => {
  it('renders each stat card with the count from its own query', async () => {
    const listUsers = vi
      .fn()
      .mockImplementation(async ({ query }: { query: Record<string, string> }) => ({
        data: { users: [], total: totalForQuery(query) },
        error: null,
      }));

    const fixture = await setUp(listUsers);

    const values = [...fixture.nativeElement.querySelectorAll('[data-testid="stat-value"]')].map(
      (el: Element) => el.textContent?.trim(),
    );

    expect(listUsers).toHaveBeenCalledTimes(4);
    expect(values).toEqual(['10', '8', '2', '1']);
    expect(fixture.nativeElement.querySelector('[data-testid="stat-error"]')).toBeNull();
  });

  it('shows an error instead of a zero when a stat query fails', async () => {
    const listUsers = vi
      .fn()
      .mockImplementation(async ({ query }: { query: Record<string, string> }) => {
        if (query['filterField'] === 'role') {
          return { data: null, error: { message: 'Forbidden' } };
        }
        return { data: { users: [], total: totalForQuery(query) }, error: null };
      });

    const fixture = await setUp(listUsers);

    const errorEl = fixture.nativeElement.querySelector('[data-testid="stat-error"]');
    const values = [...fixture.nativeElement.querySelectorAll('[data-testid="stat-value"]')].map(
      (el: Element) => el.textContent?.trim(),
    );

    expect(errorEl?.textContent?.trim()).toBe('Forbidden');
    expect(values).not.toContain('0');
  });

  it('surfaces a validation error instead of unvalidated data when total is malformed', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [], total: 'not-a-number' }, error: null });

    const fixture = await setUp(listUsers);

    const errorEls = fixture.nativeElement.querySelectorAll('[data-testid="stat-error"]');
    const values = fixture.nativeElement.querySelectorAll('[data-testid="stat-value"]');

    expect(errorEls.length).toBe(4);
    expect(values.length).toBe(0);
  });
});
