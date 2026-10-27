// Must stay the first import: Sentry instruments modules as they load.
import './instrument';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { BootstrapUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3400;
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
            title: 'Cron API',
            description: 'API for managing scheduled tasks',
            version: '1.0.0',
            tag: 'cron',
            path: 'docs',
          }
        : undefined,
    cors: {
      origin: configService.getOrThrow<string>('CORS_ORIGIN'),
      credentials: true,
    },
    enableCookieParser: true,
  });

  app.enableShutdownHooks();
  await app.listen(port);
  console.log(`Cron application is running on port ${port}`);
}
bootstrap()
  .then(() => console.log('Cron service started successfully'))
  .catch((error) => {
    console.error('Failed to start Cron service', error);
    process.exit(1);
  });
