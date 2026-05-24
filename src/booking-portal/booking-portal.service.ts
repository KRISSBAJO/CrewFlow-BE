import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
  TenantStatus,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { addMinutes } from '../common/domain';
import { AuthUser } from '../common/current-user.decorator';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CreatePortalBookingDto } from './dto/create-portal-booking.dto';

@Injectable()
export class BookingPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly automations: AutomationsService,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly workflows: WorkflowsService,
  ) {}

  async getPortal(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        services: {
          where: { active: true },
          orderBy: { title: 'asc' },
        },
        receptionistConfig: true,
      },
    });

    if (!tenant || !this.isBookableTenant(tenant.status)) {
      throw new NotFoundException('Booking page not available');
    }

    return {
      tenant: {
        id: tenant.id,
        businessName: tenant.businessName,
        slug: tenant.slug,
        industry: tenant.industry,
        status: tenant.status,
      },
      booking: {
        paymentEnabled: true,
        defaultStatus: BookingStatus.CONFIRMED,
        source: 'customer_portal',
      },
      receptionist: tenant.receptionistConfig
        ? {
            serviceArea: tenant.receptionistConfig.serviceArea,
            businessHours: tenant.receptionistConfig.businessHours,
            quoteDisclaimer: tenant.receptionistConfig.quoteDisclaimer,
            bookingBufferMinutes:
              tenant.receptionistConfig.bookingBufferMinutes,
            maxAdvanceDays: tenant.receptionistConfig.maxAdvanceDays,
          }
        : null,
      services: tenant.services.map((service) => ({
        id: service.id,
        title: service.title,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
      })),
    };
  }

  async createBooking(slug: string, dto: CreatePortalBookingDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        services: { where: { active: true } },
        receptionistConfig: true,
      },
    });

    if (!tenant || !this.isBookableTenant(tenant.status)) {
      throw new NotFoundException('Booking page not available');
    }

    const service = tenant.services.find((item) => item.id === dto.serviceId);
    if (!service) {
      throw new NotFoundException('Service not available');
    }

    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('Invalid start time');
    }
    this.assertBookableWindow(startTime, tenant.receptionistConfig);

    const notes = [dto.address ? `Address: ${dto.address}` : null, dto.notes]
      .filter(Boolean)
      .join('\n\n');

    const customer = await this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: dto.phone,
        },
      },
      update: {
        name: dto.customerName,
        email: dto.email,
        notes: notes || undefined,
      },
      create: {
        tenantId: tenant.id,
        name: dto.customerName,
        phone: dto.phone,
        email: dto.email,
        notes: notes || undefined,
      },
    });

    const booking = await this.prisma.booking.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        serviceId: service.id,
        startTime,
        endTime: addMinutes(startTime, service.durationMinutes),
        status: BookingStatus.CONFIRMED,
        source: 'customer_portal',
        notes: notes || undefined,
      },
      include: this.bookingInclude(),
    });

    await this.audit.record({
      tenantId: tenant.id,
      action: 'PORTAL_BOOKING_CREATED',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Customer booked ${service.title} from public booking page`,
      metadata: {
        customerId: customer.id,
        serviceId: service.id,
        payNow: Boolean(dto.payNow),
        source: 'customer_portal',
      },
    });

    await this.automations.trigger({
      tenantId: tenant.id,
      trigger: AutomationTrigger.BOOKING_CONFIRMED,
      customerId: customer.id,
      bookingId: booking.id,
    });
    await this.workflows.handleBookingStatusChanged(booking);

    let invoiceResult: Awaited<
      ReturnType<PaymentsService['createInvoicePaymentLink']>
    > | null = null;
    if (dto.payNow) {
      const actor = await this.resolvePortalActor(tenant.id);
      const invoice = await this.invoices.createFromBooking(
        tenant.id,
        booking.id,
        actor.sub,
      );
      invoiceResult = await this.payments.createInvoicePaymentLink(
        actor,
        invoice.id,
        {},
      );
    }

    return {
      booking,
      customer,
      invoice: invoiceResult?.invoice ?? booking.invoice ?? null,
      payment: invoiceResult?.payment ?? null,
      links: {
        successPath: `/book/${tenant.slug}/success?bookingId=${booking.id}`,
        invoicePath: invoiceResult?.invoice
          ? `/book/${tenant.slug}/invoice/${invoiceResult.invoice.id}`
          : null,
      },
    };
  }

  async getBooking(slug: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, tenant: { slug } },
      include: {
        tenant: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            industry: true,
            status: true,
          },
        },
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
        service: true,
        invoice: {
          include: {
            payments: { orderBy: { createdAt: 'desc' }, take: 1 },
            lineItems: true,
          },
        },
        assignedStaff: { select: { id: true, name: true } },
      },
    });

    if (!booking || !this.isBookableTenant(booking.tenant.status)) {
      throw new NotFoundException('Booking not found');
    }

    return {
      tenant: booking.tenant,
      booking,
      invoice: booking.invoice,
      payment: booking.invoice?.payments[0] ?? null,
      nextSteps: this.bookingNextSteps(booking.status, booking.invoice?.status),
    };
  }

  async getInvoice(slug: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenant: { slug } },
      include: {
        tenant: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            industry: true,
            status: true,
          },
        },
        customer: {
          select: { id: true, name: true, phone: true, email: true },
        },
        booking: { include: { service: true, assignedStaff: true } },
        lineItems: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!invoice || !this.isBookableTenant(invoice.tenant.status)) {
      throw new NotFoundException('Invoice not found');
    }

    return {
      tenant: invoice.tenant,
      invoice,
      payment: invoice.payments[0] ?? null,
      checkoutUrl:
        invoice.paymentUrl ?? invoice.payments[0]?.checkoutUrl ?? null,
    };
  }

  private isBookableTenant(status: TenantStatus) {
    return status === TenantStatus.ACTIVE || status === TenantStatus.TRIAL;
  }

  private assertBookableWindow(
    startTime: Date,
    config?: {
      bookingBufferMinutes: number;
      maxAdvanceDays: number;
    } | null,
  ) {
    const now = new Date();
    const bufferMinutes = config?.bookingBufferMinutes ?? 30;
    const maxAdvanceDays = config?.maxAdvanceDays ?? 30;
    const earliest = addMinutes(now, bufferMinutes);
    const latest = new Date(now);
    latest.setDate(latest.getDate() + maxAdvanceDays);

    if (startTime < earliest) {
      throw new BadRequestException(
        `Choose a time at least ${bufferMinutes} minutes from now`,
      );
    }
    if (startTime > latest) {
      throw new BadRequestException(
        `Choose a time within the next ${maxAdvanceDays} days`,
      );
    }
  }

  private bookingNextSteps(
    status: BookingStatus,
    invoiceStatus?: InvoiceStatus | null,
  ) {
    if (status === BookingStatus.CANCELLED) {
      return ['The appointment was cancelled. Contact the business to rebook.'];
    }
    if (status === BookingStatus.COMPLETED) {
      return invoiceStatus === InvoiceStatus.PAID
        ? ['Service is complete and payment is recorded.']
        : ['Service is complete. Please pay the invoice when ready.'];
    }
    return [
      'The business will confirm staff assignment.',
      'You will receive appointment updates before arrival.',
      invoiceStatus === InvoiceStatus.PAID
        ? 'Payment is recorded.'
        : 'Pay online to keep checkout simple.',
    ];
  }

  private async resolvePortalActor(tenantId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: {
        tenantId,
        active: true,
        role: { in: [UserRole.OWNER, UserRole.MANAGER] },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    if (!user) {
      throw new BadRequestException(
        'Booking payments require an active owner or manager',
      );
    }

    return {
      sub: user.id,
      tenantId,
      email: user.email,
      role: user.role,
    };
  }

  private bookingInclude() {
    return {
      customer: true,
      service: true,
      assignedStaff: { select: { id: true, name: true } },
      invoice: true,
    };
  }
}
