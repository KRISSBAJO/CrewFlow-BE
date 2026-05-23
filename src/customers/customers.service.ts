import { Injectable } from '@nestjs/common';
import { PlanLimitsService } from '../common/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ImportCustomerRowDto } from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto) {
    await this.planLimits.assertCanWrite(tenantId);
    await this.planLimits.assertBelowLimit(
      tenantId,
      'customers',
      await this.prisma.customer.count({ where: { tenantId } }),
    );
    return this.prisma.customer.create({ data: { ...dto, tenantId } });
  }

  async import(tenantId: string, customers: ImportCustomerRowDto[]) {
    await this.planLimits.assertCanWrite(tenantId);
    const customerLimit = await this.planLimits.limitFor(tenantId, 'customers');
    const existingCustomers = await this.prisma.customer.count({
      where: { tenantId },
    });
    const rows = customers
      .map((customer) => ({
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email?.trim() || undefined,
        notes: customer.notes?.trim() || undefined,
      }))
      .filter((customer) => customer.name && customer.phone)
      .slice(0, Math.min(500, Math.max(0, (customerLimit ?? 500) - existingCustomers)));

    let created = 0;
    let updated = 0;
    let skipped = customers.length - rows.length;
    const results: Array<{
      phone: string;
      status: 'created' | 'updated' | 'skipped';
      id?: string;
      reason?: string;
    }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (seen.has(row.phone)) {
        skipped += 1;
        results.push({
          phone: row.phone,
          status: 'skipped',
          reason: 'Duplicate phone in import',
        });
        continue;
      }
      seen.add(row.phone);

      const existing = await this.prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId, phone: row.phone } },
        select: { id: true },
      });

      const customer = await this.prisma.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: row.phone } },
        create: { ...row, tenantId },
        update: {
          name: row.name,
          email: row.email,
          notes: row.notes,
        },
        select: { id: true },
      });

      if (existing) {
        updated += 1;
        results.push({ phone: row.phone, status: 'updated', id: customer.id });
      } else {
        created += 1;
        results.push({ phone: row.phone, status: 'created', id: customer.id });
      }
    }

    return { created, updated, skipped, total: customers.length, results };
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

    const now = new Date();
    const paidTotalCents = invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const openInvoiceCents = invoices
      .filter((invoice) => ['SENT', 'OVERDUE'].includes(invoice.status))
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const lastBooking = bookings.find((booking) => booking.startTime <= now);
    const nextBooking = [...bookings]
      .filter((booking) => booking.startTime > now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];

    return {
      customerId: id,
      summary: {
        paidTotalCents,
        openInvoiceCents,
        bookingCount: bookings.length,
        invoiceCount: invoices.length,
        lastBooking,
        nextBooking,
      },
      items,
    };
  }

  update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({
      where: { id, tenantId },
      data: dto,
    });
  }
}
