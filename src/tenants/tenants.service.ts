import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  getProfile(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        businessName: true,
        slug: true,
        industry: true,
        subscriptionPlan: true,
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

  getOnboarding(tenantId: string) {
    return this.prisma.onboardingProfile.findUniqueOrThrow({
      where: { tenantId },
    });
  }

  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto) {
    const completedSteps = this.normalizeCompletedSteps(dto);
    const setupStatus = completedSteps.length >= 5 ? 'READY' : 'IN_PROGRESS';

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(dto.businessName ? { businessName: dto.businessName.trim() } : {}),
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
