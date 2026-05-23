import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async checkIn(tenantId: string, userId: string, dto: CheckInDto) {
    const open = await this.prisma.attendance.findFirst({
      where: { tenantId, userId, checkOut: null },
    });

    if (open) {
      throw new BadRequestException('Staff member is already checked in');
    }

    return this.prisma.attendance.create({
      data: {
        tenantId,
        userId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        photoUrl: dto.photoUrl,
        notes: dto.notes,
      },
    });
  }

  async checkOut(tenantId: string, userId: string) {
    const open = await this.prisma.attendance.findFirstOrThrow({
      where: { tenantId, userId, checkOut: null },
    });

    return this.prisma.attendance.update({
      where: { id: open.id },
      data: { checkOut: new Date() },
    });
  }

  findAll(tenantId: string, date?: string) {
    const day = date ? new Date(date) : new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    return this.prisma.attendance.findMany({
      where: { tenantId, checkIn: { gte: start, lte: end } },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { checkIn: 'desc' },
    });
  }
}
