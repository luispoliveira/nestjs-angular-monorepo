// Must stay the first import: Sentry instruments modules as they load.
import './instrument';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { BootstrapUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {});
  app.useLogger(app.get(Logger));
  const configService = app.get(ConfigService);

  const environment = configService.get<EnvironmentEnum>(
    'NODE_ENV',
    EnvironmentEnum.DEVELOPMENT,
  );

  BootstrapUtil.setup(app, {
    globalPrefix: 'api',
    useHelmet: true,
    enableVersioning: true,
    swagger:
      environment !== EnvironmentEnum.PRODUCTION
        ? {
            title: 'API',
            description: 'API for authentication and authorization',
            version: '1.0.0',
            tag: 'api',
            path: 'docs',
          }
        : undefined,
    cors: {
      origin: configService.getOrThrow<string>('CORS_ORIGIN'),
      credentials: true,
    },
    enableCookieParser: true,
    trustProxy: true,
  });

  const port = configService.getOrThrow<number>('PORT');
  app.enableShutdownHooks();
  await app.listen(port);

  // Disable HTTP keep-alive in non-production so existing connections don't
  // prevent the port from being released when nest --watch restarts the process.
  if (environment !== EnvironmentEnum.PRODUCTION) {
    (app.getHttpServer() as { keepAliveTimeout: number }).keepAliveTimeout = 0;
  }

  console.log(`API is running on port ${port}`);
  console.log(`🚀 API Service running on: http://localhost:${port}/api`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}
void bootstrap();
