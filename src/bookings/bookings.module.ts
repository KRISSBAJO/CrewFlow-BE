import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { PlanLimitsService } from '../common/plan-limits.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [AuditModule, AutomationsModule, WorkflowsModule, InvoicesModule],
  controllers: [BookingsController],
  providers: [BookingsService, PlanLimitsService],
  exports: [BookingsService],
})
export class BookingsModule {}
