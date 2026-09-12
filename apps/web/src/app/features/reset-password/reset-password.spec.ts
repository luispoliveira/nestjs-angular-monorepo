import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { ResetPassword } from './reset-password';

function setUp(resetPassword: (args: unknown) => Promise<unknown>, token: string | null = 'reset-token-123') {
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { resetPassword } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(ResetPassword);
  fixture.detectChanges();
  return fixture;
}

describe('ResetPassword', () => {
  it('resets the password with the token from the URL and shows a success state', async () => {
    const resetPassword = vi.fn().mockResolvedValue({ error: null });
    const fixture: ComponentFixture<ResetPassword> = setUp(resetPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough', confirmPassword: 'longenough' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(resetPassword).toHaveBeenCalledWith({ newPassword: 'longenough', token: 'reset-token-123' });
    expect(fixture.componentInstance['done']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="go-to-sign-in"]')).toBeTruthy();
  });

  it('shows a server error when the token is invalid or expired', async () => {
    const resetPassword = vi.fn().mockResolvedValue({ error: { message: 'Invalid token' } });
    const fixture = setUp(resetPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough', confirmPassword: 'longenough' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(fixture.componentInstance['done']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Invalid token',
    );
  });

  it('does not submit when the confirmation does not match', async () => {
    const resetPassword = vi.fn();
    const fixture = setUp(resetPassword);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough', confirmPassword: 'different' });
    await fixture.componentInstance['onSubmit']();

    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('shows an error and never calls the server when the URL has no token', async () => {
    const resetPassword = vi.fn();
    const fixture = setUp(resetPassword, null);

    fixture.componentInstance['form'].setValue({ newPassword: 'longenough', confirmPassword: 'longenough' });
    await fixture.componentInstance['onSubmit']();
    fixture.detectChanges();

    expect(resetPassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'This reset link is missing its token.',
    );
  });
});
