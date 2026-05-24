import { Injectable } from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
  MessageProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { MessagesService } from '../messages/messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { RevenueCampaignType, SendCampaignDto } from './dto/send-campaign.dto';

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  async summary(user: AuthUser) {
    assertManager(user);
    return this.buildSummary(user.tenantId);
  }

  async revenueEngine(user: AuthUser) {
    assertManager(user);
    const profiles = await this.customerRevenueProfiles(user.tenantId);
    const enriched = profiles.map((profile) =>
      this.enrichRevenueProfile(profile),
    );
    const segments = this.segmentCustomers(enriched);
    const nextBestActions = enriched
      .filter((profile) => profile.nextBestAction.type !== 'NONE')
      .sort(
        (a, b) =>
          b.nextBestAction.priorityScore - a.nextBestAction.priorityScore ||
          b.lifetimeValueCents - a.lifetimeValueCents,
      )
      .slice(0, 30);

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        customers: enriched.length,
        lifetimeValueCents: enriched.reduce(
          (sum, profile) => sum + profile.lifetimeValueCents,
          0,
        ),
        openInvoiceCents: enriched.reduce(
          (sum, profile) => sum + profile.openInvoiceCents,
          0,
        ),
        repeatReadyCents: segments.repeatReady.reduce(
          (sum, profile) => sum + profile.estimatedNextValueCents,
          0,
        ),
        winBackCents: segments.inactive.reduce(
          (sum, profile) => sum + profile.estimatedNextValueCents,
          0,
        ),
        highValueCount: segments.highValue.length,
        atRiskCount: enriched.filter((profile) => profile.riskScore >= 65)
          .length,
      },
      segments,
      nextBestActions,
      customers: enriched,
    };
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

  async sendCampaign(user: AuthUser, dto: SendCampaignDto) {
    assertManager(user);
    const profiles = await this.customerRevenueProfiles(user.tenantId);
    const selected = profiles
      .filter((profile) => dto.customerIds.includes(profile.customer.id))
      .slice(0, 50);

    const provider = dto.provider ?? MessageProvider.WHATSAPP;
    const sent: unknown[] = [];
    for (const profile of selected) {
      const message = await this.messages.send(user, {
        customerId: profile.customer.id,
        provider,
        content: this.campaignMessage(dto.type, profile, dto.note),
      });
      sent.push({
        customerId: profile.customer.id,
        messageId: message.message.id,
      });
    }

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'RETENTION_CAMPAIGN_SENT',
      entityType: 'Customer',
      summary: `Sent ${dto.type} campaign to ${sent.length} customers`,
      metadata: {
        type: dto.type,
        provider,
        customerIds: selected.map((profile) => profile.customer.id),
        sent,
      } as Prisma.InputJsonValue,
    });

    return {
      sentAt: new Date().toISOString(),
      type: dto.type,
      provider,
      requested: dto.customerIds.length,
      sent: sent.length,
      items: sent,
    };
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

  private enrichRevenueProfile(
    profile: Awaited<
      ReturnType<RetentionService['customerRevenueProfiles']>
    >[number],
  ) {
    const segmentTags = this.segmentTags(profile);
    const riskScore = this.customerRiskScore(profile);
    return {
      ...profile,
      segmentTags,
      riskScore,
      nextBestAction: this.nextBestAction(profile, riskScore),
    };
  }

  private segmentCustomers(
    customers: Array<ReturnType<RetentionService['enrichRevenueProfile']>>,
  ) {
    return {
      highValue: customers
        .filter((customer) => customer.segmentTags.includes('high_value'))
        .slice(0, 12),
      overduePayers: customers
        .filter((customer) => customer.segmentTags.includes('overdue_payer'))
        .slice(0, 12),
      inactive: customers
        .filter((customer) => customer.segmentTags.includes('inactive'))
        .slice(0, 12),
      repeatReady: customers
        .filter((customer) => customer.segmentTags.includes('repeat_ready'))
        .slice(0, 12),
      newCustomers: customers
        .filter((customer) => customer.segmentTags.includes('new_customer'))
        .slice(0, 12),
    };
  }

  private segmentTags(
    profile: Awaited<
      ReturnType<RetentionService['customerRevenueProfiles']>
    >[number],
  ) {
    const tags: string[] = [];
    if (profile.lifetimeValueCents >= 50000 || profile.completedBookings >= 3) {
      tags.push('high_value');
    }
    if (profile.openInvoiceCents > 0) tags.push('overdue_payer');
    if (
      profile.completedBookings >= 1 &&
      profile.daysSinceLastBooking >= 60 &&
      !profile.hasFutureBooking
    ) {
      tags.push('inactive');
    }
    if (
      profile.completedBookings >= 1 &&
      profile.daysSinceLastBooking >= 14 &&
      profile.daysSinceLastBooking < 60 &&
      !profile.hasFutureBooking
    ) {
      tags.push('repeat_ready');
    }
    if (profile.completedBookings === 0 && profile.paidTotalCents === 0) {
      tags.push('new_customer');
    }
    return tags.length ? tags : ['active'];
  }

  private customerRiskScore(
    profile: Awaited<
      ReturnType<RetentionService['customerRevenueProfiles']>
    >[number],
  ) {
    return Math.min(
      100,
      (profile.openInvoiceCents > 0 ? 35 : 0) +
        (profile.daysSinceLastBooking >= 90
          ? 35
          : profile.daysSinceLastBooking >= 60
            ? 25
            : profile.daysSinceLastBooking >= 30
              ? 12
              : 0) +
        (profile.completedBookings >= 2 && !profile.hasFutureBooking ? 15 : 0) +
        (profile.lifetimeValueCents >= 50000 ? 15 : 0),
    );
  }

  private nextBestAction(
    profile: Awaited<
      ReturnType<RetentionService['customerRevenueProfiles']>
    >[number],
    riskScore: number,
  ) {
    if (profile.openInvoiceCents > 0) {
      return {
        type: 'COLLECT_PAYMENT',
        label: 'Recover open invoice',
        message: `${profile.customer.name} has ${this.money(profile.openInvoiceCents)} open. Collect payment before offering more work.`,
        priorityScore: riskScore + 25,
      };
    }
    if (
      profile.completedBookings >= 1 &&
      profile.daysSinceLastBooking >= 60 &&
      !profile.hasFutureBooking
    ) {
      return {
        type: 'WIN_BACK',
        label: 'Send win-back',
        message: `Offer ${profile.customer.name} a simple return slot for ${profile.serviceTitle}.`,
        priorityScore: riskScore + 15,
      };
    }
    if (
      profile.completedBookings >= 1 &&
      profile.daysSinceLastBooking >= 14 &&
      !profile.hasFutureBooking
    ) {
      return {
        type: 'REBOOK',
        label: 'Offer repeat booking',
        message: `Suggest another ${profile.serviceTitle} while the timing is right.`,
        priorityScore: riskScore + 10,
      };
    }
    if (profile.lifetimeValueCents >= 50000) {
      return {
        type: 'VIP_CHECK_IN',
        label: 'VIP check-in',
        message: `Protect a high-value customer with a personal check-in.`,
        priorityScore: 55,
      };
    }
    return {
      type: 'NONE',
      label: 'No action',
      message: 'Customer is healthy right now.',
      priorityScore: 0,
    };
  }

  private campaignMessage(
    type: RevenueCampaignType,
    profile: Awaited<
      ReturnType<RetentionService['customerRevenueProfiles']>
    >[number],
    note?: string,
  ) {
    const base =
      type === RevenueCampaignType.REBOOKING
        ? `Hi ${profile.customer.name}, would you like us to reserve another ${profile.serviceTitle} appointment for you?`
        : type === RevenueCampaignType.WIN_BACK
          ? `Hi ${profile.customer.name}, it has been a while since your last ${profile.serviceTitle}. We would be happy to help again this week.`
          : type === RevenueCampaignType.PAYMENT_RECOVERY
            ? `Hi ${profile.customer.name}, a quick reminder that your account has an open balance of ${this.money(profile.openInvoiceCents)}.`
            : `Hi ${profile.customer.name}, checking in to make sure everything is still running smoothly for you.`;

    return [base, note].filter(Boolean).join(' ');
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
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
