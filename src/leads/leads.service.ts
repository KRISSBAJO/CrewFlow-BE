import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BookingIntentStatus,
  BookingStatus,
  LeadSource,
  LeadStatus,
  MessageProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import type { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { PlanLimitsService } from '../common/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertLeadToBookingDto } from './dto/convert-lead-to-booking.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

type LeadAutomationInput = {
  tenantId: string;
  customerId?: string | null;
  conversationId?: string | null;
  bookingIntentId?: string | null;
  bookingId?: string | null;
  assignedToId?: string | null;
  source?: LeadSource;
  serviceTitle?: string | null;
  customerName?: string | null;
  estimatedValueCents?: number | null;
  intentStatus?: BookingIntentStatus;
  missingFields?: string[];
  notes?: string | null;
};

const leadInclude = {
  customer: true,
  conversation: true,
  bookingIntent: { include: { service: true, booking: true } },
  booking: { include: { service: true, customer: true, assignedStaff: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.LeadInclude;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
    private readonly bookings: BookingsService,
  ) {}

  findAll(user: AuthUser, status?: LeadStatus, assignedToMe?: boolean) {
    assertManager(user);
    return this.prisma.lead.findMany({
      where: {
        tenantId: user.tenantId,
        status,
        assignedToId: assignedToMe ? user.sub : undefined,
      },
      include: leadInclude,
      orderBy: [
        { status: 'asc' },
        { followUpAt: 'asc' },
        { updatedAt: 'desc' },
      ],
      take: 200,
    });
  }

  async create(user: AuthUser, dto: CreateLeadDto) {
    assertManager(user);
    await this.planLimits.assertCanWrite(user.tenantId);
    await this.planLimits.assertBelowLimit(
      user.tenantId,
      'leads',
      await this.prisma.lead.count({ where: { tenantId: user.tenantId } }),
    );
    await this.assertReferences(user.tenantId, dto);
    const lead = await this.prisma.lead.create({
      data: {
        tenantId: user.tenantId,
        title: dto.title,
        status: dto.status ?? LeadStatus.NEW,
        source: dto.source ?? LeadSource.MANUAL,
        customerId: dto.customerId,
        conversationId: dto.conversationId,
        assignedToId: dto.assignedToId,
        estimatedValueCents: dto.estimatedValueCents,
        conversionProbability: dto.conversionProbability ?? 25,
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : undefined,
        notes: dto.notes,
      },
      include: leadInclude,
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'LEAD_CREATED',
      entityType: 'Lead',
      entityId: lead.id,
      summary: `Created lead: ${lead.title}`,
      metadata: { status: lead.status, source: lead.source },
    });

    return lead;
  }

  async update(user: AuthUser, id: string, dto: UpdateLeadDto) {
    assertManager(user);
    await this.assertReferences(user.tenantId, dto);

    const lead = await this.prisma.lead.update({
      where: { id, tenantId: user.tenantId },
      data: {
        title: dto.title,
        status: dto.status,
        source: dto.source,
        customerId: dto.customerId,
        conversationId: dto.conversationId,
        assignedToId: dto.assignedToId,
        estimatedValueCents: dto.estimatedValueCents,
        conversionProbability: dto.conversionProbability,
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : undefined,
        wonLostReason: dto.wonLostReason,
        notes: dto.notes,
      },
      include: leadInclude,
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'LEAD_UPDATED',
      entityType: 'Lead',
      entityId: lead.id,
      summary: `Updated lead to ${lead.status}`,
      metadata: {
        assignedToId: lead.assignedToId,
        conversionProbability: lead.conversionProbability,
      },
    });

    return lead;
  }

  async convertToBooking(
    user: AuthUser,
    id: string,
    dto: ConvertLeadToBookingDto,
  ) {
    assertManager(user);
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      include: leadInclude,
    });

    if (!lead) {
      throw new BadRequestException('Lead not found');
    }

    if (!lead.customerId) {
      throw new BadRequestException(
        'Connect this lead to a customer before converting it to a booking',
      );
    }

    if (lead.bookingId) {
      throw new BadRequestException('Lead is already connected to a booking');
    }

    const booking = await this.bookings.create(user, {
      customerId: lead.customerId,
      serviceId: dto.serviceId,
      assignedStaffId: dto.assignedStaffId,
      startTime: dto.startTime,
      status: dto.status ?? BookingStatus.CONFIRMED,
      source: `lead:${lead.source.toLowerCase()}`,
      notes:
        dto.notes ??
        [
          `Converted from lead: ${lead.title}`,
          lead.notes ? `Lead notes: ${lead.notes}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
    });

    const updatedLead = await this.prisma.lead.update({
      where: { id: lead.id, tenantId: user.tenantId },
      data: {
        status: LeadStatus.WON,
        bookingId: booking.id,
        conversionProbability: 100,
        followUpAt: null,
        wonLostReason: `Converted to booking ${booking.id}`,
      },
      include: leadInclude,
    });

    if (lead.bookingIntentId) {
      await this.prisma.bookingIntent.updateMany({
        where: { id: lead.bookingIntentId, tenantId: user.tenantId },
        data: {
          status: BookingIntentStatus.BOOKED,
          bookingId: booking.id,
        },
      });
    }

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'LEAD_CONVERTED_TO_BOOKING',
      entityType: 'Lead',
      entityId: lead.id,
      summary: `Converted lead to booking for ${booking.customer.name}`,
      metadata: {
        leadId: lead.id,
        bookingId: booking.id,
        serviceId: dto.serviceId,
        startTime: dto.startTime,
      },
    });

    return { lead: updatedLead, booking };
  }

  async analytics(user: AuthUser) {
    assertManager(user);
    const [leads, wonBookings] = await Promise.all([
      this.prisma.lead.findMany({ where: { tenantId: user.tenantId } }),
      this.prisma.lead.findMany({
        where: {
          tenantId: user.tenantId,
          status: LeadStatus.WON,
          bookingId: { not: null },
        },
        include: { booking: { include: { service: true } } },
      }),
    ]);
    const openStatuses = new Set<LeadStatus>([
      LeadStatus.NEW,
      LeadStatus.CONTACTED,
      LeadStatus.QUALIFIED,
      LeadStatus.BOOKING_READY,
    ]);
    const now = Date.now();
    const byStatus = Object.values(LeadStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<LeadStatus, number>,
    );
    const bySource = Object.values(LeadSource).reduce(
      (acc, source) => ({ ...acc, [source]: 0 }),
      {} as Record<LeadSource, number>,
    );

    for (const lead of leads) {
      byStatus[lead.status] += 1;
      bySource[lead.source] += 1;
    }

    const openLeads = leads.filter((lead) => openStatuses.has(lead.status));
    const openPipelineCents = openLeads.reduce(
      (sum, lead) => sum + (lead.estimatedValueCents ?? 0),
      0,
    );
    const weightedPipelineCents = openLeads.reduce(
      (sum, lead) =>
        sum +
        Math.round(
          ((lead.estimatedValueCents ?? 0) * lead.conversionProbability) / 100,
        ),
      0,
    );
    const wonValueCents = leads
      .filter((lead) => lead.status === LeadStatus.WON)
      .reduce((sum, lead) => sum + (lead.estimatedValueCents ?? 0), 0);
    const followUpsDue = openLeads.filter(
      (lead) => lead.followUpAt && lead.followUpAt.getTime() <= now,
    ).length;
    const closed = byStatus.WON + byStatus.LOST;

    return {
      total: leads.length,
      open: openLeads.length,
      byStatus,
      bySource,
      openPipelineCents,
      weightedPipelineCents,
      wonValueCents,
      wonCount: byStatus.WON,
      lostCount: byStatus.LOST,
      conversionRate: closed ? Math.round((byStatus.WON / closed) * 100) : 0,
      followUpsDue,
      leadToBooking: {
        wonBookings: wonBookings.length,
        bookingValueCents: wonBookings.reduce(
          (sum, lead) => sum + (lead.booking?.service.priceCents ?? 0),
          0,
        ),
      },
    };
  }

  async upsertFromAutomation(input: LeadAutomationInput) {
    const status = this.statusFromIntent(input);
    const lead = {
      tenantId: input.tenantId,
      customerId: input.customerId ?? undefined,
      conversationId: input.conversationId ?? undefined,
      bookingIntentId: input.bookingIntentId ?? undefined,
      bookingId: input.bookingId ?? undefined,
      assignedToId: input.assignedToId ?? undefined,
      title:
        input.serviceTitle && input.customerName
          ? `${input.serviceTitle} for ${input.customerName}`
          : input.serviceTitle
            ? `${input.serviceTitle} inquiry`
            : `Service inquiry${input.customerName ? ` for ${input.customerName}` : ''}`,
      status,
      source: input.source ?? LeadSource.AI_RECEPTIONIST,
      estimatedValueCents: input.estimatedValueCents ?? undefined,
      conversionProbability: this.probability(status),
      followUpAt:
        status === LeadStatus.BOOKING_READY
          ? new Date(Date.now() + 2 * 60 * 60_000)
          : new Date(Date.now() + 24 * 60 * 60_000),
      notes: input.notes ?? undefined,
    };

    if (input.bookingIntentId) {
      return this.prisma.lead.upsert({
        where: { bookingIntentId: input.bookingIntentId },
        create: lead,
        update: {
          customerId: lead.customerId,
          conversationId: lead.conversationId,
          assignedToId: lead.assignedToId,
          title: lead.title,
          status: lead.status,
          source: lead.source,
          estimatedValueCents: lead.estimatedValueCents,
          conversionProbability: lead.conversionProbability,
          followUpAt: lead.followUpAt,
          notes: lead.notes,
        },
        include: leadInclude,
      });
    }

    return this.prisma.lead.create({ data: lead, include: leadInclude });
  }

  sourceFromProvider(provider?: MessageProvider | null): LeadSource {
    if (provider === MessageProvider.WHATSAPP) return LeadSource.WHATSAPP;
    if (provider === MessageProvider.SMS) return LeadSource.SMS;
    if (provider === MessageProvider.EMAIL) return LeadSource.EMAIL;
    if (provider === MessageProvider.WEB_CHAT) return LeadSource.WEB_CHAT;
    return LeadSource.AI_RECEPTIONIST;
  }

  private statusFromIntent(input: LeadAutomationInput) {
    if (input.bookingId || input.intentStatus === BookingIntentStatus.BOOKED) {
      return LeadStatus.WON;
    }
    if (input.intentStatus === BookingIntentStatus.READY) {
      return LeadStatus.BOOKING_READY;
    }
    if (input.serviceTitle || input.estimatedValueCents) {
      return LeadStatus.QUALIFIED;
    }
    return LeadStatus.NEW;
  }

  private probability(status: LeadStatus) {
    const probabilities: Record<LeadStatus, number> = {
      NEW: 25,
      CONTACTED: 40,
      QUALIFIED: 60,
      BOOKING_READY: 85,
      WON: 100,
      LOST: 0,
    };
    return probabilities[status];
  }

  private async assertReferences(
    tenantId: string,
    dto: Partial<CreateLeadDto & UpdateLeadDto>,
  ) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw new BadRequestException('Customer not found');
    }
    if (dto.conversationId) {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId, tenantId },
        select: { id: true },
      });
      if (!conversation)
        throw new BadRequestException('Conversation not found');
    }
    if (dto.assignedToId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, tenantId, active: true },
        select: { id: true },
      });
      if (!user) throw new BadRequestException('Assignee not found');
    }
  }
}
