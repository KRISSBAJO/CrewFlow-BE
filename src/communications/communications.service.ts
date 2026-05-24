import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationRunStatus,
  BookingStatus,
  MessageDirection,
  MessageProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { isManager } from '../common/permissions';
import { MessageProviderService } from '../messaging/message-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BookingUpdateType,
  SendBookingUpdateDto,
} from './dto/send-booking-update.dto';

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: ReturnType<CommunicationsService['bookingInclude']>;
}>;

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MessageProviderService,
    private readonly audit: AuditService,
  ) {}

  async bookingTimeline(user: AuthUser, bookingId: string) {
    const booking = await this.findBooking(user, bookingId);
    const [messages, automations] = await Promise.all([
      this.prisma.messageLog.findMany({
        where: {
          tenantId: user.tenantId,
          customerId: booking.customerId,
        },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.automationRun.findMany({
        where: { tenantId: user.tenantId, bookingId: booking.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const scopedMessages = messages.filter((message) =>
      this.matchesBooking(message.metadata, booking.id),
    );
    const timeline = [
      ...scopedMessages.map((message) => ({
        id: message.id,
        kind: 'message' as const,
        createdAt: message.createdAt,
        title: this.messageTitle(message.metadata),
        status: message.direction,
        provider: message.provider,
        content: message.content,
      })),
      ...automations.map((run) => ({
        id: run.id,
        kind: 'automation' as const,
        createdAt: run.createdAt,
        title: run.trigger,
        status: run.status,
        provider: run.provider,
        content: run.content,
        error: run.error,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      booking,
      timeline,
      suggestions: this.suggestions(booking, scopedMessages, automations),
    };
  }

  async health(user: AuthUser) {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 7);

    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId: user.tenantId,
        ...(isManager(user) ? {} : { assignedStaffId: user.sub }),
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.IN_PROGRESS,
            BookingStatus.COMPLETED,
          ],
        },
        startTime: {
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
          lte: horizon,
        },
      },
      include: this.bookingInclude(),
      orderBy: { startTime: 'asc' },
      take: 200,
    });

    const bookingIds = bookings.map((booking) => booking.id);
    const [messages, automations] = await Promise.all([
      this.prisma.messageLog.findMany({
        where: {
          tenantId: user.tenantId,
          customerId: { in: bookings.map((booking) => booking.customerId) },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      this.prisma.automationRun.findMany({
        where: { tenantId: user.tenantId, bookingId: { in: bookingIds } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const risks = bookings.flatMap((booking) =>
      this.communicationRisks(booking, messages, automations),
    );

    return {
      generatedAt: now,
      summary: {
        checkedBookings: bookings.length,
        risks: risks.length,
        missingConfirmation: risks.filter(
          (risk) => risk.type === BookingUpdateType.CONFIRM_APPOINTMENT,
        ).length,
        missingOnTheWay: risks.filter(
          (risk) => risk.type === BookingUpdateType.ON_THE_WAY,
        ).length,
        missingReview: risks.filter(
          (risk) => risk.type === BookingUpdateType.REVIEW_REQUEST,
        ).length,
      },
      risks,
    };
  }

  async sendBookingUpdate(
    user: AuthUser,
    bookingId: string,
    dto: SendBookingUpdateDto,
  ) {
    const booking = await this.findBooking(user, bookingId);
    if (!booking.customer.phone) {
      throw new BadRequestException('Customer has no phone number');
    }

    const provider = dto.provider ?? MessageProvider.WHATSAPP;
    const content = this.renderMessage(dto.type, booking, dto.note);
    const sent = await this.provider.send({
      provider,
      to: booking.customer.phone,
      content,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        tenantId: user.tenantId,
        customerId: booking.customerId,
        direction: MessageDirection.OUTBOUND,
        provider,
        content,
        metadata: {
          bookingId: booking.id,
          communicationType: dto.type,
          providerMessageId: sent.providerMessageId,
          providerStatus: sent.status,
          raw: sent.raw,
        } as Prisma.InputJsonValue,
      },
      include: { customer: true },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'BOOKING_UPDATE_SENT',
      entityType: 'MessageLog',
      entityId: message.id,
      summary: `Sent ${dto.type} update for ${booking.service.title}`,
      metadata: {
        bookingId: booking.id,
        customerId: booking.customerId,
        providerMessageId: sent.providerMessageId,
      },
    });

    return { message, provider: sent };
  }

  private async findBooking(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        tenantId: user.tenantId,
        ...(isManager(user) ? {} : { assignedStaffId: user.sub }),
      },
      include: this.bookingInclude(),
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private suggestions(
    booking: BookingWithRelations,
    messages: Array<{ metadata: Prisma.JsonValue }>,
    automations: Array<{
      trigger: string;
      status: AutomationRunStatus;
    }>,
  ) {
    return [
      BookingUpdateType.CONFIRM_APPOINTMENT,
      BookingUpdateType.CREW_ASSIGNED,
      BookingUpdateType.ON_THE_WAY,
      BookingUpdateType.INVOICE_READY,
      BookingUpdateType.REVIEW_REQUEST,
    ]
      .filter((type) => this.shouldSuggest(type, booking))
      .map((type) => ({
        type,
        label: this.label(type),
        sent: this.hasCommunication(type, booking.id, messages, automations),
        preview: this.renderMessage(type, booking),
      }));
  }

  private communicationRisks(
    booking: BookingWithRelations,
    messages: Array<{ metadata: Prisma.JsonValue }>,
    automations: Array<{
      bookingId: string | null;
      trigger: string;
      status: AutomationRunStatus;
    }>,
  ) {
    const risks: Array<{
      bookingId: string;
      customerName: string;
      serviceTitle: string;
      startTime: Date;
      type: BookingUpdateType;
      title: string;
      severity: 'warning' | 'critical';
    }> = [];

    const addRisk = (
      type: BookingUpdateType,
      title: string,
      severity: 'warning' | 'critical' = 'warning',
    ) => {
      if (!this.hasCommunication(type, booking.id, messages, automations)) {
        risks.push({
          bookingId: booking.id,
          customerName: booking.customer.name,
          serviceTitle: booking.service.title,
          startTime: booking.startTime,
          type,
          title,
          severity,
        });
      }
    };

    const activeStatuses: BookingStatus[] = [
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
    ];
    if (activeStatuses.includes(booking.status)) {
      addRisk(
        BookingUpdateType.CONFIRM_APPOINTMENT,
        'Appointment confirmation not sent',
      );
    }
    if (
      booking.status === BookingStatus.IN_PROGRESS ||
      (booking.status === BookingStatus.CONFIRMED &&
        booking.startTime.getTime() - Date.now() < 2 * 60 * 60_000)
    ) {
      addRisk(
        BookingUpdateType.ON_THE_WAY,
        'On-the-way update not sent',
        'critical',
      );
    }
    if (booking.status === BookingStatus.COMPLETED) {
      addRisk(BookingUpdateType.REVIEW_REQUEST, 'Review request not sent');
    }

    return risks;
  }

  private shouldSuggest(
    type: BookingUpdateType,
    booking: BookingWithRelations,
  ) {
    if (type === BookingUpdateType.CREW_ASSIGNED) {
      return Boolean(booking.assignedStaff);
    }
    if (type === BookingUpdateType.INVOICE_READY) {
      return Boolean(booking.invoice);
    }
    if (type === BookingUpdateType.REVIEW_REQUEST) {
      return booking.status === BookingStatus.COMPLETED;
    }
    if (type === BookingUpdateType.ON_THE_WAY) {
      return booking.status !== BookingStatus.COMPLETED;
    }
    return true;
  }

  private hasCommunication(
    type: BookingUpdateType,
    bookingId: string,
    messages: Array<{ metadata: Prisma.JsonValue }>,
    automations: Array<{
      bookingId?: string | null;
      trigger: string;
      status: AutomationRunStatus;
    }>,
  ) {
    return (
      messages.some((message) => {
        const metadata = this.metadataRecord(message.metadata);
        return (
          metadata?.bookingId === bookingId &&
          metadata?.communicationType === type
        );
      }) ||
      automations.some(
        (run) =>
          run.bookingId === bookingId &&
          run.status === AutomationRunStatus.SENT &&
          this.triggerMatchesType(run.trigger, type),
      )
    );
  }

  private renderMessage(
    type: BookingUpdateType,
    booking: BookingWithRelations,
    note?: string,
  ) {
    const business = booking.tenant.businessName;
    const customer = booking.customer.name;
    const service = booking.service.title;
    const time = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(booking.startTime);
    const staff = booking.assignedStaff?.name ?? 'our crew';
    const invoiceUrl = booking.invoice?.paymentUrl;
    const noteText = note ? ` ${note}` : '';

    const messages: Record<BookingUpdateType, string> = {
      [BookingUpdateType.CONFIRM_APPOINTMENT]: `Hi ${customer}, ${business} confirmed your ${service} appointment for ${time}.${noteText}`,
      [BookingUpdateType.CREW_ASSIGNED]: `Hi ${customer}, ${staff} has been assigned to your ${service} appointment for ${time}.${noteText}`,
      [BookingUpdateType.ON_THE_WAY]: `Hi ${customer}, ${staff} is on the way for your ${service} appointment.${noteText}`,
      [BookingUpdateType.RUNNING_LATE]: `Hi ${customer}, ${staff} is running a little late for your ${service} appointment.${noteText}`,
      [BookingUpdateType.INVOICE_READY]: `Hi ${customer}, your ${business} invoice is ready${invoiceUrl ? `: ${invoiceUrl}` : '.'}${noteText}`,
      [BookingUpdateType.REVIEW_REQUEST]: `Hi ${customer}, thanks for choosing ${business}. Could you leave us a quick review while the service is fresh?${noteText}`,
    };
    return messages[type];
  }

  private label(type: BookingUpdateType) {
    return type
      .toLowerCase()
      .split('_')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ');
  }

  private triggerMatchesType(trigger: string, type: BookingUpdateType) {
    const pairs: Partial<Record<BookingUpdateType, string[]>> = {
      [BookingUpdateType.CONFIRM_APPOINTMENT]: ['BOOKING_CONFIRMED'],
      [BookingUpdateType.ON_THE_WAY]: ['STAFF_ON_THE_WAY'],
      [BookingUpdateType.INVOICE_READY]: ['INVOICE_DUE'],
      [BookingUpdateType.REVIEW_REQUEST]: ['REVIEW_REQUEST'],
    };
    return pairs[type]?.includes(trigger) ?? false;
  }

  private messageTitle(metadata: Prisma.JsonValue) {
    const type = this.metadataRecord(metadata)?.communicationType;
    return typeof type === 'string'
      ? this.label(type as BookingUpdateType)
      : 'Message';
  }

  private matchesBooking(metadata: Prisma.JsonValue, bookingId: string) {
    return this.metadataRecord(metadata)?.bookingId === bookingId;
  }

  private metadataRecord(metadata: Prisma.JsonValue) {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  }

  private bookingInclude() {
    return {
      tenant: { select: { id: true, businessName: true, slug: true } },
      customer: true,
      service: true,
      assignedStaff: { select: { id: true, name: true, phone: true } },
      invoice: true,
    };
  }
}
