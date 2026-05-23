import { Injectable } from '@nestjs/common';
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
import type { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
    private readonly audit: AuditService,
  ) {}

  async summary(user: AuthUser) {
    assertManager(user);
    return this.buildSummary(user.tenantId);
  }

  async scan(user: AuthUser) {
    assertManager(user);
    const result = await this.scanTenant(user.tenantId, 'manual-api', user.sub);
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'RETENTION_SCAN',
      entityType: 'Customer',
      summary: `Scanned retention opportunities and found ${result.actionsCreatedOrUpdated}`,
      metadata: {
        source: result.source,
        repeatCandidates: result.repeatCandidates,
        winBackCandidates: result.winBackCandidates,
        actionsCreatedOrUpdated: result.actionsCreatedOrUpdated,
      },
    });
    return result;
  }

  async scanTenant(tenantId: string, source = 'scheduler', actorId?: string) {
    const [repeatCandidates, winBackCandidates] = await Promise.all([
      this.repeatBookingCandidates(tenantId),
      this.winBackCandidates(tenantId),
    ]);
    const actions: unknown[] = [];

    for (const candidate of repeatCandidates) {
      actions.push(
        await this.upsertAction({
          tenantId,
          type: ActionType.SUGGEST_REPEAT_BOOKING,
          priority:
            candidate.daysSinceLastBooking >= 21
              ? ActionPriority.HIGH
              : ActionPriority.MEDIUM,
          title: `Suggest repeat booking for ${candidate.customer.name}`,
          description: `${candidate.customer.name} last booked ${candidate.serviceTitle}. Offer a convenient repeat appointment.`,
          customerId: candidate.customer.id,
          dueAt: new Date(),
          metadata: {
            source,
            lastBookingId: candidate.lastBookingId,
            serviceTitle: candidate.serviceTitle,
            daysSinceLastBooking: candidate.daysSinceLastBooking,
            lifetimeValueCents: candidate.lifetimeValueCents,
            recommendation: candidate.recommendation,
          },
        }),
      );
      await this.automations.trigger({
        tenantId,
        trigger: AutomationTrigger.REBOOKING_REMINDER,
        customerId: candidate.customer.id,
      });
    }

    for (const candidate of winBackCandidates) {
      actions.push(
        await this.upsertAction({
          tenantId,
          type: ActionType.WIN_BACK_CUSTOMER,
          priority:
            candidate.lifetimeValueCents >= 50000
              ? ActionPriority.HIGH
              : ActionPriority.MEDIUM,
          title: `Win back ${candidate.customer.name}`,
          description: `${candidate.customer.name} has been inactive for ${candidate.daysSinceLastBooking} days. Send a personal follow-up.`,
          customerId: candidate.customer.id,
          dueAt: new Date(),
          metadata: {
            source,
            serviceTitle: candidate.serviceTitle,
            daysSinceLastBooking: candidate.daysSinceLastBooking,
            lifetimeValueCents: candidate.lifetimeValueCents,
            recommendation: candidate.recommendation,
          },
        }),
      );
      await this.automations.trigger({
        tenantId,
        trigger: AutomationTrigger.CUSTOMER_WINBACK,
        customerId: candidate.customer.id,
      });
    }

    return {
      scannedAt: new Date(),
      source,
      actorId,
      repeatCandidates: repeatCandidates.length,
      winBackCandidates: winBackCandidates.length,
      actionsCreatedOrUpdated: actions.length,
      actions,
    };
  }

  private async buildSummary(tenantId: string) {
    const [repeatCandidates, winBackCandidates, topCustomers, paidRevenue] =
      await Promise.all([
        this.repeatBookingCandidates(tenantId),
        this.winBackCandidates(tenantId),
        this.topCustomers(tenantId),
        this.prisma.invoice.aggregate({
          where: { tenantId, status: InvoiceStatus.PAID },
          _sum: { totalCents: true },
        }),
      ]);

    const retainedRevenueCents = topCustomers.reduce(
      (sum, customer) => sum + customer.paidTotalCents,
      0,
    );
    const repeatOpportunityCents = repeatCandidates.reduce(
      (sum, customer) => sum + customer.estimatedNextValueCents,
      0,
    );
    const winBackOpportunityCents = winBackCandidates.reduce(
      (sum, customer) => sum + customer.estimatedNextValueCents,
      0,
    );

    return {
      retainedRevenueCents,
      paidRevenueCents: paidRevenue._sum.totalCents ?? 0,
      repeatOpportunityCents,
      winBackOpportunityCents,
      repeatCandidates,
      winBackCandidates,
      topCustomers,
    };
  }

  private async repeatBookingCandidates(tenantId: string) {
    const customers = await this.customerRevenueProfiles(tenantId);
    return customers
      .filter(
        (profile) =>
          profile.completedBookings >= 1 &&
          profile.daysSinceLastBooking >= 14 &&
          profile.daysSinceLastBooking < 60 &&
          !profile.hasFutureBooking,
      )
      .slice(0, 25);
  }

  private async winBackCandidates(tenantId: string) {
    const customers = await this.customerRevenueProfiles(tenantId);
    return customers
      .filter(
        (profile) =>
          profile.completedBookings >= 1 &&
          profile.daysSinceLastBooking >= 60 &&
          !profile.hasFutureBooking,
      )
      .slice(0, 25);
  }

  private async topCustomers(tenantId: string) {
    const customers = await this.customerRevenueProfiles(tenantId);
    return customers
      .filter((profile) => profile.paidTotalCents > 0)
      .sort((a, b) => b.paidTotalCents - a.paidTotalCents)
      .slice(0, 10);
  }

  private async customerRevenueProfiles(tenantId: string) {
    const now = new Date();
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      include: {
        bookings: {
          include: { service: true },
          orderBy: { startTime: 'desc' },
        },
        invoices: true,
      },
      take: 500,
    });

    return customers.map((customer) => {
      const completed = customer.bookings.filter(
        (booking) => booking.status === BookingStatus.COMPLETED,
      );
      const lastBooking =
        completed[0] ??
        customer.bookings.find((booking) => booking.startTime <= now);
      const futureBooking = customer.bookings.find(
        (booking) =>
          booking.startTime > now &&
          booking.status !== BookingStatus.CANCELLED &&
          booking.status !== BookingStatus.NO_SHOW,
      );
      const paidTotalCents = customer.invoices
        .filter((invoice) => invoice.status === InvoiceStatus.PAID)
        .reduce((sum, invoice) => sum + invoice.totalCents, 0);
      const openInvoiceCents = customer.invoices
        .filter(
          (invoice) =>
            invoice.status === InvoiceStatus.SENT ||
            invoice.status === InvoiceStatus.OVERDUE,
        )
        .reduce((sum, invoice) => sum + invoice.totalCents, 0);
      const estimatedNextValueCents =
        lastBooking?.service.priceCents ??
        Math.round(paidTotalCents / Math.max(1, completed.length || 1));
      const daysSinceLastBooking = lastBooking
        ? Math.floor(
            (now.getTime() - lastBooking.startTime.getTime()) / 86_400_000,
          )
        : 9999;

      return {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        },
        completedBookings: completed.length,
        paidTotalCents,
        openInvoiceCents,
        lastBookingAt: lastBooking?.startTime ?? null,
        lastBookingId: lastBooking?.id ?? null,
        serviceTitle: lastBooking?.service.title ?? 'service',
        daysSinceLastBooking,
        hasFutureBooking: Boolean(futureBooking),
        estimatedNextValueCents,
        lifetimeValueCents: paidTotalCents,
        recommendation:
          daysSinceLastBooking >= 60
            ? 'Send win-back offer'
            : 'Offer repeat booking',
      };
    });
  }

  private upsertAction(input: {
    tenantId: string;
    type: ActionType;
    priority: ActionPriority;
    title: string;
    description: string;
    customerId: string;
    dueAt: Date;
    metadata: Prisma.InputJsonValue;
  }) {
    return this.prisma.operationalAction.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: [input.type, input.customerId].join(':'),
        },
      },
      create: {
        tenantId: input.tenantId,
        type: input.type,
        priority: input.priority,
        status: ActionStatus.OPEN,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        dueAt: input.dueAt,
        source: 'retention',
        idempotencyKey: [input.type, input.customerId].join(':'),
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
}
