import { Injectable } from '@nestjs/common';
import {
  ActionStatus,
  AutomationRunStatus,
  InvoiceStatus,
  TenantStatus,
  WebhookEventStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

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
    ] = await Promise.all([
      this.prisma.tenant.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.booking.count(),
      this.prisma.lead.count(),
      this.prisma.operationalAction.count({
        where: { status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] } },
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

  tenant(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, active: true },
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
      },
    });

    return tenant;
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
      include: { tenant: true, actor: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
