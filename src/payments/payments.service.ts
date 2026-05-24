import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingEventType,
  InvoiceStatus,
  MessageDirection,
  MessageProvider,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
  TenantStatus,
  WebhookEventStatus,
  WebhookProvider,
} from '@prisma/client';
import { createHmac } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { MessageProviderService } from '../messaging/message-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { SignatureService } from '../security/signature.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { SendReceiptDto } from './dto/send-receipt.dto';

type StripeCheckoutSession = {
  id: string;
  url?: string;
  payment_intent?: string;
};

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url?: string;
    reference?: string;
  };
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly automations: AutomationsService,
    private readonly messageProvider: MessageProviderService,
    private readonly config: ConfigService,
    private readonly signatures: SignatureService,
  ) {}

  findAll(user: AuthUser, status?: PaymentStatus) {
    return this.prisma.payment.findMany({
      where: { tenantId: user.tenantId, status },
      include: { invoice: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async createInvoicePaymentLink(
    user: AuthUser,
    invoiceId: string,
    dto: CreatePaymentLinkDto,
  ) {
    assertManager(user);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: user.tenantId },
      include: { customer: true, tenant: true, lineItems: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('Void invoices cannot be paid');
    }

    const provider = this.resolveProvider(dto.provider);
    const payment = await this.prisma.payment.create({
      data: {
        tenantId: user.tenantId,
        invoiceId: invoice.id,
        provider,
        status: PaymentStatus.PENDING,
        amountCents: invoice.totalCents,
        currency: 'usd',
        metadata: {
          invoiceNo: invoice.invoiceNo,
          customerId: invoice.customerId,
        },
      },
    });

    const checkout =
      provider === PaymentProvider.STRIPE
        ? await this.createStripeCheckoutSession(invoice, payment.id)
        : provider === PaymentProvider.PAYSTACK
          ? await this.createPaystackCheckoutSession(invoice, payment.id)
          : this.createMockCheckout(invoice.id, payment.id);

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        checkoutUrl: checkout.url,
        providerSessionId: checkout.sessionId,
        providerPaymentId: checkout.paymentIntentId,
      },
      include: { invoice: { include: { customer: true } } },
    });

    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status:
          invoice.status === InvoiceStatus.DRAFT
            ? InvoiceStatus.SENT
            : invoice.status,
        paymentUrl: checkout.url,
        paymentProvider: provider,
        paymentReference: checkout.sessionId,
      },
      include: {
        customer: true,
        lineItems: true,
        booking: { include: { service: true } },
        payments: true,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PAYMENT_LINK_CREATED',
      entityType: 'Payment',
      entityId: updatedPayment.id,
      summary: `Created ${provider} payment link for invoice ${invoice.invoiceNo}`,
      metadata: {
        invoiceId: invoice.id,
        amountCents: invoice.totalCents,
        checkoutUrl: checkout.url,
      },
    });

    await this.automations.trigger({
      tenantId: user.tenantId,
      trigger: 'INVOICE_DUE',
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      bookingId: invoice.bookingId ?? undefined,
    });

    return { invoice: updatedInvoice, payment: updatedPayment };
  }

  async renderInvoiceHtml(user: AuthUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: user.tenantId },
      include: {
        tenant: true,
        customer: true,
        lineItems: true,
        booking: { include: { service: true, assignedStaff: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const rows = invoice.lineItems
      .map(
        (item) => `
          <tr>
            <td>${this.escape(item.description)}</td>
            <td>${item.quantity}</td>
            <td>${this.money(item.unitCents)}</td>
            <td>${this.money(item.totalCents)}</td>
          </tr>`,
      )
      .join('');
    const paid = invoice.status === InvoiceStatus.PAID;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${this.escape(invoice.invoiceNo)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172026; margin: 40px; }
    .top { display: flex; justify-content: space-between; gap: 32px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .status { font-weight: 700; color: ${paid ? '#047857' : '#b45309'}; }
    table { border-collapse: collapse; width: 100%; margin-top: 32px; }
    th, td { border-bottom: 1px solid #d8dee4; padding: 12px; text-align: left; }
    th { background: #f6f8fa; }
    .totals { margin-left: auto; margin-top: 24px; width: 320px; }
    .totals div { display: flex; justify-content: space-between; padding: 8px 0; }
    .pay { display: inline-block; margin-top: 24px; padding: 12px 16px; background: #0f766e; color: white; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <section class="top">
    <div>
      <h1>${this.escape(invoice.tenant.businessName)}</h1>
      <div>${this.escape(invoice.tenant.industry)}</div>
    </div>
    <div>
      <h2>Invoice ${this.escape(invoice.invoiceNo)}</h2>
      <div class="status">${invoice.status}</div>
      <div>Due ${invoice.dueDate.toDateString()}</div>
    </div>
  </section>
  <section>
    <h3>Bill To</h3>
    <div>${this.escape(invoice.customer.name)}</div>
    <div>${this.escape(invoice.customer.phone)}</div>
    <div>${this.escape(invoice.customer.email ?? '')}</div>
  </section>
  <table>
    <thead><tr><th>Service</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="totals">
    <div><span>Subtotal</span><strong>${this.money(invoice.subtotalCents)}</strong></div>
    <div><span>Tax</span><strong>${this.money(invoice.taxCents)}</strong></div>
    <div><span>Total</span><strong>${this.money(invoice.totalCents)}</strong></div>
  </section>
  ${
    invoice.paymentUrl && !paid
      ? `<a class="pay" href="${this.escape(invoice.paymentUrl)}">Pay invoice</a>`
      : ''
  }
</body>
</html>`;
  }

  async markPaymentSucceeded(paymentId: string, source = 'mock-checkout') {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { customer: true } } },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.completePayment({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      providerPaymentId: payment.providerPaymentId ?? source,
      receiptUrl: payment.receiptUrl,
    });
  }

  async handleStripeWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: string,
  ) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    const signatureVerified = webhookSecret
      ? this.signatures.verifyStripeSignature({
          secret: webhookSecret,
          rawBody: rawBody ?? JSON.stringify(payload),
          signature,
        })
      : null;

    if (webhookSecret && !signatureVerified) {
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    const body = this.asRecord(payload);
    const providerEventId =
      this.stringField(body, 'id') ?? `stripe-${Date.now()}`;

    const event = await this.prisma.webhookEvent.create({
      data: {
        provider: WebhookProvider.STRIPE,
        providerEventId,
        status: WebhookEventStatus.RECEIVED,
        payload: {
          ...body,
          crewflowSignatureVerified: signatureVerified,
        },
      },
    });

    try {
      const eventType = this.stringField(body, 'type');
      const data = this.asRecord(body.data);
      const stripeObject = this.asRecord(data.object);

      if (eventType?.startsWith('invoice.')) {
        const tenantId =
          await this.resolvePlatformTenantFromStripeObject(stripeObject);
        if (tenantId) {
          await this.applyPlatformInvoiceEvent({
            tenantId,
            eventType,
            providerEventId,
            stripeObject,
          });
          return this.prisma.webhookEvent.update({
            where: { id: event.id },
            data: {
              tenantId,
              status: WebhookEventStatus.PROCESSED,
              processedAt: new Date(),
            },
          });
        }
      }

      if (eventType === 'customer.subscription.deleted') {
        const tenantId =
          await this.resolvePlatformTenantFromStripeObject(stripeObject);
        if (tenantId) {
          await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
              status: TenantStatus.CHURNED,
              subscriptionStatus: SubscriptionStatus.CANCELED,
              canceledAt: new Date(),
            },
          });
          await this.recordPlatformBillingEventOnce({
            tenantId,
            type: BillingEventType.CANCELED,
            providerEventId,
            amountCents: null,
            note: 'Stripe subscription canceled.',
            metadata: stripeObject,
          });
          return this.prisma.webhookEvent.update({
            where: { id: event.id },
            data: {
              tenantId,
              status: WebhookEventStatus.PROCESSED,
              processedAt: new Date(),
            },
          });
        }
      }

      if (eventType !== 'checkout.session.completed') {
        return this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: WebhookEventStatus.IGNORED,
            processedAt: new Date(),
          },
        });
      }

      const session = stripeObject;
      const metadata = this.asRecord(session.metadata);
      if (this.stringField(metadata, 'kind') === 'platform_subscription') {
        const tenantId = this.stringField(metadata, 'tenantId');
        if (!tenantId) {
          throw new Error('Stripe platform checkout missing tenantId');
        }
        await this.completePlatformCheckout({
          tenantId,
          providerEventId,
          session,
          metadata,
        });
        return this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            tenantId,
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date(),
          },
        });
      }

      const paymentId = this.stringField(metadata, 'paymentId');
      const sessionId = this.stringField(session, 'id');

      const payment = paymentId
        ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
        : sessionId
          ? await this.prisma.payment.findFirst({
              where: {
                provider: PaymentProvider.STRIPE,
                providerSessionId: sessionId,
              },
            })
          : null;

      if (!payment) {
        throw new Error('No matching payment found for Stripe event');
      }

      const completed = await this.completePayment({
        tenantId: payment.tenantId,
        paymentId: payment.id,
        providerPaymentId:
          this.stringField(session, 'payment_intent') ?? undefined,
        receiptUrl: this.stringField(session, 'receipt_url') ?? null,
      });

      return this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          tenantId: completed.tenantId,
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      return this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: WebhookEventStatus.FAILED,
          error:
            error instanceof Error ? error.message : 'Stripe webhook error',
          processedAt: new Date(),
        },
      });
    }
  }

  async handlePaystackWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: string,
  ) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (secret) {
      const expected = createHmac('sha512', secret)
        .update(rawBody ?? JSON.stringify(payload))
        .digest('hex');
      if (!signature || signature !== expected) {
        throw new UnauthorizedException('Invalid Paystack webhook signature');
      }
    }

    const body = this.asRecord(payload);
    const data = this.asRecord(body.data);
    const metadata = this.asRecord(data.metadata);
    const eventType = this.stringField(body, 'event') ?? 'paystack.event';
    const reference =
      this.stringField(data, 'reference') ?? `paystack-${Date.now()}`;

    const event = await this.prisma.webhookEvent.create({
      data: {
        provider: WebhookProvider.PAYSTACK,
        providerEventId: `${eventType}:${reference}`,
        status: WebhookEventStatus.RECEIVED,
        payload: body as Prisma.InputJsonValue,
      },
    });

    try {
      const tenantId =
        this.stringField(metadata, 'tenantId') ??
        (await this.resolvePlatformTenantFromPaystackObject(data));
      if (
        tenantId &&
        (eventType === 'charge.success' ||
          eventType === 'subscription.create' ||
          eventType === 'invoice.payment_success')
      ) {
        await this.completePaystackPlatformEvent({
          tenantId,
          providerEventId: `${eventType}:${reference}`,
          eventType,
          data,
          metadata,
        });
        return this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            tenantId,
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date(),
          },
        });
      }

      const paymentId = this.stringField(metadata, 'paymentId');
      const payment = paymentId
        ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
        : await this.prisma.payment.findFirst({
            where: {
              provider: PaymentProvider.PAYSTACK,
              providerSessionId: reference,
            },
          });
      if (eventType === 'charge.success' && payment) {
        const completed = await this.completePayment({
          tenantId: payment.tenantId,
          paymentId: payment.id,
          providerPaymentId: reference,
        });
        return this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            tenantId: completed.tenantId,
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date(),
          },
        });
      }

      return this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.IGNORED, processedAt: new Date() },
      });
    } catch (error) {
      return this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: WebhookEventStatus.FAILED,
          error:
            error instanceof Error ? error.message : 'Paystack webhook error',
          processedAt: new Date(),
        },
      });
    }
  }

  async sendReceipt(user: AuthUser, paymentId: string, dto: SendReceiptDto) {
    assertManager(user);
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId: user.tenantId,
        status: PaymentStatus.SUCCEEDED,
      },
      include: { invoice: { include: { customer: true, tenant: true } } },
    });

    if (!payment) {
      throw new NotFoundException('Paid payment not found');
    }

    const content = [
      `Payment received for invoice ${payment.invoice.invoiceNo}.`,
      `Amount: ${this.money(payment.amountCents)}.`,
      dto.note,
      payment.receiptUrl ? `Receipt: ${payment.receiptUrl}` : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    const provider = dto.provider ?? MessageProvider.WHATSAPP;
    const result = await this.messageProvider.send({
      provider,
      to: payment.invoice.customer.phone,
      content,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        tenantId: user.tenantId,
        customerId: payment.invoice.customer.id,
        direction: MessageDirection.OUTBOUND,
        provider,
        content,
        metadata: {
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          providerMessageId: result.providerMessageId,
          providerStatus: result.status,
        },
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PAYMENT_RECEIPT_SENT',
      entityType: 'Payment',
      entityId: payment.id,
      summary: `Sent receipt for invoice ${payment.invoice.invoiceNo}`,
      metadata: { messageLogId: message.id },
    });

    return { message, provider: result };
  }

  private async completePlatformCheckout(input: {
    tenantId: string;
    providerEventId: string;
    session: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) {
    const monthlyPriceCents =
      this.numberFromString(input.metadata, 'monthlyPriceCents') ??
      this.numberField(input.session, 'amount_subtotal') ??
      0;
    const setupFeeCents =
      this.numberFromString(input.metadata, 'setupFeeCents') ?? 0;
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: input.tenantId },
        data: {
          status: TenantStatus.ACTIVE,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          stripeCustomerId: this.stringField(input.session, 'customer'),
          stripeSubscriptionId: this.stringField(input.session, 'subscription'),
          monthlyPriceCents: monthlyPriceCents || undefined,
          setupFeeCents: setupFeeCents || undefined,
          currentPeriodEnd: nextMonth,
          nextBillingAt: nextMonth,
          pastDueAt: null,
          canceledAt: null,
        },
      });

      if (setupFeeCents > 0) {
        const existingSetup = await tx.platformBillingEvent.findFirst({
          where: {
            tenantId: input.tenantId,
            providerEventId: `${input.providerEventId}:setup`,
          },
        });
        if (!existingSetup) {
          await tx.platformBillingEvent.create({
            data: {
              tenantId: input.tenantId,
              type: BillingEventType.SETUP_FEE_PAID,
              amountCents: setupFeeCents,
              provider: 'stripe',
              providerEventId: `${input.providerEventId}:setup`,
              note: 'Stripe setup fee paid.',
              metadata: input.session as Prisma.InputJsonValue,
            },
          });
        }
      }

      const existingSubscription = await tx.platformBillingEvent.findFirst({
        where: {
          tenantId: input.tenantId,
          providerEventId: `${input.providerEventId}:subscription`,
        },
      });
      if (!existingSubscription) {
        await tx.platformBillingEvent.create({
          data: {
            tenantId: input.tenantId,
            type: BillingEventType.SUBSCRIPTION_STARTED,
            amountCents: monthlyPriceCents || null,
            provider: 'stripe',
            providerEventId: `${input.providerEventId}:subscription`,
            note: 'Stripe subscription checkout completed.',
            metadata: input.session as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  private async applyPlatformInvoiceEvent(input: {
    tenantId: string;
    eventType: string;
    providerEventId: string;
    stripeObject: Record<string, unknown>;
  }) {
    const amountPaid =
      this.numberField(input.stripeObject, 'amount_paid') ??
      this.numberField(input.stripeObject, 'amount_due');
    const periodEnd = this.periodEndFromInvoice(input.stripeObject);

    if (input.eventType === 'invoice.payment_succeeded') {
      await this.prisma.tenant.update({
        where: { id: input.tenantId },
        data: {
          status: TenantStatus.ACTIVE,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          pastDueAt: null,
          canceledAt: null,
        },
      });
      await this.recordPlatformBillingEventOnce({
        tenantId: input.tenantId,
        type: BillingEventType.SUBSCRIPTION_RENEWED,
        providerEventId: input.providerEventId,
        amountCents: amountPaid ?? null,
        note: 'Stripe subscription invoice paid.',
        metadata: input.stripeObject,
      });
      return;
    }

    if (input.eventType === 'invoice.payment_failed') {
      await this.prisma.tenant.update({
        where: { id: input.tenantId },
        data: {
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
          pastDueAt: new Date(),
        },
      });
      await this.recordPlatformBillingEventOnce({
        tenantId: input.tenantId,
        type: BillingEventType.PAYMENT_FAILED,
        providerEventId: input.providerEventId,
        amountCents: amountPaid ?? null,
        note: 'Stripe subscription invoice payment failed.',
        metadata: input.stripeObject,
      });
    }
  }

  private async completePaystackPlatformEvent(input: {
    tenantId: string;
    providerEventId: string;
    eventType: string;
    data: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) {
    const amount =
      this.numberField(input.data, 'amount') ??
      this.numberFromString(input.metadata, 'monthlyPriceCents') ??
      0;
    const monthlyPriceCents =
      this.numberFromString(input.metadata, 'monthlyPriceCents') ?? amount;
    const setupFeeCents =
      this.numberFromString(input.metadata, 'setupFeeCents') ?? 0;
    const customer = this.asRecord(input.data.customer);
    const subscription = this.asRecord(input.data.subscription);
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    await this.prisma.tenant.update({
      where: { id: input.tenantId },
      data: {
        status: TenantStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        monthlyPriceCents: monthlyPriceCents || undefined,
        setupFeeCents: setupFeeCents || undefined,
        paystackCustomerCode:
          this.stringField(customer, 'customer_code') ?? undefined,
        paystackSubscriptionCode:
          this.stringField(subscription, 'subscription_code') ?? undefined,
        currentPeriodEnd: nextMonth,
        nextBillingAt: nextMonth,
        pastDueAt: null,
        canceledAt: null,
      },
    });

    if (setupFeeCents > 0) {
      await this.recordPlatformBillingEventOnce({
        tenantId: input.tenantId,
        type: BillingEventType.SETUP_FEE_PAID,
        providerEventId: `${input.providerEventId}:setup`,
        amountCents: setupFeeCents,
        provider: 'paystack',
        note: 'Paystack setup fee paid.',
        metadata: input.data,
      });
    }

    await this.recordPlatformBillingEventOnce({
      tenantId: input.tenantId,
      type:
        input.eventType === 'charge.success'
          ? BillingEventType.SUBSCRIPTION_STARTED
          : BillingEventType.SUBSCRIPTION_RENEWED,
      providerEventId: `${input.providerEventId}:subscription`,
      amountCents: monthlyPriceCents || amount || null,
      provider: 'paystack',
      note: 'Paystack subscription payment received.',
      metadata: input.data,
    });
  }

  private async recordPlatformBillingEventOnce(input: {
    tenantId: string;
    type: BillingEventType;
    providerEventId: string;
    amountCents?: number | null;
    provider?: string;
    note: string;
    metadata: Record<string, unknown>;
  }) {
    const existing = await this.prisma.platformBillingEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        providerEventId: input.providerEventId,
      },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.platformBillingEvent.create({
      data: {
        tenantId: input.tenantId,
        type: input.type,
        amountCents: input.amountCents,
        provider: input.provider ?? 'stripe',
        providerEventId: input.providerEventId,
        note: input.note,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async resolvePlatformTenantFromPaystackObject(
    value: Record<string, unknown>,
  ) {
    const metadata = this.asRecord(value.metadata);
    const tenantId = this.stringField(metadata, 'tenantId');
    if (tenantId) return tenantId;
    const customer = this.asRecord(value.customer);
    const subscription = this.asRecord(value.subscription);
    const paystackCustomerCode = this.stringField(customer, 'customer_code');
    const paystackSubscriptionCode = this.stringField(
      subscription,
      'subscription_code',
    );
    if (!paystackCustomerCode && !paystackSubscriptionCode) return null;
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        OR: [
          paystackCustomerCode ? { paystackCustomerCode } : undefined,
          paystackSubscriptionCode ? { paystackSubscriptionCode } : undefined,
        ].filter(Boolean) as Array<{
          paystackCustomerCode?: string;
          paystackSubscriptionCode?: string;
        }>,
      },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async resolvePlatformTenantFromStripeObject(
    value: Record<string, unknown>,
  ) {
    const metadata = this.asRecord(value.metadata);
    const subscriptionDetails = this.asRecord(value.subscription_details);
    const subscriptionMetadata = this.asRecord(subscriptionDetails.metadata);
    const tenantId =
      this.stringField(metadata, 'tenantId') ??
      this.stringField(subscriptionMetadata, 'tenantId');
    if (tenantId) {
      return tenantId;
    }

    const subscriptionId =
      this.stringField(value, 'subscription') ?? this.stringField(value, 'id');
    if (!subscriptionId) {
      return null;
    }
    const tenant = await this.prisma.tenant.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async completePayment(input: {
    tenantId: string;
    paymentId: string;
    providerPaymentId?: string;
    receiptUrl?: string | null;
  }) {
    const paidAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt,
          providerPaymentId: input.providerPaymentId,
          receiptUrl: input.receiptUrl ?? undefined,
        },
        include: { invoice: { include: { customer: true } } },
      });

      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          status: InvoiceStatus.PAID,
          paidAt,
          paymentReference:
            input.providerPaymentId ?? payment.providerSessionId ?? payment.id,
        },
      });

      return payment;
    });

    await this.audit.record({
      tenantId: input.tenantId,
      action: 'PAYMENT_SUCCEEDED',
      entityType: 'Payment',
      entityId: updated.id,
      summary: `Payment received for invoice ${updated.invoice.invoiceNo}`,
      metadata: {
        invoiceId: updated.invoiceId,
        amountCents: updated.amountCents,
        providerPaymentId: input.providerPaymentId,
      },
    });

    return updated;
  }

  private resolveProvider(provider?: PaymentProvider) {
    if (provider) {
      return provider;
    }
    return process.env.PAYSTACK_SECRET_KEY
      ? PaymentProvider.PAYSTACK
      : process.env.STRIPE_SECRET_KEY
        ? PaymentProvider.STRIPE
        : PaymentProvider.MOCK;
  }

  private async createStripeCheckoutSession(
    invoice: Prisma.InvoiceGetPayload<{
      include: { customer: true; tenant: true; lineItems: true };
    }>,
    paymentId: string,
  ) {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('STRIPE_SECRET_KEY is not configured');
    }

    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const successUrl =
      process.env.PAYMENT_SUCCESS_URL ??
      `${apiBase}/payments/mock-checkout/${paymentId}/success`;
    const cancelUrl =
      process.env.PAYMENT_CANCEL_URL ??
      `${apiBase}/invoices/${invoice.id}/html`;
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('customer_email', invoice.customer.email ?? '');
    params.set('client_reference_id', invoice.id);
    params.set('metadata[paymentId]', paymentId);
    params.set('metadata[invoiceId]', invoice.id);
    params.set('metadata[tenantId]', invoice.tenantId);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set(
      'line_items[0][price_data][unit_amount]',
      invoice.totalCents.toString(),
    );
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${invoice.tenant.businessName} invoice ${invoice.invoiceNo}`,
    );

    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await response.text());
    }

    const session = (await response.json()) as StripeCheckoutSession;
    return {
      url: session.url ?? null,
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
    };
  }

  private createMockCheckout(invoiceId: string, paymentId: string) {
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    return {
      url: `${apiBase}/payments/mock-checkout/${paymentId}`,
      sessionId: `mock_${invoiceId}_${paymentId}`,
      paymentIntentId: `mock_pi_${paymentId}`,
    };
  }

  private async createPaystackCheckoutSession(
    invoice: Prisma.InvoiceGetPayload<{
      include: { customer: true; tenant: true; lineItems: true };
    }>,
    paymentId: string,
  ) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured');
    }
    const email = invoice.customer.email ?? invoice.tenant.billingEmail;
    if (!email) {
      throw new BadRequestException(
        'Customer or tenant billing email is required for Paystack',
      );
    }
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const reference = `cf_invoice_${paymentId}_${Date.now()}`;
    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: invoice.totalCents,
          currency: (process.env.PAYSTACK_CURRENCY ?? 'NGN').toUpperCase(),
          reference,
          callback_url:
            process.env.PAYMENT_SUCCESS_URL ??
            `${apiBase}/invoices/${invoice.id}/html`,
          metadata: {
            paymentId,
            invoiceId: invoice.id,
            tenantId: invoice.tenantId,
          },
        }),
      },
    );
    const payload = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !payload.status || !payload.data?.authorization_url) {
      throw new BadRequestException(
        payload.message || 'Paystack checkout failed',
      );
    }
    return {
      url: payload.data.authorization_url,
      sessionId: payload.data.reference ?? reference,
      paymentIntentId: payload.data.reference ?? reference,
    };
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  }

  private escape(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringField(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    return typeof value[key] === 'string' ? value[key] : undefined;
  }

  private numberField(
    value: Record<string, unknown>,
    key: string,
  ): number | undefined {
    return typeof value[key] === 'number' ? value[key] : undefined;
  }

  private numberFromString(
    value: Record<string, unknown>,
    key: string,
  ): number | undefined {
    const field = value[key];
    if (typeof field === 'number') {
      return field;
    }
    if (typeof field !== 'string') {
      return undefined;
    }
    const parsed = Number(field);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private periodEndFromInvoice(value: Record<string, unknown>) {
    const lines = this.asRecord(value.lines);
    const lineData = Array.isArray(lines.data) ? lines.data : [];
    const firstLine = this.asRecord(lineData[0]);
    const period = this.asRecord(firstLine.period);
    const end = this.numberField(period, 'end');
    return end ? new Date(end * 1000) : undefined;
  }
}
