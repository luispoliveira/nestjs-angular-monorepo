import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CLS_CORRELATION_ID } from '../constants';
import { isSilentPath } from '../constants/observability';
import { MongoService } from '../mongo/mongo.service';
import { Log } from '../mongo/schema/log.schema';
import { SanitizeUtil } from '../utils';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  constructor(
    private readonly mongoService: MongoService,
    private readonly clsService: ClsService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const now = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    if (isSilentPath(request.url ?? '')) return next.handle();
    const { method, url, body, headers, ip } = request as {
      method: string;
      url: string;
      body: unknown;
      headers: Record<string, unknown>;
      ip: string;
    };
    const user = (request as unknown as Record<string, unknown>).user;
    const correlationId = this.clsService.get<string>(CLS_CORRELATION_ID);

    const logData = {
      method,
      url: SanitizeUtil.sanitizeUrl(url),
      ip,
      correlationId,
      user: user ? SanitizeUtil.sanitize(user) : undefined,
      headers: SanitizeUtil.sanitize(headers),
      requestBody:
        body && typeof body === 'object'
          ? (SanitizeUtil.sanitize(body) as Record<string, unknown>)
          : undefined,
    };

    const log = await this.mongoService
      .createLog(logData as Partial<Log>)
      .catch((error) => {
        console.error('Failed to save log:', error);
      });

    return next.handle().pipe(
      tap(
        (responseBody) => {
          const response = context.switchToHttp().getResponse<Response>();
          const { statusCode } = response;
          const duration = Date.now() - now;

          if (log) {
            this.mongoService
              .updateLog(log._id as unknown as string, {
                statusCode,
                duration,
                responseBody:
                  responseBody && typeof responseBody === 'object'
                    ? (SanitizeUtil.sanitize(responseBody) as unknown as Record<
                        string,
                        unknown
                      >)
                    : undefined,
              })
              .catch((logError) => {
                this.logger.error('Failed to update log:', logError);
              });
          }
        },
        (error: unknown) => {
          const response = context.switchToHttp().getResponse<Response>();
          const { statusCode } = response;
          const duration = Date.now() - now;
          const httpError = error as { status?: number; response?: unknown };

          const logData = {
            statusCode: httpError.status ?? statusCode ?? 500,
            duration,
            correlationId,
            user: user ? SanitizeUtil.sanitize(user) : undefined,
            headers: SanitizeUtil.sanitize(headers),
            responseBody:
              httpError.response && typeof httpError.response === 'object'
                ? (SanitizeUtil.sanitize(
                    httpError.response,
                  ) as unknown as Record<string, unknown>)
                : undefined,
          };

          if (log) {
            this.mongoService
              .updateLog(log._id as unknown as string, logData as Partial<Log>)
              .catch((logError) => {
                this.logger.error('Failed to update error log:', logError);
              });
          }
        },
      ),
    );
  }
}
