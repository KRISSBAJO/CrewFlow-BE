import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AutomationTrigger,
  MessageProvider,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const slug = await this.uniqueTenantSlug(dto.businessName);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const serviceNames = this.normalizeServices(dto.services);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          businessName: dto.businessName.trim(),
          slug,
          industry: dto.industry.trim(),
          status: 'TRIAL',
          onboardingProfile: {
            create: {
              ownerName: dto.ownerName.trim(),
              ownerEmail: email,
              ownerPhone: dto.phone?.trim(),
              staffCount: dto.staffCount?.trim(),
              whatsappNumber: dto.whatsappNumber?.trim(),
              services: serviceNames,
              biggestProblem: dto.biggestProblem?.trim(),
              setupStatus: 'ACCOUNT_CREATED',
            },
          },
          receptionistConfig: {
            create: {
              displayName: `${dto.businessName.trim()} Receptionist`,
              serviceArea: dto.industry.trim(),
              fallbackMessage:
                'Thanks for reaching out. We received your request and will confirm details shortly.',
            },
          },
          users: {
            create: {
              name: dto.ownerName.trim(),
              email,
              phone: dto.phone?.trim(),
              passwordHash,
              role: UserRole.OWNER,
            },
          },
        },
        include: {
          users: true,
          onboardingProfile: true,
        },
      });

      if (serviceNames.length) {
        await tx.service.createMany({
          data: serviceNames.map((title) => ({
            tenantId: created.id,
            title,
            description: `Starter service from onboarding: ${title}`,
            durationMinutes: 120,
            priceCents: 19900,
          })),
          skipDuplicates: true,
        });
      }

      await tx.automationRule.createMany({
        data: this.defaultAutomationRules(created.id),
        skipDuplicates: true,
      });

      await tx.operationalAction.create({
        data: {
          tenantId: created.id,
          type: 'FOLLOW_UP_STALE_INQUIRY',
          priority: 'HIGH',
          title: 'Finish onboarding setup',
          description:
            'Review services, staff, WhatsApp automation, and first booking workflow.',
          source: 'onboarding',
          idempotencyKey: 'onboarding:finish-setup',
          metadata: {
            staffCount: dto.staffCount,
            biggestProblem: dto.biggestProblem,
          } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    const user = tenant.users[0];
    return this.session(user.id, tenant.id, user.email, user.role, {
      tenant: {
        id: tenant.id,
        businessName: tenant.businessName,
        slug: tenant.slug,
        industry: tenant.industry,
        status: tenant.status,
      },
      onboardingProfile: tenant.onboardingProfile,
    });
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), active: true },
      include: { tenant: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.session(user.id, user.tenantId, user.email, user.role, {
      tenant: {
        id: user.tenant.id,
        businessName: user.tenant.businessName,
        slug: user.tenant.slug,
        industry: user.tenant.industry,
        status: user.tenant.status,
      },
    });
  }

  private session(
    id: string,
    tenantId: string,
    email: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ) {
    const accessToken = this.jwt.sign({
      sub: id,
      tenantId,
      email,
      role,
    });

    return {
      accessToken,
      user: { id, sub: id, tenantId, email, role },
      ...extra,
    };
  }

  private normalizeServices(services?: string[]): string[] {
    return [
      ...new Set(
        (services ?? [])
          .map((service) => service.trim())
          .filter(Boolean)
          .slice(0, 8),
      ),
    ];
  }

  private defaultAutomationRules(tenantId: string) {
    return [
      {
        tenantId,
        trigger: AutomationTrigger.BOOKING_CONFIRMED,
        provider: MessageProvider.WHATSAPP,
        template:
          'Your {{service}} appointment is confirmed for {{startTime}}. Reply here if anything changes.',
        delayMinutes: 0,
      },
      {
        tenantId,
        trigger: AutomationTrigger.STAFF_ON_THE_WAY,
        provider: MessageProvider.WHATSAPP,
        template:
          'Your technician is on the way for {{service}}. We will update you when the job is complete.',
        delayMinutes: 0,
      },
      {
        tenantId,
        trigger: AutomationTrigger.INVOICE_DUE,
        provider: MessageProvider.WHATSAPP,
        template:
          'Friendly reminder: invoice {{invoiceNo}} is due. You can pay here: {{paymentUrl}}',
        delayMinutes: 60,
      },
      {
        tenantId,
        trigger: AutomationTrigger.REVIEW_REQUEST,
        provider: MessageProvider.WHATSAPP,
        template:
          'Thanks for choosing us. If everything looked good, would you leave a quick review?',
        delayMinutes: 120,
      },
    ];
  }

  private async uniqueTenantSlug(value: string): Promise<string> {
    const base = this.slugify(value) || 'tenant';
    let slug = base;
    let suffix = 2;

    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
