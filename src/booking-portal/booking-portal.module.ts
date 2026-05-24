import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BookingPortalController } from './booking-portal.controller';
import { BookingPortalService } from './booking-portal.service';

@Module({
  imports: [
    AuditModule,
    AutomationsModule,
    InvoicesModule,
    PaymentsModule,
    WorkflowsModule,
  ],
  controllers: [BookingPortalController],
  providers: [BookingPortalService],
})
export class BookingPortalModule {}
