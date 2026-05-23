import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: PaymentStatus,
  ) {
    return this.payments.findAll(user, status);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('invoices/:id/payment-link')
  createInvoicePaymentLink(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.payments.createInvoicePaymentLink(user, id, dto);
  }

  @Get('invoices/:id/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  renderInvoiceHtml(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.renderInvoiceHtml(user, id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('payments/:id/receipt')
  sendReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendReceiptDto,
  ) {
    return this.payments.sendReceipt(user, id, dto);
  }

  @Public()
  @Get('payments/mock-checkout/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  mockCheckout(@Param('id') id: string) {
    return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>CrewFlow Mock Checkout</title></head>
<body style="font-family: Arial, sans-serif; margin: 40px;">
  <h1>CrewFlow Mock Checkout</h1>
  <p>This local checkout confirms payment without Stripe credentials.</p>
  <form method="post" action="/api/payments/mock-checkout/${id}/success">
    <button style="padding: 12px 16px; background: #0f766e; color: white; border: 0; border-radius: 6px;">Mark Paid</button>
  </form>
</body>
</html>`;
  }

  @Public()
  @Post('payments/mock-checkout/:id/success')
  markMockPaymentSucceeded(@Param('id') id: string) {
    return this.payments.markPaymentSucceeded(id);
  }

  @Public()
  @Post('webhooks/stripe')
  handleStripeWebhook(
    @Body() payload: unknown,
    @Headers('stripe-signature') signature?: string,
    @Req() request?: RawBodyRequest<Request>,
  ) {
    return this.payments.handleStripeWebhook(
      payload,
      signature,
      request?.rawBody?.toString('utf8'),
    );
  }
}
