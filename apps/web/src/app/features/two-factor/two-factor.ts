import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { twoFactorCodeSchema, zodValidator } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../auth/auth-client.token';
import { SessionService } from '../../auth/session.service';

/**
 * The second sign-in step for a 2FA-enabled user (`/two-factor`, reached
 * from sign-in.ts when `signIn.email` returns `twoFactorRedirect: true`).
 * better-auth holds the pending challenge in a short-lived httpOnly cookie
 * server-side — this page has no other state to carry.
 */
@Component({
  selector: 'app-two-factor',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  templateUrl: './two-factor.html',
  styleUrl: './two-factor.scss',
})
export class TwoFactor {
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly session = inject(SessionService);

  protected readonly form = this.formBuilder.nonNullable.group(
    { code: [''], trustDevice: [false] },
    { validators: zodValidator(twoFactorCodeSchema) },
  );

  protected readonly useBackupCode = signal(false);
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected toggleBackupCode(): void {
    this.useBackupCode.set(!this.useBackupCode());
    this.form.reset({ code: '', trustDevice: this.form.getRawValue().trustDevice });
    this.serverError.set(null);
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { code, trustDevice } = this.form.getRawValue();
    const { error } = this.useBackupCode()
      ? await this.authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await this.authClient.twoFactor.verifyTotp({ code, trustDevice });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Invalid code.');
      return;
    }

    await this.session.signedIn();
    await this.router.navigateByUrl('/dashboard');
  }
}
