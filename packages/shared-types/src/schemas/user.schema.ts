import z from 'zod';
import { RoleEnum } from '../enums/index.js';

export const createUserSchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  email: z.email('Invalid email address'),
  role: z.enum(RoleEnum),
});

export const editRoleSchema = z.object({
  role: z.enum(RoleEnum),
});

export type EditRoleInput = z.infer<typeof editRoleSchema>;

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * A user as returned by the better-auth admin plugin (`UserWithRole`).
 * better-auth owns this model (see packages/database/prisma/auth.prisma) —
 * its `id` is a string, unlike `baseEntitySchema`'s numeric `id`. `createdAt`
 * is `z.date()`: although the raw HTTP wire payload is an ISO string, the
 * only call site in this codebase is `authClient.admin.listUsers()`
 * (better-auth's client), which parses known `Date`-typed fields into real
 * `Date` instances before this schema ever sees the value — confirmed via a
 * live browser check against a running apps/auth instance, where parsing
 * against the raw wire string shape threw "expected string, received Date".
 */
export const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    role: z.enum(RoleEnum).nullish(),
    banned: z.boolean().nullish(),
    banReason: z.string().nullish(),
    banExpires: z.date().nullish(),
    createdAt: z.date(),
  })
  .meta({ id: 'User' });

export type User = z.infer<typeof userSchema>;

/**
 * Response shape of the better-auth admin plugin's `listUsers` — fixed by
 * that library, not by us, so it does not use `paginatedSchema` (which
 * shapes future apps/api endpoints we control).
 */
export const usersListResponseSchema = z
  .object({
    users: z.array(userSchema),
    total: z.number().int().nonnegative(),
  })
  .meta({ id: 'UsersListResponse' });

export type UsersListResponse = z.infer<typeof usersListResponseSchema>;

export const banUserSchema = z.object({
  reason: z.string().optional(),
  /** `nullish` (not just `optional`) so a form's "Never expires" option can bind `null` directly. */
  expiresInSeconds: z.number().int().positive().nullish(),
});

export type BanUserInput = z.infer<typeof banUserSchema>;

/** Same policy as `signInSchema`'s password field — not a new rule. */
export const setUserPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type SetUserPasswordInput = z.infer<typeof setUserPasswordSchema>;

/** The logged-in user editing their own name/email (`authClient.updateUser` / `changeEmail`). */
export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Full name is required'),
  email: z.email('Invalid email address'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Same length policy as `setUserPasswordSchema`'s `newPassword` — not a new rule. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * A session as returned by the better-auth admin plugin's `listUserSessions`.
 * `createdAt`/`expiresAt` are `z.date()` for the same reason `userSchema`'s
 * `createdAt` is — better-auth's client parses them before this schema sees
 * the value.
 */
export const userSessionSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    createdAt: z.date(),
    expiresAt: z.date(),
    ipAddress: z.string().nullish(),
    userAgent: z.string().nullish(),
  })
  .meta({ id: 'UserSession' });

export type UserSession = z.infer<typeof userSessionSchema>;

export const userSessionsListResponseSchema = z
  .object({
    sessions: z.array(userSessionSchema),
  })
  .meta({ id: 'UserSessionsListResponse' });

export type UserSessionsListResponse = z.infer<typeof userSessionsListResponseSchema>;
