import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { Request } from 'express';
import { map, Observable } from 'rxjs';
import { SERVICES } from '../constants';
import { IS_PUBLIC_KEY } from '../decorators';
import { ContextUtil } from '../utils';
import { authenticateToken } from './authenticate-token';

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

    return authenticateToken(this.authClient, token, this.logger).pipe(
      map((user) => {
        (request as unknown as Record<string, unknown>).user = user;
        return true;
      }),
    );
  }
}
