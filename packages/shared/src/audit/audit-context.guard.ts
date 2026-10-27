import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUDIT_KEY, AuditMetadata } from './audit.decorator';
import { AuditedRequest } from './audit-event.util';

/**
 * Registered as the FIRST global guard (design.md → D5). Guards run before
 * interceptors, and the exception filter has no access to route metadata, so
 * a request rejected by authentication or role guards would otherwise leave
 * no audit trail. This guard only copies the handler's @Audit metadata onto
 * the request and always allows — it can never change the request's outcome.
 */
@Injectable()
export class AuditContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (meta) {
      context.switchToHttp().getRequest<AuditedRequest>().audit = meta;
    }
    return true;
  }
}
