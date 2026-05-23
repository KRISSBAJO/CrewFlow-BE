import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
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
    const slug = this.slugify(dto.businessName);
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      throw new ConflictException('A business with this name already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const tenant = await this.prisma.tenant.create({
      data: {
        businessName: dto.businessName,
        slug,
        industry: dto.industry,
        users: {
          create: {
            name: dto.ownerName,
            email: dto.email.toLowerCase(),
            passwordHash,
            role: UserRole.OWNER,
          },
        },
      },
      include: { users: true },
    });

    const user = tenant.users[0];
    return this.session(user.id, tenant.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), active: true },
      include: { tenant: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.session(user.id, user.tenantId, user.email, user.role);
  }

  private session(id: string, tenantId: string, email: string, role: UserRole) {
    const accessToken = this.jwt.sign({
      sub: id,
      tenantId,
      email,
      role,
    });

    return {
      accessToken,
      user: { id, tenantId, email, role },
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
