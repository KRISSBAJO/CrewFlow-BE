import { Module } from '@nestjs/common';
import { PlanLimitsService } from '../common/plan-limits.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, PlanLimitsService],
  exports: [CustomersService],
})
export class CustomersModule {}
