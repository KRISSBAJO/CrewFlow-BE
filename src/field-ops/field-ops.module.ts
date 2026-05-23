import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { FieldOpsController } from './field-ops.controller';
import { FieldOpsService } from './field-ops.service';

@Module({
  imports: [AuditModule, WorkflowsModule, InvoicesModule],
  controllers: [FieldOpsController],
  providers: [FieldOpsService],
})
export class FieldOpsModule {}
