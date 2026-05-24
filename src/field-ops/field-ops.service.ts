import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  BookingStatus,
  JobReportStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager, isManager } from '../common/permissions';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AssignJobDto } from './dto/assign-job.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { JobNoteDto } from './dto/job-note.dto';

@Injectable()
export class FieldOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflows: WorkflowsService,
    private readonly invoices: InvoicesService,
  ) {}

  jobs(user: AuthUser, date?: string) {
    const { start, end } = this.dayBounds(date);

    return this.prisma.booking.findMany({
      where: {
        tenantId: user.tenantId,
        assignedStaffId: isManager(user) ? undefined : user.sub,
        startTime: { gte: start, lte: end },
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.IN_PROGRESS,
            BookingStatus.COMPLETED,
          ],
        },
      },
      include: this.jobInclude(),
      orderBy: { startTime: 'asc' },
      take: 100,
    });
  }

  async dispatchBoard(user: AuthUser, date?: string) {
    assertManager(user);
    const { start, end } = this.dayBounds(date);
    const [jobs, staff, openDispatchActions] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          tenantId: user.tenantId,
          startTime: { gte: start, lte: end },
          status: {
            in: [
              BookingStatus.REQUESTED,
              BookingStatus.CONFIRMED,
              BookingStatus.IN_PROGRESS,
              BookingStatus.COMPLETED,
            ],
          },
        },
        include: this.jobInclude(),
        orderBy: { startTime: 'asc' },
        take: 200,
      }),
      this.prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          active: true,
          role: { in: [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF] },
        },
        select: { id: true, name: true, email: true, phone: true, role: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.operationalAction.findMany({
        where: {
          tenantId: user.tenantId,
          type: { in: [ActionType.CONFIRM_BOOKING, ActionType.DISPATCH_STAFF] },
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
        include: { booking: { include: { service: true, customer: true } } },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 100,
      }),
    ]);

    const readiness = jobs.map((job) => this.jobReadiness(job));
    const staffLoad = staff.map((member) => {
      const assigned = jobs.filter((job) => job.assignedStaffId === member.id);
      const minutes = assigned.reduce(
        (total, job) => total + job.service.durationMinutes,
        0,
      );
      return {
        ...member,
        jobs: assigned.length,
        minutes,
        nextJob: assigned.find((job) => job.status !== BookingStatus.COMPLETED),
      };
    });

    return {
      date: start.toISOString().slice(0, 10),
      summary: {
        totalJobs: jobs.length,
        unassigned: readiness.filter((item) => !item.readiness.assigned).length,
        needsConfirmation: readiness.filter((item) => !item.readiness.confirmed)
          .length,
        ready: readiness.filter((item) => item.readiness.ready).length,
        inProgress: jobs.filter(
          (job) => job.status === BookingStatus.IN_PROGRESS,
        ).length,
        completed: jobs.filter((job) => job.status === BookingStatus.COMPLETED)
          .length,
      },
      jobs: readiness,
      staffLoad,
      openDispatchActions,
    };
  }

  async job(user: AuthUser, bookingId: string) {
    const booking = await this.findAccessibleBooking(user, bookingId);
    return booking;
  }

  async startJob(user: AuthUser, bookingId: string) {
    const booking = await this.findAccessibleBooking(user, bookingId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed jobs can be started');
    }

    const started = await this.prisma.booking.update({
      where: { id: booking.id, tenantId: user.tenantId },
      data: { status: BookingStatus.IN_PROGRESS },
      include: this.jobInclude(),
    });

    await this.prisma.fieldJobReport.upsert({
      where: { bookingId: booking.id },
      create: {
        tenantId: user.tenantId,
        bookingId: booking.id,
        status: JobReportStatus.DRAFT,
        startedAt: new Date(),
      },
      update: { startedAt: new Date() },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'FIELD_JOB_STARTED',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Started field job for ${booking.customer.name}`,
      metadata: { bookingId: booking.id },
    });

    await this.workflows.handleBookingStatusChanged(started);
    return started;
  }

  async assignJob(user: AuthUser, bookingId: string, dto: AssignJobDto) {
    assertManager(user);
    const booking = await this.findAccessibleBooking(user, bookingId);
    const activeStatuses: BookingStatus[] = [
      BookingStatus.REQUESTED,
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
    ];
    if (!activeStatuses.includes(booking.status)) {
      throw new BadRequestException('Only active jobs can be assigned');
    }

    await this.assertStaff(user.tenantId, dto.staffId);
    await this.assertNoStaffConflict(
      user.tenantId,
      dto.staffId,
      booking.startTime,
      booking.endTime ??
        this.addMinutes(booking.startTime, booking.service.durationMinutes),
      booking.id,
    );

    const assigned = await this.prisma.booking.update({
      where: { id: booking.id, tenantId: user.tenantId },
      data: {
        assignedStaffId: dto.staffId,
        status:
          booking.status === BookingStatus.REQUESTED
            ? BookingStatus.CONFIRMED
            : booking.status,
        notes: dto.dispatchNote
          ? [booking.notes, `Dispatch note: ${dto.dispatchNote}`]
              .filter(Boolean)
              .join('\n\n')
          : booking.notes,
      },
      include: this.jobInclude(),
    });

    await this.prisma.operationalAction.updateMany({
      where: {
        tenantId: user.tenantId,
        bookingId: booking.id,
        type: { in: [ActionType.CONFIRM_BOOKING, ActionType.DISPATCH_STAFF] },
        status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
      },
      data: {
        assignedToId: dto.staffId,
        status: ActionStatus.IN_PROGRESS,
        metadata: {
          dispatchNote: dto.dispatchNote,
          assignedBy: user.sub,
          assignedAt: new Date().toISOString(),
        },
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'FIELD_JOB_ASSIGNED',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Assigned ${assigned.service.title} to ${assigned.assignedStaff?.name}`,
      metadata: {
        bookingId: booking.id,
        assignedStaffId: dto.staffId,
        dispatchNote: dto.dispatchNote,
      },
    });

    await this.workflows.handleBookingStatusChanged(assigned);
    return {
      booking: assigned,
      readiness: this.jobReadiness(assigned),
    };
  }

  async saveNotes(user: AuthUser, bookingId: string, dto: JobNoteDto) {
    const booking = await this.findAccessibleBooking(user, bookingId);
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        'Notes can only be added before completion',
      );
    }

    const report = await this.prisma.fieldJobReport.upsert({
      where: { bookingId: booking.id },
      create: {
        tenantId: user.tenantId,
        bookingId: booking.id,
        status: JobReportStatus.DRAFT,
        staffNotes: dto.staffNotes,
        photoUrls: dto.photoUrls ?? [],
      },
      update: {
        staffNotes: dto.staffNotes,
        photoUrls: dto.photoUrls,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'FIELD_JOB_NOTES_UPDATED',
      entityType: 'FieldJobReport',
      entityId: report.id,
      summary: `Updated field notes for booking ${booking.id}`,
      metadata: { bookingId: booking.id, photoCount: report.photoUrls.length },
    });

    return report;
  }

  async completeJob(user: AuthUser, bookingId: string, dto: CompleteJobDto) {
    const booking = await this.findAccessibleBooking(user, bookingId);
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.IN_PROGRESS
    ) {
      throw new BadRequestException('Only active jobs can be completed');
    }

    const completedAt = new Date();
    const [completed, report] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: booking.id, tenantId: user.tenantId },
        data: { status: BookingStatus.COMPLETED },
        include: this.jobInclude(),
      }),
      this.prisma.fieldJobReport.upsert({
        where: { bookingId: booking.id },
        create: {
          tenantId: user.tenantId,
          bookingId: booking.id,
          status: JobReportStatus.COMPLETED,
          checklist: (dto.checklist ?? []) as unknown as Prisma.InputJsonValue,
          photoUrls: dto.photoUrls ?? [],
          staffNotes: dto.staffNotes,
          customerSignatureUrl: dto.customerSignatureUrl,
          customerSignatureName: dto.customerSignatureName,
          completedById: user.sub,
          startedAt: this.startedAt(booking) ?? completedAt,
          completedAt,
        },
        update: {
          status: JobReportStatus.COMPLETED,
          checklist: (dto.checklist ?? []) as unknown as Prisma.InputJsonValue,
          photoUrls: dto.photoUrls,
          staffNotes: dto.staffNotes,
          customerSignatureUrl: dto.customerSignatureUrl,
          customerSignatureName: dto.customerSignatureName,
          completedById: user.sub,
          completedAt,
        },
      }),
    ]);

    const invoice =
      dto.autoInvoice === false || completed.invoice
        ? completed.invoice
        : await this.invoices.createFromBooking(
            user.tenantId,
            completed.id,
            user.sub,
          );

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'FIELD_JOB_COMPLETED',
      entityType: 'FieldJobReport',
      entityId: report.id,
      summary: `Completed field job for ${completed.customer.name}`,
      metadata: {
        bookingId: completed.id,
        invoiceId: invoice?.id,
        photoCount: report.photoUrls.length,
      },
    });

    await this.workflows.handleBookingStatusChanged({
      ...completed,
      invoice: invoice
        ? { id: invoice.id, status: invoice.status }
        : completed.invoice,
    });

    return { booking: completed, report, invoice };
  }

  async report(user: AuthUser, bookingId: string) {
    await this.findAccessibleBooking(user, bookingId);
    return this.prisma.fieldJobReport.findUniqueOrThrow({
      where: { bookingId },
      include: {
        booking: { include: { customer: true, service: true, invoice: true } },
        completedBy: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  private async findAccessibleBooking(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        tenantId: user.tenantId,
        ...(isManager(user) ? {} : { assignedStaffId: user.sub }),
      },
      include: this.jobInclude(),
    });
    if (!booking) {
      throw new NotFoundException('Job not found');
    }
    if (!isManager(user) && booking.assignedStaffId !== user.sub) {
      throw new ForbiddenException('This job is not assigned to you');
    }
    return booking;
  }

  private jobInclude() {
    return {
      customer: true,
      service: true,
      assignedStaff: {
        select: { id: true, name: true, email: true, phone: true, role: true },
      },
      invoice: true,
      fieldJobReport: true,
    };
  }

  private jobReadiness(
    job: Prisma.BookingGetPayload<{
      include: ReturnType<FieldOpsService['jobInclude']>;
    }>,
  ) {
    const assigned = Boolean(job.assignedStaffId);
    const confirmedStatuses: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED,
    ];
    const confirmed = confirmedStatuses.includes(job.status);
    const hasCustomerPhone = Boolean(job.customer.phone);
    const hasServiceWindow = Boolean(job.startTime && job.endTime);
    const reportStarted = Boolean(job.fieldJobReport?.startedAt);
    const completed = job.status === BookingStatus.COMPLETED;
    const blockers = [
      !confirmed ? 'Confirm booking' : null,
      !assigned ? 'Assign crew' : null,
      !hasCustomerPhone ? 'Add customer phone' : null,
      !hasServiceWindow ? 'Confirm job duration' : null,
    ].filter((item): item is string => Boolean(item));

    return {
      ...job,
      readiness: {
        ready: blockers.length === 0,
        assigned,
        confirmed,
        hasCustomerPhone,
        hasServiceWindow,
        reportStarted,
        completed,
        blockers,
        score: Math.round(
          ([confirmed, assigned, hasCustomerPhone, hasServiceWindow].filter(
            Boolean,
          ).length /
            4) *
            100,
        ),
      },
    };
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
      throw new BadRequestException('Assigned staff does not belong to tenant');
    }
  }

  private async assertNoStaffConflict(
    tenantId: string,
    staffId: string,
    startTime: Date,
    endTime: Date,
    ignoreBookingId: string,
  ) {
    const conflict = await this.prisma.booking.findFirst({
      where: {
        tenantId,
        assignedStaffId: staffId,
        id: { not: ignoreBookingId },
        status: {
          in: [
            BookingStatus.REQUESTED,
            BookingStatus.CONFIRMED,
            BookingStatus.IN_PROGRESS,
          ],
        },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      include: { customer: true, service: true },
    });
    if (conflict) {
      await this.prisma.operationalAction.upsert({
        where: {
          tenantId_idempotencyKey: {
            tenantId,
            idempotencyKey: `staff-conflict:${ignoreBookingId}:${conflict.id}`,
          },
        },
        create: {
          tenantId,
          type: ActionType.RESOLVE_STAFF_CONFLICT,
          priority: ActionPriority.URGENT,
          title: 'Resolve staff schedule conflict',
          description: `${conflict.service.title} for ${conflict.customer.name} overlaps this assignment.`,
          bookingId: ignoreBookingId,
          assignedToId: staffId,
          dueAt: new Date(),
          idempotencyKey: `staff-conflict:${ignoreBookingId}:${conflict.id}`,
          metadata: { conflictBookingId: conflict.id },
        },
        update: {
          status: ActionStatus.OPEN,
          priority: ActionPriority.URGENT,
          dueAt: new Date(),
        },
      });
      throw new BadRequestException(
        'Assigned staff already has a booking at this time',
      );
    }
  }

  private dayBounds(date?: string) {
    const start =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(`${date}T00:00:00`)
        : date
          ? new Date(date)
          : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60_000);
  }

  private startedAt(booking: unknown) {
    const report = (
      booking as { fieldJobReport?: { startedAt: Date | null } | null }
    ).fieldJobReport;
    return report?.startedAt ?? null;
  }
}
