import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.configService.get<string>('METRICS_TOKEN');
    if (!token) {
      // Fail closed in production: a forgotten METRICS_TOKEN must not silently
      // expose /metrics. Outside production, allow unauthenticated scraping.
      return this.configService.get<string>('NODE_ENV') !== 'production';
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const authHeader = request.headers['authorization'] ?? '';
    return authHeader === `Bearer ${token}`;
  }
}
