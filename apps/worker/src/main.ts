// Must stay the first import: Sentry instruments modules as they load.
import './instrument';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { BootstrapUtil } from '@repo/shared';
import { EnvironmentEnum } from '@repo/shared-types';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { workerBootstrapConfig } from './bootstrap.config';

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

  const port = configService.get<number>('PORT') || 3300;
  const environment = configService.get<EnvironmentEnum>(
    'NODE_ENV',
    EnvironmentEnum.DEVELOPMENT,
  );

  BootstrapUtil.setup(
    app,
    workerBootstrapConfig({
      environment,
      corsOrigin: configService.getOrThrow<string>('CORS_ORIGIN'),
    }),
  );

  app.enableShutdownHooks();
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`Worker application is running on port ${port}`);
}
bootstrap()
  .then(() => console.log('Worker service started successfully'))
  .catch((error) => {
    console.error('Failed to start Worker service', error);
    process.exit(1);
  });
