import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { TemplateService } from './template.service';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Module({
  imports: [AuditModule, MessagingModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, TemplateService, WhatsappTemplatesService],
  exports: [AutomationsService, WhatsappTemplatesService],
})
export class AutomationsModule {}
