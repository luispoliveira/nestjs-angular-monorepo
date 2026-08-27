import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { BanUserDialog } from '../ban-user-dialog/ban-user-dialog';
import { SetPasswordDialog } from './set-password-dialog/set-password-dialog';
import { UserDetail } from './user-detail';

function fakeSessionAtom(currentUserId: string, currentUserRole: 'admin' | 'user' = 'admin') {
  const value = {
    data: { user: { id: currentUserId, email: 'me@example.com', role: currentUserRole }, session: { id: 's1' } },
    error: null,
    isPending: false,
    isRefetching: false,
  };
  return {
    get: () => value,
    subscribe(listener: (v: typeof value) => void) {
      listener(value);
      return () => undefined;
    },
  };
}

const realUser = {
  id: '1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

async function waitForSettled(fixture: ComponentFixture<UserDetail>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.nativeElement.querySelector('[data-testid="user-detail-loading"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('User query did not settle in time');
}

function setUp(
  admin: Record<string, (...args: never[]) => Promise<unknown>>,
  opts: { id?: string; currentUserId?: string } = {},
) {
  const id = opts.id ?? '1';
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      { provide: AUTH_CLIENT, useValue: { admin, useSession: fakeSessionAtom(opts.currentUserId ?? 'me') } },
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id }) }, paramMap: of(convertToParamMap({ id })) },
      },
    ],
  });
  const fixture = TestBed.createComponent(UserDetail);
  fixture.detectChanges();
  return fixture;
}

describe('UserDetail', () => {
  it('renders identity and active status', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    expect(getUser).toHaveBeenCalledWith({ query: { id: '1' } });
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-name"]')?.textContent).toContain(
      'Jane Doe',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-state"]')?.textContent).toContain(
      'Active',
    );
  });

  it('renders ban reason and expiry when banned', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { ...realUser, banned: true, banReason: 'Spamming', banExpires: new Date('2026-02-01T00:00:00.000Z') },
      error: null,
    });
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-reason"]')?.textContent).toContain(
      'Spamming',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-expires"]')).toBeTruthy();
  });

  it('renders ban state without reason or expiry when absent', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { ...realUser, banned: true }, error: null });
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-reason"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-expires"]')).toBeNull();
  });

  it('shows an error state when the user is not found', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: null, error: { message: 'User not found' } });
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-error"]')?.textContent).toContain(
      'User not found',
    );
  });

  it('opens the set password dialog for the current user', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const openSpy = vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({} as ReturnType<MatDialog['open']>);
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    fixture.nativeElement.querySelector('[data-testid="set-password-action"]').click();

    expect(openSpy).toHaveBeenCalledWith(SetPasswordDialog, {
      data: { user: expect.objectContaining({ id: '1' }) },
    });
  });

  it('does not offer impersonation for the admin viewing their own detail page', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const fixture = setUp({ getUser }, { currentUserId: '1' });
    await waitForSettled(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="impersonate-action"]')).toBeNull();
  });

  it('does not offer impersonation for another admin', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { ...realUser, role: 'admin' }, error: null });
    const fixture = setUp({ getUser }, { currentUserId: 'me' });
    await waitForSettled(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="impersonate-action"]')).toBeNull();
  });

  it('impersonates a regular user after confirmation and navigates to /dashboard', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const impersonateUser = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({ afterClosed: () => of(true) } as ReturnType<
      MatDialog['open']
    >);
    const fixture = setUp({ getUser, impersonateUser }, { currentUserId: 'me' });
    await waitForSettled(fixture);
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.nativeElement.querySelector('[data-testid="impersonate-action"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(impersonateUser).toHaveBeenCalledWith({ userId: '1' });
    expect(navigateSpy).toHaveBeenCalledWith('/dashboard');
  });

  it('opens the ban dialog for the current user', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const openSpy = vi.spyOn(MatDialog.prototype, 'open').mockReturnValue({} as ReturnType<MatDialog['open']>);
    const fixture = setUp({ getUser });
    await waitForSettled(fixture);

    fixture.nativeElement.querySelector('[data-testid="detail-ban-action"]').click();

    expect(openSpy).toHaveBeenCalledWith(BanUserDialog, { data: { user: expect.objectContaining({ id: '1' }) } });
  });

  it('unbans and re-fetches, clearing the displayed ban reason and expiry', async () => {
    const bannedUser = { ...realUser, banned: true, banReason: 'Spamming', banExpires: new Date('2026-02-01T00:00:00.000Z') };
    const getUser = vi.fn().mockResolvedValueOnce({ data: bannedUser, error: null }).mockResolvedValue({
      data: realUser,
      error: null,
    });
    const unbanUser = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ getUser, unbanUser });
    await waitForSettled(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-reason"]')).toBeTruthy();

    await fixture.componentInstance['unban']();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(unbanUser).toHaveBeenCalledWith({ userId: '1' });
    expect(fixture.nativeElement.querySelector('[data-testid="user-detail-ban-reason"]')).toBeNull();
  });

  const realSession = {
    id: 'sess_1',
    token: 'token_1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    ipAddress: '127.0.0.1',
    userAgent: null,
  };

  it('lists active sessions', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const listUserSessions = vi.fn().mockResolvedValue({ data: { sessions: [realSession] }, error: null });
    const fixture = setUp({ getUser, listUserSessions });
    await waitForSettled(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(listUserSessions).toHaveBeenCalledWith({ userId: '1' });
    expect(fixture.nativeElement.querySelector('[data-testid="session-row-sess_1"]')).toBeTruthy();
  });

  it('revokes a single session and removes it from the list', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const listUserSessions = vi
      .fn()
      .mockResolvedValueOnce({ data: { sessions: [realSession] }, error: null })
      .mockResolvedValue({ data: { sessions: [] }, error: null });
    const revokeUserSession = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ getUser, listUserSessions, revokeUserSession });
    await waitForSettled(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    await fixture.componentInstance['revokeSession']('token_1');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(revokeUserSession).toHaveBeenCalledWith({ sessionToken: 'token_1' });
    expect(fixture.nativeElement.querySelector('[data-testid="no-sessions"]')).toBeTruthy();
  });

  it('revokes all sessions and empties the list', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: realUser, error: null });
    const listUserSessions = vi
      .fn()
      .mockResolvedValueOnce({ data: { sessions: [realSession] }, error: null })
      .mockResolvedValue({ data: { sessions: [] }, error: null });
    const revokeUserSessions = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp({ getUser, listUserSessions, revokeUserSessions });
    await waitForSettled(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    await fixture.componentInstance['revokeAllSessions']();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(revokeUserSessions).toHaveBeenCalledWith({ userId: '1' });
    expect(fixture.nativeElement.querySelector('[data-testid="no-sessions"]')).toBeTruthy();
  });
});
