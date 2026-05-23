import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { toCents } from '../common/domain';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager, isManager } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoicesService {
  private readonly statusTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
    [InvoiceStatus.DRAFT]: [InvoiceStatus.SENT, InvoiceStatus.VOID],
    [InvoiceStatus.SENT]: [
      InvoiceStatus.PAID,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.VOID,
    ],
    [InvoiceStatus.OVERDUE]: [InvoiceStatus.PAID, InvoiceStatus.VOID],
    [InvoiceStatus.PAID]: [],
    [InvoiceStatus.VOID]: [],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly automations: AutomationsService,
  ) {}

  async create(user: AuthUser, dto: CreateInvoiceDto) {
    assertManager(user);
    const tenantId = user.tenantId;
    await this.assertCustomer(tenantId, dto.customerId);
    if (dto.bookingId) {
      await this.assertBooking(tenantId, dto.bookingId, dto.customerId);
    }

    const lineItems = dto.lineItems?.length
      ? dto.lineItems.map((item) => {
          const unitCents = toCents(item.unitPrice);
          return {
            tenantId,
            description: item.description,
            quantity: item.quantity,
            unitCents,
            totalCents: unitCents * item.quantity,
          };
        })
      : [
          {
            tenantId,
            description: 'Service',
            quantity: 1,
            unitCents: toCents(dto.subtotal),
            totalCents: toCents(dto.subtotal),
          },
        ];
    const subtotalCents = lineItems.reduce(
      (sum, item) => sum + item.totalCents,
      0,
    );
    const taxCents = toCents(dto.tax ?? 0);
    const totalCents = subtotalCents + taxCents;

    const invoice = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { invoiceCounter: { increment: 1 } },
        select: { invoiceCounter: true },
      });

      return tx.invoice.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          bookingId: dto.bookingId,
          invoiceNo: this.formatInvoiceNo(tenant.invoiceCounter),
          subtotalCents,
          taxCents,
          totalCents,
          dueDate: new Date(dto.dueDate),
          lineItems: { createMany: { data: lineItems } },
        },
        include: this.include(),
      });
    });

    await this.audit.record({
      tenantId,
      actorId: user.sub,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Created invoice ${invoice.invoiceNo}`,
      metadata: {
        totalCents: invoice.totalCents,
        customerId: invoice.customerId,
      },
    });

    if (
      invoice.status === InvoiceStatus.SENT ||
      invoice.status === InvoiceStatus.OVERDUE
    ) {
      await this.automations.trigger({
        tenantId,
        trigger: 'INVOICE_DUE',
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        bookingId: invoice.bookingId ?? undefined,
      });
    }

    return invoice;
  }

  findAll(user: AuthUser, status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: {
        tenantId: user.tenantId,
        status,
        booking: isManager(user) ? undefined : { assignedStaffId: user.sub },
      },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async createFromBooking(
    tenantId: string,
    bookingId: string,
    actorId?: string,
  ) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId },
      include: { service: true, customer: true, invoice: true },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.invoice) {
      return booking.invoice;
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { invoiceCounter: { increment: 1 } },
        select: { invoiceCounter: true },
      });

      return tx.invoice.create({
        data: {
          tenantId,
          customerId: booking.customerId,
          bookingId: booking.id,
          invoiceNo: this.formatInvoiceNo(tenant.invoiceCounter),
          subtotalCents: booking.service.priceCents,
          taxCents: 0,
          totalCents: booking.service.priceCents,
          dueDate,
          status: InvoiceStatus.SENT,
          lineItems: {
            create: {
              tenantId,
              description: booking.service.title,
              quantity: 1,
              unitCents: booking.service.priceCents,
              totalCents: booking.service.priceCents,
            },
          },
        },
        include: this.include(),
      });
    });

    await this.audit.record({
      tenantId,
      actorId,
      action: 'INVOICE_AUTO_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Auto-created invoice ${invoice.invoiceNo} after job completion`,
      metadata: { bookingId, totalCents: invoice.totalCents },
    });

    await this.automations.trigger({
      tenantId,
      trigger: 'INVOICE_DUE',
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      bookingId,
    });

    return invoice;
  }

  async updateStatus(user: AuthUser, id: string, status: InvoiceStatus) {
    assertManager(user);
    const existing = await this.prisma.invoice.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Invoice not found');
    }

    this.assertStatusTransition(existing.status, status);

    const invoice = await this.prisma.invoice.update({
      where: { id, tenantId: user.tenantId },
      data: {
        status,
        paidAt: status === InvoiceStatus.PAID ? new Date() : undefined,
      },
      include: this.include(),
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'INVOICE_STATUS_UPDATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      summary: `Changed invoice ${invoice.invoiceNo} from ${existing.status} to ${status}`,
      metadata: { previousStatus: existing.status, status },
    });

    if (status === InvoiceStatus.SENT || status === InvoiceStatus.OVERDUE) {
      await this.automations.trigger({
        tenantId: user.tenantId,
        trigger: 'INVOICE_DUE',
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        bookingId: invoice.bookingId ?? undefined,
      });
    }

    return invoice;
  }

  private async assertCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer does not belong to this tenant');
    }
  }

  private async assertBooking(
    tenantId: string,
    bookingId: string,
    customerId: string,
  ) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenantId, customerId },
      select: { id: true },
    });

    if (!booking) {
      throw new BadRequestException('Booking does not belong to this customer');
    }
  }

  private assertStatusTransition(from: InvoiceStatus, to: InvoiceStatus) {
    if (from === to) {
      return;
    }

    if (!this.statusTransitions[from].includes(to)) {
      throw new BadRequestException(
        `Cannot move invoice from ${from} to ${to}`,
      );
    }
  }

  private formatInvoiceNo(counter: number): string {
    return `INV-${counter.toString().padStart(6, '0')}`;
  }

  private include() {
    return {
      customer: true,
      lineItems: true,
      booking: { include: { service: true } },
    };
  }
}
