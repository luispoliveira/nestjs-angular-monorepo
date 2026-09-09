import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { DatabaseSeederService } from './database-seeder.service';

// Import this module explicitly in the one app meant to seed the database
// (apps/api) — seeding must never run as a side effect of every app's boot.
@Module({
  imports: [DatabaseModule],
  providers: [DatabaseSeederService],
})
export class DatabaseSeederModule {}
