import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { RoleEnum } from '@repo/shared-types';
import { SessionService } from './session.service';

/**
 * Protects an admin-only route. Unauthenticated → /sign-in (same as
 * authGuard); authenticated but non-admin → /dashboard, never the admin
 * route's content (design.md → D5, zod-shared-contract spec's "Admin-only
 * routes enforce the admin role").
 */
export const adminGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.ready();

  if (!session.isAuthenticated()) return router.parseUrl('/sign-in');
  return session.user()?.role === RoleEnum.ADMIN ? true : router.parseUrl('/dashboard');
};
