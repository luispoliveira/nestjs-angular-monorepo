import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SignIn } from './sign-in';

@Component({ selector: 'app-dashboard-stub', template: 'dashboard page' })
class DashboardStub {}

@Component({ selector: 'app-two-factor-stub', template: 'two-factor page' })
class TwoFactorStub {}

function setUp(
  signInEmail: (args: { email: string; password: string }) => Promise<{
    data?: unknown;
    error: { message?: string } | null;
  }>,
  overrides: {
    sendVerificationEmail?: (args: unknown) => Promise<unknown>;
    requestPasswordReset?: (args: unknown) => Promise<unknown>;
  } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AUTH_CLIENT,
        useValue: {
          signIn: { email: signInEmail },
          sendVerificationEmail: overrides.sendVerificationEmail ?? vi.fn(),
          requestPasswordReset: overrides.requestPasswordReset ?? vi.fn(),
        },
      },
      provideRouter([
        { path: 'sign-in', component: SignIn },
        { path: 'dashboard', component: DashboardStub },
        { path: 'two-factor', component: TwoFactorStub },
      ]),
    ],
  });
  return RouterTestingHarness.create('/sign-in');
}

describe('SignIn', () => {
  it('shows a server error and does not navigate on invalid credentials', async () => {
    const signInEmail = vi.fn().mockResolvedValue({ error: { message: 'Invalid email or password' } });
    const harness = await setUp(signInEmail);
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'admin@admin.com', password: 'WrongPassword123!' });
    await instance['onSubmit']();
    harness.detectChanges();

    expect(signInEmail).toHaveBeenCalledWith({ email: 'admin@admin.com', password: 'WrongPassword123!' });
    expect(TestBed.inject(Router).url).toBe('/sign-in');
    expect(harness.routeNativeElement?.textContent).toContain('Invalid email or password');
  });

  it('navigates to /dashboard on a successful sign-in', async () => {
    const signInEmail = vi.fn().mockResolvedValue({ error: null });
    const harness = await setUp(signInEmail);
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'admin@admin.com', password: 'Admin123!' });
    await instance['onSubmit']();

    expect(TestBed.inject(Router).url).toBe('/dashboard');
  });

  it('blocks submission and never calls signIn.email when the form is invalid', async () => {
    const signInEmail = vi.fn();
    const harness = await setUp(signInEmail);
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'not-an-email', password: 'short' });
    await instance['onSubmit']();
    harness.detectChanges();

    expect(signInEmail).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/sign-in');
    expect(instance['form'].controls.email.errors?.['zod']).toBeTruthy();
    expect(instance['form'].controls.password.errors?.['zod']).toBeTruthy();
  });

  it('navigates to /two-factor when the server reports a pending 2FA challenge', async () => {
    const signInEmail = vi.fn().mockResolvedValue({ data: { twoFactorRedirect: true, twoFactorMethods: ['totp'] }, error: null });
    const harness = await setUp(signInEmail);
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'admin@admin.com', password: 'Admin123!' });
    await instance['onSubmit']();

    expect(TestBed.inject(Router).url).toBe('/two-factor');
  });

  it('offers to resend the verification email when sign-in fails because the email is not verified', async () => {
    const signInEmail = vi.fn().mockResolvedValue({ error: { message: 'Email not verified' } });
    const sendVerificationEmail = vi.fn().mockResolvedValue({ error: null });
    const harness = await setUp(signInEmail, { sendVerificationEmail });
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'new@example.com', password: 'Admin123!' });
    await instance['onSubmit']();
    harness.detectChanges();

    expect(instance['showResendVerification']()).toBe(true);

    await instance['resendVerificationEmail']();

    expect(sendVerificationEmail).toHaveBeenCalledWith({ email: 'new@example.com' });
    expect(instance['resendSent']()).toBe(true);
  });

  it('does not offer to resend the verification email for other sign-in failures', async () => {
    const signInEmail = vi.fn().mockResolvedValue({ error: { message: 'Invalid email or password' } });
    const harness = await setUp(signInEmail);
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['form'].setValue({ email: 'admin@admin.com', password: 'WrongPassword123!' });
    await instance['onSubmit']();

    expect(instance['showResendVerification']()).toBe(false);
  });

  it('sends a password reset request from the forgot-password sub-form', async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue({ error: null });
    const harness = await setUp(vi.fn(), { requestPasswordReset });
    const instance = harness.routeDebugElement?.componentInstance as SignIn;

    instance['openForgotPassword']();
    instance['forgotPasswordForm'].setValue({ email: 'admin@admin.com' });
    await instance['onSubmitForgotPassword']();

    expect(requestPasswordReset).toHaveBeenCalledWith({ email: 'admin@admin.com' });
    expect(instance['forgotPasswordMessage']()).toContain('check your inbox');
  });
});
