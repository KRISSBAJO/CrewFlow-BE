import { Injectable } from '@nestjs/common';
import { MessageDirection, MessageProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReceptionistMessageDto } from './dto/receptionist-message.dto';

@Injectable()
export class ReceptionistService {
  constructor(private readonly prisma: PrismaService) {}

  async handleInquiry(tenantId: string, dto: ReceptionistMessageDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    const services = await this.prisma.service.findMany({
      where: { tenantId, active: true },
      orderBy: { priceCents: 'asc' },
    });

    const customer = dto.phone
      ? await this.prisma.customer.upsert({
          where: { tenantId_phone: { tenantId, phone: dto.phone } },
          create: {
            tenantId,
            phone: dto.phone,
            name: dto.customerName ?? 'New inquiry',
            notes: 'Created by AI receptionist intake',
          },
          update: {
            name: dto.customerName,
          },
        })
      : null;

    await this.prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customer?.id,
        direction: MessageDirection.INBOUND,
        provider: MessageProvider.WEB_CHAT,
        content: dto.message,
      },
    });

    const reply = this.composeReply(tenant.businessName, dto.message, services);

    await this.prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customer?.id,
        direction: MessageDirection.OUTBOUND,
        provider: MessageProvider.WEB_CHAT,
        content: reply,
        metadata: {
          mode: 'rules-first-ai-ready',
          nextStep: 'connect-openai-response-provider',
        },
      },
    });

    return {
      reply,
      customer,
      suggestedActions: [
        'collect_address',
        'confirm_service',
        'offer_two_time_slots',
        'create_booking_after_confirmation',
      ],
    };
  }

  private composeReply(
    businessName: string,
    message: string,
    services: Array<{
      title: string;
      priceCents: number;
      durationMinutes: number;
    }>,
  ): string {
    const lower = message.toLowerCase();
    const matched = services.find((service) =>
      lower.includes(service.title.toLowerCase().split(' ')[0]),
    );
    const leadService = matched ?? services[0];

    if (!leadService) {
      return `Thanks for reaching out to ${businessName}. I can help collect your details and get you scheduled. What service do you need, what address should we visit, and what day works best?`;
    }

    const price = (leadService.priceCents / 100).toFixed(2);
    return `Thanks for reaching out to ${businessName}. ${leadService.title} starts at $${price} and usually takes about ${leadService.durationMinutes} minutes. What address should we visit, and do you prefer morning or afternoon?`;
  }
}
