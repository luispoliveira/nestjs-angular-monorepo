import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AUTH_CLIENT } from '../../auth/auth-client.token';

/**
 * `/verify-email?token=...` — the link sent by `sendVerificationEmail` in
 * apps/auth's app.module.ts. Verifies on load, no user input needed.
 */
@Component({
  selector: 'app-verify-email',
  imports: [MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './verify-email.html',
  styleUrl: './verify-email.scss',
})
export class VerifyEmail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly verifying = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.verifying.set(false);
      this.errorMessage.set('This verification link is missing its token.');
      return;
    }

    const { error } = await this.authClient.verifyEmail({ query: { token } });

    this.verifying.set(false);
    if (error) {
      this.errorMessage.set(error.message ?? 'Failed to verify email.');
    }
  }

  protected goToSignIn(): void {
    this.router.navigateByUrl('/sign-in');
  }
}
