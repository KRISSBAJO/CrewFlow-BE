import { Injectable } from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  BookingIntentStatus,
  BookingStatus,
  ConversationStatus,
  InvoiceStatus,
  LeadStatus,
  MessageDirection,
  MessageProvider,
  SubscriptionStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async summary(tenantId: string, from?: string, to?: string) {
    const start = from ? new Date(from) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = to ? new Date(to) : new Date(start);
    end.setHours(23, 59, 59, 999);

    const [
      appointments,
      revenue,
      pendingInvoices,
      overdueInvoices,
      unpaidInvoiceValue,
      activeStaff,
      recentMessages,
      urgentActions,
      unassignedToday,
      pendingRequests,
      noShows,
      hotLeads,
      staleConversations,
      staleLeads,
      hotLeadValue,
      completedUnpaid,
      repeatBookingActions,
      winBackActions,
      tenant,
    ] = await Promise.all([
      this.prisma.booking.findMany({
        where: { tenantId, startTime: { gte: start, lte: end } },
        include: { customer: true, service: true, assignedStaff: true },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          status: InvoiceStatus.PAID,
          paidAt: { gte: start, lte: end },
        },
        _sum: { totalCents: true },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
          dueDate: { lt: new Date() },
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        },
        _sum: { totalCents: true },
      }),
      this.prisma.attendance.count({
        where: { tenantId, checkOut: null },
      }),
      this.prisma.messageLog.findMany({
        where: { tenantId },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.operationalAction.findMany({
        where: {
          tenantId,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
          priority: { in: [ActionPriority.HIGH, ActionPriority.URGENT] },
        },
        include: { customer: true, invoice: true, booking: true },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 8,
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          status: BookingStatus.CONFIRMED,
          assignedStaffId: null,
          startTime: { gte: start, lte: end },
        },
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          status: BookingStatus.REQUESTED,
          startTime: { gte: start, lte: end },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId,
          status: BookingStatus.NO_SHOW,
          startTime: { gte: start, lte: end },
        },
        include: { service: true, customer: true },
        take: 20,
      }),
      this.prisma.bookingIntent.count({
        where: {
          tenantId,
          status: {
            in: [BookingIntentStatus.READY, BookingIntentStatus.COLLECTING],
          },
          bookingId: null,
        },
      }),
      this.prisma.conversation.count({
        where: {
          tenantId,
          status: {
            in: [
              ConversationStatus.OPEN,
              ConversationStatus.WAITING_ON_CUSTOMER,
              ConversationStatus.BOOKING_READY,
            ],
          },
          lastMessageAt: { lt: this.hoursAgo(4) },
        },
      }),
      this.prisma.lead.count({
        where: {
          tenantId,
          status: {
            in: [
              LeadStatus.NEW,
              LeadStatus.CONTACTED,
              LeadStatus.QUALIFIED,
              LeadStatus.BOOKING_READY,
            ],
          },
          OR: [
            { followUpAt: { lte: new Date() } },
            { followUpAt: null, updatedAt: { lt: this.hoursAgo(6) } },
          ],
        },
      }),
      this.prisma.lead.aggregate({
        where: {
          tenantId,
          status: LeadStatus.BOOKING_READY,
        },
        _sum: { estimatedValueCents: true },
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          status: BookingStatus.COMPLETED,
          OR: [
            { invoice: null },
            { invoice: { status: { not: InvoiceStatus.PAID } } },
          ],
        },
      }),
      this.prisma.operationalAction.count({
        where: {
          tenantId,
          type: ActionType.SUGGEST_REPEAT_BOOKING,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.operationalAction.count({
        where: {
          tenantId,
          type: ActionType.WIN_BACK_CUSTOMER,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          subscriptionStatus: true,
          pastDueAt: true,
          nextBillingAt: true,
          planLimits: true,
        },
      }),
    ]);

    const noShowRiskCents = noShows.reduce(
      (sum, booking) => sum + booking.service.priceCents,
      0,
    );
    const unpaidTotalCents = unpaidInvoiceValue._sum.totalCents ?? 0;

    return {
      today: {
        from: start,
        to: end,
        appointments,
        confirmed: appointments.filter(
          (item) => item.status === BookingStatus.CONFIRMED,
        ).length,
      },
      revenue: {
        paidTotalCents: revenue._sum.totalCents ?? 0,
        unpaidTotalCents,
        noShowRiskCents,
        atRiskTotalCents: unpaidTotalCents + noShowRiskCents,
      },
      pendingInvoices,
      overdueInvoices,
      activeStaff,
      recentMessages,
      operations: {
        unassignedToday,
        pendingRequests,
        urgentActions,
        alerts: this.buildAlerts({
          overdueInvoices,
          unpaidTotalCents,
          noShowRiskCents,
          unassignedToday,
          pendingRequests,
          urgentActionCount: urgentActions.length,
          hotLeads,
          staleConversations,
          staleLeads,
          hotLeadValueCents: hotLeadValue._sum.estimatedValueCents ?? 0,
          completedUnpaid,
          repeatBookingActions,
          winBackActions,
          billingRisk: this.billingRisk(tenant, {
            activeStaff,
            hotLeads,
            monthlyBookings: await this.monthlyBookings(tenantId),
          }),
        }),
      },
    };
  }

  async weeklyDigest(user: AuthUser) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const [
      tenant,
      paidRevenue,
      openInvoices,
      overdueInvoices,
      completedBookings,
      upcomingBookings,
      noShows,
      leadsCreated,
      wonLeads,
      bookingReadyLeads,
      retentionActions,
      dispatchIssues,
      topActions,
    ] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { businessName: true, billingEmail: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId: user.tenantId,
          status: InvoiceStatus.PAID,
          paidAt: { gte: start, lte: end },
        },
        _sum: { totalCents: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId: user.tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        },
        _sum: { totalCents: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId: user.tenantId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
          dueDate: { lt: new Date() },
        },
        _sum: { totalCents: true },
        _count: true,
      }),
      this.prisma.booking.count({
        where: {
          tenantId: user.tenantId,
          status: BookingStatus.COMPLETED,
          startTime: { gte: start, lte: end },
        },
      }),
      this.prisma.booking.count({
        where: {
          tenantId: user.tenantId,
          status: { in: [BookingStatus.REQUESTED, BookingStatus.CONFIRMED] },
          startTime: { gt: end },
        },
      }),
      this.prisma.booking.findMany({
        where: {
          tenantId: user.tenantId,
          status: BookingStatus.NO_SHOW,
          startTime: { gte: start, lte: end },
        },
        include: { service: true },
      }),
      this.prisma.lead.count({
        where: {
          tenantId: user.tenantId,
          createdAt: { gte: start, lte: end },
        },
      }),
      this.prisma.lead.count({
        where: {
          tenantId: user.tenantId,
          status: LeadStatus.WON,
          updatedAt: { gte: start, lte: end },
        },
      }),
      this.prisma.lead.aggregate({
        where: {
          tenantId: user.tenantId,
          status: LeadStatus.BOOKING_READY,
        },
        _sum: { estimatedValueCents: true },
        _count: true,
      }),
      this.prisma.operationalAction.count({
        where: {
          tenantId: user.tenantId,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
          type: {
            in: [
              ActionType.SUGGEST_REPEAT_BOOKING,
              ActionType.WIN_BACK_CUSTOMER,
            ],
          },
        },
      }),
      this.prisma.operationalAction.count({
        where: {
          tenantId: user.tenantId,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
          type: {
            in: [ActionType.DISPATCH_STAFF, ActionType.RESOLVE_STAFF_CONFLICT],
          },
        },
      }),
      this.prisma.operationalAction.findMany({
        where: {
          tenantId: user.tenantId,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
        include: {
          customer: true,
          invoice: true,
          booking: { include: { service: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 8,
      }),
    ]);

    const noShowRiskCents = noShows.reduce(
      (sum, booking) => sum + booking.service.priceCents,
      0,
    );
    const digest = {
      businessName: tenant.businessName,
      recipient: tenant.billingEmail ?? user.email,
      period: {
        from: start.toISOString(),
        to: end.toISOString(),
      },
      metrics: {
        collectedCents: paidRevenue._sum.totalCents ?? 0,
        paidInvoiceCount: paidRevenue._count,
        openInvoiceCents: openInvoices._sum.totalCents ?? 0,
        openInvoiceCount: openInvoices._count,
        overdueInvoiceCents: overdueInvoices._sum.totalCents ?? 0,
        overdueInvoiceCount: overdueInvoices._count,
        completedBookings,
        upcomingBookings,
        noShowCount: noShows.length,
        noShowRiskCents,
        leadsCreated,
        wonLeads,
        bookingReadyLeadCount: bookingReadyLeads._count,
        bookingReadyLeadValueCents:
          bookingReadyLeads._sum.estimatedValueCents ?? 0,
        retentionActions,
        dispatchIssues,
      },
      topRisks: this.digestRisks({
        overdueInvoiceCount: overdueInvoices._count,
        overdueInvoiceCents: overdueInvoices._sum.totalCents ?? 0,
        noShowCount: noShows.length,
        noShowRiskCents,
        bookingReadyLeadCount: bookingReadyLeads._count,
        bookingReadyLeadValueCents:
          bookingReadyLeads._sum.estimatedValueCents ?? 0,
        retentionActions,
        dispatchIssues,
      }),
      recommendedActions: topActions.map((action) => ({
        id: action.id,
        title: action.title,
        priority: action.priority,
        type: action.type,
        dueAt: action.dueAt,
        customerName: action.customer?.name ?? null,
        invoiceNo: action.invoice?.invoiceNo ?? null,
        serviceTitle: action.booking?.service?.title ?? null,
      })),
    };

    return {
      ...digest,
      text: this.digestText(digest),
    };
  }

  async sendWeeklyDigest(user: AuthUser) {
    const digest = await this.weeklyDigest(user);
    const message = await this.prisma.messageLog.create({
      data: {
        tenantId: user.tenantId,
        direction: MessageDirection.OUTBOUND,
        provider: MessageProvider.EMAIL,
        content: digest.text,
        metadata: {
          kind: 'owner_weekly_digest',
          recipient: digest.recipient,
          period: digest.period,
          metrics: digest.metrics,
        },
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'OWNER_WEEKLY_DIGEST_SENT',
      entityType: 'MessageLog',
      entityId: message.id,
      summary: `Sent weekly owner digest to ${digest.recipient}`,
      metadata: {
        messageLogId: message.id,
        period: digest.period,
        recipient: digest.recipient,
      },
    });

    return { sentAt: new Date().toISOString(), message, digest };
  }

  private buildAlerts(input: {
    overdueInvoices: number;
    unpaidTotalCents: number;
    noShowRiskCents: number;
    unassignedToday: number;
    pendingRequests: number;
    urgentActionCount: number;
    hotLeads: number;
    staleConversations: number;
    staleLeads: number;
    hotLeadValueCents: number;
    completedUnpaid: number;
    repeatBookingActions: number;
    winBackActions: number;
    billingRisk: Array<{
      key: string;
      severity: 'info' | 'warning' | 'critical';
      title: string;
      value?: number;
    }>;
  }) {
    const alerts: Array<{
      key: string;
      severity: 'info' | 'warning' | 'critical';
      title: string;
      value?: number;
      amountCents?: number;
    }> = [];

    if (input.overdueInvoices > 0) {
      alerts.push({
        key: 'overdue-invoices',
        severity: 'critical',
        title: 'Overdue invoices need collection',
        value: input.overdueInvoices,
        amountCents: input.unpaidTotalCents,
      });
    }
    if (input.unassignedToday > 0) {
      alerts.push({
        key: 'unassigned-bookings',
        severity: 'critical',
        title: 'Appointments today need staff assigned',
        value: input.unassignedToday,
      });
    }
    if (input.pendingRequests > 0) {
      alerts.push({
        key: 'pending-requests',
        severity: 'warning',
        title: 'Booking requests are waiting for confirmation',
        value: input.pendingRequests,
      });
    }
    if (input.hotLeads > 0) {
      alerts.push({
        key: 'hot-leads',
        severity: 'critical',
        title: 'Receptionist leads are not booked yet',
        value: input.hotLeads,
        amountCents: input.hotLeadValueCents,
      });
    }
    if (input.staleLeads > 0) {
      alerts.push({
        key: 'stale-leads',
        severity: 'critical',
        title: 'Leads need follow-up today',
        value: input.staleLeads,
      });
    }
    if (input.completedUnpaid > 0) {
      alerts.push({
        key: 'completed-unpaid',
        severity: 'critical',
        title: 'Completed jobs still need payment',
        value: input.completedUnpaid,
      });
    }
    if (input.staleConversations > 0) {
      alerts.push({
        key: 'stale-conversations',
        severity: 'warning',
        title: 'Customer conversations need follow-up',
        value: input.staleConversations,
      });
    }
    if (input.winBackActions > 0) {
      alerts.push({
        key: 'winback-customers',
        severity: 'warning',
        title: 'Inactive customers are ready for win-back',
        value: input.winBackActions,
      });
    }
    if (input.repeatBookingActions > 0) {
      alerts.push({
        key: 'repeat-bookings',
        severity: 'info',
        title: 'Customers are ready to rebook',
        value: input.repeatBookingActions,
      });
    }
    if (input.noShowRiskCents > 0) {
      alerts.push({
        key: 'no-show-risk',
        severity: 'warning',
        title: 'No-show revenue risk detected',
        amountCents: input.noShowRiskCents,
      });
    }
    if (input.urgentActionCount > 0) {
      alerts.push({
        key: 'urgent-actions',
        severity: 'warning',
        title: 'Manager actions are open',
        value: input.urgentActionCount,
      });
    }
    alerts.push(...input.billingRisk);

    if (alerts.length === 0) {
      alerts.push({
        key: 'clear',
        severity: 'info',
        title: 'No major operational leaks detected',
      });
    }

    return alerts;
  }

  private billingRisk(
    tenant: {
      subscriptionStatus: SubscriptionStatus;
      pastDueAt?: Date | null;
      nextBillingAt?: Date | null;
      planLimits?: unknown;
    },
    usage: { activeStaff: number; hotLeads: number; monthlyBookings: number },
  ) {
    const alerts: Array<{
      key: string;
      severity: 'info' | 'warning' | 'critical';
      title: string;
      value?: number;
    }> = [];
    if (
      tenant.subscriptionStatus === SubscriptionStatus.PAST_DUE ||
      tenant.subscriptionStatus === SubscriptionStatus.UNPAID
    ) {
      alerts.push({
        key: 'billing-past-due',
        severity: 'critical',
        title: 'Subscription billing needs recovery',
      });
    }
    if (tenant.nextBillingAt) {
      const days = Math.ceil(
        (tenant.nextBillingAt.getTime() - Date.now()) / 86_400_000,
      );
      if (days >= 0 && days <= 3) {
        alerts.push({
          key: 'billing-renewal-soon',
          severity: 'info',
          title: 'Subscription renewal is coming up',
          value: days,
        });
      }
    }
    const limits = this.asPlanLimits(tenant.planLimits);
    const trackedUsage = {
      staff: usage.activeStaff,
      leads: usage.hotLeads,
      monthlyBookings: usage.monthlyBookings,
    };
    for (const [key, limit] of Object.entries(limits)) {
      const used = trackedUsage[key as keyof typeof trackedUsage];
      if (typeof used === 'number' && limit > 0 && used / limit >= 0.8) {
        alerts.push({
          key: `plan-usage-${key}`,
          severity: used >= limit ? 'critical' : 'warning',
          title:
            used >= limit
              ? `Plan limit reached: ${key}`
              : `Plan usage above 80%: ${key}`,
          value: used,
        });
      }
    }
    return alerts;
  }

  private async monthlyBookings(tenantId: string) {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return this.prisma.booking.count({
      where: { tenantId, startTime: { gte: start, lt: end } },
    });
  }

  private asPlanLimits(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, limit]) => typeof limit === 'number',
      ),
    ) as Record<string, number>;
  }

  private digestRisks(input: {
    overdueInvoiceCount: number;
    overdueInvoiceCents: number;
    noShowCount: number;
    noShowRiskCents: number;
    bookingReadyLeadCount: number;
    bookingReadyLeadValueCents: number;
    retentionActions: number;
    dispatchIssues: number;
  }) {
    const risks: Array<{
      title: string;
      severity: 'info' | 'warning' | 'critical';
      amountCents?: number;
      count?: number;
    }> = [];
    if (input.overdueInvoiceCount > 0) {
      risks.push({
        title: 'Overdue invoices need collection',
        severity: 'critical',
        count: input.overdueInvoiceCount,
        amountCents: input.overdueInvoiceCents,
      });
    }
    if (input.bookingReadyLeadCount > 0) {
      risks.push({
        title: 'Booking-ready leads still need conversion',
        severity: 'critical',
        count: input.bookingReadyLeadCount,
        amountCents: input.bookingReadyLeadValueCents,
      });
    }
    if (input.dispatchIssues > 0) {
      risks.push({
        title: 'Dispatch issues need owner/manager attention',
        severity: 'warning',
        count: input.dispatchIssues,
      });
    }
    if (input.retentionActions > 0) {
      risks.push({
        title: 'Repeat and win-back revenue is waiting',
        severity: 'info',
        count: input.retentionActions,
      });
    }
    if (input.noShowCount > 0) {
      risks.push({
        title: 'No-shows created revenue risk',
        severity: 'warning',
        count: input.noShowCount,
        amountCents: input.noShowRiskCents,
      });
    }
    return risks.length
      ? risks
      : [
          {
            title: 'No major revenue leaks detected this week',
            severity: 'info' as const,
          },
        ];
  }

  private digestText(digest: {
    businessName: string;
    period: { from: string; to: string };
    metrics: Record<string, number>;
    topRisks: Array<{ title: string; count?: number; amountCents?: number }>;
    recommendedActions: Array<{ title: string; priority: string }>;
  }) {
    const lines = [
      `${digest.businessName} weekly owner digest`,
      `${new Date(digest.period.from).toDateString()} - ${new Date(digest.period.to).toDateString()}`,
      '',
      `Collected: ${this.money(digest.metrics.collectedCents)} from ${digest.metrics.paidInvoiceCount} paid invoices`,
      `Open invoices: ${this.money(digest.metrics.openInvoiceCents)} across ${digest.metrics.openInvoiceCount} invoices`,
      `Overdue: ${this.money(digest.metrics.overdueInvoiceCents)} across ${digest.metrics.overdueInvoiceCount} invoices`,
      `Bookings: ${digest.metrics.completedBookings} completed, ${digest.metrics.upcomingBookings} upcoming`,
      `Leads: ${digest.metrics.leadsCreated} new, ${digest.metrics.wonLeads} won, ${digest.metrics.bookingReadyLeadCount} booking-ready`,
      '',
      'Top risks:',
      ...digest.topRisks.map(
        (risk) =>
          `- ${risk.title}${risk.count ? ` (${risk.count})` : ''}${risk.amountCents ? ` - ${this.money(risk.amountCents)}` : ''}`,
      ),
      '',
      'Recommended actions:',
      ...(digest.recommendedActions.length
        ? digest.recommendedActions.map(
            (action) => `- [${action.priority}] ${action.title}`,
          )
        : ['- No urgent owner actions right now']),
    ];
    return lines.join('\n');
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  }

  private hoursAgo(hours: number) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }
}
