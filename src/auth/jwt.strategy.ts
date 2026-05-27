import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/current-user.decorator';

function cookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const accessCookieName =
      config.get<string>('IDENTITY_ACCESS_COOKIE_NAME') ?? 'crewflow_access';
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) =>
          cookieValue(request.headers.cookie, accessCookieName),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: AuthUser & { tokenType?: string }): Promise<AuthUser> {
    if (payload.tokenType && payload.tokenType !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        active: true,
      },
      select: { id: true, tenantId: true, email: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User is not active');
    }

    return {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };
  }
}
