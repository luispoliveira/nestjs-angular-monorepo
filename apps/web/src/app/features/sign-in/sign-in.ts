import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { signInSchema, zodValidator } from '@repo/shared-types';
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

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.serverError.set(null);

    const { email, password } = this.form.getRawValue();
    const { error } = await this.authClient.signIn.email({ email, password });

    this.submitting.set(false);

    if (error) {
      this.serverError.set(error.message ?? 'Failed to sign in.');
      return;
    }

    await this.router.navigateByUrl('/dashboard');
  }
}
