import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ActionStatus,
  AutomationRunStatus,
  BillingEventType,
  LeadStatus,
  InvoiceStatus,
  Prisma,
  SubscriptionStatus,
  Tenant,
  TenantStatus,
  WebhookEventStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportAccessDto } from './dto/create-support-access.dto';
import { CreateBillingEventDto } from './dto/create-billing-event.dto';
import { CreatePlatformCheckoutDto } from './dto/create-platform-checkout.dto';
import { CreateSupportNoteDto } from './dto/create-support-note.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

type StripeCheckoutSession = {
  id: string;
  url?: string;
  customer?: string;
  subscription?: string;
};

type StripePortalSession = {
  id: string;
  url?: string;
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async metrics() {
    const [
      tenants,
      users,
      bookings,
      leads,
      openActions,
      failedAutomations,
      failedWebhooks,
      paidRevenue,
      mrr,
      pastDueTenants,
    ] = await Promise.all([
      this.prisma.tenant.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.booking.count(),
      this.prisma.lead.count(),
      this.prisma.operationalAction.count({
        where: {
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.automationRun.count({
        where: { status: AutomationRunStatus.FAILED },
      }),
      this.prisma.webhookEvent.count({
        where: { status: WebhookEventStatus.FAILED },
      }),
      this.prisma.invoice.aggregate({
        where: { status: InvoiceStatus.PAID },
        _sum: { totalCents: true },
      }),
      this.prisma.tenant.aggregate({
        where: { subscriptionStatus: SubscriptionStatus.ACTIVE },
        _sum: { monthlyPriceCents: true },
      }),
      this.prisma.tenant.count({
        where: {
          subscriptionStatus: {
            in: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID],
          },
        },
      }),
    ]);

    return {
      tenantStatus: tenants.reduce(
        (acc, row) => ({ ...acc, [row.status]: row._count._all }),
        {} as Record<TenantStatus, number>,
      ),
      activeUsers: users,
      bookings,
      leads,
      openActions,
      failedAutomations,
      failedWebhooks,
      paidRevenueCents: paidRevenue._sum.totalCents ?? 0,
      mrrCents: mrr._sum.monthlyPriceCents ?? 0,
      pastDueTenants,
    };
  }

  tenants() {
    return this.prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            users: true,
            customers: true,
            bookings: true,
            leads: true,
            invoices: true,
            operationalActions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  users() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            status: true,
            subscriptionStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async updateUser(user: AuthUser, id: string, dto: UpdatePlatformUserDto) {
    const target = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { tenant: true },
    });
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        email: dto.email?.toLowerCase().trim(),
        phone: dto.phone?.trim(),
        role: dto.role,
        active: dto.active,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        tenant: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            status: true,
            subscriptionStatus: true,
          },
        },
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_USER_UPDATED',
      entityType: 'User',
      entityId: id,
      summary: `Platform admin updated ${target.email}`,
      metadata: {
        targetTenantId: target.tenantId,
        targetTenant: target.tenant.businessName,
        role: dto.role,
        active: dto.active,
        email: dto.email,
      },
    });

    return updated;
  }

  actions() {
    return this.prisma.operationalAction.findMany({
      include: {
        tenant: true,
        customer: true,
        booking: { include: { service: true } },
        invoice: true,
        assignedTo: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  tenant(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        receptionistConfig: true,
        onboardingProfile: true,
        _count: {
          select: {
            customers: true,
            bookings: true,
            leads: true,
            invoices: true,
            operationalActions: true,
            automationRuns: true,
            webhookEvents: true,
          },
        },
      },
    });
  }

  async updateTenant(user: AuthUser, id: string, dto: UpdateTenantStatusDto) {
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: dto.status,
        subscriptionPlan: dto.subscriptionPlan,
        billingEmail: dto.billingEmail,
        monthlyPriceCents: dto.monthlyPriceCents,
        setupFeeCents: dto.setupFeeCents,
        subscriptionStatus: dto.subscriptionStatus,
        trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : undefined,
        currentPeriodEnd: dto.currentPeriodEnd
          ? new Date(dto.currentPeriodEnd)
          : undefined,
        nextBillingAt: dto.nextBillingAt
          ? new Date(dto.nextBillingAt)
          : undefined,
        stripeCustomerId: dto.stripeCustomerId,
        stripeSubscriptionId: dto.stripeSubscriptionId,
        pastDueAt:
          dto.subscriptionStatus === SubscriptionStatus.PAST_DUE ||
          dto.subscriptionStatus === SubscriptionStatus.UNPAID
            ? new Date()
            : dto.subscriptionStatus
              ? null
              : undefined,
        canceledAt:
          dto.subscriptionStatus === SubscriptionStatus.CANCELED
            ? new Date()
            : dto.subscriptionStatus
              ? null
              : undefined,
        featureFlags: dto.featureFlags as Prisma.InputJsonValue,
        planLimits: dto.planLimits as Prisma.InputJsonValue,
        suspendedAt: dto.status === TenantStatus.SUSPENDED ? new Date() : null,
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TENANT_UPDATED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin updated ${tenant.businessName}`,
      metadata: {
        status: dto.status,
        subscriptionPlan: dto.subscriptionPlan,
        billingEmail: dto.billingEmail,
        monthlyPriceCents: dto.monthlyPriceCents,
        setupFeeCents: dto.setupFeeCents,
        subscriptionStatus: dto.subscriptionStatus,
        trialEndsAt: dto.trialEndsAt,
        currentPeriodEnd: dto.currentPeriodEnd,
        nextBillingAt: dto.nextBillingAt,
        stripeCustomerId: dto.stripeCustomerId,
        stripeSubscriptionId: dto.stripeSubscriptionId,
        featureFlags: dto.featureFlags,
        planLimits: dto.planLimits,
      },
    });

    return tenant;
  }

  async tenantHealth(id: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [
      tenant,
      openActions,
      failedAutomations,
      failedWebhooks,
      overdueInvoices,
      hotLeads,
      recentBookings,
      activeUsers,
      recentAudit,
    ] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id } }),
      this.prisma.operationalAction.count({
        where: {
          tenantId: id,
          status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.automationRun.count({
        where: { tenantId: id, status: AutomationRunStatus.FAILED },
      }),
      this.prisma.webhookEvent.count({
        where: { tenantId: id, status: WebhookEventStatus.FAILED },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId: id,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.lead.count({
        where: {
          tenantId: id,
          status: { in: [LeadStatus.BOOKING_READY, LeadStatus.QUALIFIED] },
        },
      }),
      this.prisma.booking.count({
        where: { tenantId: id, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.user.count({ where: { tenantId: id, active: true } }),
      this.prisma.auditLog.findFirst({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    let score = 100;
    if (tenant.status === TenantStatus.SUSPENDED) score -= 40;
    if (tenant.status === TenantStatus.CHURNED) score -= 70;
    score -= Math.min(25, failedAutomations * 5 + failedWebhooks * 5);
    score -= Math.min(20, overdueInvoices * 4);
    score -= Math.min(15, openActions);
    if (recentBookings === 0) score -= 10;

    return {
      score: Math.max(0, score),
      status: tenant.status,
      openActions,
      failedAutomations,
      failedWebhooks,
      overdueInvoices,
      hotLeads,
      recentBookings,
      activeUsers,
      lastActivityAt: recentAudit?.createdAt ?? tenant.updatedAt,
    };
  }

  tenantUsage(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        businessName: true,
        featureFlags: true,
        planLimits: true,
        _count: {
          select: {
            users: true,
            customers: true,
            bookings: true,
            leads: true,
            invoices: true,
            automationRuns: true,
            messages: true,
          },
        },
      },
    });
  }

  supportNotes(id: string) {
    return this.prisma.platformSupportNote.findMany({
      where: { tenantId: id },
      include: { author: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async addSupportNote(user: AuthUser, id: string, dto: CreateSupportNoteDto) {
    const note = await this.prisma.platformSupportNote.create({
      data: {
        tenantId: id,
        authorId: user.sub,
        note: dto.note,
      },
      include: { author: { select: { id: true, email: true, role: true } } },
    });
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_SUPPORT_NOTE_CREATED',
      entityType: 'Tenant',
      entityId: id,
      summary: 'Platform admin added a support note',
      metadata: { tenantId: id },
    });
    return note;
  }

  supportAccess(id: string) {
    return this.prisma.platformSupportAccess.findMany({
      where: { tenantId: id },
      include: { admin: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  billingEvents(id: string) {
    return this.prisma.platformBillingEvent.findMany({
      where: { tenantId: id },
      include: { actor: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createBillingEvent(
    user: AuthUser,
    id: string,
    dto: CreateBillingEventDto,
  ) {
    const event = await this.prisma.platformBillingEvent.create({
      data: {
        tenantId: id,
        actorId: user.sub,
        type: dto.type,
        amountCents: dto.amountCents,
        provider: dto.provider ?? 'manual',
        note: dto.note,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
      include: { actor: { select: { id: true, email: true, role: true } } },
    });

    await this.applyBillingEventToTenant(id, dto);

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_BILLING_EVENT_CREATED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin recorded ${dto.type}`,
      metadata: {
        type: dto.type,
        amountCents: dto.amountCents,
        provider: dto.provider,
      },
    });

    return event;
  }

  async billingSummary(id: string) {
    const [tenant, events] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id } }),
      this.prisma.platformBillingEvent.findMany({
        where: { tenantId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const collectedCents = events
      .filter(
        (event) =>
          event.type === BillingEventType.SETUP_FEE_PAID ||
          event.type === BillingEventType.SUBSCRIPTION_STARTED ||
          event.type === BillingEventType.SUBSCRIPTION_RENEWED,
      )
      .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const failedCount = events.filter(
      (event) => event.type === BillingEventType.PAYMENT_FAILED,
    ).length;

    return {
      tenantId: id,
      subscriptionStatus: tenant.subscriptionStatus,
      monthlyPriceCents: tenant.monthlyPriceCents,
      setupFeeCents: tenant.setupFeeCents,
      billingEmail: tenant.billingEmail,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionId: tenant.stripeSubscriptionId,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      trialEndsAt: tenant.trialEndsAt,
      currentPeriodEnd: tenant.currentPeriodEnd,
      nextBillingAt: tenant.nextBillingAt,
      pastDueAt: tenant.pastDueAt,
      canceledAt: tenant.canceledAt,
      collectedCents,
      failedCount,
      events,
    };
  }

  async createBillingCheckout(
    user: AuthUser,
    id: string,
    dto: CreatePlatformCheckoutDto,
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
    });
    const monthlyPriceCents =
      dto.monthlyPriceCents ?? tenant.monthlyPriceCents ?? 29900;
    const setupFeeCents = dto.setupFeeCents ?? tenant.setupFeeCents ?? 0;
    const collectSetupFee = dto.collectSetupFee ?? setupFeeCents > 0;

    if (monthlyPriceCents <= 0) {
      throw new BadRequestException('Monthly price must be greater than zero');
    }

    const checkout = process.env.STRIPE_SECRET_KEY
      ? await this.createStripeSubscriptionCheckout({
          tenant,
          monthlyPriceCents,
          setupFeeCents: collectSetupFee ? setupFeeCents : 0,
          successUrl: dto.successUrl,
          cancelUrl: dto.cancelUrl,
        })
      : this.createMockSubscriptionCheckout(id);

    await this.prisma.tenant.update({
      where: { id },
      data: {
        monthlyPriceCents,
        setupFeeCents,
        stripeCustomerId: checkout.customerId ?? tenant.stripeCustomerId,
        stripeSubscriptionId:
          checkout.subscriptionId ?? tenant.stripeSubscriptionId,
      },
    });

    await this.prisma.platformBillingEvent.create({
      data: {
        tenantId: id,
        actorId: user.sub,
        type: BillingEventType.SETUP_FEE_INVOICED,
        amountCents: collectSetupFee ? setupFeeCents : monthlyPriceCents,
        provider: checkout.provider,
        providerEventId: checkout.sessionId,
        note: checkout.mock
          ? 'Mock platform subscription checkout created.'
          : 'Stripe platform subscription checkout created.',
        metadata: {
          checkoutUrl: checkout.url,
          monthlyPriceCents,
          setupFeeCents: collectSetupFee ? setupFeeCents : 0,
        },
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_BILLING_CHECKOUT_CREATED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin created billing checkout for ${tenant.businessName}`,
      metadata: {
        checkoutUrl: checkout.url,
        monthlyPriceCents,
        setupFeeCents: collectSetupFee ? setupFeeCents : 0,
        provider: checkout.provider,
      },
    });

    return checkout;
  }

  async createBillingPortal(user: AuthUser, id: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
    });
    if (!tenant.stripeCustomerId) {
      throw new BadRequestException(
        'Tenant does not have a Stripe customer yet',
      );
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('STRIPE_SECRET_KEY is not configured');
    }

    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const returnUrl =
      process.env.PLATFORM_BILLING_PORTAL_RETURN_URL ??
      process.env.PLATFORM_BILLING_SUCCESS_URL ??
      `${apiBase.replace('/api', '')}/admin`;
    const params = new URLSearchParams();
    params.set('customer', tenant.stripeCustomerId);
    params.set('return_url', returnUrl);

    const response = await fetch(
      'https://api.stripe.com/v1/billing_portal/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await response.text());
    }

    const session = (await response.json()) as StripePortalSession;
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_BILLING_PORTAL_CREATED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin opened billing portal for ${tenant.businessName}`,
      metadata: { customerId: tenant.stripeCustomerId },
    });

    return { provider: 'stripe', sessionId: session.id, url: session.url };
  }

  async markMockBillingSucceeded(id: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
    });
    const monthlyPriceCents = tenant.monthlyPriceCents ?? 29900;
    const setupFeeCents = tenant.setupFeeCents ?? 0;
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.ACTIVE,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          stripeCustomerId: tenant.stripeCustomerId ?? `mock_cus_${id}`,
          stripeSubscriptionId: tenant.stripeSubscriptionId ?? `mock_sub_${id}`,
          currentPeriodEnd: nextMonth,
          nextBillingAt: nextMonth,
          pastDueAt: null,
          canceledAt: null,
        },
      });
      if (setupFeeCents > 0) {
        await tx.platformBillingEvent.create({
          data: {
            tenantId: id,
            type: BillingEventType.SETUP_FEE_PAID,
            amountCents: setupFeeCents,
            provider: 'mock',
            providerEventId: `mock_setup_${id}_${Date.now()}`,
            note: 'Mock setup fee paid.',
          },
        });
      }
      await tx.platformBillingEvent.create({
        data: {
          tenantId: id,
          type: BillingEventType.SUBSCRIPTION_STARTED,
          amountCents: monthlyPriceCents,
          provider: 'mock',
          providerEventId: `mock_subscription_${id}_${Date.now()}`,
          note: 'Mock subscription started.',
        },
      });
    });

    return {
      status: 'ok',
      tenantId: id,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    };
  }

  async createSupportAccess(
    user: AuthUser,
    id: string,
    dto: CreateSupportAccessDto,
  ) {
    const token = `support_${randomBytes(18).toString('hex')}`;
    const access = await this.prisma.platformSupportAccess.create({
      data: {
        tenantId: id,
        adminId: user.sub,
        reason: dto.reason,
        token,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
      include: { admin: { select: { id: true, email: true, role: true } } },
    });
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_SUPPORT_ACCESS_CREATED',
      entityType: 'Tenant',
      entityId: id,
      summary: 'Platform admin created an audited support access token',
      metadata: {
        tenantId: id,
        reason: dto.reason,
        expiresAt: access.expiresAt,
      },
    });
    return access;
  }

  automationFailures() {
    return this.prisma.automationRun.findMany({
      where: { status: AutomationRunStatus.FAILED },
      include: { tenant: true, customer: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  webhookFailures() {
    return this.prisma.webhookEvent.findMany({
      where: { status: WebhookEventStatus.FAILED },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  auditLogs() {
    return this.prisma.auditLog.findMany({
      include: {
        tenant: true,
        actor: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async createStripeSubscriptionCheckout(input: {
    tenant: Tenant;
    monthlyPriceCents: number;
    setupFeeCents: number;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('STRIPE_SECRET_KEY is not configured');
    }

    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const successUrl =
      input.successUrl ??
      process.env.PLATFORM_BILLING_SUCCESS_URL ??
      `${apiBase.replace('/api', '')}/admin?billing=success`;
    const cancelUrl =
      input.cancelUrl ??
      process.env.PLATFORM_BILLING_CANCEL_URL ??
      `${apiBase.replace('/api', '')}/admin?billing=cancel`;

    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('client_reference_id', input.tenant.id);
    if (input.tenant.billingEmail) {
      params.set('customer_email', input.tenant.billingEmail);
    }
    if (input.tenant.stripeCustomerId) {
      params.delete('customer_email');
      params.set('customer', input.tenant.stripeCustomerId);
    }
    params.set('metadata[kind]', 'platform_subscription');
    params.set('metadata[tenantId]', input.tenant.id);
    params.set(
      'metadata[monthlyPriceCents]',
      input.monthlyPriceCents.toString(),
    );
    params.set('metadata[setupFeeCents]', input.setupFeeCents.toString());
    params.set('subscription_data[metadata][kind]', 'platform_subscription');
    params.set('subscription_data[metadata][tenantId]', input.tenant.id);
    params.set(
      'subscription_data[metadata][monthlyPriceCents]',
      input.monthlyPriceCents.toString(),
    );
    params.set(
      'subscription_data[metadata][setupFeeCents]',
      input.setupFeeCents.toString(),
    );
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set(
      'line_items[0][price_data][unit_amount]',
      input.monthlyPriceCents.toString(),
    );
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${input.tenant.businessName} CrewFlow subscription`,
    );

    if (input.setupFeeCents > 0) {
      params.set('line_items[1][quantity]', '1');
      params.set('line_items[1][price_data][currency]', 'usd');
      params.set(
        'line_items[1][price_data][unit_amount]',
        input.setupFeeCents.toString(),
      );
      params.set(
        'line_items[1][price_data][product_data][name]',
        `${input.tenant.businessName} CrewFlow setup`,
      );
    }

    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    if (!response.ok) {
      throw new BadRequestException(await response.text());
    }

    const session = (await response.json()) as StripeCheckoutSession;
    return {
      provider: 'stripe',
      mock: false,
      url: session.url ?? null,
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription,
    };
  }

  private createMockSubscriptionCheckout(tenantId: string) {
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    return {
      provider: 'mock',
      mock: true,
      url: `${apiBase}/platform/mock-billing/${tenantId}/success`,
      sessionId: `mock_platform_${tenantId}_${Date.now()}`,
      customerId: `mock_cus_${tenantId}`,
      subscriptionId: `mock_sub_${tenantId}`,
    };
  }

  private async applyBillingEventToTenant(
    tenantId: string,
    dto: CreateBillingEventDto,
  ) {
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    if (
      dto.type === BillingEventType.SUBSCRIPTION_STARTED ||
      dto.type === BillingEventType.SUBSCRIPTION_RENEWED
    ) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          status: TenantStatus.ACTIVE,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          monthlyPriceCents: dto.amountCents,
          currentPeriodEnd: nextMonth,
          nextBillingAt: nextMonth,
          pastDueAt: null,
          canceledAt: null,
        },
      });
    }

    if (
      dto.type === BillingEventType.PAYMENT_FAILED ||
      dto.type === BillingEventType.PAST_DUE
    ) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
          pastDueAt: now,
        },
      });
    }

    if (dto.type === BillingEventType.CANCELED) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          status: TenantStatus.CHURNED,
          subscriptionStatus: SubscriptionStatus.CANCELED,
          canceledAt: now,
        },
      });
    }
  }
}
