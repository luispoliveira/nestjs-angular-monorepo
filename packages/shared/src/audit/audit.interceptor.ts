import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, AuditMetadata } from './audit.decorator';
import { AuditedRequest, buildRequestAuditEvent } from './audit-event.util';
import { AuditService } from './audit.service';

/**
 * Records every handler marked with @Audit, on success and on any error the
 * handler or its pipes throw. Guard rejections never reach an interceptor;
 * the exception filter covers those (design.md → D5). The write is
 * fire-and-forget, so it adds no latency and cannot fail the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    return next.handle().pipe(
      tap({
        next: (body) => {
          void this.audit.record(
            buildRequestAuditEvent(request, meta, 'success', undefined, body),
          );
        },
        error: (error: unknown) => {
          request.auditRecorded = true;
          const status =
            error instanceof HttpException ? error.getStatus() : 500;
          void this.audit.record(
            buildRequestAuditEvent(request, meta, 'failure', String(status)),
          );
        },
      }),
    );
  }
}
