import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [AuditModule, SecurityModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappWebhookService],
})
export class WebhooksModule {}
