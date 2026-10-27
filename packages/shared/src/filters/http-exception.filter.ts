import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod/v4';
import { CLS_CORRELATION_ID } from '../constants';
import { AuditService } from '../audit/audit.service';
import { AuditedRequest, buildRequestAuditEvent } from '../audit/audit-event.util';
import { SanitizeUtil } from '../utils/sanitize.util';
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  constructor(
    private readonly clsService: ClsService,
    // Only apps that audit (apps/api) provide AuditService's rejection path.
    @Optional() private readonly audit?: AuditService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'rpc') {
      this.logger.error(
        'Microservice error',
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception);
      throw exception;
    }

    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const correlationId = this.clsService.get<string>(CLS_CORRELATION_ID);

    if (exception instanceof ZodValidationException) {
      return this.handleZodValidationException(
        exception,
        response,
        request,
        correlationId,
      );
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${SanitizeUtil.sanitizeUrl(request.url)}`,
      exception instanceof Error ? exception.stack : '',
    );

    if (status >= 500) {
      Sentry.captureException(exception);
    }

    this.auditRejection(request, status);

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: SanitizeUtil.sanitizeUrl(request.url),
      message,
      correlationId,
    });
  }

  handleZodValidationException(
    exception: ZodValidationException,
    response: Response,
    request: Request,
    correlationId: string,
  ) {
    const zodError = exception.getZodError() as ZodError;

    this.logger.warn(
      `${request.method} ${SanitizeUtil.sanitizeUrl(request.url)} - Validation failed`,
      JSON.stringify(zodError.issues),
    );

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      timestamp: new Date().toISOString(),
      path: SanitizeUtil.sanitizeUrl(request.url),
      message: 'Validation failed',
      errors: zodError.issues,
      correlationId,
    });
  }

  /**
   * 401/403 come from guards, which run before interceptors, so the
   * AuditInterceptor never saw them. `request.audit` was set by
   * AuditContextGuard; `auditRecorded` stops a handler-thrown 401/403 that the
   * interceptor already recorded from being recorded twice.
   */
  private auditRejection(request: Request, status: number): void {
    if (!this.audit || (status !== 401 && status !== 403)) return;
    const audited = request as unknown as AuditedRequest;
    if (!audited.audit || audited.auditRecorded) return;
    void this.audit.record(
      buildRequestAuditEvent(audited, audited.audit, 'failure', String(status)),
    );
  }
}
