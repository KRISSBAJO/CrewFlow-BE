import { Injectable } from '@nestjs/common';
import { BookingStatus, InvoiceStatus } from '@prisma/client';
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
      activeStaff,
      recentMessages,
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
      this.prisma.attendance.count({
        where: { tenantId, checkOut: null },
      }),
      this.prisma.messageLog.findMany({
        where: { tenantId },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

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
      },
      pendingInvoices,
      activeStaff,
      recentMessages,
    };
  }
}
