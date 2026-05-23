import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({ data: { ...dto, tenantId } });
  }

  findAll(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.customer.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        bookings: { orderBy: { startTime: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        messages: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async timeline(tenantId: string, id: string) {
    await this.prisma.customer.findFirstOrThrow({
      where: { id, tenantId },
      select: { id: true },
    });

    const [bookings, invoices, payments, messages, actions, conversations] =
      await Promise.all([
        this.prisma.booking.findMany({
          where: { tenantId, customerId: id },
          include: { service: true, assignedStaff: true },
          orderBy: { startTime: 'desc' },
          take: 25,
        }),
        this.prisma.invoice.findMany({
          where: { tenantId, customerId: id },
          include: { lineItems: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.payment.findMany({
          where: { tenantId, invoice: { customerId: id } },
          include: { invoice: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.messageLog.findMany({
          where: { tenantId, customerId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.operationalAction.findMany({
          where: { tenantId, customerId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.conversation.findMany({
          where: { tenantId, customerId: id },
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: 3 },
            bookingIntents: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 25,
        }),
      ]);

    const items = [
      ...bookings.map((item) => ({
        type: 'booking',
        occurredAt: item.startTime,
        item,
      })),
      ...invoices.map((item) => ({
        type: 'invoice',
        occurredAt: item.createdAt,
        item,
      })),
      ...payments.map((item) => ({
        type: 'payment',
        occurredAt: item.paidAt ?? item.createdAt,
        item,
      })),
      ...messages.map((item) => ({
        type: 'message',
        occurredAt: item.createdAt,
        item,
      })),
      ...actions.map((item) => ({
        type: 'action',
        occurredAt: item.createdAt,
        item,
      })),
      ...conversations.map((item) => ({
        type: 'conversation',
        occurredAt: item.lastMessageAt,
        item,
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    return { customerId: id, items };
  }

  update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({
      where: { id, tenantId },
      data: dto,
    });
  }
}
