import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { addMinutes } from '../common/domain';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager, isManager } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

@Injectable()
export class BookingsService {
  private readonly activeConflictStatuses = [
    BookingStatus.REQUESTED,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
  ];

  private readonly statusTransitions: Record<BookingStatus, BookingStatus[]> = {
    [BookingStatus.REQUESTED]: [
      BookingStatus.CONFIRMED,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.CONFIRMED]: [
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED,
      BookingStatus.NO_SHOW,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.IN_PROGRESS]: [
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.COMPLETED]: [],
    [BookingStatus.NO_SHOW]: [],
    [BookingStatus.CANCELLED]: [],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly automations: AutomationsService,
  ) {}

  async create(user: AuthUser, dto: CreateBookingDto) {
    assertManager(user);
    const tenantId = user.tenantId;
    await this.assertCustomer(tenantId, dto.customerId);
    const service = await this.prisma.service.findFirstOrThrow({
      where: { id: dto.serviceId, tenantId, active: true },
    });
    const startTime = new Date(dto.startTime);
    const endTime = addMinutes(startTime, service.durationMinutes);
    const assignedStaffId = dto.assignedStaffId;

    if (assignedStaffId) {
      await this.assertStaff(tenantId, assignedStaffId);
      await this.assertNoStaffConflict(
        tenantId,
        assignedStaffId,
        startTime,
        endTime,
      );
    }

    const booking = await this.prisma.booking.create({
      data: {
        tenantId,
        customerId: dto.customerId,
        serviceId: dto.serviceId,
        assignedStaffId,
        startTime,
        endTime,
        status: dto.status ?? BookingStatus.CONFIRMED,
        source: dto.source ?? 'manual',
        notes: dto.notes,
      },
      include: this.include(),
    });

    await this.audit.record({
      tenantId,
      actorId: user.sub,
      action: 'BOOKING_CREATED',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Created booking for ${booking.customer.name}`,
      metadata: { status: booking.status, startTime: booking.startTime },
    });

    if (booking.status === BookingStatus.CONFIRMED) {
      await this.automations.trigger({
        tenantId,
        trigger: 'BOOKING_CONFIRMED',
        customerId: booking.customerId,
        bookingId: booking.id,
      });
    }

    return booking;
  }

  findAll(
    user: AuthUser,
    from?: string,
    to?: string,
    assignedStaffId?: string,
  ) {
    return this.prisma.booking.findMany({
      where: {
        tenantId: user.tenantId,
        assignedStaffId: isManager(user) ? assignedStaffId : user.sub,
        startTime: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      include: this.include(),
      orderBy: { startTime: 'asc' },
      take: 200,
    });
  }

  mySchedule(user: AuthUser, from?: string, to?: string) {
    return this.findAll(user, from, to, user.sub);
  }

  async staffSchedule(
    user: AuthUser,
    staffId: string,
    from?: string,
    to?: string,
  ) {
    assertManager(user);
    await this.assertStaff(user.tenantId, staffId);
    return this.findAll(user, from, to, staffId);
  }

  async update(user: AuthUser, id: string, dto: UpdateBookingDto) {
    const tenantId = user.tenantId;
    const existing = await this.prisma.booking.findFirst({
      where: {
        id,
        tenantId,
        ...(isManager(user) ? {} : { assignedStaffId: user.sub }),
      },
      include: { service: true },
    });

    if (!existing) {
      throw new NotFoundException('Booking not found');
    }

    if (!isManager(user)) {
      this.assertStaffUpdate(existing.status, dto);
    }

    if (dto.customerId) {
      await this.assertCustomer(tenantId, dto.customerId);
    }

    const serviceId = dto.serviceId ?? existing.serviceId;
    const service =
      dto.serviceId && dto.serviceId !== existing.serviceId
        ? await this.prisma.service.findFirstOrThrow({
            where: { id: dto.serviceId, tenantId, active: true },
          })
        : existing.service;
    const startTime = dto.startTime
      ? new Date(dto.startTime)
      : existing.startTime;
    const endTime = addMinutes(startTime, service.durationMinutes);
    const assignedStaffId = dto.assignedStaffId ?? existing.assignedStaffId;

    if (assignedStaffId) {
      await this.assertStaff(tenantId, assignedStaffId);
      await this.assertNoStaffConflict(
        tenantId,
        assignedStaffId,
        startTime,
        endTime,
        id,
      );
    }

    if (dto.status) {
      this.assertStatusTransition(existing.status, dto.status);
    }

    const booking = await this.prisma.booking.update({
      where: { id, tenantId },
      data: {
        customerId: dto.customerId,
        serviceId,
        assignedStaffId: dto.assignedStaffId,
        startTime,
        endTime,
        status: dto.status,
        notes: dto.notes,
      },
      include: this.include(),
    });

    await this.audit.record({
      tenantId,
      actorId: user.sub,
      action: 'BOOKING_UPDATED',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Updated booking ${booking.id}`,
      metadata: { previousStatus: existing.status, status: booking.status },
    });

    await this.triggerBookingAutomation(booking);

    return booking;
  }

