import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Stands in for MicroserviceAuthGuard (which needs a running apps/auth over
 * Redis RPC): no `x-test-role` header → 401, otherwise `request.user` gets
 * that role. `x-test-impersonated-by` marks the session as an impersonation,
 * as the real authenticate reply does. Everything else — SharedModule's
 * global pipe, serializer, exception filter and logging interceptor, the
 * real RolesGuard, Postgres and EncryptionService — is the production wiring.
 */
@Injectable()
export class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const role = request.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    const impersonatedBy = request.headers['x-test-impersonated-by'];
    request.user = {
      id: `test-${role}`,
      email: `test-${role}@example.com`,
      role,
      ...(impersonatedBy ? { impersonatedBy } : {}),
    };
    return true;
  }
}
