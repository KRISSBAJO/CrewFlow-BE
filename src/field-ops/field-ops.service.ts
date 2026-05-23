import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, JobReportStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { isManager } from '../common/permissions';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
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
    const start = date ? new Date(date) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

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

  private startedAt(booking: unknown) {
    const report = (
      booking as { fieldJobReport?: { startedAt: Date | null } | null }
    ).fieldJobReport;
    return report?.startedAt ?? null;
  }
}
