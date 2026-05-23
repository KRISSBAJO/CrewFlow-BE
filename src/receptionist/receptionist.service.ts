import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BookingIntentStatus,
  ConversationMessageRole,
  ConversationStatus,
  MessageDirection,
  MessageProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiReceptionistService } from './ai-receptionist.service';
import { HandoffConversationDto } from './dto/handoff-conversation.dto';
import { ReceptionistMessageDto } from './dto/receptionist-message.dto';
import { UpdateReceptionistConfigDto } from './dto/update-receptionist-config.dto';

type ExtractedReceptionistData = {
  serviceTitle?: string | null;
  preferredWindow?: string | null;
  address?: string | null;
  notes?: string | null;
};

@Injectable()
export class ReceptionistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiReceptionistService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
  ) {}

  getConfig(tenantId: string) {
    return this.prisma.receptionistConfig.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  updateConfig(user: AuthUser, dto: UpdateReceptionistConfigDto) {
    assertManager(user);
    return this.prisma.receptionistConfig.upsert({
      where: { tenantId: user.tenantId },
      create: { tenantId: user.tenantId, ...dto },
      update: dto,
    });
  }

  findConversations(user: AuthUser, status?: ConversationStatus) {
    assertManager(user);
    return this.prisma.conversation.findMany({
      where: { tenantId: user.tenantId, status },
      include: {
        customer: true,
        bookingIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }

  findConversation(user: AuthUser, id: string) {
    assertManager(user);
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        messages: { orderBy: { createdAt: 'asc' } },
        bookingIntents: { include: { service: true, booking: true } },
      },
    });
  }

  async handoff(user: AuthUser, id: string, dto: HandoffConversationDto) {
    assertManager(user);
    const conversation = await this.prisma.conversation.update({
      where: { id, tenantId: user.tenantId },
      data: {
        status: ConversationStatus.HANDED_OFF,
        handedOffAt: new Date(),
        handedOffToId: dto.handedOffToId ?? user.sub,
        handoffReason: dto.reason ?? 'Manual handoff',
      },
    });

    await this.prisma.bookingIntent.updateMany({
      where: { tenantId: user.tenantId, conversationId: id },
      data: { status: BookingIntentStatus.HANDED_OFF },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'RECEPTIONIST_HANDOFF',
      entityType: 'Conversation',
      entityId: id,
      summary: 'Conversation handed off to staff',
      metadata: { reason: dto.reason },
    });

    return conversation;
  }

  async handleInquiry(tenantId: string, dto: ReceptionistMessageDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    const config = await this.getConfig(tenantId);
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
    const conversation = await this.getOrCreateConversation(
      tenantId,
      dto,
      customer?.id,
    );

    await this.recordConversationMessage(
      tenantId,
      conversation.id,
      ConversationMessageRole.CUSTOMER,
      dto.message,
    );
    await this.prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customer?.id,
        direction: MessageDirection.INBOUND,
        provider: dto.channel ?? MessageProvider.WEB_CHAT,
        content: dto.message,
      },
    });

    const handoffRequested = config.handoffKeywords.some((keyword) =>
      dto.message.toLowerCase().includes(keyword.toLowerCase()),
    );
    const context = await this.buildContext(tenantId, conversation.id);
    const aiResult = handoffRequested
      ? null
      : await this.ai.generate({
          model: config.model,
          system: this.systemPrompt(tenant.businessName, config, services),
          user: context,
        });
    const fallback = this.fallbackReply(
      tenant.businessName,
      dto.message,
      services,
      config.quoteDisclaimer,
    );
    const reply = handoffRequested
      ? config.fallbackMessage
      : (aiResult?.reply ?? fallback.reply);
    const intentData: ExtractedReceptionistData =
      aiResult?.extracted ?? fallback.extracted;
    const matchedService = this.matchService(
      intentData.serviceTitle ?? dto.message,
      services,
    );
    const missingFields = this.missingFields(
      customer?.phone,
      matchedService?.id,
      intentData,
    );
    const bookingIntent = await this.prisma.bookingIntent.upsert({
      where: {
        id:
          (
            await this.prisma.bookingIntent.findFirst({
              where: {
                tenantId,
                conversationId: conversation.id,
                status: BookingIntentStatus.COLLECTING,
              },
              select: { id: true },
            })
          )?.id ?? 'new',
      },
      create: {
        tenantId,
        conversationId: conversation.id,
        customerId: customer?.id,
        serviceId: matchedService?.id,
        status:
          missingFields.length === 0
            ? BookingIntentStatus.READY
            : BookingIntentStatus.COLLECTING,
        preferredWindow: intentData.preferredWindow,
        address: intentData.address,
        notes: intentData.notes,
        quotedPriceCents: matchedService?.priceCents,
        missingFields,
      },
      update: {
        customerId: customer?.id,
        serviceId: matchedService?.id,
        status:
          missingFields.length === 0
            ? BookingIntentStatus.READY
            : BookingIntentStatus.COLLECTING,
        preferredWindow: intentData.preferredWindow,
        address: intentData.address,
        notes: intentData.notes,
        quotedPriceCents: matchedService?.priceCents,
        missingFields,
      },
    });
    await this.leads.upsertFromAutomation({
      tenantId,
      customerId: customer?.id,
      conversationId: conversation.id,
      bookingIntentId: bookingIntent.id,
      source: this.leads.sourceFromProvider(dto.channel ?? MessageProvider.WEB_CHAT),
      serviceTitle: matchedService?.title,
      customerName: customer?.name ?? dto.customerName,
      estimatedValueCents: matchedService?.priceCents,
      intentStatus: bookingIntent.status,
      missingFields,
      notes: intentData.notes,
    });

    await this.recordConversationMessage(
      tenantId,
      conversation.id,
      ConversationMessageRole.ASSISTANT,
      reply,
      {
        mode: aiResult ? 'openai_responses' : 'local_fallback',
        intent: aiResult?.intent ?? fallback.intent,
        bookingIntentId: bookingIntent.id,
      },
    );
    await this.prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customer?.id,
        direction: MessageDirection.OUTBOUND,
        provider: dto.channel ?? MessageProvider.WEB_CHAT,
        content: reply,
        metadata: {
          conversationId: conversation.id,
          bookingIntentId: bookingIntent.id,
          mode: aiResult ? 'openai_responses' : 'local_fallback',
        },
      },
    });

    const status = handoffRequested
      ? ConversationStatus.HANDED_OFF
      : missingFields.length === 0
        ? ConversationStatus.BOOKING_READY
        : ConversationStatus.OPEN;
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status,
        lastMessageAt: new Date(),
        handedOffAt: handoffRequested ? new Date() : undefined,
        handoffReason: handoffRequested
          ? 'Customer requested human help'
          : undefined,
      },
    });

    return {
      reply,
      customer,
      conversationId: conversation.id,
      bookingIntent,
      suggestedSlots: this.suggestSlots(config.bookingBufferMinutes),
      missingFields,
      handoff: handoffRequested,
    };
  }

  private async getOrCreateConversation(
    tenantId: string,
    dto: ReceptionistMessageDto,
    customerId?: string,
  ) {
    if (dto.conversationId) {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId, tenantId },
      });
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }
      return conversation;
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        customerId,
        channel: dto.channel ?? MessageProvider.WEB_CHAT,
      },
    });
  }

  private recordConversationMessage(
    tenantId: string,
    conversationId: string,
    role: ConversationMessageRole,
    content: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.conversationMessage.create({
      data: { tenantId, conversationId, role, content, metadata },
    });
  }

  private async buildContext(tenantId: string, conversationId: string) {
    const messages = await this.prisma.conversationMessage.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');
  }

  private systemPrompt(
    businessName: string,
    config: {
      displayName: string;
      tone: string;
      serviceArea: string | null;
      quoteDisclaimer: string;
    },
    services: Array<{
      title: string;
      durationMinutes: number;
      priceCents: number;
    }>,
  ) {
    const serviceLines = services
      .map(
        (service) =>
          `${service.title}: $${(service.priceCents / 100).toFixed(2)}, ${service.durationMinutes} minutes`,
      )
      .join('\n');
    return [
      `You are ${config.displayName}, the receptionist for ${businessName}.`,
      `Tone: ${config.tone}.`,
      config.serviceArea ? `Service area: ${config.serviceArea}.` : '',
      `Never invent services, prices, or availability. Use only this service list:\n${serviceLines}`,
      `Always include this quote note when giving prices: ${config.quoteDisclaimer}`,
      'Collect service, customer phone/name, address, and preferred day/time before saying a booking is ready.',
      'Return JSON only matching the requested schema.',
    ].join('\n');
  }

  private fallbackReply(
    businessName: string,
    message: string,
    services: Array<{
      id: string;
      title: string;
      priceCents: number;
      durationMinutes: number;
    }>,
    disclaimer: string,
  ) {
    const matched = this.matchService(message, services) ?? services[0];
    if (!matched) {
      return {
        reply: `Thanks for reaching out to ${businessName}. What service do you need, what address should we visit, and what day works best?`,
        intent: 'question',
        extracted: {} as ExtractedReceptionistData,
      };
    }
    return {
      reply: `Thanks for reaching out to ${businessName}. ${matched.title} starts at $${(matched.priceCents / 100).toFixed(2)} and usually takes about ${matched.durationMinutes} minutes. ${disclaimer} What address should we visit, and do you prefer morning or afternoon?`,
      intent: 'quote',
      extracted: { serviceTitle: matched.title } as ExtractedReceptionistData,
    };
  }

  private matchService(
    value: string | undefined,
    services: Array<{
      id: string;
      title: string;
      priceCents: number;
      durationMinutes: number;
    }>,
  ) {
    const lower = (value ?? '').toLowerCase();
    const generic = new Set(['cleaning', 'service', 'home']);
    return services
      .map((service) => {
        const title = service.title.toLowerCase();
        const words = title.split(/\s+/).filter((word) => word.length > 3);
        const exactScore = lower.includes(title) ? 10 : 0;
        const wordScore = words.reduce(
          (score, word) =>
            lower.includes(word) ? score + (generic.has(word) ? 1 : 4) : score,
          0,
        );
        return { service, score: exactScore + wordScore };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.service;
  }

  private missingFields(
    phone: string | undefined,
    serviceId: string | undefined,
    extracted: { preferredWindow?: string | null; address?: string | null },
  ) {
    return [
      !phone ? 'phone' : null,
      !serviceId ? 'service' : null,
      !extracted.address ? 'address' : null,
      !extracted.preferredWindow ? 'preferredWindow' : null,
    ].filter((field): field is string => Boolean(field));
  }

  private suggestSlots(bufferMinutes: number) {
    const now = new Date();
    return [1, 2, 3].map((days, index) => {
      const slot = new Date(now);
      slot.setDate(now.getDate() + days);
      slot.setHours(index % 2 === 0 ? 9 : 14, bufferMinutes, 0, 0);
      return slot;
    });
  }
}
