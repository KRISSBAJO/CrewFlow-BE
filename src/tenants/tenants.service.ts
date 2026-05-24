import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  BillingEventType,
  MessageDirection,
  MessageProvider,
  Prisma,
  SubscriptionStatus,
  Tenant,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { WhatsappTemplatesService } from '../automations/whatsapp-templates.service';
import { AuthUser } from '../common/current-user.decorator';
import { PlanLimitsService } from '../common/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
    private readonly whatsappTemplates: WhatsappTemplatesService,
  ) {}

  getProfile(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        slug: true,
        industry: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        billingEmail: true,
        monthlyPriceCents: true,
        setupFeeCents: true,
        currentPeriodEnd: true,
        nextBillingAt: true,
        pastDueAt: true,
        canceledAt: true,
        featureFlags: true,
        planLimits: true,
        createdAt: true,
        onboardingProfile: true,
        receptionistConfig: {
          select: {
            displayName: true,
            serviceArea: true,
            businessHours: true,
            enabled: true,
          },
        },
      },
    });
  }

  async getOnboarding(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: {
        users: {
          where: { role: UserRole.OWNER },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    const owner = tenant.users[0];

    return this.prisma.onboardingProfile.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ownerName: owner?.name ?? 'Owner',
        ownerEmail: owner?.email ?? 'owner@example.com',
        ownerPhone: owner?.phone,
        setupStatus: 'IN_PROGRESS',
        source: 'settings',
      },
      update: {},
    });
  }

  async whatsappOnboarding(tenantId: string) {
    const [
      profile,
      templates,
      automationRules,
      webhookEvents,
      inboundMessages,
    ] = await Promise.all([
      this.getOnboarding(tenantId),
      this.whatsappTemplates.onboarding(tenantId),
      this.prisma.automationRule.findMany({
        where: { tenantId, provider: MessageProvider.WHATSAPP },
        include: { whatsappTemplate: true },
        orderBy: { trigger: 'asc' },
      }),
      this.prisma.webhookEvent.count({
        where: { tenantId, provider: MessageProvider.WHATSAPP },
      }),
      this.prisma.messageLog.count({
        where: {
          tenantId,
          provider: MessageProvider.WHATSAPP,
          direction: MessageDirection.INBOUND,
        },
      }),
    ]);
    const approvedTemplates = templates.filter(
      (template) => template.status === 'APPROVED',
    ).length;
    const linkedRules = automationRules.filter((rule) =>
      Boolean(rule.whatsappTemplateId),
    ).length;
    const liveReady = Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN,
    );
    const steps = [
      {
        id: 'business_number',
        label: 'Business WhatsApp number',
        done: Boolean(profile.whatsappNumber),
        detail: profile.whatsappNumber ?? 'Add the customer-facing number',
      },
      {
        id: 'cloud_api',
        label: 'Meta Cloud API credentials',
        done: liveReady,
        detail: liveReady ? 'Live sender configured' : 'Using mock sender',
      },
      {
        id: 'templates_seeded',
        label: 'Production templates drafted',
        done: templates.length >= 4,
        detail: `${templates.length} templates in catalog`,
      },
      {
        id: 'templates_approved',
        label: 'Meta template approval',
        done: approvedTemplates >= 3,
        detail: `${approvedTemplates} approved templates`,
      },
      {
        id: 'templates_linked',
        label: 'Templates linked to automations',
        done: linkedRules >= 3,
        detail: `${linkedRules} automation rules linked`,
      },
      {
        id: 'webhook_verified',
        label: 'Webhook receiving customer messages',
        done: webhookEvents > 0 || inboundMessages > 0,
        detail: `${webhookEvents} webhook events, ${inboundMessages} inbound messages`,
      },
    ];

    return {
      liveReady,
      webhookUrl: `${process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api'}/webhooks/whatsapp`,
      verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
      businessAccountConfigured: Boolean(
        process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      ),
      templates,
      automationRules,
      steps,
      score: Math.round(
        (steps.filter((step) => step.done).length / steps.length) * 100,
      ),
    };
  }

  async activation(user: AuthUser) {
    const tenantId = user.tenantId;
    const [
      tenant,
      onboarding,
      services,
      staff,
      customers,
      bookings,
      automationRules,
      billingEvents,
    ] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          businessName: true,
          industry: true,
          subscriptionStatus: true,
          billingEmail: true,
          monthlyPriceCents: true,
          setupFeeCents: true,
          currentPeriodEnd: true,
          nextBillingAt: true,
        },
      }),
      this.prisma.onboardingProfile.findUnique({ where: { tenantId } }),
      this.prisma.service.count({ where: { tenantId, active: true } }),
      this.prisma.user.count({ where: { tenantId, active: true } }),
      this.prisma.customer.count({ where: { tenantId } }),
      this.prisma.booking.count({ where: { tenantId } }),
      this.prisma.automationRule.count({ where: { tenantId, active: true } }),
      this.prisma.platformBillingEvent.count({ where: { tenantId } }),
    ]);

    const steps = [
      {
        id: 'business_profile',
        label: 'Business profile',
        detail: `${tenant.businessName} · ${tenant.industry}`,
        done: Boolean(tenant.businessName && tenant.industry),
        target: 'settings',
      },
      {
        id: 'service_catalog',
        label: 'Service catalog',
        detail: services
          ? `${services} services active`
          : 'Add at least one service',
        done: services > 0,
        target: 'settings',
      },
      {
        id: 'staff_ready',
        label: 'Staff ready',
        detail: staff
          ? `${staff} users active`
          : 'Invite owner, managers, or staff',
        done: staff > 0,
        target: 'settings',
      },
      {
        id: 'customer_base',
        label: 'Customer base',
        detail: customers
          ? `${customers} customers loaded`
          : 'Add or import customers',
        done: customers > 0,
        target: 'customers',
      },
      {
        id: 'first_booking',
        label: 'First booking',
        detail: bookings
          ? `${bookings} bookings created`
          : 'Create a test or real booking',
        done: bookings > 0,
        target: 'bookings',
      },
      {
        id: 'automation_ready',
        label: 'Automation ready',
        detail: automationRules
          ? `${automationRules} automation rules enabled`
          : 'Enable reminders and follow-up automation',
        done: automationRules > 0,
        target: 'settings',
      },
      {
        id: 'billing_active',
        label: 'Billing active',
        detail:
          tenant.subscriptionStatus === SubscriptionStatus.ACTIVE
            ? `${this.money(tenant.monthlyPriceCents ?? 0)} monthly plan active`
            : 'Activate billing before launch',
        done: tenant.subscriptionStatus === SubscriptionStatus.ACTIVE,
        target: 'settings',
      },
    ];
    const completed = steps.filter((step) => step.done).length;
    const score = Math.round((completed / steps.length) * 100);
    const nextStep = steps.find((step) => !step.done) ?? null;
    const setupStatus = score === 100 ? 'LAUNCH_READY' : 'IN_PROGRESS';

    if (onboarding && onboarding.setupStatus !== setupStatus) {
      await this.prisma.onboardingProfile.update({
        where: { tenantId },
        data: { setupStatus },
      });
    }

    return {
      score,
      completed,
      total: steps.length,
      setupStatus,
      launchReady: score === 100,
      nextStep,
      steps,
      counts: {
        services,
        staff,
        customers,
        bookings,
        automationRules,
        billingEvents,
      },
      biggestProblem: onboarding?.biggestProblem,
    };
  }

  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto) {
    const completedSteps = this.normalizeCompletedSteps(dto);
    const setupStatus = completedSteps.length >= 5 ? 'READY' : 'IN_PROGRESS';

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(dto.businessName
            ? { businessName: dto.businessName.trim() }
            : {}),
          ...(dto.industry ? { industry: dto.industry.trim() } : {}),
        },
        select: {
          id: true,
          businessName: true,
          slug: true,
          industry: true,
          subscriptionPlan: true,
          createdAt: true,
        },
      });

      const onboardingProfile = await tx.onboardingProfile.upsert({
        where: { tenantId },
        create: {
          tenantId,
          ownerName: 'Owner',
          ownerEmail: 'owner@example.com',
          whatsappNumber: dto.whatsappNumber?.trim(),
          staffCount: dto.staffCount?.trim(),
          biggestProblem: dto.biggestProblem?.trim(),
          setupStatus,
          source: 'settings',
        },
        update: {
          whatsappNumber: dto.whatsappNumber?.trim(),
          staffCount: dto.staffCount?.trim(),
          biggestProblem: dto.biggestProblem?.trim(),
          setupStatus,
        },
      });

      const receptionistConfig = await tx.receptionistConfig.upsert({
        where: { tenantId },
        create: {
          tenantId,
          displayName: `${tenant.businessName} Receptionist`,
          serviceArea: dto.serviceArea?.trim(),
          businessHours: dto.businessHours as Prisma.InputJsonValue,
        },
        update: {
          serviceArea: dto.serviceArea?.trim(),
          businessHours: dto.businessHours as Prisma.InputJsonValue,
        },
        select: {
          displayName: true,
          serviceArea: true,
          businessHours: true,
          enabled: true,
        },
      });

      return {
        ...tenant,
        onboardingProfile: {
          ...onboardingProfile,
          completedSteps,
        },
        receptionistConfig,
      };
    });
  }

  listStaff(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async createStaff(tenantId: string, dto: CreateStaffDto) {
    await this.planLimits.assertCanWrite(tenantId);
    await this.planLimits.assertBelowLimit(
      tenantId,
      'staff',
      await this.prisma.user.count({ where: { tenantId, active: true } }),
    );
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email.toLowerCase() } },
    });

    if (existing) {
      throw new ConflictException('Staff member already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        passwordHash,
        role: dto.role ?? UserRole.STAFF,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        active: true,
      },
    });
  }

  async billing(user: AuthUser) {
    const [tenant, counts, events] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
      this.usageCounts(user.tenantId),
      this.prisma.platformBillingEvent.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    const limits = this.planLimits.asLimits(tenant.planLimits);
    return {
      tenantId: tenant.id,
      subscriptionPlan: tenant.subscriptionPlan,
      subscriptionStatus: tenant.subscriptionStatus,
      monthlyPriceCents: tenant.monthlyPriceCents,
      setupFeeCents: tenant.setupFeeCents,
      billingEmail: tenant.billingEmail,
      currentPeriodEnd: tenant.currentPeriodEnd,
      nextBillingAt: tenant.nextBillingAt,
      pastDueAt: tenant.pastDueAt,
      canceledAt: tenant.canceledAt,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
      hasStripeCustomer: Boolean(tenant.stripeCustomerId),
      hasPaystackCustomer: Boolean(tenant.paystackCustomerCode),
      limits,
      usage: counts,
      events,
    };
  }

  async createBillingCheckout(user: AuthUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
    });
    const monthlyPriceCents = tenant.monthlyPriceCents ?? 29900;
    if (monthlyPriceCents <= 0) {
      throw new BadRequestException('Monthly price must be configured first');
    }
    const checkout = process.env.PAYSTACK_SECRET_KEY
      ? await this.createPaystackSubscriptionCheckout(tenant, monthlyPriceCents)
      : process.env.STRIPE_SECRET_KEY
        ? await this.createStripeSubscriptionCheckout(tenant, monthlyPriceCents)
        : this.createMockSubscriptionCheckout(tenant.id);

    await this.prisma.platformBillingEvent.create({
      data: {
        tenantId: tenant.id,
        actorId: user.sub,
        type: BillingEventType.SETUP_FEE_INVOICED,
        amountCents: monthlyPriceCents,
        provider: checkout.provider,
        providerEventId: checkout.sessionId,
        note: 'Tenant owner created subscription checkout.',
        metadata: {
          checkoutUrl: checkout.url,
          monthlyPriceCents,
        },
      },
    });
    await this.audit.record({
      tenantId: tenant.id,
      actorId: user.sub,
      action: 'TENANT_BILLING_CHECKOUT_CREATED',
      entityType: 'Tenant',
      entityId: tenant.id,
      summary: 'Owner created a billing checkout session',
      metadata: { provider: checkout.provider, checkoutUrl: checkout.url },
    });
    return checkout;
  }

  async createBillingPortal(user: AuthUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
    });
    if (!tenant.stripeCustomerId) {
      throw new BadRequestException('No billing customer is linked yet');
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('Stripe billing portal is not configured');
    }
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const params = new URLSearchParams();
    params.set('customer', tenant.stripeCustomerId);
    params.set(
      'return_url',
      process.env.TENANT_BILLING_PORTAL_RETURN_URL ??
        `${apiBase.replace('/api', '')}/app?view=settings`,
    );

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
    const session = (await response.json()) as { id: string; url?: string };
    return { provider: 'stripe', sessionId: session.id, url: session.url };
  }

  private async usageCounts(tenantId: string) {
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

  private async createStripeSubscriptionCheckout(
    tenant: Tenant,
    monthlyPriceCents: number,
  ) {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('STRIPE_SECRET_KEY is not configured');
    }
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const successUrl =
      process.env.TENANT_BILLING_SUCCESS_URL ??
      `${apiBase.replace('/api', '')}/app?billing=success`;
    const cancelUrl =
      process.env.TENANT_BILLING_CANCEL_URL ??
      `${apiBase.replace('/api', '')}/app?billing=cancel`;
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', successUrl);
    params.set('cancel_url', cancelUrl);
    params.set('client_reference_id', tenant.id);
    if (tenant.stripeCustomerId) {
      params.set('customer', tenant.stripeCustomerId);
    } else if (tenant.billingEmail) {
      params.set('customer_email', tenant.billingEmail);
    }
    params.set('metadata[kind]', 'platform_subscription');
    params.set('metadata[tenantId]', tenant.id);
    params.set('metadata[monthlyPriceCents]', monthlyPriceCents.toString());
    params.set('metadata[setupFeeCents]', '0');
    params.set('subscription_data[metadata][kind]', 'platform_subscription');
    params.set('subscription_data[metadata][tenantId]', tenant.id);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set(
      'line_items[0][price_data][unit_amount]',
      monthlyPriceCents.toString(),
    );
    params.set('line_items[0][price_data][recurring][interval]', 'month');
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${tenant.businessName} CrewFlow subscription`,
    );
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
    const session = (await response.json()) as { id: string; url?: string };
    return {
      provider: 'stripe',
      mock: false,
      sessionId: session.id,
      url: session.url,
    };
  }

  private createMockSubscriptionCheckout(tenantId: string) {
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    return {
      provider: 'mock',
      mock: true,
      sessionId: `mock_tenant_${tenantId}_${Date.now()}`,
      url: `${apiBase}/platform/mock-billing/${tenantId}/success`,
    };
  }

  private async createPaystackSubscriptionCheckout(
    tenant: Tenant,
    monthlyPriceCents: number,
  ) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured');
    }
    if (!tenant.billingEmail) {
      throw new BadRequestException('Billing email is required for Paystack');
    }
    const apiBase = process.env.PUBLIC_API_URL ?? 'http://localhost:3002/api';
    const reference = `cf_tenant_${tenant.id}_${Date.now()}`;
    const plan =
      process.env.PAYSTACK_TENANT_PLAN_CODE ??
      process.env.PAYSTACK_PLATFORM_PLAN_CODE;
    const body: Record<string, unknown> = {
      email: tenant.billingEmail,
      amount: monthlyPriceCents,
      currency: (process.env.PAYSTACK_CURRENCY ?? 'NGN').toUpperCase(),
      reference,
      callback_url:
        process.env.TENANT_BILLING_SUCCESS_URL ??
        `${apiBase.replace('/api', '')}/app?billing=success`,
      metadata: {
        kind: 'platform_subscription',
        tenantId: tenant.id,
        monthlyPriceCents,
        setupFeeCents: 0,
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
    const payload = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { authorization_url?: string; reference?: string };
    };
    if (!response.ok || !payload.status || !payload.data?.authorization_url) {
      throw new BadRequestException(
        payload.message || 'Paystack checkout failed',
      );
    }
    return {
      provider: 'paystack',
      mock: false,
      sessionId: payload.data.reference ?? reference,
      url: payload.data.authorization_url,
    };
  }

  private money(cents: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  }

  async updateStaff(tenantId: string, id: string, dto: UpdateStaffDto) {
    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: {
          tenantId,
          email: dto.email.toLowerCase(),
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Staff email already exists');
      }
    }

    return this.prisma.user.update({
      where: { id, tenantId },
      data: {
        name: dto.name?.trim(),
        email: dto.email?.toLowerCase(),
        phone: dto.phone?.trim(),
        role: dto.role,
        active: dto.active,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        active: true,
      },
    });
  }

  private normalizeCompletedSteps(dto: UpdateTenantSettingsDto): string[] {
    return [
      ...new Set([
        ...(dto.completedSteps ?? []),
        ...(dto.businessName || dto.industry ? ['businessProfile'] : []),
        ...(dto.serviceArea || dto.businessHours ? ['operatingDetails'] : []),
        ...(dto.whatsappNumber || dto.whatsappPlanned
          ? ['whatsappPlanned']
          : []),
        ...(dto.staffCount ? ['staffPlan'] : []),
      ]),
    ];
  }
}
