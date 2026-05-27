import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AutomationTrigger, MessageProvider, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import type { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

type SessionUser = AuthUser & { id: string };
type SessionPayload = {
  accessToken?: string;
  refreshToken?: string;
  user: SessionUser;
  tenant?: Record<string, unknown>;
  onboardingProfile?: unknown;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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
          },
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

  async me(user: AuthUser) {
    const found = await this.prisma.user.findFirst({
      where: { id: user.sub, tenantId: user.tenantId, active: true },
      include: { tenant: true },
    });

    if (!found) {
      throw new UnauthorizedException('User is not active');
    }

    return {
      user: this.sessionUser(found.id, found.tenantId, found.email, found.role),
      tenant: {
        id: found.tenant.id,
        businessName: found.tenant.businessName,
        slug: found.tenant.slug,
        industry: found.tenant.industry,
        status: found.tenant.status,
      },
    };
  }

  async refresh(refreshToken?: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh cookie');
    }

    let payload: AuthUser & { tokenType?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, tenantId: payload.tenantId, active: true },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('User is not active');
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

  setSessionCookies(response: Response, session: SessionPayload) {
    if (!session.accessToken || !session.refreshToken) return;
    response.cookie(this.accessCookieName(), session.accessToken, {
      ...this.cookieOptions(),
      maxAge: this.accessTtlMinutes() * 60_000,
    });
    response.cookie(this.refreshCookieName(), session.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.refreshTtlDays() * 86_400_000,
    });
  }

  clearSessionCookies(response: Response) {
    const options = this.cookieOptions();
    response.clearCookie(this.accessCookieName(), options);
    response.clearCookie(this.refreshCookieName(), options);
  }

  refreshTokenFromCookieHeader(cookieHeader?: string) {
    return this.cookieValue(cookieHeader, this.refreshCookieName());
  }

  expose(session: SessionPayload) {
    if (this.config.get<string>('DEV_EXPOSE_TOKENS') === 'true') {
      return session;
    }
    const { accessToken: _accessToken, refreshToken: _refreshToken, ...safe } =
      session;
    return safe;
  }

  createSession(
    id: string,
    tenantId: string,
    email: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ) {
    return this.session(id, tenantId, email, role, extra);
  }

  private session(
    id: string,
    tenantId: string,
    email: string,
    role: UserRole,
    extra: Record<string, unknown> = {},
  ): SessionPayload {
    const accessToken = this.jwt.sign({
      sub: id,
      tenantId,
      email,
      role,
      tokenType: 'access',
    }, {
      expiresIn: `${this.accessTtlMinutes()}m`,
    });
    const refreshToken = this.jwt.sign({
      sub: id,
      tenantId,
      email,
      role,
      tokenType: 'refresh',
    }, {
      expiresIn: `${this.refreshTtlDays()}d`,
    });

    return {
      accessToken,
      refreshToken,
      user: this.sessionUser(id, tenantId, email, role),
      ...extra,
    };
  }

  private sessionUser(
    id: string,
    tenantId: string,
    email: string,
    role: UserRole,
  ): SessionUser {
    return { id, sub: id, tenantId, email, role };
  }

  private accessCookieName() {
    return (
      this.config.get<string>('IDENTITY_ACCESS_COOKIE_NAME') ??
      'crewflow_access'
    );
  }

  private refreshCookieName() {
    return (
      this.config.get<string>('IDENTITY_REFRESH_COOKIE_NAME') ??
      'crewflow_refresh'
    );
  }

  private accessTtlMinutes() {
    return Number(this.config.get<string>('JWT_ACCESS_TTL_MINUTES') ?? 15);
  }

  private refreshTtlDays() {
    return Number(this.config.get<string>('JWT_REFRESH_TTL_DAYS') ?? 30);
  }

  private cookieOptions() {
    const sameSite =
      (this.config.get<string>('COOKIE_SAME_SITE') ?? 'lax').toLowerCase() ===
      'none'
        ? 'none'
        : (this.config.get<string>('COOKIE_SAME_SITE') ?? 'lax').toLowerCase() ===
            'strict'
          ? 'strict'
          : 'lax';
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: sameSite as 'lax' | 'strict' | 'none',
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  private cookieValue(cookieHeader: string | undefined, name: string) {
    if (!cookieHeader) return undefined;
    const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
    const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
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
