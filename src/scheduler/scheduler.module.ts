import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { SchedulerController } from './scheduler.controller';
import { OperationsSchedulerService } from './operations-scheduler.service';

@Module({
  imports: [AuditModule, AutomationsModule],
  controllers: [SchedulerController],
  providers: [OperationsSchedulerService],
})
export class SchedulerModule {}
