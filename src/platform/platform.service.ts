import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ActionStatus,
  AutomationRunStatus,
  BillingEventType,
  LeadStatus,
  InvoiceStatus,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
  Tenant,
  TenantStatus,
  UserRole,
  WebhookEventStatus,
  WebhookProvider,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/current-user.decorator';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappWebhookService } from '../webhooks/whatsapp-webhook.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { ArchiveTenantDto } from './dto/archive-tenant.dto';
import { ApplySubscriptionPlanDto } from './dto/apply-subscription-plan.dto';
import { CreateSupportAccessDto } from './dto/create-support-access.dto';
import { CreateBillingEventDto } from './dto/create-billing-event.dto';
import { CreatePlatformCheckoutDto } from './dto/create-platform-checkout.dto';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { CreateSupportNoteDto } from './dto/create-support-note.dto';
import { ReplayPlatformFailureDto } from './dto/replay-platform-failure.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpsertSubscriptionPlanDto } from './dto/upsert-subscription-plan.dto';
import {
  ProviderWorkflowTarget,
  VerifyProviderWorkflowDto,
} from './dto/verify-provider-workflow.dto';
import { UpdateActionDto } from '../workflows/dto/update-action.dto';

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

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

type PlatformAuditFilters = {
  tenantId?: string;
  action?: string;
  q?: string;
  limit?: string;
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly automations: AutomationsService,
    private readonly payments: PaymentsService,
    private readonly whatsAppWebhooks: WhatsappWebhookService,
    private readonly workflows: WorkflowsService,
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

  async providerHealth() {
    const [
      webhookStatus,
      failedAutomations,
      pendingAutomations,
      recentWebhooks,
      recentRuns,
    ] = await Promise.all([
      this.prisma.webhookEvent.groupBy({
        by: ['provider', 'status'],
        _count: { _all: true },
      }),
      this.prisma.automationRun.count({
        where: { status: AutomationRunStatus.FAILED },
      }),
      this.prisma.automationRun.count({
        where: { status: AutomationRunStatus.PENDING },
      }),
      this.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        include: { tenant: true },
        take: 10,
      }),
      this.prisma.automationRun.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { tenant: true, customer: true },
        take: 10,
      }),
    ]);

    const webhooks = Object.values(WebhookProvider).reduce(
      (acc, provider) => {
        const rows = webhookStatus.filter((item) => item.provider === provider);
        acc[provider] = rows.reduce(
          (counts, row) => ({
            ...counts,
            [row.status]: row._count._all,
          }),
          {} as Record<WebhookEventStatus, number>,
        );
        return acc;
      },
      {} as Record<WebhookProvider, Record<WebhookEventStatus, number>>,
    );

    return {
      checkedAt: new Date(),
      integrations: {
        whatsapp: {
          configured: Boolean(
            process.env.WHATSAPP_ACCESS_TOKEN &&
            process.env.WHATSAPP_PHONE_NUMBER_ID,
          ),
          verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
          appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
        },
        stripe: {
          configured: Boolean(process.env.STRIPE_SECRET_KEY),
          webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        },
        paystack: {
          configured: Boolean(process.env.PAYSTACK_SECRET_KEY),
          currency: process.env.PAYSTACK_CURRENCY ?? 'NGN',
          platformPlanConfigured: Boolean(
            process.env.PAYSTACK_PLATFORM_PLAN_CODE,
          ),
          tenantPlanConfigured: Boolean(process.env.PAYSTACK_TENANT_PLAN_CODE),
        },
      },
      queues: {
        failedAutomations,
        pendingAutomations,
      },
      webhooks,
      recentWebhooks,
      recentRuns,
    };
  }

  async scanTrialExpiry(user: AuthUser) {
    const tenants = await this.prisma.tenant.findMany({
      where: { subscriptionStatus: SubscriptionStatus.TRIALING },
      select: { id: true },
    });
    const results: Array<
      Awaited<ReturnType<WorkflowsService['scanTrialExpiryForTenant']>>
    > = [];
    for (const tenant of tenants) {
      results.push(
        await this.workflows.scanTrialExpiryForTenant(
          tenant.id,
          'platform-admin',
          user.sub,
        ),
      );
    }
    const actionsCreatedOrUpdated = results.reduce(
      (sum, item) => sum + item.actionsCreatedOrUpdated,
      0,
    );
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TRIAL_EXPIRY_SCAN',
      entityType: 'Tenant',
      summary: `Scanned ${tenants.length} trials and surfaced ${actionsCreatedOrUpdated} actions`,
      metadata: { tenantCount: tenants.length, actionsCreatedOrUpdated },
    });
    return {
      scannedAt: new Date(),
      tenantCount: tenants.length,
      actionsCreatedOrUpdated,
      results,
    };
  }

  async scanPastDueBilling(user: AuthUser) {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        subscriptionStatus: {
          in: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID],
        },
      },
      select: { id: true },
    });
    const results: Array<
      Awaited<ReturnType<WorkflowsService['scanBillingRecoveryForTenant']>>
    > = [];
    for (const tenant of tenants) {
      results.push(
        await this.workflows.scanBillingRecoveryForTenant(
          tenant.id,
          'platform-admin',
          user.sub,
        ),
      );
    }
    const actionsCreatedOrUpdated = results.reduce(
      (sum, item) => sum + item.actionsCreatedOrUpdated,
      0,
    );
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_PAST_DUE_BILLING_SCAN',
      entityType: 'Tenant',
      summary: `Scanned ${tenants.length} past-due tenants and surfaced ${actionsCreatedOrUpdated} actions`,
      metadata: { tenantCount: tenants.length, actionsCreatedOrUpdated },
    });
    return {
      scannedAt: new Date(),
      tenantCount: tenants.length,
      actionsCreatedOrUpdated,
      results,
    };
  }

  tenants() {
    return this.prisma.tenant.findMany({
      include: {
        plan: true,
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

  plans() {
    return this.prisma.subscriptionPlan.findMany({
      include: { _count: { select: { tenants: true } } },
      orderBy: [{ sortOrder: 'asc' }, { monthlyPriceCents: 'asc' }],
    });
  }

  async createPlan(user: AuthUser, dto: UpsertSubscriptionPlanDto) {
    this.assertSuperAdmin(user, 'create subscription plans');
    if (!dto.name?.trim()) throw new BadRequestException('Plan name is required');
    const slug = await this.uniquePlanSlug(dto.slug ?? dto.name);
    const plan = await this.prisma.subscriptionPlan.create({
      data: this.planData(
        dto,
        slug,
      ) as Prisma.SubscriptionPlanUncheckedCreateInput,
      include: { _count: { select: { tenants: true } } },
    });
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_PLAN_CREATED',
      entityType: 'SubscriptionPlan',
      entityId: plan.id,
      summary: `Platform admin created plan ${plan.name}`,
      metadata: { slug: plan.slug, monthlyPriceCents: plan.monthlyPriceCents },
    });
    return plan;
  }

  async updatePlan(
    user: AuthUser,
    id: string,
    dto: UpsertSubscriptionPlanDto,
  ) {
    this.assertSuperAdmin(user, 'update subscription plans');
    const slug = dto.slug ? await this.uniquePlanSlug(dto.slug, id) : undefined;
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: this.planData(
        dto,
        slug,
      ) as Prisma.SubscriptionPlanUncheckedUpdateInput,
      include: { _count: { select: { tenants: true } } },
    });
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_PLAN_UPDATED',
      entityType: 'SubscriptionPlan',
      entityId: plan.id,
      summary: `Platform admin updated plan ${plan.name}`,
      metadata: { slug: plan.slug, active: plan.active },
    });
    return plan;
  }

  async riskBoard() {
    const tenants = await this.prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            users: true,
            customers: true,
            bookings: true,
            invoices: true,
            leads: true,
            operationalActions: true,
            automationRuns: true,
            webhookEvents: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const rows = await Promise.all(
      tenants.map(async (tenant) => {
        const [
          failedAutomations,
          failedWebhooks,
          openActions,
          overdueInvoices,
          hotLeads,
          recentBookings,
          lastAudit,
          activeSupportSessions,
        ] = await Promise.all([
          this.prisma.automationRun.count({
            where: { tenantId: tenant.id, status: AutomationRunStatus.FAILED },
          }),
          this.prisma.webhookEvent.count({
            where: { tenantId: tenant.id, status: WebhookEventStatus.FAILED },
          }),
          this.prisma.operationalAction.count({
            where: {
              tenantId: tenant.id,
              status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] },
            },
          }),
          this.prisma.invoice.count({
            where: {
              tenantId: tenant.id,
              status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
              dueDate: { lt: now },
            },
          }),
          this.prisma.lead.count({
            where: {
              tenantId: tenant.id,
              status: { in: [LeadStatus.BOOKING_READY, LeadStatus.QUALIFIED] },
            },
          }),
          this.prisma.booking.count({
            where: { tenantId: tenant.id, createdAt: { gte: thirtyDaysAgo } },
          }),
          this.prisma.auditLog.findFirst({
            where: { tenantId: tenant.id },
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.platformSupportAccess.count({
            where: {
              tenantId: tenant.id,
              expiresAt: { gt: now },
              revokedAt: null,
            },
          }),
        ]);

        let score = 100;
        const reasons: string[] = [];
        const subtract = (points: number, reason: string) => {
          score -= points;
          reasons.push(reason);
        };
        if (tenant.status === TenantStatus.SUSPENDED)
          subtract(25, 'Suspended tenant');
        if (tenant.status === TenantStatus.ARCHIVED)
          subtract(40, 'Archived tenant');
        if (tenant.status === TenantStatus.CHURNED)
          subtract(60, 'Churned tenant');
        if (
          tenant.subscriptionStatus === SubscriptionStatus.PAST_DUE ||
          tenant.subscriptionStatus === SubscriptionStatus.UNPAID
        ) {
          subtract(25, 'Past due billing');
        }
        if (failedAutomations)
          subtract(
            Math.min(20, failedAutomations * 4),
            `${failedAutomations} failed automations`,
          );
        if (failedWebhooks)
          subtract(
            Math.min(20, failedWebhooks * 5),
            `${failedWebhooks} failed webhooks`,
          );
        if (overdueInvoices)
          subtract(
            Math.min(20, overdueInvoices * 4),
            `${overdueInvoices} overdue invoices`,
          );
        if (openActions > 5) subtract(10, 'Action queue piling up');
        if (recentBookings === 0 && tenant.status === TenantStatus.ACTIVE)
          subtract(10, 'No recent bookings');
        if (activeSupportSessions)
          reasons.push(`${activeSupportSessions} active support sessions`);
        if (!reasons.length) reasons.push('Healthy');

        return {
          tenant,
          score: Math.max(0, score),
          severity:
            score < 45 ? 'critical' : score < 70 ? 'warning' : 'healthy',
          reasons,
          failedAutomations,
          failedWebhooks,
          openActions,
          overdueInvoices,
          hotLeads,
          recentBookings,
          activeSupportSessions,
          lastActivityAt: lastAudit?.createdAt ?? tenant.updatedAt,
        };
      }),
    );

    return rows.sort((a, b) => a.score - b.score);
  }

  supportSessions() {
    return this.prisma.platformSupportAccess.findMany({
      include: {
        tenant: true,
        admin: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 120,
    });
  }

  async createTenant(user: AuthUser, dto: CreatePlatformTenantDto) {
    this.assertSuperAdmin(user, 'create tenants');
    const slug = await this.uniqueTenantSlug(dto.slug ?? dto.businessName);
    const plan = dto.subscriptionPlanId
      ? await this.prisma.subscriptionPlan.findUniqueOrThrow({
          where: { id: dto.subscriptionPlanId },
        })
      : null;
    const passwordHash = await bcrypt.hash(dto.ownerPassword, 12);
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          businessName: dto.businessName.trim(),
          slug,
          industry: dto.industry.trim(),
          status: dto.status ?? TenantStatus.TRIAL,
          subscriptionStatus:
            dto.subscriptionStatus ?? SubscriptionStatus.TRIALING,
          subscriptionPlan:
            plan?.slug ?? dto.subscriptionPlan?.trim() ?? 'pilot',
          subscriptionPlanId: plan?.id,
          billingEmail: dto.ownerEmail.toLowerCase().trim(),
          monthlyPriceCents:
            dto.monthlyPriceCents ?? plan?.monthlyPriceCents ?? 29900,
          setupFeeCents: dto.setupFeeCents ?? plan?.setupFeeCents ?? 100000,
          featureFlags: dto.featureFlags ?? plan?.featureFlags ?? {
            aiReceptionist: true,
            leadPipeline: true,
            retention: true,
            whatsappAutomation: true,
          },
          planLimits: dto.planLimits ?? plan?.planLimits ?? {
            staff: 10,
            monthlyBookings: 200,
            monthlyMessages: 2000,
          },
          onboardingProfile: {
            create: {
              ownerName: dto.ownerName.trim(),
              ownerEmail: dto.ownerEmail.toLowerCase().trim(),
              ownerPhone: dto.ownerPhone?.trim(),
              services: [],
              biggestProblem: 'Platform-created tenant',
              setupStatus: 'NEEDS_SETUP',
            },
          },
        },
      });
      await tx.user.create({
        data: {
          tenantId: created.id,
          name: dto.ownerName.trim(),
          email: dto.ownerEmail.toLowerCase().trim(),
          passwordHash,
          phone: dto.ownerPhone?.trim(),
          role: UserRole.OWNER,
        },
      });
      return created;
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TENANT_CREATED',
      entityType: 'Tenant',
      entityId: tenant.id,
      summary: `Platform admin created ${tenant.businessName}`,
      metadata: { slug: tenant.slug, ownerEmail: dto.ownerEmail },
    });

    return this.tenant(tenant.id);
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

  async createUser(user: AuthUser, dto: CreatePlatformUserDto) {
    this.assertSuperAdmin(user, 'create users');
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: dto.tenantId } });
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        phone: dto.phone?.trim(),
        role: dto.role,
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
      action: 'PLATFORM_USER_CREATED',
      entityType: 'User',
      entityId: created.id,
      summary: `Platform admin created ${created.email}`,
      metadata: { targetTenantId: dto.tenantId, role: dto.role },
    });

    return created;
  }

  async updateUser(user: AuthUser, id: string, dto: UpdatePlatformUserDto) {
    this.assertSuperAdmin(user, 'update users');
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
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async updateAction(user: AuthUser, id: string, dto: UpdateActionDto) {
    const existing = await this.prisma.operationalAction.findUniqueOrThrow({
      where: { id },
    });
    if (dto.assignedToId) {
      await this.prisma.user.findFirstOrThrow({
        where: { id: dto.assignedToId, tenantId: existing.tenantId },
      });
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
          platformNote: dto.note,
          platformUpdatedBy: user.sub,
        },
      },
      include: {
        tenant: true,
        customer: true,
        booking: { include: { service: true } },
        invoice: true,
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_ACTION_UPDATED',
      entityType: 'OperationalAction',
      entityId: id,
      summary: `Platform admin updated action: ${action.title}`,
      metadata: {
        targetTenantId: action.tenantId,
        status: action.status,
        priority: action.priority,
      },
    });

    return action;
  }

  tenant(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        plan: true,
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
    if (
      user.role !== UserRole.PLATFORM_ADMIN &&
      (dto.status ||
        dto.subscriptionStatus ||
        dto.subscriptionPlan ||
        dto.subscriptionPlanId ||
        dto.monthlyPriceCents !== undefined ||
        dto.setupFeeCents !== undefined ||
        dto.stripeCustomerId ||
        dto.stripeSubscriptionId ||
        dto.paystackCustomerCode ||
        dto.paystackSubscriptionCode)
    ) {
      throw new ForbiddenException(
        'Platform support can update flags and limits only',
      );
    }
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: dto.status,
        subscriptionPlan: dto.subscriptionPlan,
        subscriptionPlanId: dto.subscriptionPlanId,
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
        paystackCustomerCode: dto.paystackCustomerCode,
        paystackSubscriptionCode: dto.paystackSubscriptionCode,
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
        subscriptionPlanId: dto.subscriptionPlanId,
        billingEmail: dto.billingEmail,
        monthlyPriceCents: dto.monthlyPriceCents,
        setupFeeCents: dto.setupFeeCents,
        subscriptionStatus: dto.subscriptionStatus,
        trialEndsAt: dto.trialEndsAt,
        currentPeriodEnd: dto.currentPeriodEnd,
        nextBillingAt: dto.nextBillingAt,
        stripeCustomerId: dto.stripeCustomerId,
        stripeSubscriptionId: dto.stripeSubscriptionId,
        paystackCustomerCode: dto.paystackCustomerCode,
        paystackSubscriptionCode: dto.paystackSubscriptionCode,
        featureFlags: dto.featureFlags,
        planLimits: dto.planLimits,
      },
    });

    return tenant;
  }

  async applyPlan(
    user: AuthUser,
    id: string,
    dto: ApplySubscriptionPlanDto,
  ) {
    this.assertSuperAdmin(user, 'apply subscription plans');
    const plan = await this.prisma.subscriptionPlan.findUniqueOrThrow({
      where: { id: dto.planId },
    });
    const overwriteBilling = dto.overwriteBilling ?? true;
    const overwriteFeatures = dto.overwriteFeatures ?? true;
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        subscriptionPlanId: plan.id,
        subscriptionPlan: plan.slug,
        ...(overwriteBilling
          ? {
              monthlyPriceCents: plan.monthlyPriceCents,
              setupFeeCents: plan.setupFeeCents,
            }
          : {}),
        ...(overwriteFeatures
          ? {
              featureFlags: plan.featureFlags as Prisma.InputJsonValue,
              planLimits: plan.planLimits as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_PLAN_APPLIED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin applied ${plan.name} to ${tenant.businessName}`,
      metadata: {
        planId: plan.id,
        planSlug: plan.slug,
        overwriteBilling,
        overwriteFeatures,
      },
    });
    return this.tenant(id);
  }

  async archiveTenant(user: AuthUser, id: string, dto: ArchiveTenantDto) {
    this.assertSuperAdmin(user, 'archive tenants');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
    });
    if (dto.confirmation !== tenant.businessName) {
      throw new BadRequestException(
        'Confirmation must exactly match the tenant business name',
      );
    }

    const archived = await this.prisma.tenant.update({
      where: { id },
      data: {
        status: TenantStatus.ARCHIVED,
        suspendedAt: new Date(),
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TENANT_ARCHIVED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin archived ${tenant.businessName}`,
      metadata: { reason: dto.reason, confirmation: dto.confirmation },
    });

    return archived;
  }

  async restoreTenant(user: AuthUser, id: string) {
    this.assertSuperAdmin(user, 'restore tenants');
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: TenantStatus.ACTIVE, suspendedAt: null },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TENANT_RESTORED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin restored ${tenant.businessName}`,
      metadata: { restoredStatus: tenant.status },
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
    if (tenant.status === TenantStatus.ARCHIVED) score -= 60;
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

  async search(q?: string) {
    const needle = q?.trim();
    if (!needle || needle.length < 2) {
      throw new BadRequestException('Search requires at least 2 characters');
    }
    const contains = { contains: needle, mode: Prisma.QueryMode.insensitive };
    const [tenants, users, customers, bookings, leads, invoices] =
      await Promise.all([
        this.prisma.tenant.findMany({
          where: {
            OR: [
              { businessName: contains },
              { slug: contains },
              { industry: contains },
              { billingEmail: contains },
            ],
          },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.user.findMany({
          where: { OR: [{ name: contains }, { email: contains }] },
          select: {
            id: true,
            tenantId: true,
            name: true,
            email: true,
            role: true,
            active: true,
            tenant: { select: { id: true, businessName: true, slug: true } },
          },
          take: 10,
        }),
        this.prisma.customer.findMany({
          where: {
            OR: [{ name: contains }, { phone: contains }, { email: contains }],
          },
          include: { tenant: true },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.booking.findMany({
          where: {
            OR: [
              { notes: contains },
              { customer: { name: contains } },
              { service: { title: contains } },
            ],
          },
          include: { tenant: true, customer: true, service: true },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.lead.findMany({
          where: {
            OR: [
              { title: contains },
              { notes: contains },
              { wonLostReason: contains },
              { customer: { name: contains } },
            ],
          },
          include: { tenant: true, customer: true },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.invoice.findMany({
          where: {
            OR: [{ invoiceNo: contains }, { customer: { name: contains } }],
          },
          include: { tenant: true, customer: true },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
      ]);

    return {
      query: needle,
      tenants,
      users,
      customers,
      bookings,
      leads,
      invoices,
    };
  }

  async tenantTimeline(id: string) {
    const [audit, billing, support, automationFailures, webhookFailures] =
      await Promise.all([
        this.prisma.auditLog.findMany({
          where: { OR: [{ tenantId: id }, { entityId: id }] },
          include: { actor: { select: { id: true, email: true, role: true } } },
          orderBy: { createdAt: 'desc' },
          take: 80,
        }),
        this.prisma.platformBillingEvent.findMany({
          where: { tenantId: id },
          include: { actor: { select: { id: true, email: true, role: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.platformSupportNote.findMany({
          where: { tenantId: id },
          include: {
            author: { select: { id: true, email: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.automationRun.findMany({
          where: { tenantId: id, status: AutomationRunStatus.FAILED },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        }),
        this.prisma.webhookEvent.findMany({
          where: { tenantId: id, status: WebhookEventStatus.FAILED },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
      ]);

    return [
      ...audit.map((item) => ({
        id: item.id,
        kind: 'audit',
        title: item.action,
        summary: item.summary,
        createdAt: item.createdAt,
        actor: item.actor,
      })),
      ...billing.map((item) => ({
        id: item.id,
        kind: 'billing',
        title: item.type,
        summary: item.note ?? item.provider,
        amountCents: item.amountCents,
        createdAt: item.createdAt,
        actor: item.actor,
      })),
      ...support.map((item) => ({
        id: item.id,
        kind: 'support',
        title: 'Support note',
        summary: item.note,
        createdAt: item.createdAt,
        actor: item.author,
      })),
      ...automationFailures.map((item) => ({
        id: item.id,
        kind: 'automation_failure',
        title: item.trigger,
        summary: item.error,
        createdAt: item.updatedAt,
      })),
      ...webhookFailures.map((item) => ({
        id: item.id,
        kind: 'webhook_failure',
        title: `${item.provider} webhook`,
        summary: item.error,
        createdAt: item.createdAt,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async exportTenant(user: AuthUser, id: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
            createdAt: true,
          },
        },
        customers: true,
        services: true,
        bookings: true,
        invoices: true,
        payments: true,
        leads: true,
        conversations: true,
        messages: true,
        automationRuns: true,
        webhookEvents: true,
        operationalActions: true,
        supportNotes: true,
        billingEvents: true,
        auditLogs: true,
      },
    });

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_TENANT_EXPORTED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin exported ${tenant.businessName}`,
      metadata: {
        users: tenant.users.length,
        customers: tenant.customers.length,
        bookings: tenant.bookings.length,
        invoices: tenant.invoices.length,
      },
    });

    return { exportedAt: new Date().toISOString(), tenant };
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
    this.assertSuperAdmin(user, 'manage billing events');
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
      paystackCustomerCode: tenant.paystackCustomerCode,
      paystackSubscriptionCode: tenant.paystackSubscriptionCode,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
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
    this.assertSuperAdmin(user, 'create billing checkout sessions');
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

    const provider = this.billingProvider(dto.provider);
    const checkout =
      provider === 'stripe'
        ? await this.createStripeSubscriptionCheckout({
            tenant,
            monthlyPriceCents,
            setupFeeCents: collectSetupFee ? setupFeeCents : 0,
            successUrl: dto.successUrl,
            cancelUrl: dto.cancelUrl,
            currency: dto.currency,
          })
        : provider === 'paystack'
          ? await this.createPaystackSubscriptionCheckout({
              tenant,
              monthlyPriceCents,
              setupFeeCents: collectSetupFee ? setupFeeCents : 0,
              successUrl: dto.successUrl,
              currency: dto.currency,
              paystackPlanCode: dto.paystackPlanCode,
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
        paystackCustomerCode:
          checkout.paystackCustomerCode ?? tenant.paystackCustomerCode,
        paystackSubscriptionCode:
          checkout.paystackSubscriptionCode ?? tenant.paystackSubscriptionCode,
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
          : `${checkout.provider} platform subscription checkout created.`,
        metadata: {
          checkoutUrl: checkout.url,
          monthlyPriceCents,
          setupFeeCents: collectSetupFee ? setupFeeCents : 0,
          currency: checkout.currency,
          paystackPlanCode: dto.paystackPlanCode,
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
    this.assertSuperAdmin(user, 'open billing portals');
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

  async verifyProviderWorkflows(
    user: AuthUser,
    id: string,
    dto: VerifyProviderWorkflowDto,
  ) {
    this.assertSuperAdmin(user, 'verify payment provider workflows');
    await this.prisma.tenant.findUniqueOrThrow({ where: { id } });
    const providers =
      dto.provider === ProviderWorkflowTarget.ALL || !dto.provider
        ? [PaymentProvider.STRIPE, PaymentProvider.PAYSTACK]
        : [
            dto.provider as
              | typeof PaymentProvider.STRIPE
              | typeof PaymentProvider.PAYSTACK,
          ];
    const results = await Promise.all(
      providers.map((provider) =>
        this.payments.verifyProviderWorkflow({
          tenantId: id,
          provider,
          actorId: user.sub,
        }),
      ),
    );

    await this.auditService.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_PROVIDER_WORKFLOWS_VERIFIED',
      entityType: 'Tenant',
      entityId: id,
      summary: `Platform admin verified ${providers.join(', ')} billing workflows`,
      metadata: {
        providers,
        checks: results.map((result) => ({
          provider: result.provider,
          checks: result.checks,
        })),
      },
    });

    return {
      tenantId: id,
      providers,
      passed: results.every((result) =>
        Object.values(result.checks).every(Boolean),
      ),
      results,
    };
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

  async impersonate(user: AuthUser, token: string) {
    const access = await this.prisma.platformSupportAccess.findUniqueOrThrow({
      where: { token },
      include: { tenant: true, admin: true },
    });
    if (access.adminId !== user.sub) {
      throw new ForbiddenException('Support token belongs to another admin');
    }
    if (access.expiresAt < new Date()) {
      throw new BadRequestException('Support token has expired');
    }
    if (access.revokedAt) {
      throw new BadRequestException('Support token has been revoked');
    }

    const target = await this.prisma.user.findFirst({
      where: {
        tenantId: access.tenantId,
        active: true,
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    if (!target) {
      throw new BadRequestException('Tenant has no active owner or manager');
    }

    await this.prisma.platformSupportAccess.update({
      where: { id: access.id },
      data: { usedAt: new Date() },
    });

    await this.auditService.record({
      tenantId: access.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_SUPPORT_IMPERSONATION_STARTED',
      entityType: 'User',
      entityId: target.id,
      summary: `Platform support opened audited access as ${target.email}`,
      metadata: {
        supportAccessId: access.id,
        platformAdminId: user.sub,
        platformAdminEmail: user.email,
        reason: access.reason,
      },
    });

    const tokenPayload = {
      sub: target.id,
      tenantId: target.tenantId,
      email: target.email,
      role: target.role,
      impersonatedBy: user.sub,
      supportAccessId: access.id,
    };
    const accessToken = this.jwt.sign({
      ...tokenPayload,
      tokenType: 'access',
    }, {
      expiresIn: `${Number(this.config.get<string>('JWT_ACCESS_TTL_MINUTES') ?? 15)}m`,
    });
    const refreshToken = this.jwt.sign({
      ...tokenPayload,
      tokenType: 'refresh',
    }, {
      expiresIn: `${Number(this.config.get<string>('JWT_REFRESH_TTL_DAYS') ?? 30)}d`,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: target.id,
        sub: target.id,
        tenantId: target.tenantId,
        email: target.email,
        role: target.role,
        impersonatedBy: user.sub,
      },
      tenant: {
        id: access.tenant.id,
        businessName: access.tenant.businessName,
        slug: access.tenant.slug,
        industry: access.tenant.industry,
        status: access.tenant.status,
      },
    };
  }

  async revokeSupportAccess(user: AuthUser, id: string) {
    const access = await this.prisma.platformSupportAccess.findUniqueOrThrow({
      where: { id },
      include: { tenant: true, admin: true },
    });
    if (user.role !== UserRole.PLATFORM_ADMIN && access.adminId !== user.sub) {
      throw new ForbiddenException(
        'Only platform admins or the token owner can revoke support access',
      );
    }

    const revoked = await this.prisma.platformSupportAccess.update({
      where: { id },
      data: { revokedAt: new Date() },
      include: {
        tenant: true,
        admin: { select: { id: true, email: true, role: true } },
      },
    });

    await this.auditService.record({
      tenantId: access.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_SUPPORT_ACCESS_REVOKED',
      entityType: 'PlatformSupportAccess',
      entityId: id,
      summary: `Support access revoked for ${access.tenant.businessName}`,
      metadata: {
        adminEmail: access.admin.email,
        originallyExpiresAt: access.expiresAt,
      },
    });

    return revoked;
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

  async retryAutomationFailure(
    user: AuthUser,
    id: string,
    dto: ReplayPlatformFailureDto,
  ) {
    const run = await this.prisma.automationRun.findUniqueOrThrow({
      where: { id },
    });
    const updated = await this.automations.retry(
      run.tenantId,
      id,
      user.sub,
      dto.reason,
    );

    await this.auditService.record({
      tenantId: run.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_AUTOMATION_RETRIED',
      entityType: 'AutomationRun',
      entityId: id,
      summary: `Platform admin retried ${run.trigger} automation`,
      metadata: { reason: dto.reason },
    });

    return updated;
  }

  async replayWebhookFailure(
    user: AuthUser,
    id: string,
    dto: ReplayPlatformFailureDto,
  ) {
    const event = await this.prisma.webhookEvent.findUniqueOrThrow({
      where: { id },
    });
    const replayPayload = {
      ...(event.payload as Record<string, unknown> | null),
      platformReplay: {
        reason: dto.reason,
        replayedBy: user.sub,
        replayedAt: new Date().toISOString(),
      },
    };
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: WebhookEventStatus.RECEIVED,
        error: null,
        processedAt: null,
        payload: replayPayload,
      },
    });
    const updated =
      event.provider === WebhookProvider.WHATSAPP
        ? await this.whatsAppWebhooks.replay(id)
        : await this.payments.replayWebhookEvent(id);

    await this.auditService.record({
      tenantId: event.tenantId ?? user.tenantId,
      actorId: user.sub,
      action: 'PLATFORM_WEBHOOK_REPLAYED',
      entityType: 'WebhookEvent',
      entityId: id,
      summary: `Platform admin replayed ${event.provider} webhook`,
      metadata: { reason: dto.reason, status: updated.status },
    });

    return updated;
  }

  exportHistory() {
    return this.prisma.auditLog.findMany({
      where: { action: 'PLATFORM_TENANT_EXPORTED' },
      include: {
        tenant: true,
        actor: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  auditLogs(filters: PlatformAuditFilters = {}) {
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(filters.limit ?? '200', 10) || 200),
    );
    const contains = filters.q?.trim()
      ? {
          contains: filters.q.trim(),
          mode: Prisma.QueryMode.insensitive,
        }
      : undefined;
    return this.prisma.auditLog.findMany({
      where: {
        tenantId: filters.tenantId || undefined,
        action: filters.action || undefined,
        OR: contains
          ? [
              { action: contains },
              { entityType: contains },
              { summary: contains },
              { actor: { email: contains } },
              { tenant: { businessName: contains } },
            ]
          : undefined,
      },
      include: {
        tenant: true,
        actor: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async uniqueTenantSlug(input: string) {
    const base =
      input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'tenant';
    let slug = base;
    let suffix = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
    return slug;
  }

  private async uniquePlanSlug(input: string, existingId?: string) {
    const base =
      input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'plan';
    let slug = base;
    let suffix = 1;
    while (true) {
      const existing = await this.prisma.subscriptionPlan.findUnique({
        where: { slug },
      });
      if (!existing || existing.id === existingId) return slug;
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
  }

  private planData(dto: UpsertSubscriptionPlanDto, slug?: string) {
    return {
      name: dto.name?.trim(),
      slug,
      description: dto.description?.trim() || null,
      active: dto.active,
      currency: dto.currency?.trim().toUpperCase(),
      monthlyPriceCents: dto.monthlyPriceCents,
      setupFeeCents: dto.setupFeeCents,
      stripePriceId: dto.stripePriceId?.trim() || null,
      paystackPlanCode: dto.paystackPlanCode?.trim() || null,
      featureFlags: dto.featureFlags as Prisma.InputJsonValue,
      planLimits: dto.planLimits as Prisma.InputJsonValue,
      sortOrder: dto.sortOrder,
    };
  }

  private async createStripeSubscriptionCheckout(input: {
    tenant: Tenant;
    monthlyPriceCents: number;
    setupFeeCents: number;
    successUrl?: string;
    cancelUrl?: string;
    currency?: string;
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
    params.set('line_items[0][price_data][currency]', input.currency ?? 'usd');
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
      params.set(
        'line_items[1][price_data][currency]',
        input.currency ?? 'usd',
      );
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
      paystackCustomerCode: undefined,
      paystackSubscriptionCode: undefined,
      currency: input.currency ?? 'usd',
    };
  }

  private async createPaystackSubscriptionCheckout(input: {
    tenant: Tenant;
    monthlyPriceCents: number;
    setupFeeCents: number;
    successUrl?: string;
    currency?: string;
    paystackPlanCode?: string;
  }) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured');
    }
    const email = input.tenant.billingEmail;
    if (!email) {
      throw new BadRequestException(
        'Tenant billing email is required for Paystack',
      );
    }
    const currency = (
      input.currency ??
      process.env.PAYSTACK_CURRENCY ??
      'NGN'
    ).toUpperCase();
    const amount = input.monthlyPriceCents + input.setupFeeCents;
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const callbackUrl =
      input.successUrl ??
      process.env.PLATFORM_BILLING_SUCCESS_URL ??
      `${apiBase.replace('/api', '')}/admin?billing=success`;
    const reference = `cf_platform_${input.tenant.id}_${Date.now()}`;
    const plan =
      input.paystackPlanCode ?? process.env.PAYSTACK_PLATFORM_PLAN_CODE;
    const body: Record<string, unknown> = {
      email,
      amount,
      currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        kind: 'platform_subscription',
        tenantId: input.tenant.id,
        monthlyPriceCents: input.monthlyPriceCents,
        setupFeeCents: input.setupFeeCents,
      },
    };
    if (plan) {
      body.plan = plan;
    }

    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json()) as PaystackInitializeResponse;
    if (!response.ok || !payload.status || !payload.data?.authorization_url) {
      throw new BadRequestException(
        payload.message || 'Paystack checkout failed',
      );
    }

    return {
      provider: 'paystack',
      mock: false,
      url: payload.data.authorization_url,
      sessionId: payload.data.reference ?? reference,
      customerId: undefined,
      subscriptionId: undefined,
      paystackCustomerCode: undefined,
      paystackSubscriptionCode: undefined,
      currency,
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
      paystackCustomerCode: undefined,
      paystackSubscriptionCode: undefined,
      currency: 'usd',
    };
  }

  private billingProvider(provider?: 'stripe' | 'paystack' | 'mock') {
    if (provider) return provider;
    if (process.env.PAYSTACK_SECRET_KEY) return 'paystack';
    if (process.env.STRIPE_SECRET_KEY) return 'stripe';
    return 'mock';
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

    if (
      dto.type === BillingEventType.CREDIT_APPLIED ||
      dto.type === BillingEventType.REFUND_ISSUED
    ) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { pastDueAt: null },
      });
    }
  }

  private assertSuperAdmin(user: AuthUser, action: string) {
    if (user.role !== UserRole.PLATFORM_ADMIN) {
      throw new ForbiddenException(`Only platform admins can ${action}`);
    }
  }
}
