import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [AuditModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappWebhookService],
})
export class WebhooksModule {}
