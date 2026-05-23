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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

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
          status: { in: [BookingIntentStatus.READY, BookingIntentStatus.COLLECTING] },
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
          OR: [{ invoice: null }, { invoice: { status: { not: InvoiceStatus.PAID } } }],
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
        }),
      },
    };
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

    if (alerts.length === 0) {
      alerts.push({
        key: 'clear',
        severity: 'info',
        title: 'No major operational leaks detected',
      });
    }

    return alerts;
  }

  private hoursAgo(hours: number) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }
}
