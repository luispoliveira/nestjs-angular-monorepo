import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { forgotPasswordSchema, signInSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../auth/auth-client.token';

@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
})
export class SignIn {
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authClient = inject(AUTH_CLIENT);

  protected readonly form = this.formBuilder.nonNullable.group(
    { email: [''], password: [''] },
    { validators: zodValidator(signInSchema) },
  );

  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly showResendVerification = signal(false);
  protected readonly resendSent = signal(false);

  /** Toggles the "Forgot password?" sub-form in place of the sign-in form. */
  protected readonly forgotPasswordMode = signal(false);
  protected readonly forgotPasswordForm = this.formBuilder.nonNullable.group(
    { email: [''] },
    { validators: zodValidator(forgotPasswordSchema) },
  );
  protected readonly forgotPasswordSubmitting = signal(false);
  protected readonly forgotPasswordMessage = signal<string | null>(null);

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);
    this.showResendVerification.set(false);
    this.resendSent.set(false);

    const { email, password } = this.form.getRawValue();
    const { data, error } = await this.authClient.signIn.email({ email, password });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Failed to sign in.');
      // better-auth's own error message for this case — matched on text
      // since `emailAndPassword.requireEmailVerification` throws a plain
      // FORBIDDEN with no machine-readable code of its own (confirmed
      // against better-auth's `api/routes/sign-in.mjs`).
      this.showResendVerification.set((error.message ?? '').toLowerCase().includes('not verified'));
      return;
    }

    // A 2FA-enabled user's password is correct, but no session exists yet —
    // better-auth deletes the just-created session and holds a short-lived
    // verification cookie instead (see the two-factor plugin's sign-in
    // hook). The second factor is entered on its own page.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      await this.router.navigateByUrl('/two-factor');
      return;
    }

    await this.router.navigateByUrl('/dashboard');
  }

  protected async resendVerificationEmail(): Promise<void> {
    const { email } = this.form.getRawValue();
    if (!email) return;
    await this.authClient.sendVerificationEmail({ email });
    this.resendSent.set(true);
  }

  protected openForgotPassword(): void {
    this.forgotPasswordForm.reset({ email: this.form.getRawValue().email });
    this.forgotPasswordMessage.set(null);
    this.forgotPasswordMode.set(true);
  }

  protected closeForgotPassword(): void {
    this.forgotPasswordMode.set(false);
  }

  protected async onSubmitForgotPassword(): Promise<void> {
    if (this.forgotPasswordForm.invalid) {
      this.forgotPasswordForm.markAllAsTouched();
      return;
    }

    this.forgotPasswordSubmitting.set(true);
    const { email } = this.forgotPasswordForm.getRawValue();
    // redirectTo is omitted: apps/auth's sendResetPassword hook builds its
    // own UI_URL-based link and ignores it (see app.module.ts).
    const { error } = await this.authClient.requestPasswordReset({ email });
    this.forgotPasswordSubmitting.set(false);

    this.forgotPasswordMessage.set(
      error ? (error.message ?? 'Failed to send reset email.') : 'If this email exists, check your inbox for a reset link.',
    );
  }
}
