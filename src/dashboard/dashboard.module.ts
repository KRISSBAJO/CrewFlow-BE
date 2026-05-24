import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuditModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
