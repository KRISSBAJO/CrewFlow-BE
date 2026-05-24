import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  MessageProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { InvoicesService } from '../invoices/invoices.service';
import { MessagesService } from '../messages/messages.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollectionActionDto,
  CollectionActionType,
} from './dto/collection-action.dto';

type CollectionInvoice = Prisma.InvoiceGetPayload<{
  include: {
    customer: true;
    booking: { include: { service: true } };
    lineItems: true;
    payments: true;
  };
}>;

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly messages: MessagesService,
    private readonly payments: PaymentsService,
  ) {}

  async summary(user: AuthUser) {
    assertManager(user);
    const [invoices, paidLast30] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          tenantId: user.tenantId,
          status: {
            in: [
              InvoiceStatus.DRAFT,
              InvoiceStatus.SENT,
              InvoiceStatus.OVERDUE,
            ],
          },
        },
        include: this.includeInvoice(),
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId: user.tenantId,
          status: InvoiceStatus.PAID,
          paidAt: { gte: this.daysAgo(30) },
        },
        _sum: { totalCents: true },
      }),
    ]);

    const enriched = invoices.map((invoice) => this.enrich(invoice));
    const buckets = [
      this.bucket(
        'notDue',
        'Not due yet',
        enriched.filter((invoice) => invoice.daysPastDue <= 0),
      ),
      this.bucket(
        'dueNow',
        'Due now',
        enriched.filter(
          (invoice) => invoice.daysPastDue > 0 && invoice.daysPastDue <= 7,
        ),
      ),
      this.bucket(
        'eightToFourteen',
        '8-14 days',
        enriched.filter(
          (invoice) => invoice.daysPastDue >= 8 && invoice.daysPastDue <= 14,
        ),
      ),
      this.bucket(
        'fifteenPlus',
        '15+ days',
        enriched.filter((invoice) => invoice.daysPastDue >= 15),
      ),
    ];

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        openCents: enriched.reduce(
          (sum, invoice) => sum + invoice.totalCents,
          0,
        ),
        overdueCents: enriched
          .filter(
            (invoice) =>
              invoice.status === InvoiceStatus.OVERDUE ||
              invoice.daysPastDue > 0,
          )
          .reduce((sum, invoice) => sum + invoice.totalCents, 0),
        paidLast30Cents: paidLast30._sum.totalCents ?? 0,
        openCount: enriched.length,
        overdueCount: enriched.filter(
          (invoice) =>
            invoice.status === InvoiceStatus.OVERDUE || invoice.daysPastDue > 0,
        ).length,
        noPaymentLinkCount: enriched.filter(
          (invoice) => !invoice.hasPaymentLink,
        ).length,
        highRiskCount: enriched.filter(
          (invoice) => invoice.collectionRisk >= 70,
        ).length,
      },
      agingBuckets: buckets,
      priorityInvoices: [...enriched]
        .sort(
          (a, b) =>
            b.collectionRisk - a.collectionRisk || b.totalCents - a.totalCents,
        )
        .slice(0, 10),
      invoices: enriched,
    };
  }

  async timeline(user: AuthUser, invoiceId: string) {
    assertManager(user);
    const invoice = await this.findInvoice(user.tenantId, invoiceId);
    const [messages, audits] = await Promise.all([
      this.prisma.messageLog.findMany({
        where: { tenantId: user.tenantId, customerId: invoice.customerId },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.auditLog.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [
            { entityId: invoice.id },
            { metadata: { path: ['invoiceId'], equals: invoice.id } },
          ],
        },
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const filteredMessages = messages.filter((message) => {
      const metadata = this.asRecord(message.metadata);
      return (
        metadata.invoiceId === invoice.id ||
        message.content.includes(invoice.invoiceNo)
      );
    });

    const events = [
      ...invoice.payments.map((payment) => ({
        id: payment.id,
        type: 'payment',
        label: `Payment ${payment.status}`,
        detail: `${payment.provider} ${this.money(payment.amountCents)}`,
        createdAt: payment.paidAt ?? payment.createdAt,
      })),
      ...filteredMessages.map((message) => ({
        id: message.id,
        type: 'message',
        label: `${message.provider} message`,
        detail: message.content,
        createdAt: message.createdAt,
      })),
      ...audits.map((audit) => ({
        id: audit.id,
        type: 'audit',
        label: audit.action,
        detail: audit.summary,
        createdAt: audit.createdAt,
        actor: audit.actor,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return { invoice: this.enrich(invoice), events };
  }

  async runAction(user: AuthUser, invoiceId: string, dto: CollectionActionDto) {
    assertManager(user);
    const invoice = await this.findInvoice(user.tenantId, invoiceId);

    if (dto.type === CollectionActionType.MARK_PAID) {
      await this.invoices.updateStatus(user, invoice.id, InvoiceStatus.PAID);
      return this.afterAction(user, invoice.id, dto.type);
    }

    if (dto.type === CollectionActionType.VOID_INVOICE) {
      await this.invoices.updateStatus(user, invoice.id, InvoiceStatus.VOID);
      return this.afterAction(user, invoice.id, dto.type);
    }

    if (dto.type === CollectionActionType.PROMISE_TO_PAY) {
      if (!dto.promiseDate) {
        throw new BadRequestException('Promise date is required');
      }
      await this.audit.record({
        tenantId: user.tenantId,
        actorId: user.sub,
        action: 'COLLECTION_PROMISE_TO_PAY',
        entityType: 'Invoice',
        entityId: invoice.id,
        summary: `${invoice.customer.name} promised to pay invoice ${invoice.invoiceNo}`,
        metadata: {
          invoiceId: invoice.id,
          promiseDate: dto.promiseDate,
          note: dto.note,
        },
      });
      return this.afterAction(user, invoice.id, dto.type);
    }

    if (!invoice.customer.phone) {
      throw new BadRequestException('Customer has no phone number');
    }

    const paymentBundle = invoice.paymentUrl
      ? null
      : await this.payments.createInvoicePaymentLink(user, invoice.id, {});
    const freshInvoice =
      paymentBundle?.invoice ??
      (await this.findInvoice(user.tenantId, invoice.id));
    const message = await this.sendCollectionMessage(user, freshInvoice, dto);

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: dto.type,
      entityType: 'Invoice',
      entityId: freshInvoice.id,
      summary: `Ran ${dto.type} for invoice ${freshInvoice.invoiceNo}`,
      metadata: {
        invoiceId: freshInvoice.id,
        messageId: message.message.id,
        paymentId: paymentBundle?.payment.id,
      },
    });

    return {
      action: dto.type,
      invoice: this.enrich(freshInvoice),
      payment: paymentBundle?.payment ?? null,
      message: message.message,
      timeline: await this.timeline(user, freshInvoice.id),
    };
  }

  async scanOverdue(user: AuthUser) {
    assertManager(user);
    const now = new Date();
    const result = await this.prisma.invoice.updateMany({
      where: {
        tenantId: user.tenantId,
        status: InvoiceStatus.SENT,
        dueDate: { lt: now },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'COLLECTION_OVERDUE_SCAN',
      entityType: 'Invoice',
      summary: `Marked ${result.count} invoices overdue`,
      metadata: { count: result.count },
    });

    return { scannedAt: now.toISOString(), overdueMarked: result.count };
  }

  private async afterAction(
    user: AuthUser,
    invoiceId: string,
    action: CollectionActionType,
  ) {
    const invoice = await this.findInvoice(user.tenantId, invoiceId);
    return {
      action,
      invoice: this.enrich(invoice),
      timeline: await this.timeline(user, invoice.id),
    };
  }

  private async sendCollectionMessage(
    user: AuthUser,
    invoice: CollectionInvoice,
    dto: CollectionActionDto,
  ) {
    const content =
      dto.type === CollectionActionType.SEND_REMINDER
        ? `Hi ${invoice.customer.name}, friendly reminder that invoice ${invoice.invoiceNo} for ${this.money(invoice.totalCents)} is due. You can pay here: ${invoice.paymentUrl}`
        : `Hi ${invoice.customer.name}, here is your secure payment link for invoice ${invoice.invoiceNo} (${this.money(invoice.totalCents)}): ${invoice.paymentUrl}`;

    const sent = await this.messages.send(user, {
      customerId: invoice.customerId,
      provider: dto.provider ?? MessageProvider.WHATSAPP,
      content: dto.note ? `${content}\n\n${dto.note}` : content,
    });

    const metadata = this.asRecord(sent.message.metadata);
    const updatedMessage = await this.prisma.messageLog.update({
      where: { id: sent.message.id },
      data: {
        metadata: {
          ...metadata,
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          collectionAction: dto.type,
        },
      },
    });

    return { ...sent, message: updatedMessage };
  }

  private async findInvoice(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: this.includeInvoice(),
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  private includeInvoice() {
    return {
      customer: true,
      booking: { include: { service: true } },
      lineItems: true,
      payments: { orderBy: { createdAt: 'desc' as const } },
    };
  }

  private enrich(invoice: CollectionInvoice) {
    const daysPastDue = this.daysPastDue(invoice.dueDate);
    const hasPaymentLink = Boolean(
      invoice.paymentUrl ||
      invoice.payments.some((payment) => payment.checkoutUrl),
    );
    const pendingPayments = invoice.payments.filter(
      (payment) => payment.status === PaymentStatus.PENDING,
    ).length;
    const latestPayment = invoice.payments[0] ?? null;
    const collectionRisk = Math.min(
      100,
      (invoice.status === InvoiceStatus.OVERDUE ? 35 : 0) +
        Math.max(daysPastDue, 0) * 3 +
        (!hasPaymentLink ? 20 : 0) +
        (invoice.totalCents >= 50000
          ? 15
          : invoice.totalCents >= 20000
            ? 8
            : 0),
    );

    return {
      ...invoice,
      daysPastDue,
      agingBucket: this.agingBucket(daysPastDue),
      hasPaymentLink,
      latestPaymentStatus: latestPayment?.status ?? null,
      pendingPaymentAttempts: pendingPayments,
      collectionRisk,
    };
  }

  private bucket(
    key: string,
    label: string,
    invoices: Array<ReturnType<CollectionsService['enrich']>>,
  ) {
    return {
      key,
      label,
      count: invoices.length,
      totalCents: invoices.reduce(
        (sum, invoice) => sum + invoice.totalCents,
        0,
      ),
    };
  }

  private agingBucket(daysPastDue: number) {
    if (daysPastDue <= 0) return 'not_due';
    if (daysPastDue <= 7) return 'due_now';
    if (daysPastDue <= 14) return '8_14';
    return '15_plus';
  }

  private daysPastDue(dueDate: Date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  }

  private daysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
