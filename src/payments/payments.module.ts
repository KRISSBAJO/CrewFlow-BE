import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationsModule } from '../automations/automations.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuditModule, AutomationsModule, MessagingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
