import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { TemplateService } from './template.service';

@Module({
  imports: [AuditModule, MessagingModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, TemplateService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
