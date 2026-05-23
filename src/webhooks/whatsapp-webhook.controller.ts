import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly webhooks: WhatsappWebhookService) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() response: Response,
  ) {
    if (this.webhooks.verify(mode, token)) {
      return response.status(200).send(challenge);
    }

    return response.sendStatus(403);
  }

  @Public()
  @Post()
  receive(
    @Body() payload: Record<string, unknown>,
    @Headers('x-hub-signature-256') signature?: string,
    @Query('tenantSlug') tenantSlug?: string,
  ) {
    return this.webhooks.receive(payload, tenantSlug, signature);
  }
}
