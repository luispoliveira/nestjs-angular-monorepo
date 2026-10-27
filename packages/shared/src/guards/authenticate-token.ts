import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, Observable, throwError, timeout } from 'rxjs';
import { AUTH_RPC_TIMEOUT_MS, MESSAGE_PATTERNS } from '../constants';

/**
 * Asks the auth service to validate a session token. Shared by
 * `MicroserviceAuthGuard` and Express middleware that sits outside Nest's
 * guard chain, so both answer the same way: 401 when auth rejects the token,
 * 503 when it is silent or unreachable.
 */
export function authenticateToken(
  authClient: ClientProxy,
  token: string,
  logger: Logger,
): Observable<Record<string, unknown>> {
  return authClient
    .send<Record<string, unknown>>(MESSAGE_PATTERNS.AUTH_AUTHENTICATE, {
      token,
    })
    .pipe(
      timeout(AUTH_RPC_TIMEOUT_MS),
      catchError((err: unknown) => {
        // apps/auth rejects every bad token with RpcException({ status: 401 });
        // anything else (timeout, Redis down) means auth is unavailable, not
        // that the session is invalid — 503 keeps clients from signing out.
        if ((err as { status?: number } | null)?.status === 401) {
          return throwError(
            () => new UnauthorizedException('Invalid or expired session'),
          );
        }
        logger.error('Authentication service unavailable', err);
        return throwError(
          () =>
            new ServiceUnavailableException('Authentication service unavailable'),
        );
      }),
    );
}
