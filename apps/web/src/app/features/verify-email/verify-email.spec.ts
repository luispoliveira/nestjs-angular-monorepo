import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { VerifyEmail } from './verify-email';

function setUp(verifyEmail: (args: unknown) => Promise<unknown>, token: string | null = 'verify-token-123') {
  TestBed.configureTestingModule({
    providers: [
      { provide: AUTH_CLIENT, useValue: { verifyEmail } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(VerifyEmail);
  fixture.detectChanges();
  return fixture;
}

async function afterInit(fixture: ComponentFixture<VerifyEmail>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('VerifyEmail', () => {
  it('verifies the token from the URL and shows a success message', async () => {
    const verifyEmail = vi.fn().mockResolvedValue({ error: null });
    const fixture = setUp(verifyEmail);
    await afterInit(fixture);

    expect(verifyEmail).toHaveBeenCalledWith({ query: { token: 'verify-token-123' } });
    expect(fixture.componentInstance['verifying']()).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="success-message"]')).toBeTruthy();
  });

  it('shows a server error when the token is invalid or expired', async () => {
    const verifyEmail = vi.fn().mockResolvedValue({ error: { message: 'Invalid token' } });
    const fixture = setUp(verifyEmail);
    await afterInit(fixture);

    expect(fixture.nativeElement.querySelector('[data-testid="error-message"]')?.textContent?.trim()).toBe(
      'Invalid token',
    );
  });

  it('shows an error and never calls the server when the URL has no token', async () => {
    const verifyEmail = vi.fn();
    const fixture = setUp(verifyEmail, null);
    await afterInit(fixture);

    expect(verifyEmail).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="error-message"]')?.textContent?.trim()).toBe(
      'This verification link is missing its token.',
    );
  });
});
