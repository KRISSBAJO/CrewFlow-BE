import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [AuditModule, AutomationsModule, WorkflowsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
