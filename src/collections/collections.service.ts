import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
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

  async runAutomation(user: AuthUser) {
    assertManager(user);
    const now = new Date();
    const [collectionResult, receiptResult, promiseResult] = await Promise.all([
      this.runCollectionCadence(user, now),
      this.runReceiptRecovery(user, now),
      this.runPromiseFollowUps(user, now),
    ]);

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'COLLECTION_AUTOMATION_RUN',
      entityType: 'Invoice',
      summary: `Ran collections automation: ${collectionResult.messagesSent} reminders, ${receiptResult.receiptsSent} receipts, ${promiseResult.actionsCreatedOrUpdated} promise follow-ups`,
      metadata: {
        collectionResult,
        receiptResult,
        promiseResult,
      } as Prisma.InputJsonValue,
    });

    return {
      scannedAt: now.toISOString(),
      ...collectionResult,
      receiptsSent: receiptResult.receiptsSent,
      promiseFollowUpsCreatedOrUpdated: promiseResult.actionsCreatedOrUpdated,
      receiptItems: receiptResult.items,
      promiseItems: promiseResult.items,
    };
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

  private async runCollectionCadence(user: AuthUser, now: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
      },
      include: this.includeInvoice(),
      orderBy: [{ dueDate: 'asc' }, { totalCents: 'desc' }],
      take: 200,
    });

    const items: unknown[] = [];
    let messagesSent = 0;
    let actionsCreatedOrUpdated = 0;
    let paymentLinksCreated = 0;

    for (const invoice of invoices) {
      const stage = this.collectionStage(invoice, now);
      if (!stage) continue;

      const alreadyRan = await this.hasAuditForStage(
        user.tenantId,
        invoice.id,
        stage.key,
      );
      if (alreadyRan) continue;

      const freshInvoice = invoice.paymentUrl
        ? invoice
        : (await this.payments.createInvoicePaymentLink(user, invoice.id, {}))
            .invoice;
      if (!invoice.paymentUrl) paymentLinksCreated += 1;

      if (stage.sendMessage) {
        const message = await this.sendCollectionMessage(user, freshInvoice, {
          type: CollectionActionType.SEND_REMINDER,
          provider: MessageProvider.WHATSAPP,
          note: stage.note,
        });
        messagesSent += 1;
        items.push({
          invoiceId: freshInvoice.id,
          invoiceNo: freshInvoice.invoiceNo,
          stage: stage.key,
          messageId: message.message.id,
        });
      }

      if (stage.createAction) {
        await this.upsertCollectionAction({
          tenantId: user.tenantId,
          invoice: freshInvoice,
          priority: stage.priority,
          title: stage.title,
          description: stage.description,
          dueAt: now,
          idempotencyKey: `collections:${freshInvoice.id}:${stage.key}`,
          metadata: {
            stage: stage.key,
            daysPastDue: this.daysPastDue(freshInvoice.dueDate),
            totalCents: freshInvoice.totalCents,
          },
        });
        actionsCreatedOrUpdated += 1;
      }

      await this.audit.record({
        tenantId: user.tenantId,
        actorId: user.sub,
        action: 'COLLECTION_AUTOMATION_STAGE',
        entityType: 'Invoice',
        entityId: freshInvoice.id,
        summary: `Ran collection stage ${stage.key} for ${freshInvoice.invoiceNo}`,
        metadata: {
          invoiceId: freshInvoice.id,
          stage: stage.key,
          paymentLinkReady: Boolean(freshInvoice.paymentUrl),
        },
      });
    }

    return {
      invoicesScanned: invoices.length,
      messagesSent,
      actionsCreatedOrUpdated,
      paymentLinksCreated,
      items,
    };
  }

  private async runReceiptRecovery(user: AuthUser, now: Date) {
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId: user.tenantId,
        status: PaymentStatus.SUCCEEDED,
        paidAt: { gte: this.daysAgo(30) },
      },
      include: { invoice: { include: { customer: true } } },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });

    const items: unknown[] = [];
    for (const payment of payments) {
      const receiptSent = await this.prisma.auditLog.findFirst({
        where: {
          tenantId: user.tenantId,
          action: 'PAYMENT_RECEIPT_SENT',
          entityType: 'Payment',
          entityId: payment.id,
        },
        select: { id: true },
      });
      if (receiptSent) continue;

      const sent = await this.payments.sendReceipt(user, payment.id, {
        provider: MessageProvider.WHATSAPP,
        note: 'Thank you. Your payment has been received.',
      });
      items.push({
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNo: payment.invoice.invoiceNo,
        messageId: sent.message.id,
      });
    }

    return {
      scannedAt: now.toISOString(),
      paymentsScanned: payments.length,
      receiptsSent: items.length,
      items,
    };
  }

  private async runPromiseFollowUps(user: AuthUser, now: Date) {
    const promiseAudits = await this.prisma.auditLog.findMany({
      where: {
        tenantId: user.tenantId,
        action: 'COLLECTION_PROMISE_TO_PAY',
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const duePromises = promiseAudits.filter((audit) => {
      const metadata = this.asRecord(audit.metadata);
      const promiseDate = this.stringValue(metadata.promiseDate);
      return promiseDate ? new Date(promiseDate) <= now : false;
    });

    const items: unknown[] = [];
    for (const audit of duePromises) {
      const metadata = this.asRecord(audit.metadata);
      const invoiceId = this.stringValue(metadata.invoiceId) ?? audit.entityId;
      const promiseDate = this.stringValue(metadata.promiseDate);
      const note = this.stringValue(metadata.note);
      if (!invoiceId) continue;

      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          tenantId: user.tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        },
        include: this.includeInvoice(),
      });
      if (!invoice) continue;

      const action = await this.upsertCollectionAction({
        tenantId: user.tenantId,
        invoice,
        priority: ActionPriority.HIGH,
        title: `Follow up promised payment ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} promised to pay ${this.money(invoice.totalCents)}. Follow up now and close the loop.`,
        dueAt: now,
        idempotencyKey: `collections:${invoice.id}:promise-follow-up`,
        metadata: {
          promiseDate,
          note,
          promiseAuditId: audit.id,
        },
      });

      items.push({
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        actionId: action.id,
      });
    }

    return {
      promisesScanned: promiseAudits.length,
      actionsCreatedOrUpdated: items.length,
      items,
    };
  }

  private collectionStage(invoice: CollectionInvoice, now: Date) {
    const daysPastDue = this.daysPastDue(invoice.dueDate);
    const dueSoon =
      daysPastDue < 0 &&
      invoice.dueDate.getTime() - now.getTime() <= 2 * 86_400_000;

    if (dueSoon) {
      return {
        key: 'due-soon',
        sendMessage: false,
        createAction: false,
        note: '',
        priority: ActionPriority.LOW,
        title: '',
        description: '',
      };
    }
    if (daysPastDue === 0) {
      return {
        key: 'due-today',
        sendMessage: true,
        createAction: invoice.totalCents >= 50000,
        note: 'This invoice is due today.',
        priority: ActionPriority.MEDIUM,
        title: `Collect invoice due today ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} has an invoice due today for ${this.money(invoice.totalCents)}.`,
      };
    }
    if (daysPastDue >= 3 && daysPastDue < 7) {
      return {
        key: 'overdue-3',
        sendMessage: true,
        createAction: true,
        note: 'This invoice is now overdue. Please complete payment when you can.',
        priority: ActionPriority.HIGH,
        title: `Collect overdue invoice ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} is ${daysPastDue} days past due for ${this.money(invoice.totalCents)}.`,
      };
    }
    if (daysPastDue >= 7 && daysPastDue < 14) {
      return {
        key: 'overdue-7',
        sendMessage: true,
        createAction: true,
        note: 'This invoice is one week overdue. Please pay today or reply if you need help.',
        priority: ActionPriority.URGENT,
        title: `Escalate overdue invoice ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} is one week past due. Escalate collection and confirm payment intent.`,
      };
    }
    if (daysPastDue >= 14) {
      return {
        key: 'overdue-14',
        sendMessage: false,
        createAction: true,
        note: '',
        priority: ActionPriority.URGENT,
        title: `Final collection review ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} is ${daysPastDue} days past due. Decide whether to call, pause service, or write off.`,
      };
    }

    return null;
  }

  private async hasAuditForStage(
    tenantId: string,
    invoiceId: string,
    stage: string,
  ) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: 'COLLECTION_AUTOMATION_STAGE',
        entityId: invoiceId,
        metadata: { path: ['stage'], equals: stage },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private upsertCollectionAction(input: {
    tenantId: string;
    invoice: CollectionInvoice;
    priority: ActionPriority;
    title: string;
    description: string;
    dueAt: Date;
    idempotencyKey: string;
    metadata: Prisma.InputJsonValue;
  }) {
    return this.prisma.operationalAction.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      update: {
        priority: input.priority,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        status: ActionStatus.OPEN,
        dismissedAt: null,
        completedAt: null,
        metadata: input.metadata,
      },
      create: {
        tenantId: input.tenantId,
        type: ActionType.COLLECT_PAYMENT,
        priority: input.priority,
        title: input.title,
        description: input.description,
        customerId: input.invoice.customerId,
        bookingId: input.invoice.bookingId,
        invoiceId: input.invoice.id,
        dueAt: input.dueAt,
        source: 'collections',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    });
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

  private stringValue(value: unknown) {
    return typeof value === 'string' ? value : undefined;
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
