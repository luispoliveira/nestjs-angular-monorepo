import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { resetPasswordSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../auth/auth-client.token';

/**
 * `/reset-password?token=...` — the link sent by `sendResetPassword` in
 * apps/auth's app.module.ts. The token proves ownership of the account, so
 * this page needs no session and no current password.
 */
@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authClient = inject(AUTH_CLIENT);

  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';

  protected readonly form = this.formBuilder.nonNullable.group(
    { newPassword: [''], confirmPassword: [''] },
    { validators: zodValidator(resetPasswordSchema) },
  );

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly done = signal(false);

  protected async onSubmit(): Promise<void> {
    if (!this.token) {
      this.serverError.set('This reset link is missing its token.');
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { newPassword } = this.form.getRawValue();
    const { error } = await this.authClient.resetPassword({ newPassword, token: this.token });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Failed to reset password.');
      return;
    }

    this.done.set(true);
  }

  protected goToSignIn(): void {
    this.router.navigateByUrl('/sign-in');
  }
}
