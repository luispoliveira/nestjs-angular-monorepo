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
import { assertRlsEnforceable } from './rls';

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
          ? ['query', 'info', 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to the database...');
    await this.$connect();
    this.logger.log('Successfully connected to the database.');

    // Off by default: only multi-tenant projects rely on row-level security.
    // Turn it on with DATABASE_REQUIRE_RLS=true and the app refuses to start on
    // credentials that would silently disable tenant isolation.
    if (this.configService.get<string>('DATABASE_REQUIRE_RLS') === 'true') {
      await assertRlsEnforceable(this);
      this.logger.log('Database role cannot bypass row-level security.');
    }
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from the database...');
    await this.$disconnect();
    this.logger.log('Successfully disconnected from the database.');
  }
}
