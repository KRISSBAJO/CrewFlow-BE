import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SecurityModule } from '../security/security.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [AuditModule, SecurityModule, MessagingModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappWebhookService],
  exports: [WhatsappWebhookService],
})
export class WebhooksModule {}
