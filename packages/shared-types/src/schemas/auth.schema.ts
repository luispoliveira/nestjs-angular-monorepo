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
