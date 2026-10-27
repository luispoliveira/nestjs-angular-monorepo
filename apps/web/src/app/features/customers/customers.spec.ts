import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Customer, CustomersListResponse, RoleEnum } from '@repo/shared-types';
import { of } from 'rxjs';
import { AUTH_CLIENT, SessionAtomClient } from '../../auth/auth-client.token';
import { ConfirmDialog } from '../users/confirm-dialog/confirm-dialog';
import { CustomerFormDialog } from './customer-form-dialog/customer-form-dialog';
import { Customers } from './customers';
import { CustomersApi } from './customers.api';

function customer(id: string): Customer {
  return {
    id,
    name: `Customer ${id}`,
    email: `c${id}@example.com`,
    taxId: null,
    notes: null,
    createdAt: new Date('2026-10-10T10:00:00.000Z'),
    updatedAt: new Date('2026-10-10T10:00:00.000Z'),
  };
}

function page(items: Customer[], total = items.length): CustomersListResponse {
  return { items, meta: { page: 1, pageSize: 20, totalPages: Math.ceil(total / 20), total } };
}

type SessionValue = SessionAtomClient['useSession'] extends { get(): infer T } ? T : never;

function fakeSessionAtom(role: RoleEnum): SessionAtomClient['useSession'] {
  const value = {
    data: { user: { id: 'me', email: 'me@example.com', role }, session: { id: 's1' } },
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

async function settle(fixture: ComponentFixture<Customers>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.nativeElement.querySelector('[data-testid="customers-loading"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Customers query did not settle in time');
}

function setUp(role: RoleEnum, api: Partial<Record<keyof CustomersApi, ReturnType<typeof vi.fn>>>) {
  const snackOpen = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      { provide: AUTH_CLIENT, useValue: { useSession: fakeSessionAtom(role) } },
      { provide: CustomersApi, useValue: api },
      { provide: MatSnackBar, useValue: { open: snackOpen } },
    ],
  });
  const fixture = TestBed.createComponent(Customers);
  fixture.detectChanges();
  return { fixture, snackOpen };
}

const q = (fixture: ComponentFixture<Customers>, selector: string) =>
  fixture.nativeElement.querySelector(selector) as HTMLElement | null;

describe('Customers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows create, edit and delete controls to an admin', async () => {
    const list = vi.fn().mockResolvedValue(page([customer('1')]));
    const { fixture } = setUp(RoleEnum.ADMIN, { list });
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="customer-row-"]').length).toBe(1);
    expect(q(fixture, '[data-testid="create-customer"]')).toBeTruthy();
    expect(q(fixture, '[data-testid="edit-customer-1"]')).toBeTruthy();
    expect(q(fixture, '[data-testid="delete-customer-1"]')).toBeTruthy();
  });

  it('shows no write controls to a non-admin', async () => {
    const list = vi.fn().mockResolvedValue(page([customer('1')]));
    const { fixture } = setUp(RoleEnum.USER, { list });
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="customer-row-"]').length).toBe(1);
    expect(q(fixture, '[data-testid="create-customer"]')).toBeNull();
    expect(q(fixture, '[data-testid="edit-customer-1"]')).toBeNull();
    expect(q(fixture, '[data-testid="delete-customer-1"]')).toBeNull();
  });

  it('pages and searches through the API (debounced, back to the first page)', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue(page([customer('1')], 42));
      const { fixture } = setUp(RoleEnum.USER, { list });
      const instance = fixture.componentInstance;
      await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20, search: '' });

      instance['onPage']({ pageIndex: 1, pageSize: 20, length: 42 });
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenLastCalledWith({ skip: 20, take: 20, search: '' });

      instance['searchControl'].setValue('silva');
      await vi.advanceTimersByTimeAsync(299);
      expect(instance['page']()).toBe(1);
      await vi.advanceTimersByTimeAsync(2);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      expect(instance['page']()).toBe(0);
      expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20, search: 'silva' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the form dialog for create and for edit', async () => {
    const list = vi.fn().mockResolvedValue(page([customer('1')]));
    const open = vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({
      afterClosed: () => of(false),
    } as ReturnType<MatDialog['open']>);
    const { fixture } = setUp(RoleEnum.ADMIN, { list });
    await settle(fixture);

    q(fixture, '[data-testid="create-customer"]')?.click();
    expect(open).toHaveBeenLastCalledWith(CustomerFormDialog, expect.objectContaining({ data: null }));

    q(fixture, '[data-testid="edit-customer-1"]')?.click();
    expect(open).toHaveBeenLastCalledWith(
      CustomerFormDialog,
      expect.objectContaining({ data: expect.objectContaining({ id: '1' }) }),
    );
  });

  it('deletes only after confirmation and refreshes the list', async () => {
    const list = vi.fn().mockResolvedValue(page([customer('1')]));
    const remove = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({
      afterClosed: () => of(true),
    } as ReturnType<MatDialog['open']>);
    const { fixture } = setUp(RoleEnum.ADMIN, { list, remove });
    const invalidate = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');
    await settle(fixture);

    await fixture.componentInstance['delete'](customer('1'));

    expect(open).toHaveBeenCalledWith(ConfirmDialog, expect.anything());
    expect(remove).toHaveBeenCalledWith('1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] });
  });

  it('does not delete when the confirmation is dismissed', async () => {
    const list = vi.fn().mockResolvedValue(page([customer('1')]));
    const remove = vi.fn();
    vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({
      afterClosed: () => of(false),
    } as ReturnType<MatDialog['open']>);
    const { fixture } = setUp(RoleEnum.ADMIN, { list, remove });
    await settle(fixture);

    await fixture.componentInstance['delete'](customer('1'));

    expect(remove).not.toHaveBeenCalled();
  });

  it('shows a load error and renders no rows when the list fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('malformed'));
    const { fixture } = setUp(RoleEnum.USER, { list });
    await settle(fixture);

    expect(q(fixture, '[data-testid="customers-error"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="customer-row-"]').length).toBe(0);
  });
});
