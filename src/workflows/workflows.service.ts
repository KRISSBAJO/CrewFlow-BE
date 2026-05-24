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
  LeadStatus,
  Prisma,
  SubscriptionStatus,
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

  async scanLeadFollowUps(user: AuthUser) {
    assertManager(user);
    const now = new Date();
    const staleCutoff = this.addHours(now, -6);
    const leads = await this.prisma.lead.findMany({
      where: {
        tenantId: user.tenantId,
        status: {
          in: [
            LeadStatus.NEW,
            LeadStatus.CONTACTED,
            LeadStatus.QUALIFIED,
            LeadStatus.BOOKING_READY,
          ],
        },
        OR: [
          { followUpAt: { lte: now } },
          {
            followUpAt: null,
            updatedAt: { lte: staleCutoff },
          },
        ],
      },
      include: { customer: true, assignedTo: true },
      orderBy: [{ followUpAt: 'asc' }, { updatedAt: 'asc' }],
      take: 100,
    });

    const actions: unknown[] = [];
    for (const lead of leads) {
      actions.push(
        await this.upsertAction({
          tenantId: user.tenantId,
          type: ActionType.FOLLOW_UP_STALE_INQUIRY,
          priority: this.leadPriority(
            lead.status,
            lead.conversionProbability,
            lead.estimatedValueCents ?? 0,
          ),
          title: `Follow up lead: ${lead.title}`,
          description: `${lead.customer?.name ?? 'A lead'} needs follow-up before the opportunity goes cold.`,
          customerId: lead.customerId,
          assignedToId: lead.assignedToId ?? user.sub,
          dueAt: now,
          metadata: {
            leadId: lead.id,
            leadStatus: lead.status,
            estimatedValueCents: lead.estimatedValueCents,
            conversionProbability: lead.conversionProbability,
            followUpAt: lead.followUpAt,
          },
        }),
      );

      if (lead.customerId) {
        await this.automations.trigger({
          tenantId: user.tenantId,
          trigger: AutomationTrigger.LEAD_FOLLOW_UP,
          customerId: lead.customerId,
          leadId: lead.id,
        });
      }
    }

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'LEAD_FOLLOW_UP_SCAN',
      entityType: 'Lead',
      summary: `Scanned leads and found ${leads.length} follow-ups due`,
      metadata: { count: leads.length },
    });

    return {
      scannedAt: now,
      count: leads.length,
      actionsCreatedOrUpdated: actions.length,
      items: leads,
      actions,
    };
  }

  async scanBillingRecovery(user: AuthUser) {
    assertManager(user);
    const result = await this.scanBillingRecoveryForTenant(
      user.tenantId,
      'manual-api',
      user.sub,
    );
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'BILLING_RECOVERY_SCAN',
      entityType: 'Tenant',
      summary: `Scanned billing recovery and found ${result.actionsCreatedOrUpdated}`,
      metadata: {
        scannedAt: result.scannedAt,
        subscriptionStatus: result.subscriptionStatus,
        usage: result.usage,
        limits: result.limits,
        actionsCreatedOrUpdated: result.actionsCreatedOrUpdated,
      },
    });
    return result;
  }

  async scanBillingRecoveryForTenant(
    tenantId: string,
    source = 'scheduler',
    actorId?: string,
  ) {
    const now = new Date();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        subscriptionStatus: true,
        monthlyPriceCents: true,
        nextBillingAt: true,
        pastDueAt: true,
        planLimits: true,
      },
    });
    const usage: Record<string, number> = await this.billingUsage(tenantId);
    const limits = this.asPlanLimits(tenant.planLimits);
    const actions: unknown[] = [];

    if (
      tenant.subscriptionStatus === SubscriptionStatus.PAST_DUE ||
      tenant.subscriptionStatus === SubscriptionStatus.UNPAID
    ) {
      const daysPastDue = tenant.pastDueAt
        ? this.daysBetween(tenant.pastDueAt, now)
        : 0;
      actions.push(
        await this.upsertAction({
          tenantId,
          type: ActionType.COLLECT_PAYMENT,
          priority:
            daysPastDue >= 7 ? ActionPriority.URGENT : ActionPriority.HIGH,
          title: 'Recover past-due CrewFlow subscription',
          description:
            'Billing is past due. Contact the owner, update payment details, or pause risky expansion until payment is recovered.',
          assignedToId: actorId,
          dueAt: now,
          metadata: {
            kind: 'billing_recovery',
            source,
            subscriptionStatus: tenant.subscriptionStatus,
            daysPastDue,
            monthlyPriceCents: tenant.monthlyPriceCents,
          },
        }),
      );
    }

    if (tenant.nextBillingAt) {
      const daysUntilBilling = Math.ceil(
        (tenant.nextBillingAt.getTime() - now.getTime()) / 86_400_000,
      );
      if (daysUntilBilling <= 3 && daysUntilBilling >= 0) {
        actions.push(
          await this.upsertAction({
            tenantId,
            type: ActionType.COLLECT_PAYMENT,
            priority: ActionPriority.MEDIUM,
            title: 'Upcoming CrewFlow renewal',
            description:
              'Renewal is coming up. Confirm billing contact and payment method are current.',
            assignedToId: actorId,
            dueAt: now,
            metadata: {
              kind: 'billing_renewal',
              source,
              nextBillingAt: tenant.nextBillingAt,
              daysUntilBilling,
              monthlyPriceCents: tenant.monthlyPriceCents,
            },
          }),
        );
      }
    }

    for (const [key, limit] of Object.entries(limits)) {
      const used = usage[key] ?? 0;
      if (limit > 0 && used / limit >= 0.8) {
        actions.push(
          await this.upsertAction({
            tenantId,
            type: ActionType.COLLECT_PAYMENT,
            priority:
              used >= limit ? ActionPriority.HIGH : ActionPriority.MEDIUM,
            title:
              used >= limit
                ? `Plan limit reached: ${this.humanizeLimit(key)}`
                : `Plan usage nearing limit: ${this.humanizeLimit(key)}`,
            description:
              used >= limit
                ? 'The team has hit a plan limit. Upgrade the plan before operations are blocked.'
                : 'Usage is above 80% of plan capacity. Start the upgrade conversation before work slows down.',
            assignedToId: actorId,
            dueAt: now,
            metadata: {
              kind: 'plan_usage_warning',
              source,
              limitKey: key,
              used,
              limit,
              percentUsed: Math.round((used / limit) * 100),
            },
          }),
        );
      }
    }

    return {
      scannedAt: now,
      subscriptionStatus: tenant.subscriptionStatus,
      usage,
      limits,
      actionsCreatedOrUpdated: actions.length,
      actions,
    };
  }

  async scanTrialExpiryForTenant(
    tenantId: string,
    source = 'scheduler',
    actorId?: string,
  ) {
    const now = new Date();
    const warningWindow = new Date(now.getTime() + 7 * 86_400_000);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        monthlyPriceCents: true,
      },
    });

    if (
      tenant.subscriptionStatus !== SubscriptionStatus.TRIALING ||
      !tenant.trialEndsAt ||
      tenant.trialEndsAt > warningWindow
    ) {
      return {
        scannedAt: now,
        subscriptionStatus: tenant.subscriptionStatus,
        trialEndsAt: tenant.trialEndsAt,
        actionsCreatedOrUpdated: 0,
        actions: [],
      };
    }

    const daysUntilTrialEnds = Math.ceil(
      (tenant.trialEndsAt.getTime() - now.getTime()) / 86_400_000,
    );
    const expired = daysUntilTrialEnds < 0;

    if (expired) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
          pastDueAt: now,
        },
      });
    }

    const action = await this.upsertAction({
      tenantId,
      type: ActionType.COLLECT_PAYMENT,
      priority: expired ? ActionPriority.URGENT : ActionPriority.HIGH,
      title: expired
        ? 'Convert expired CrewFlow trial'
        : 'Convert CrewFlow trial before it expires',
      description: expired
        ? 'The trial has expired. Collect payment details or decide whether to suspend access.'
        : 'The trial is ending soon. Confirm decision maker, payment method, and launch path.',
      assignedToId: actorId,
      dueAt: now,
      metadata: {
        kind: 'trial_expiry',
        source,
        trialEndsAt: tenant.trialEndsAt,
        daysUntilTrialEnds,
        monthlyPriceCents: tenant.monthlyPriceCents,
      },
    });

    return {
      scannedAt: now,
      subscriptionStatus: expired
        ? SubscriptionStatus.PAST_DUE
        : tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      actionsCreatedOrUpdated: 1,
      actions: [action],
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
    metadata?: Prisma.InputJsonValue;
  }) {
    const leadId = this.metadataLeadId(input.metadata);
    const metadataKey = this.metadataActionKey(input.metadata);
    const parts = [
      input.type,
      input.bookingId ?? 'no-booking',
      input.invoiceId ?? 'no-invoice',
      input.customerId ?? 'no-customer',
    ];
    if (leadId) {
      parts.push(leadId);
    }
    if (metadataKey) {
      parts.push(metadataKey);
    }
    return parts.join(':');
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

  private leadPriority(
    status: LeadStatus,
    probability: number,
    estimatedValueCents: number,
  ) {
    if (
      status === LeadStatus.BOOKING_READY ||
      probability >= 80 ||
      estimatedValueCents >= 50000
    ) {
      return ActionPriority.URGENT;
    }
    if (status === LeadStatus.QUALIFIED || probability >= 50) {
      return ActionPriority.HIGH;
    }
    return ActionPriority.MEDIUM;
  }

  private metadataLeadId(metadata?: Prisma.InputJsonValue) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const value = (metadata as Record<string, unknown>).leadId;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }

  private metadataActionKey(metadata?: Prisma.InputJsonValue) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const data = metadata as Record<string, unknown>;
      const kind = typeof data.kind === 'string' ? data.kind : null;
      const limitKey = typeof data.limitKey === 'string' ? data.limitKey : null;
      return [kind, limitKey].filter(Boolean).join(':') || null;
    }
    return null;
  }

  private async billingUsage(
    tenantId: string,
  ): Promise<Record<string, number>> {
    const now = new Date();
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    const [staff, customers, leads, monthlyBookings] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, active: true } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.lead.count({ where: { tenantId } }),
      this.prisma.booking.count({
        where: { tenantId, startTime: { gte: monthStart, lt: monthEnd } },
      }),
    ]);
    return { staff, customers, leads, monthlyBookings };
  }

  private asPlanLimits(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, limit]) => typeof limit === 'number',
      ),
    ) as Record<string, number>;
  }

  private humanizeLimit(value: string) {
    return value.replace(/([A-Z])/g, ' $1').toLowerCase();
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
