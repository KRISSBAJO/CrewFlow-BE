import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly webhooks: WhatsappWebhookService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.webhooks.status(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('events')
  events(@CurrentUser() user: AuthUser) {
    return this.webhooks.events(user.tenantId);
  }

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
    @Req() request?: RawBodyRequest<Request>,
  ) {
    return this.webhooks.receive(
      payload,
      tenantSlug,
      signature,
      request?.rawBody?.toString('utf8'),
    );
  }
}
