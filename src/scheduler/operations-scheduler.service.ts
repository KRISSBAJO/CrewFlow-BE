import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationsSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OperationsSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.ENABLE_SCHEDULER !== 'true') {
      return;
    }
    const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 300000);
    this.timer = setInterval(() => {
      void this.runAllTenants('interval');
    }, intervalMs);
    this.timer.unref();
    void this.runAllTenants('startup');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runAllTenants(source = 'manual') {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    const results: Array<Awaited<ReturnType<typeof this.runTenantScans>>> = [];
    for (const tenant of tenants) {
      results.push(await this.runTenantScans(tenant.id, source));
    }
    this.logger.log(
      `Operational scans completed for ${results.length} tenants`,
    );
    return { scannedAt: new Date(), source, tenants: results };
  }

  async runTenantScans(tenantId: string, source = 'manual') {
    const [overdue, lostRevenue] = await Promise.all([
      this.scanOverdueInvoices(tenantId, source),
      this.scanLostRevenue(tenantId, source),
    ]);
    return { tenantId, overdue, lostRevenue };
  }

  private async scanOverdueInvoices(tenantId: string, source: string) {
    const now = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        dueDate: { lt: now },
      },
      include: { customer: true },
      take: 100,
    });

    for (const invoice of invoices) {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.OVERDUE },
      });
      await this.upsertAction({
        tenantId,
        type: ActionType.COLLECT_PAYMENT,
        priority: this.invoicePriority(invoice.dueDate, invoice.totalCents),
        title: `Collect overdue invoice ${invoice.invoiceNo}`,
        description: `${invoice.customer.name} owes $${(invoice.totalCents / 100).toFixed(2)}.`,
        customerId: invoice.customerId,
        bookingId: invoice.bookingId,
        invoiceId: invoice.id,
        dueAt: now,
        metadata: {
          source,
          totalCents: invoice.totalCents,
          dueDate: invoice.dueDate,
        },
      });
      await this.automations.trigger({
        tenantId,
        trigger: AutomationTrigger.INVOICE_DUE,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        bookingId: invoice.bookingId ?? undefined,
      });
    }

    if (invoices.length > 0) {
      await this.audit.record({
        tenantId,
        action: 'SCHEDULED_OVERDUE_SCAN',
        entityType: 'Invoice',
        summary: `Scheduled scan found ${invoices.length} overdue invoices`,
        metadata: { source, count: invoices.length },
      });
    }

    return { count: invoices.length };
  }

  private async scanLostRevenue(tenantId: string, source: string) {
    const now = new Date();
    const soon = new Date(now.getTime() + 24 * 60 * 60_000);
    const unassigned = await this.prisma.booking.findMany({
      where: {
        tenantId,
        status: BookingStatus.CONFIRMED,
        assignedStaffId: null,
        startTime: { gte: now, lte: soon },
      },
      include: { customer: true, service: true },
      take: 100,
    });
    const requested = await this.prisma.booking.findMany({
      where: {
        tenantId,
        status: BookingStatus.REQUESTED,
        startTime: { lte: soon },
      },
      include: { customer: true, service: true },
      take: 100,
    });

    for (const booking of unassigned) {
      await this.upsertAction({
        tenantId,
        type: ActionType.DISPATCH_STAFF,
        priority: ActionPriority.URGENT,
        title: 'Assign staff before appointment',
        description: `${booking.service.title} is coming up with no assigned staff.`,
        customerId: booking.customerId,
        bookingId: booking.id,
        dueAt: now,
        metadata: { source, riskCents: booking.service.priceCents },
      });
    }
    for (const booking of requested) {
      await this.upsertAction({
        tenantId,
        type: ActionType.CONFIRM_BOOKING,
        priority: ActionPriority.HIGH,
        title: 'Confirm pending booking',
        description: `${booking.customer.name} requested ${booking.service.title}.`,
        customerId: booking.customerId,
        bookingId: booking.id,
        dueAt: now,
        metadata: { source, riskCents: booking.service.priceCents },
      });
    }

    return { unassigned: unassigned.length, requested: requested.length };
  }

  private upsertAction(input: {
    tenantId: string;
    type: ActionType;
    priority: ActionPriority;
    title: string;
    description: string;
    customerId?: string | null;
    bookingId?: string | null;
    invoiceId?: string | null;
    dueAt: Date;
    metadata: Prisma.InputJsonValue;
  }) {
    const idempotencyKey = [
      input.type,
      input.bookingId ?? 'no-booking',
      input.invoiceId ?? 'no-invoice',
      input.customerId ?? 'no-customer',
    ].join(':');

    return this.prisma.operationalAction.upsert({
      where: {
        tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey },
      },
      create: {
        tenantId: input.tenantId,
        type: input.type,
        priority: input.priority,
        status: ActionStatus.OPEN,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        bookingId: input.bookingId,
        invoiceId: input.invoiceId,
        dueAt: input.dueAt,
        idempotencyKey,
        source: 'scheduler',
        metadata: input.metadata,
      },
      update: {
        priority: input.priority,
        status: ActionStatus.OPEN,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        metadata: input.metadata,
      },
    });
  }

  private invoicePriority(dueDate: Date, totalCents: number) {
    const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86400000);
    if (daysOverdue >= 7 || totalCents >= 100000) return ActionPriority.URGENT;
    if (daysOverdue >= 3 || totalCents >= 50000) return ActionPriority.HIGH;
    return ActionPriority.MEDIUM;
  }
}
