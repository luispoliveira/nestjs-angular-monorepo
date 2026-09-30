import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { EnvironmentEnum } from '@repo/shared-types';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    const environment = configService.get<EnvironmentEnum>(
      'NODE_ENV',
      EnvironmentEnum.DEVELOPMENT,
    );
    const adapter = new PrismaPg({ connectionString: databaseUrl });

    super({
      adapter: adapter,
      log:
        environment === EnvironmentEnum.DEVELOPMENT
          ? ['info', 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to the database...');
    await this.$connect();
    this.logger.log('Successfully connected to the database.');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from the database...');
    await this.$disconnect();
    this.logger.log('Successfully disconnected from the database.');
  }
}
