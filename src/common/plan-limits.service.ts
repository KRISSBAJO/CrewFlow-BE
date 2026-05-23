import { ForbiddenException, Injectable } from '@nestjs/common';
import { SubscriptionStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PlanLimits = Record<string, number>;

@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanWrite(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        status: true,
        subscriptionStatus: true,
      },
    });

    if (
      tenant.status === TenantStatus.SUSPENDED ||
      tenant.status === TenantStatus.CHURNED ||
      tenant.subscriptionStatus === SubscriptionStatus.CANCELED ||
      tenant.subscriptionStatus === SubscriptionStatus.UNPAID
    ) {
      throw new ForbiddenException(
        'Billing needs attention before creating new operational records.',
      );
    }
  }

  async assertBelowLimit(tenantId: string, key: string, currentCount: number) {
    const limit = await this.limitFor(tenantId, key);
    if (typeof limit === 'number' && currentCount >= limit) {
      throw new ForbiddenException(
        `Plan limit reached for ${key}. Upgrade the plan or archive old records.`,
      );
    }
  }

  async limitFor(tenantId: string, key: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { planLimits: true },
    });
    const limits = this.asLimits(tenant.planLimits);
    return limits[key];
  }

  asLimits(value: unknown): PlanLimits {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, limit]) => typeof limit === 'number',
      ),
    ) as PlanLimits;
  }
}
