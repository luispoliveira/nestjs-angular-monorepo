import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Protects a route: resolves the session before deciding (never renders
 * protected content against the atom's still-loading initial value),
 * redirecting to /sign-in when unauthenticated. Mirrors the old Next.js
 * proxy.ts's publicRoutes logic, now enforced client-side (design.md → D5) —
 * the security boundary is unchanged, since every protected read is still
 * authorized server-side by better-auth or MicroserviceAuthGuard.
 */
export const authGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.ready();

  return session.isAuthenticated() ? true : router.parseUrl('/sign-in');
};

/**
 * Guards /sign-in itself: an already-authenticated user is redirected to
 * /dashboard instead of seeing the sign-in form again.
 */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);

  await session.ready();

  return session.isAuthenticated() ? router.parseUrl('/dashboard') : true;
};
