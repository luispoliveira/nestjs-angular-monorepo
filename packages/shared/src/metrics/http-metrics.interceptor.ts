import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Counter, Histogram } from '@prometheus-io/client';
import { Observable, tap } from 'rxjs';

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<{
      method: string;
      route?: { path?: string };
    }>();
    const method = req.method;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.record(context, method, start),
        error: () => this.record(context, method, start),
      }),
    );
  }

  private record(
    context: ExecutionContext,
    method: string,
    start: number,
  ): void {
    const req = context.switchToHttp().getRequest<{
      route?: { path?: string };
    }>();
    const res = context.switchToHttp().getResponse<{ statusCode: number }>();
    const route = req.route?.path ?? '[unknown]';
    const status = String(res.statusCode);
    const duration = (Date.now() - start) / 1000;

    httpRequestDuration.observe({ method, route, status }, duration);
    httpRequestsTotal.inc({ method, route, status });
  }
}
