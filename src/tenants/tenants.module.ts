import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlanLimitsService } from '../common/plan-limits.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuditModule],
  controllers: [TenantsController],
  providers: [TenantsService, PlanLimitsService],
})
export class TenantsModule {}
