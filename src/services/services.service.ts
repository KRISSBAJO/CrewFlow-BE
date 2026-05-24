import { Injectable } from '@nestjs/common';
import { toCents } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        tenantId,
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl,
        durationMinutes: dto.durationMinutes,
        priceCents: toCents(dto.price),
      },
    });
  }

  findAll(tenantId: string) {
    return this.prisma.service.findMany({
      where: { tenantId },
      orderBy: [{ active: 'desc' }, { title: 'asc' }],
    });
  }

  update(tenantId: string, id: string, dto: UpdateServiceDto) {
    return this.prisma.service.update({
      where: { id, tenantId },
      data: {
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl,
        durationMinutes: dto.durationMinutes,
        priceCents: dto.price === undefined ? undefined : toCents(dto.price),
        active: dto.active,
      },
    });
  }
}
