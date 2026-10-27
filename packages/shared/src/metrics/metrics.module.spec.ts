import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsModule } from './metrics.module';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return 'pong';
  }
}

/**
 * Guards against a split registry: default metrics, the custom HTTP metrics
 * and `@willsoto/nestjs-prometheus` must all be served from one `/metrics`.
 */
describe('MetricsModule', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MetricsModule.register({ appName: 'test' }),
      ],
      controllers: [PingController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(() => app.close());

  it('serves default and custom metrics from one /metrics, labelled with the app', async () => {
    await fetch(`${baseUrl}/ping`);

    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('process_resident_memory_bytes{app="test"}');
    expect(body).toContain('nodejs_eventloop_lag_seconds{app="test"}');
    expect(body).toMatch(/http_requests_total\{[^}]*route="\/ping"[^}]*app="test"[^}]*\} 1/);
  });
});
