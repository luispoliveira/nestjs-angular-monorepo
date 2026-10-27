import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { AuditEvent, AuditEventsListResponse } from '@repo/shared-types';
import { Audit } from './audit';
import { AuditApi } from './audit.api';

function event(id: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id,
    occurredAt: new Date('2026-10-10T10:00:00.000Z'),
    action: 'admin.user.ban',
    outcome: 'success',
    actorId: 'a1',
    actorEmail: 'admin@example.com',
    targetType: 'user',
    targetId: 'u1',
    ...overrides,
  };
}

function page(items: AuditEvent[], total = items.length): AuditEventsListResponse {
  return { items, meta: { page: 1, pageSize: 20, totalPages: Math.ceil(total / 20), total } };
}

async function settle(fixture: ComponentFixture<Audit>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.nativeElement.querySelector('[data-testid="audit-loading"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Audit query did not settle in time');
}

function setUp(list: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      { provide: AuditApi, useValue: { list } },
    ],
  });
  const fixture = TestBed.createComponent(Audit);
  fixture.detectChanges();
  return fixture;
}

const rowText = (fixture: ComponentFixture<Audit>, id: string) =>
  (fixture.nativeElement.querySelector(`[data-testid="audit-row-${id}"]`) as HTMLElement | null)?.textContent ?? '';

describe('Audit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a row per event with actor, impersonated by, action, target and outcome', async () => {
    const list = vi.fn().mockResolvedValue(
      page([event('e1', { impersonatedById: 'admin-0' }), event('e2', { outcome: 'failure', errorCode: '403' })]),
    );
    const fixture = setUp(list);
    await settle(fixture);

    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="audit-row-"]').length).toBe(2);
    expect(rowText(fixture, 'e1')).toContain('admin@example.com');
    expect(rowText(fixture, 'e1')).toContain('admin-0');
    expect(rowText(fixture, 'e1')).toContain('admin.user.ban');
    expect(rowText(fixture, 'e1')).toContain('u1');
    expect(rowText(fixture, 'e1')).toContain('success');
    expect(rowText(fixture, 'e2')).toContain('failure');
    expect(rowText(fixture, 'e2')).toContain('403');
  });

  it('shows the attempted email as the actor of a failed sign-in that has none', async () => {
    const list = vi.fn().mockResolvedValue(
      page([
        event('e3', {
          action: 'auth.sign-in',
          outcome: 'failure',
          actorId: undefined,
          actorEmail: undefined,
          attemptedEmail: 'someone@example.com',
          targetType: undefined,
          targetId: undefined,
        }),
      ]),
    );
    const fixture = setUp(list);
    await settle(fixture);

    expect(rowText(fixture, 'e3')).toContain('someone@example.com');
  });

  it('starts on the first page with no filters', async () => {
    const list = vi.fn().mockResolvedValue(page([event('e1')]));
    const fixture = setUp(list);
    await settle(fixture);

    expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20 });
  });

  it('pages through the API', async () => {
    const list = vi.fn().mockResolvedValue(page([event('e1')], 42));
    const fixture = setUp(list);
    await settle(fixture);

    fixture.componentInstance['onPage']({ pageIndex: 2, pageSize: 20, length: 42 });
    await settle(fixture);

    expect(list).toHaveBeenLastCalledWith({ skip: 40, take: 20 });
  });

  it('applies the filters (debounced) and goes back to the first page', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue(page([event('e1')], 42));
      const fixture = setUp(list);
      const instance = fixture.componentInstance;
      await vi.advanceTimersByTimeAsync(0);
      instance['onPage']({ pageIndex: 2, pageSize: 20, length: 42 });
      expect(instance['page']()).toBe(2);

      instance['filters'].patchValue({ action: 'admin.user.ban', outcome: 'failure', actor: ' a1 ', targetId: 'u1' });
      await vi.advanceTimersByTimeAsync(299);
      expect(instance['page']()).toBe(2);
      await vi.advanceTimersByTimeAsync(2);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);

      expect(instance['page']()).toBe(0);
      expect(list).toHaveBeenLastCalledWith({
        skip: 0,
        take: 20,
        action: 'admin.user.ban',
        outcome: 'failure',
        actorId: 'a1',
        targetId: 'u1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends an email typed in the actor field as actorEmail (lowercased) and anything else as actorId', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue(page([event('e1')]));
      const fixture = setUp(list);
      const instance = fixture.componentInstance;
      await vi.advanceTimersByTimeAsync(0);

      instance['filters'].patchValue({ actor: ' Admin@Example.com ' });
      await vi.advanceTimersByTimeAsync(301);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20, actorEmail: 'admin@example.com' });

      instance['filters'].patchValue({ actor: 'qeDz0o12evcRb' });
      await vi.advanceTimersByTimeAsync(301);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20, actorId: 'qeDz0o12evcRb' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the actor id on hover so an admin can filter by it', async () => {
    const list = vi.fn().mockResolvedValue(page([event('e1', { actorId: 'user-42' })]));
    const fixture = setUp(list);
    await settle(fixture);

    const actorCell = (fixture.nativeElement.querySelector('[data-testid="audit-row-e1"]') as HTMLTableRowElement).cells[1];
    expect(actorCell?.getAttribute('title')).toBe('user-42');
  });

  it('turns the date range into a whole-day from/to', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue(page([event('e1')]));
      const fixture = setUp(list);
      await vi.advanceTimersByTimeAsync(0);

      fixture.componentInstance['filters'].patchValue({
        range: { start: new Date(2026, 0, 1, 15, 30), end: new Date(2026, 0, 31, 9, 0) },
      });
      await vi.advanceTimersByTimeAsync(301);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);

      expect(list).toHaveBeenLastCalledWith({
        skip: 0,
        take: 20,
        from: new Date(2026, 0, 1, 0, 0, 0, 0),
        to: new Date(2026, 0, 31, 23, 59, 59, 999),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears every filter', async () => {
    vi.useFakeTimers();
    try {
      const list = vi.fn().mockResolvedValue(page([event('e1')]));
      const fixture = setUp(list);
      const instance = fixture.componentInstance;
      await vi.advanceTimersByTimeAsync(0);
      instance['filters'].patchValue({ outcome: 'failure', actor: 'a1' });
      await vi.advanceTimersByTimeAsync(301);

      instance['clearFilters']();
      await vi.advanceTimersByTimeAsync(301);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);

      expect(list).toHaveBeenLastCalledWith({ skip: 0, take: 20 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a load error and renders no rows when the list fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('malformed'));
    const fixture = setUp(list);
    await settle(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="audit-error"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('tr[data-testid^="audit-row-"]').length).toBe(0);
  });

  it('says so when no event matches', async () => {
    const list = vi.fn().mockResolvedValue(page([]));
    const fixture = setUp(list);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('No events found');
  });
});
