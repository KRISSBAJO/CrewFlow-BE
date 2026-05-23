import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { RetentionModule } from '../retention/retention.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { SchedulerController } from './scheduler.controller';
import { OperationsSchedulerService } from './operations-scheduler.service';

@Module({
  imports: [AuditModule, AutomationsModule, RetentionModule, WorkflowsModule],
  controllers: [SchedulerController],
  providers: [OperationsSchedulerService],
})
export class SchedulerModule {}
