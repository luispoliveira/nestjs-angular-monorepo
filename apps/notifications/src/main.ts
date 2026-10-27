// Must stay the first import: Sentry instruments modules as they load.
import './instrument';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { BootstrapUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
            title: 'Notifications API',
            description: 'API for managing notifications',
            version: '1.0.0',
            tag: 'notifications',
            path: 'docs',
          }
        : undefined,
    cors: {
      origin: configService.getOrThrow<string>('CORS_ORIGIN'),
      credentials: true,
    },
    enableCookieParser: true,
  });

  const port = configService.get<number>('PORT') || 3200;

  app.enableShutdownHooks();
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`Notifications API is running on port ${port}`);
}
bootstrap()
  .then(() => console.log('Notifications service started successfully'))
  .catch((error) => {
    console.error('Failed to start Notifications service', error);
    process.exit(1);
  });
