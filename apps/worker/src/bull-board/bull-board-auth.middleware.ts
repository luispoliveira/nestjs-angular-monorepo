import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { authenticateToken, ContextUtil } from '@repo/shared';
import { RoleEnum } from '@repo/shared-types';
import { NextFunction, Request, Response } from 'express';
import { firstValueFrom } from 'rxjs';

/**
 * Gate in front of the dashboard, which is a mounted Express app, so Nest's
 * guards never see it. Registered as Bull Board's own `middleware`, Nest runs
 * it through its exception filters: what it throws becomes the same error
 * body as any other route (minus `correlationId`: the dashboard is outside
 * the `api` prefix that ClsModule's middleware is mounted under).
 *
 *   no token / auth rejects it -> 401, signed in but not admin -> 403,
 *   auth silent or unreachable -> 503 (same rule as MicroserviceAuthGuard).
 */
export function bullBoardAuth(authClient: ClientProxy) {
  const logger = new Logger('BullBoardAuth');

  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = ContextUtil.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    const user = await firstValueFrom(
      authenticateToken(authClient, token, logger),
    );
    if (user.role !== RoleEnum.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    next();
  };
}