  private async triggerBookingAutomation(booking: {
    id: string;
    tenantId: string;
    customerId: string;
    status: BookingStatus;
  }) {
    const triggerByStatus: Partial<
      Record<
        BookingStatus,
        | 'STAFF_ON_THE_WAY'
        | 'MISSED_APPOINTMENT'
        | 'REVIEW_REQUEST'
        | 'BOOKING_CONFIRMED'
      >
    > = {
      [BookingStatus.CONFIRMED]: 'BOOKING_CONFIRMED',
      [BookingStatus.IN_PROGRESS]: 'STAFF_ON_THE_WAY',
      [BookingStatus.NO_SHOW]: 'MISSED_APPOINTMENT',
      [BookingStatus.COMPLETED]: 'REVIEW_REQUEST',
    };
    const trigger = triggerByStatus[booking.status];

    if (trigger) {
      await this.automations.trigger({
        tenantId: booking.tenantId,
        trigger,
        customerId: booking.customerId,
        bookingId: booking.id,
      });
    }
  }

  private async assertCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer does not belong to this tenant');
    }
  }

  private async assertStaff(tenantId: string, staffId: string) {
    const staff = await this.prisma.user.findFirst({
      where: {
        id: staffId,
        tenantId,
        active: true,
        role: { in: [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF] },
      },
      select: { id: true },
    });

    if (!staff) {
      throw new BadRequestException(
        'Assigned staff does not belong to this tenant',
      );
    }
  }

  private async assertNoStaffConflict(
    tenantId: string,
    staffId: string,
    startTime: Date,
    endTime: Date,
    ignoreBookingId?: string,
  ) {
    const conflict = await this.prisma.booking.findFirst({
      where: {
        tenantId,
        assignedStaffId: staffId,
        id: ignoreBookingId ? { not: ignoreBookingId } : undefined,
        status: { in: this.activeConflictStatuses },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { id: true, startTime: true, endTime: true },
    });

    if (conflict) {
      throw new ConflictException(
        'Assigned staff already has a booking at this time',
      );
    }
  }

  private assertStatusTransition(from: BookingStatus, to: BookingStatus) {
    if (from === to) {
      return;
    }

    if (!this.statusTransitions[from].includes(to)) {
      throw new BadRequestException(
        `Cannot move booking from ${from} to ${to}`,
      );
    }
  }

  private assertStaffUpdate(
    currentStatus: BookingStatus,
    dto: UpdateBookingDto,
  ) {
    const keys = Object.keys(dto);
    const allowedKeys = ['status', 'notes'];
    const hasDisallowedKey = keys.some((key) => !allowedKeys.includes(key));

    if (hasDisallowedKey) {
      throw new BadRequestException('Staff can only update status and notes');
    }

    if (dto.status) {
      const allowed: BookingStatus[] = [
        BookingStatus.IN_PROGRESS,
        BookingStatus.COMPLETED,
      ];
      if (
        currentStatus === BookingStatus.CONFIRMED &&
        allowed.includes(dto.status)
      ) {
        return;
      }
      if (
        currentStatus === BookingStatus.IN_PROGRESS &&
        dto.status === BookingStatus.COMPLETED
      ) {
        return;
      }
      throw new BadRequestException(
        'Staff can only start or complete assigned jobs',
      );
    }
  }

  private include() {
    return {
      customer: true,
      service: true,
      assignedStaff: {
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
    };
  }
}
