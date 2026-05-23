import { Injectable } from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  BookingStatus,
  InvoiceStatus,
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
}
