import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum, User } from '@repo/shared-types';
import { of } from 'rxjs';
import { AUTH_CLIENT, SessionAtomClient } from '../../auth/auth-client.token';
import { Users } from './users';

function user(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    role: RoleEnum.USER,
    banned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

function fakeSessionAtom(currentUserId: string): SessionAtomClient['useSession'] {
  const value: SessionValue = {
    data: { user: { id: currentUserId, email: 'me@example.com', role: RoleEnum.ADMIN }, session: { id: 's1' } },
    error: null,
    isPending: false,
    isRefetching: false,
  } as SessionValue;
  return {
    get: () => value,
    subscribe(listener: (v: SessionValue) => void) {
      listener(value);
      return () => undefined;
    },
  } as unknown as SessionAtomClient['useSession'];
}

async function waitForQueryToSettle(fixture: ComponentFixture<Users>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.nativeElement.querySelector('[data-testid="users-loading"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Users query did not settle in time');
}

function setUp(
  admin: Record<string, (...args: never[]) => Promise<unknown>>,
  opts: { currentUserId?: string; confirmResult?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      { provide: AUTH_CLIENT, useValue: { admin, useSession: fakeSessionAtom(opts.currentUserId ?? 'me') } },
    ],
  });
  if (opts.confirmResult !== undefined) {
    vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({
      afterClosed: () => of(opts.confirmResult),
    } as ReturnType<MatDialog['open']>);
  }
  const fixture = TestBed.createComponent(Users);
  fixture.detectChanges();
  return fixture;
}

describe('Users', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debounces the search input at 300ms and resets to the first page', async () => {
    vi.useFakeTimers();
    try {
      const listUsers = vi.fn().mockResolvedValue({ data: { users: [], total: 0 }, error: null });
      const fixture = setUp({ listUsers });
      const instance = fixture.componentInstance;
      instance['page'].set(3);

      instance['searchControl'].setValue('a');
      instance['searchControl'].setValue('ad');
      instance['searchControl'].setValue('ada');
      await vi.advanceTimersByTimeAsync(299);
      expect(instance['page']()).toBe(3);

      await vi.advanceTimersByTimeAsync(2);
      expect(instance['page']()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders rows from the query response and paginates', async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValue({ data: { users: [user('1'), user('2')], total: 42 }, error: null });
    const fixture = setUp({ listUsers });
    await waitForQueryToSettle(fixture);

    const rows = fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]');
    expect(rows.length).toBe(2);

    const [{ query: firstQuery }] = listUsers.mock.calls[0];
    expect(firstQuery.offset).toBe(0);
    expect(firstQuery.limit).toBe(20);

    fixture.componentInstance['onPage']({ pageIndex: 1, pageSize: 20, length: 42 });
    await waitForQueryToSettle(fixture);

    const lastCall = listUsers.mock.calls.at(-1);
    expect(lastCall?.[0].query.offset).toBe(20);
  });

  it('applies status filter via the API and role filter client-side when both are active', async () => {
    const listUsers = vi.fn().mockImplementation(async ({ query }: { query: Record<string, unknown> }) => {
      expect(query['filterField']).toBe('banned');
      expect(query['filterValue']).toBe(false);
      return {
        data: {
          users: [user('1', { role: RoleEnum.ADMIN, banned: false }), user('2', { role: RoleEnum.USER, banned: false })],
          total: 2,
        },
        error: null,
      };
    });
    const fixture = setUp({ listUsers });
    await waitForQueryToSettle(fixture);

    fixture.componentInstance['setStatusFilter']('active');
    fixture.componentInstance['setRoleFilter'](RoleEnum.ADMIN);
    await waitForQueryToSettle(fixture);

    const rows = fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('user1@example.com');
  });

  it('surfaces a validation error and renders no rows when an essential field is malformed', async () => {
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [{ id: '1', name: 'Missing Email' }], total: 1 },
      error: null,
    });
    const fixture = setUp({ listUsers });
    await waitForQueryToSettle(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="users-error"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]').length).toBe(0);
  });

  it('bans a user after confirmation and refreshes the list', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const banUser = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ listUsers, banUser }, { confirmResult: true });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    fixture.componentInstance['ban'](user('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(banUser).toHaveBeenCalledWith({ userId: '1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('does not ban when the confirmation is cancelled', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const banUser = vi.fn();
    const fixture = setUp({ listUsers, banUser }, { confirmResult: false });
    await waitForQueryToSettle(fixture);

    fixture.componentInstance['ban'](user('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(banUser).not.toHaveBeenCalled();
  });

  it('unbans a user without a confirmation step', async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValue({ data: { users: [user('1', { banned: true })], total: 1 }, error: null });
    const unbanUser = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ listUsers, unbanUser });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    await fixture.componentInstance['unban'](user('1', { banned: true }));

    expect(unbanUser).toHaveBeenCalledWith({ userId: '1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('shows an error and leaves the list unchanged when unban is rejected by the server', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const unbanUser = vi.fn().mockResolvedValue({ error: { message: 'Server rejected the request' } });
    const fixture = setUp({ listUsers, unbanUser });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    await fixture.componentInstance['unban'](user('1'));

    expect(invalidateSpy).not.toHaveBeenCalled();
    const rowsAfter = fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]');
    expect(rowsAfter.length).toBe(1);
  });

  it('shows an error and leaves the list unchanged when ban is rejected by the server', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const banUser = vi.fn().mockResolvedValue({ error: { message: 'Cannot ban this user' } });
    const fixture = setUp({ listUsers, banUser }, { confirmResult: true });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    fixture.componentInstance['ban'](user('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]').length).toBe(1);
  });

  it('deletes a user after confirmation and refreshes the list', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const removeUser = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ listUsers, removeUser }, { confirmResult: true });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    fixture.componentInstance['delete'](user('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeUser).toHaveBeenCalledWith({ userId: '1' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('shows an error and leaves the list unchanged when delete is rejected by the server', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('1')], total: 1 }, error: null });
    const removeUser = vi.fn().mockResolvedValue({ error: { message: 'Cannot delete this user' } });
    const fixture = setUp({ listUsers, removeUser }, { confirmResult: true });
    await waitForQueryToSettle(fixture);
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    fixture.componentInstance['delete'](user('1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="user-row-"]').length).toBe(1);
  });

  it('disables ban/unban and delete for the current user', async () => {
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [user('me')], total: 1 }, error: null });
    const fixture = setUp({ listUsers }, { currentUserId: 'me' });
    await waitForQueryToSettle(fixture);

    fixture.nativeElement.querySelector('[data-testid="actions-menu-me"]').click();
    fixture.detectChanges();

    const banButton = document.querySelector('[data-testid="ban-action"]');
    const deleteButton = document.querySelector('[data-testid="delete-action"]');

    expect(banButton?.getAttribute('disabled')).not.toBeNull();
    expect(deleteButton?.getAttribute('disabled')).not.toBeNull();
  });
});
