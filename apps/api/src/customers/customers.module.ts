import { Module } from '@nestjs/common';
import { EncryptionService } from '@repo/shared';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

// Reference vertical slice — see README "Reference slice: Customers" to remove.
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, EncryptionService],
})
export class CustomersModule {}
