import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { Request } from 'express';
import { catchError, map, Observable, throwError, timeout } from 'rxjs';
import { AUTH_RPC_TIMEOUT_MS, MESSAGE_PATTERNS, SERVICES } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators';
import { ContextUtil } from '../utils';

@Injectable()
export class MicroserviceAuthGuard implements CanActivate {
  private readonly logger = new Logger(MicroserviceAuthGuard.name);

  constructor(
    @Inject(SERVICES.AUTH) private readonly authClient: ClientProxy,
    private readonly reflector: Reflector,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = ContextUtil.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    return this.authClient
      .send<Record<string, unknown>>(MESSAGE_PATTERNS.AUTH_AUTHENTICATE, {
        token,
      })
      .pipe(
        timeout(AUTH_RPC_TIMEOUT_MS),
        map((user) => {
          (request as unknown as Record<string, unknown>).user = user;
          return true;
        }),
        catchError((err: unknown) => {
          // apps/auth rejects every bad token with RpcException({ status: 401 });
          // anything else (timeout, Redis down) means auth is unavailable, not
          // that the session is invalid — 503 keeps clients from signing out.
          if ((err as { status?: number } | null)?.status === 401) {
            return throwError(
              () => new UnauthorizedException('Invalid or expired session'),
            );
          }
          this.logger.error('Authentication service unavailable', err);
          return throwError(
            () =>
              new ServiceUnavailableException('Authentication service unavailable'),
          );
        }),
      );
  }
}
