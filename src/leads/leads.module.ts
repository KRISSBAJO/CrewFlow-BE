import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PlanLimitsService } from '../common/plan-limits.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [PrismaModule, AuditModule, BookingsModule],
  controllers: [LeadsController],
  providers: [LeadsService, PlanLimitsService],
  exports: [LeadsService],
})
export class LeadsModule {}
