import { InjectionToken } from '@angular/core';
import { authClient } from './auth-client';

/**
 * DI seam around the singleton `authClient` so components/services can be
 * tested against a fake client (e.g. a fake nanostores-shaped `useSession`
 * atom, or a stubbed `signIn.email`) instead of a real network client.
 * Test fakes only ever implement the members they exercise and cast to this
 * type — see session.service.spec.ts and sign-in.spec.ts.
 */
export const AUTH_CLIENT = new InjectionToken<typeof authClient>('AUTH_CLIENT', {
  factory: () => authClient,
});

/** Narrow type alias for consumers that only need the session atom. */
export type SessionAtomClient = Pick<typeof authClient, 'useSession'>;
