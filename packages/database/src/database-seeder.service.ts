import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Injectable()
export class DatabaseSeederService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseSeederService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit() {
    await this.withRetry(async () => {
      this.logger.log('Starting database seeding process...');

      await this.seed();

      this.logger.log('Database seeding completed successfully.');
    });
  }

  /**
   * Seeding steps go here. Every step MUST be idempotent (find-or-skip on a
   * natural key): `withRetry` re-runs the whole sequence after a failure.
   */
  protected async seed(): Promise<void> {
    // Intentionally empty in the template.
  }

  /**
   * The `PrismaPg` driver adapter can refuse the very first query issued
   * right after `$connect()` resolves on a cold boot (`ECONNREFUSED`, a
   * connection-pool race). Retrying the whole run is safe because every
   * step is idempotent; a persistent failure still surfaces after the last
   * attempt instead of being swallowed.
   */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= attempts) throw error;
        this.logger.warn(
          `Database seeding failed (attempt ${attempt}/${attempts}), retrying: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
}
