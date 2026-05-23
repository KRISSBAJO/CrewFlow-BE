import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateActionDto } from './dto/update-action.dto';

type BookingWorkflowInput = {
  id: string;
  tenantId: string;
  customerId: string;
  assignedStaffId?: string | null;
  status: BookingStatus;
  startTime?: Date;
  endTime?: Date | null;
  invoice?: { id: string; status: InvoiceStatus } | null;
};

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
    private readonly audit: AuditService,
  ) {}

  findActions(
    user: AuthUser,
    status?: ActionStatus,
    priority?: ActionPriority,
    type?: ActionType,
  ) {
    return this.prisma.operationalAction.findMany({
      where: {
        tenantId: user.tenantId,
        status: status ?? { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        priority,
        type,
      },
      include: {
        customer: true,
        booking: { include: { service: true, assignedStaff: true } },
        invoice: true,
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async updateAction(user: AuthUser, id: string, dto: UpdateActionDto) {
    assertManager(user);
    if (dto.assignedToId) {
      await this.assertUser(user.tenantId, dto.assignedToId);
    }

    const existing = await this.prisma.operationalAction.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Action not found');
    }

    const action = await this.prisma.operationalAction.update({
      where: { id },
      data: {
        status: dto.status,
        priority: dto.priority,
        assignedToId: dto.assignedToId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        completedAt:
          dto.status === ActionStatus.COMPLETED ? new Date() : undefined,
        dismissedAt:
          dto.status === ActionStatus.DISMISSED ? new Date() : undefined,
        metadata: {
          ...(existing.metadata as Record<string, unknown> | null),
          lastNote: dto.note,
          lastUpdatedBy: user.sub,
        },
      },
      include: {
        customer: true,
        booking: true,
        invoice: true,
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'OPERATIONAL_ACTION_UPDATED',
      entityType: 'OperationalAction',
      entityId: action.id,
      summary: `Updated action: ${action.title}`,
      metadata: { status: action.status, priority: action.priority },
    });

    return action;
  }

  async handleBookingStatusChanged(booking: BookingWorkflowInput) {
    if (booking.status === BookingStatus.CONFIRMED) {
      await this.upsertAction({
        tenantId: booking.tenantId,
        type: ActionType.DISPATCH_STAFF,
        priority: ActionPriority.MEDIUM,
        title: 'Prepare crew dispatch',
        description:
          'Confirm staff assignment and send technician on-the-way before arrival.',
        customerId: booking.customerId,
        bookingId: booking.id,
        assignedToId: booking.assignedStaffId,
        dueAt: booking.startTime
          ? this.minutesBefore(booking.startTime, 45)
          : undefined,
        metadata: { status: booking.status },
      });
      return;
    }

    if (booking.status === BookingStatus.IN_PROGRESS) {
      await this.completeActions(booking.tenantId, booking.id, [
        ActionType.DISPATCH_STAFF,
      ]);
      await this.automations.trigger({
        tenantId: booking.tenantId,
        trigger: AutomationTrigger.STAFF_ON_THE_WAY,
        customerId: booking.customerId,
        bookingId: booking.id,
      });
      return;
    }

    if (booking.status === BookingStatus.NO_SHOW) {
      await this.upsertAction({
        tenantId: booking.tenantId,
        type: ActionType.FOLLOW_UP_NO_SHOW,
        priority: ActionPriority.URGENT,
        title: 'Recover missed appointment',
        description:
          'Customer no-show detected. Follow up, reschedule, or collect cancellation fee.',
        customerId: booking.customerId,
        bookingId: booking.id,
        dueAt: new Date(),
        metadata: {
          lostRevenueRiskCents: await this.bookingRevenueRisk(booking.id),
        },
      });
      await this.automations.trigger({
        tenantId: booking.tenantId,
        trigger: AutomationTrigger.MISSED_APPOINTMENT,
        customerId: booking.customerId,
        bookingId: booking.id,
      });
      return;
    }

    if (booking.status === BookingStatus.COMPLETED) {
      await this.completeActions(booking.tenantId, booking.id, [
        ActionType.DISPATCH_STAFF,
        ActionType.CONFIRM_BOOKING,
      ]);
      if (!booking.invoice || booking.invoice.status !== InvoiceStatus.PAID) {
        await this.upsertAction({
          tenantId: booking.tenantId,
          type: ActionType.COLLECT_PAYMENT,
          priority: ActionPriority.HIGH,
          title: 'Collect payment after completed job',
          description:
            'The job is complete. Send or follow up on the invoice before the customer goes cold.',
          customerId: booking.customerId,
          bookingId: booking.id,
          invoiceId: booking.invoice?.id,
          dueAt: new Date(),
          metadata: { status: booking.status },
        });
      }
      await this.upsertAction({
        tenantId: booking.tenantId,
        type: ActionType.REQUEST_REVIEW,
        priority: ActionPriority.LOW,
        title: 'Request customer review',
        description: 'Ask for a review while the service experience is fresh.',
        customerId: booking.customerId,
        bookingId: booking.id,
        dueAt: this.addHours(new Date(), 2),
        metadata: { status: booking.status },
      });
      await this.automations.trigger({
        tenantId: booking.tenantId,
        trigger: AutomationTrigger.REVIEW_REQUEST,
        customerId: booking.customerId,
        bookingId: booking.id,
      });
    }
  }

  async scanOverdueInvoices(user: AuthUser) {
    assertManager(user);
    const now = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        dueDate: { lt: now },
      },
      include: { customer: true, booking: true },
      take: 200,
    });

    const updated = await Promise.all(
      invoices.map(async (invoice) => {
        const marked = await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.OVERDUE },
        });
        const action = await this.upsertAction({
          tenantId: user.tenantId,
          type: ActionType.COLLECT_PAYMENT,
          priority: this.invoicePriority(invoice.dueDate, invoice.totalCents),
          title: `Collect overdue invoice ${invoice.invoiceNo}`,
          description: `${invoice.customer.name} owes ${this.money(invoice.totalCents)}.`,
          customerId: invoice.customerId,
          bookingId: invoice.bookingId,
          invoiceId: invoice.id,
          dueAt: now,
          metadata: {
            totalCents: invoice.totalCents,
            dueDate: invoice.dueDate,
            daysOverdue: this.daysBetween(invoice.dueDate, now),
          },
        });
        await this.automations.trigger({
          tenantId: user.tenantId,
          trigger: AutomationTrigger.INVOICE_DUE,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          bookingId: invoice.bookingId ?? undefined,
        });
        return { invoice: marked, action };
      }),
    );

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'OVERDUE_INVOICE_SCAN',
      entityType: 'Invoice',
      summary: `Scanned overdue invoices and found ${updated.length}`,
      metadata: { count: updated.length },
    });

    return { scannedAt: now, count: updated.length, items: updated };
  }

  async scanLostRevenueRisk(user: AuthUser) {
    assertManager(user);
    const now = new Date();
    const staleRequested = await this.prisma.booking.findMany({
      where: {
        tenantId: user.tenantId,
        status: BookingStatus.REQUESTED,
        startTime: { lt: this.addHours(now, 24) },
      },
      include: { customer: true, service: true },
      take: 100,
    });
    const unassignedSoon = await this.prisma.booking.findMany({
      where: {
        tenantId: user.tenantId,
        assignedStaffId: null,
        status: BookingStatus.CONFIRMED,
        startTime: { gte: now, lt: this.addHours(now, 24) },
      },
      include: { customer: true, service: true },
      take: 100,
    });

    const actions: unknown[] = [];
    for (const booking of staleRequested) {
      actions.push(
        await this.upsertAction({
          tenantId: user.tenantId,
          type: ActionType.CONFIRM_BOOKING,
          priority: ActionPriority.HIGH,
          title: 'Confirm pending booking',
          description: `${booking.customer.name} requested ${booking.service.title}. Confirm or reschedule before it slips.`,
          customerId: booking.customerId,
          bookingId: booking.id,
          dueAt: now,
          metadata: {
            startTime: booking.startTime,
            riskCents: booking.service.priceCents,
          },
        }),
      );
    }
    for (const booking of unassignedSoon) {
      actions.push(
        await this.upsertAction({
          tenantId: user.tenantId,
          type: ActionType.DISPATCH_STAFF,
          priority: ActionPriority.URGENT,
          title: 'Assign staff before appointment',
          description: `${booking.service.title} is coming up with no assigned staff.`,
          customerId: booking.customerId,
          bookingId: booking.id,
          dueAt: now,
          metadata: {
            startTime: booking.startTime,
            riskCents: booking.service.priceCents,
          },
        }),
      );
    }

    return {
      scannedAt: now,
      staleRequested: staleRequested.length,
      unassignedSoon: unassignedSoon.length,
      actionsCreatedOrUpdated: actions.length,
      actions,
    };
  }

  private async upsertAction(input: {
    tenantId: string;
    type: ActionType;
    priority: ActionPriority;
    title: string;
    description?: string;
    customerId?: string | null;
    bookingId?: string | null;
    invoiceId?: string | null;
    assignedToId?: string | null;
    dueAt?: Date;
    metadata?: Prisma.InputJsonValue;
  }) {
    const idempotencyKey = this.actionKey(input);
    return this.prisma.operationalAction.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey,
        },
      },
      create: {
        tenantId: input.tenantId,
        type: input.type,
        priority: input.priority,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        bookingId: input.bookingId,
        invoiceId: input.invoiceId,
        assignedToId: input.assignedToId,
        dueAt: input.dueAt,
        idempotencyKey,
        metadata: input.metadata,
      },
      update: {
        priority: input.priority,
        status: ActionStatus.OPEN,
        title: input.title,
        description: input.description,
        assignedToId: input.assignedToId,
        dueAt: input.dueAt,
        metadata: input.metadata,
      },
    });
  }

  private actionKey(input: {
    type: ActionType;
    bookingId?: string | null;
    invoiceId?: string | null;
    customerId?: string | null;
  }) {
    return [
      input.type,
      input.bookingId ?? 'no-booking',
      input.invoiceId ?? 'no-invoice',
      input.customerId ?? 'no-customer',
    ].join(':');
  }

  private async completeActions(
    tenantId: string,
    bookingId: string,
    types: ActionType[],
  ) {
    await this.prisma.operationalAction.updateMany({
      where: {
        tenantId,
        bookingId,
        type: { in: types },
        status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
      },
      data: { status: ActionStatus.COMPLETED, completedAt: new Date() },
    });
  }

  private async bookingRevenueRisk(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true },
    });
    return booking?.service.priceCents ?? 0;
  }

  private async assertUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, active: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        'Assigned user does not belong to this tenant',
      );
    }
  }

  private invoicePriority(dueDate: Date, totalCents: number) {
    const days = this.daysBetween(dueDate, new Date());
    if (days >= 7 || totalCents >= 100000) return ActionPriority.URGENT;
    if (days >= 3 || totalCents >= 50000) return ActionPriority.HIGH;
    return ActionPriority.MEDIUM;
  }

  private daysBetween(from: Date, to: Date) {
    return Math.max(
      0,
      Math.floor((to.getTime() - from.getTime()) / 86_400_000),
    );
  }

  private minutesBefore(date: Date, minutes: number) {
    return new Date(date.getTime() - minutes * 60_000);
  }

  private addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60_000);
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  }
}
