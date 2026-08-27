import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { BootstrapUtil, SentryUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  SentryUtil.init('auth');
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  const configService = app.get(ConfigService);

  app.connectMicroservice({
    transport: Transport.REDIS,
    options: {
      host: configService.getOrThrow<string>('REDIS_HOST'),
      port: configService.getOrThrow<number>('REDIS_PORT'),
      password: configService.get<string>('REDIS_PASSWORD') || undefined,
      retryAttempts: 5,
      retryDelay: 3000,
    },
  });

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
            title: 'Auth API',
            description: 'API for authentication and authorization',
            version: '1.0.0',
            tag: 'auth',
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
  await app.startAllMicroservices();
  app.enableShutdownHooks();
  await app.listen(port);
  console.log(`Auth API is running on port ${port}`);
  console.log(`🚀 Auth Service running on: http://localhost:${port}/api/auth`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/auth/docs`);
}
bootstrap().catch((err) => {
  console.error('Error starting Auth API:', err);
  process.exit(1);
});
