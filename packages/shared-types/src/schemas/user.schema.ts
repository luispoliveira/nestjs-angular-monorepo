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
