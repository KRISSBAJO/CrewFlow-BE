import { BadRequestException, Injectable } from '@nestjs/common';
import { MessageDirection, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/current-user.decorator';
import { MessageProviderService } from '../messaging/message-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MessageProviderService,
    private readonly audit: AuditService,
  ) {}

  create(tenantId: string, dto: CreateMessageDto) {
    return this.prisma.messageLog.create({ data: { ...dto, tenantId } });
  }

  findAll(tenantId: string, customerId?: string) {
    return this.prisma.messageLog.findMany({
      where: { tenantId, customerId },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async send(user: AuthUser, dto: SendMessageDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId: user.tenantId },
    });

    if (!customer) {
      throw new BadRequestException('Customer does not belong to this tenant');
    }

    const result = await this.provider.send({
      provider: dto.provider,
      to: customer.phone,
      content: dto.content,
    });

    const message = await this.prisma.messageLog.create({
      data: {
        tenantId: user.tenantId,
        customerId: customer.id,
        direction: MessageDirection.OUTBOUND,
        provider: dto.provider,
        content: dto.content,
        metadata: {
          providerMessageId: result.providerMessageId,
          providerStatus: result.status,
          raw: result.raw,
        } as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.sub,
      action: 'MESSAGE_SENT',
      entityType: 'MessageLog',
      entityId: message.id,
      summary: `Sent ${dto.provider} message to ${customer.name}`,
      metadata: {
        customerId: customer.id,
        providerMessageId: result.providerMessageId,
      },
    });

    return { message, provider: result };
  }
}
