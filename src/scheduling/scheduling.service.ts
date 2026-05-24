import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, TenantStatus, UserRole } from '@prisma/client';
import { addMinutes } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';

type BusinessHours = Record<string, string> | null | undefined;
type SchedulingRisk = ReturnType<SchedulingService['risk']>;
type Slot = {
  startTime: Date;
  endTime: Date;
  available: boolean;
  staffId?: string;
  staffName?: string;
  reason?: string;
};

@Injectable()
export class SchedulingService {
  private readonly activeStatuses: BookingStatus[] = [
    BookingStatus.REQUESTED,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
  ];

  constructor(private readonly prisma: PrismaService) {}

  async publicAvailability(slug: string, serviceId: string, date: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!tenant || !this.isBookableTenant(tenant.status)) {
      throw new NotFoundException('Booking page not available');
    }
    return this.tenantAvailability(tenant.id, serviceId, date);
  }

  async tenantAvailability(tenantId: string, serviceId: string, date: string) {
    const { service, config } = await this.loadServiceContext(
      tenantId,
      serviceId,
    );
    const day = this.parseDay(date);
    const staff = await this.staffForTenant(tenantId);
    const bookings = await this.bookingsForDay(tenantId, day);
    const windows = this.businessWindows(
      day,
      this.asBusinessHours(config?.businessHours),
    );
    const slots: Slot[] = [];
    const bufferMinutes = config?.bookingBufferMinutes ?? 30;
    const maxAdvanceDays = config?.maxAdvanceDays ?? 30;
    const earliest = addMinutes(new Date(), bufferMinutes);
    const latest = new Date();
    latest.setDate(latest.getDate() + maxAdvanceDays);

    for (const window of windows) {
      for (
        let cursor = new Date(window.start);
        addMinutes(cursor, service.durationMinutes) <= window.end;
        cursor = addMinutes(cursor, 30)
      ) {
        const endTime = addMinutes(cursor, service.durationMinutes);
        const inWindow = cursor >= earliest && cursor <= latest;
        const candidates = staff
          .filter((member) =>
            this.isStaffAvailable(member.id, cursor, endTime, bookings),
          )
          .sort(
            (a, b) =>
              this.dailyMinutes(a.id, bookings) -
              this.dailyMinutes(b.id, bookings),
          );
        slots.push({
          startTime: new Date(cursor),
          endTime,
          available: inWindow && candidates.length > 0,
          staffId: candidates[0]?.id,
          staffName: candidates[0]?.name,
          reason: !inWindow
            ? 'Outside booking window'
            : candidates.length
              ? undefined
              : 'No staff available',
        });
      }
    }

    return {
      date: day.toISOString().slice(0, 10),
      service: {
        id: service.id,
        title: service.title,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
      },
      rules: {
        slotMinutes: 30,
        bookingBufferMinutes: bufferMinutes,
        maxAdvanceDays,
      },
      slots,
      recommended: slots.find((slot) => slot.available) ?? null,
    };
  }

  async staffSuggestions(
    tenantId: string,
    serviceId: string,
    startTimeValue: string,
  ) {
    const { service } = await this.loadServiceContext(tenantId, serviceId);
    const startTime = new Date(startTimeValue);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('Invalid start time');
    }
    const endTime = addMinutes(startTime, service.durationMinutes);
    const day = new Date(startTime);
    day.setHours(0, 0, 0, 0);
    const [staff, bookings] = await Promise.all([
      this.staffForTenant(tenantId),
      this.bookingsForDay(tenantId, day),
    ]);

    return staff
      .map((member) => {
        const conflicts = bookings.filter(
          (booking) =>
            booking.assignedStaffId === member.id &&
            booking.startTime < endTime &&
            (booking.endTime ?? addMinutes(booking.startTime, 60)) > startTime,
        );
        return {
          ...member,
          available: conflicts.length === 0,
          dailyMinutes: this.dailyMinutes(member.id, bookings),
          conflicts,
          score:
            (conflicts.length === 0 ? 100 : 0) -
            Math.min(
              50,
              Math.round(this.dailyMinutes(member.id, bookings) / 30),
            ),
        };
      })
      .sort(
        (a, b) =>
          Number(b.available) - Number(a.available) || b.score - a.score,
      );
  }

  async conflicts(tenantId: string, date?: string) {
    const day = this.parseDay(date ?? new Date().toISOString().slice(0, 10));
    const [bookings, config] = await Promise.all([
      this.bookingsForDay(tenantId, day),
      this.prisma.receptionistConfig.findUnique({ where: { tenantId } }),
    ]);
    const windows = this.businessWindows(
      day,
      this.asBusinessHours(config?.businessHours),
    );
    const risks: SchedulingRisk[] = [];

    for (const booking of bookings) {
      if (
        !booking.assignedStaffId &&
        booking.status !== BookingStatus.CANCELLED
      ) {
        risks.push(
          this.risk(booking, 'UNASSIGNED', 'Booking has no assigned crew', 80),
        );
      }
      const endTime =
        booking.endTime ??
        addMinutes(booking.startTime, booking.service.durationMinutes);
      const insideHours = windows.some(
        (window) => booking.startTime >= window.start && endTime <= window.end,
      );
      if (!insideHours) {
        risks.push(
          this.risk(
            booking,
            'OUTSIDE_HOURS',
            'Booking is outside business hours',
            55,
          ),
        );
      }
      const overlaps = bookings.filter(
        (other) =>
          other.id !== booking.id &&
          other.assignedStaffId &&
          other.assignedStaffId === booking.assignedStaffId &&
          this.activeStatuses.includes(other.status) &&
          other.startTime < endTime &&
          (other.endTime ??
            addMinutes(other.startTime, other.service.durationMinutes)) >
            booking.startTime,
      );
      if (overlaps.length) {
        risks.push(
          this.risk(
            booking,
            'STAFF_OVERLAP',
            `Crew overlaps with ${overlaps.length} booking${overlaps.length === 1 ? '' : 's'}`,
            95,
          ),
        );
      }
    }

    return {
      date: day.toISOString().slice(0, 10),
      summary: {
        bookings: bookings.length,
        risks: risks.length,
        critical: risks.filter((risk) => risk.score >= 80).length,
      },
      risks,
    };
  }

  private async loadServiceContext(tenantId: string, serviceId: string) {
    const [service, config] = await Promise.all([
      this.prisma.service.findFirst({
        where: { id: serviceId, tenantId, active: true },
      }),
      this.prisma.receptionistConfig.findUnique({ where: { tenantId } }),
    ]);
    if (!service) {
      throw new NotFoundException('Service not available');
    }
    return { service, config };
  }

  private async staffForTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        active: true,
        role: { in: [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF] },
      },
      select: { id: true, name: true, email: true, phone: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  private bookingsForDay(tenantId: string, day: Date) {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return this.prisma.booking.findMany({
      where: {
        tenantId,
        status: { in: this.activeStatuses },
        startTime: { gte: start, lte: end },
      },
      include: { customer: true, service: true, assignedStaff: true },
      orderBy: { startTime: 'asc' },
    });
  }

  private businessWindows(day: Date, businessHours: BusinessHours) {
    const key = day
      .toLocaleDateString('en-US', { weekday: 'long' })
      .toLowerCase();
    const raw = businessHours?.[key] ?? '8:00 AM - 5:00 PM';
    if (/closed/i.test(raw)) return [];
    const [startText, endText] = raw.split(/\s*-\s*/);
    const start =
      this.timeOnDay(day, startText) ?? this.timeOnDay(day, '8:00 AM')!;
    const end = this.timeOnDay(day, endText) ?? this.timeOnDay(day, '5:00 PM')!;
    return [{ start, end }];
  }

  private asBusinessHours(value: Prisma.JsonValue | undefined): BusinessHours {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }

  private timeOnDay(day: Date, text?: string) {
    if (!text) return null;
    const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const value = new Date(day);
    value.setHours(hour, minute, 0, 0);
    return value;
  }

  private isStaffAvailable(
    staffId: string,
    startTime: Date,
    endTime: Date,
    bookings: Awaited<ReturnType<SchedulingService['bookingsForDay']>>,
  ) {
    return !bookings.some(
      (booking) =>
        booking.assignedStaffId === staffId &&
        booking.startTime < endTime &&
        (booking.endTime ??
          addMinutes(booking.startTime, booking.service.durationMinutes)) >
          startTime,
    );
  }

  private dailyMinutes(
    staffId: string,
    bookings: Awaited<ReturnType<SchedulingService['bookingsForDay']>>,
  ) {
    return bookings
      .filter((booking) => booking.assignedStaffId === staffId)
      .reduce((total, booking) => total + booking.service.durationMinutes, 0);
  }

  private parseDay(date: string) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00`)
      : new Date(date);
    if (Number.isNaN(day.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    day.setHours(0, 0, 0, 0);
    return day;
  }

  private isBookableTenant(status: TenantStatus) {
    return status === TenantStatus.ACTIVE || status === TenantStatus.TRIAL;
  }

  private risk(
    booking: Awaited<ReturnType<SchedulingService['bookingsForDay']>>[number],
    type: string,
    title: string,
    score: number,
  ) {
    return {
      type,
      title,
      score,
      bookingId: booking.id,
      customerName: booking.customer.name,
      serviceTitle: booking.service.title,
      startTime: booking.startTime,
      assignedStaffName: booking.assignedStaff?.name,
    };
  }
}
