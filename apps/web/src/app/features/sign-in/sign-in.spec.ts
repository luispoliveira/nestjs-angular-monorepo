import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SignIn } from './sign-in';

@Component({ selector: 'app-dashboard-stub', template: 'dashboard page' })
class DashboardStub {}

function setUp(signInEmail: (args: { email: string; password: string }) => Promise<{
  error: { message?: string } | null;
}>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { signIn: { email: signInEmail } } },
      provideRouter([
        { path: 'sign-in', component: SignIn },
        { path: 'dashboard', component: DashboardStub },
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
});
