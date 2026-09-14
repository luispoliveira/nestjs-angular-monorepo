import z from 'zod';

/**
 * Shared with the sign-in form's zodValidator() (design.md → D6). Not
 * consumed by a NestJS DTO — better-auth validates credentials itself — but
 * kept here so the frontend's only source of validation rules for any
 * shared payload is this package, matching every other form schema.
 */
export const signInSchema = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type SignInInput = z.infer<typeof signInSchema>;

/** "Forgot password?" form on the sign-in page (`authClient.forgetPassword`). */
export const forgotPasswordSchema = z.object({
  email: z.email('Invalid email address'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * The `/reset-password?token=...` page (`authClient.resetPassword`). Same
 * length policy and confirm-match pattern as `changePasswordSchema`, minus
 * `currentPassword` — the token itself proves ownership of the account.
 */
export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * A TOTP code or a backup code, entered on the `/two-factor` sign-in step
 * (`authClient.twoFactor.verifyTotp` / `verifyBackupCode`). `min(6)` accepts
 * both a 6-digit TOTP code and an 11-character `xxxxx-xxxxx` backup code.
 */
export const twoFactorCodeSchema = z.object({
  code: z.string().min(6, 'Enter the code from your authenticator app'),
});

export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;

/**
 * Re-authentication before a sensitive self-service action (enabling or
 * disabling 2FA, regenerating backup codes, deleting the account) — every
 * such better-auth endpoint requires the current password in its body.
 */
export const confirmPasswordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export type ConfirmPasswordInput = z.infer<typeof confirmPasswordSchema>;
