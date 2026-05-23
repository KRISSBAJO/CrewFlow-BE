import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  BookingIntentStatus,
  ConversationMessageRole,
  ConversationStatus,
  MessageDirection,
  MessageProvider,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { assertManager } from '../common/permissions';
import { MessageProviderService } from '../messaging/message-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateActionFromConversationDto } from './dto/create-action-from-conversation.dto';
import { CreateBookingIntentFromConversationDto } from './dto/create-booking-intent-from-conversation.dto';
import { ReplyConversationDto } from './dto/reply-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { InboxAiService } from './inbox-ai.service';

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MessageProviderService,
    private readonly ai: InboxAiService,
    private readonly audit: AuditService,
  ) {}

  findAll(
    user: AuthUser,
    status?: ConversationStatus,
    assignedToMe?: boolean,
    channel?: MessageProvider,
  ) {
    assertManager(user);
    return this.prisma.conversation.findMany({
      where: {
        tenantId: user.tenantId,
        status,
        channel,
        assignedToId: assignedToMe ? user.sub : undefined,
      },
      include: {
        customer: true,
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        bookingIntents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { service: true },
        },
      },
      orderBy: [{ followUpAt: 'asc' }, { lastMessageAt: 'desc' }],
      take: 100,
    });
  }

  findOne(user: AuthUser, id: string) {
    assertManager(user);
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        messages: { orderBy: { createdAt: 'asc' } },
        bookingIntents: { include: { service: true, booking: true } },
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateConversationDto) {
    assertManager(user);
    await this.assertConversation(user.tenantId, id);
    if (dto.assignedToId) {
      await this.assertUser(user.tenantId, dto.assignedToId);
    }

    const conversation = await this.prisma.conversation.update({
      where: { id, tenantId: user.tenantId },
      data: {
        status: dto.status,
        assignedToId: dto.assignedToId,
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : undefined,
        resolvedAt:
          dto.status === ConversationStatus.RESOLVED ||
          dto.status === ConversationStatus.CLOSED
            ? new Date()
            : undefined,
      },
      include: { customer: true, assignedTo: true },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'INBOX_CONVERSATION_UPDATED',
      entityType: 'Conversation',
      entityId: id,
      summary: `Updated conversation status to ${conversation.status}`,
      metadata: { assignedToId: conversation.assignedToId },
    });

    return conversation;
  }

  async reply(user: AuthUser, id: string, dto: ReplyConversationDto) {
    assertManager(user);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { customer: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (!conversation.customer?.phone) {
      throw new BadRequestException(
        'Conversation customer has no phone number',
      );
    }

    const provider = dto.provider ?? conversation.channel;
    const result = await this.provider.send({
      provider,
      to: conversation.customer.phone,
      content: dto.content,
    });

    const [message] = await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: {
          tenantId: user.tenantId,
          conversationId: id,
          role: ConversationMessageRole.STAFF,
          content: dto.content,
          metadata: {
            actorId: user.sub,
            providerMessageId: result.providerMessageId,
          },
        },
      }),
      this.prisma.messageLog.create({
        data: {
          tenantId: user.tenantId,
          customerId: conversation.customerId,
          direction: MessageDirection.OUTBOUND,
          provider,
          content: dto.content,
          metadata: {
            conversationId: id,
            actorId: user.sub,
            providerMessageId: result.providerMessageId,
            providerStatus: result.status,
          },
        },
      }),
      this.prisma.conversation.update({
        where: { id },
        data: {
          status: ConversationStatus.WAITING_ON_CUSTOMER,
          assignedToId: conversation.assignedToId ?? user.sub,
          lastMessageAt: new Date(),
        },
      }),
    ]);

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'INBOX_REPLY_SENT',
      entityType: 'Conversation',
      entityId: id,
      summary: `Sent ${provider} reply to ${conversation.customer.name}`,
      metadata: {
        messageId: message.id,
        providerMessageId: result.providerMessageId,
      },
    });

    return { message, provider: result };
  }

  async suggestReply(user: AuthUser, id: string) {
    assertManager(user);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        tenant: true,
        messages: { orderBy: { createdAt: 'asc' }, take: 30 },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    const services = await this.prisma.service.findMany({
      where: { tenantId: user.tenantId, active: true },
      orderBy: { priceCents: 'asc' },
      take: 20,
    });
    const transcript = conversation.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    const suggestion = await this.ai.suggestReply({
      businessName: conversation.tenant.businessName,
      customerName: conversation.customer?.name,
      conversation: transcript,
      services,
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'INBOX_AI_REPLY_SUGGESTED',
      entityType: 'Conversation',
      entityId: id,
      summary: 'Generated inbox reply suggestion',
      metadata: { mode: suggestion.mode },
    });

    return suggestion;
  }

  async createAction(
    user: AuthUser,
    id: string,
    dto: CreateActionFromConversationDto,
  ) {
    assertManager(user);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { customer: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const action = await this.prisma.operationalAction.create({
      data: {
        tenantId: user.tenantId,
        type: ActionType.FOLLOW_UP_STALE_INQUIRY,
        priority: dto.priority ?? ActionPriority.MEDIUM,
        status: ActionStatus.OPEN,
        title: dto.title,
        description: dto.description,
        customerId: conversation.customerId,
        assignedToId: conversation.assignedToId ?? user.sub,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        idempotencyKey: `conversation:${id}:${Date.now()}`,
        metadata: {
          conversationId: id,
          channel: conversation.channel,
        },
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'INBOX_ACTION_CREATED',
      entityType: 'OperationalAction',
      entityId: action.id,
      summary: `Created action from conversation: ${action.title}`,
      metadata: { conversationId: id },
    });

    return action;
  }

  async createBookingIntent(
    user: AuthUser,
    id: string,
    dto: CreateBookingIntentFromConversationDto,
  ) {
    assertManager(user);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { customer: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (dto.serviceId) {
      await this.assertService(user.tenantId, dto.serviceId);
    }

    const missingFields = [
      !conversation.customerId ? 'customer' : null,
      !dto.serviceId ? 'service' : null,
      !dto.address ? 'address' : null,
      !dto.preferredWindow ? 'preferredWindow' : null,
    ].filter((field): field is string => Boolean(field));

    const intent = await this.prisma.bookingIntent.create({
      data: {
        tenantId: user.tenantId,
        conversationId: id,
        customerId: conversation.customerId,
        serviceId: dto.serviceId,
        status:
          missingFields.length === 0
            ? BookingIntentStatus.READY
            : BookingIntentStatus.COLLECTING,
        preferredWindow: dto.preferredWindow,
        address: dto.address,
        notes: dto.notes,
        missingFields,
      },
      include: { service: true, customer: true },
    });

    await this.prisma.conversation.update({
      where: { id },
      data: {
        status:
          missingFields.length === 0
            ? ConversationStatus.BOOKING_READY
            : ConversationStatus.OPEN,
      },
    });

    return intent;
  }

  private async assertConversation(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
  }

  private async assertUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, active: true },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('User does not belong to this tenant');
    }
  }

  private async assertService(tenantId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, tenantId, active: true },
      select: { id: true },
    });
    if (!service) {
      throw new BadRequestException('Service does not belong to this tenant');
    }
  }
}
