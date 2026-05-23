import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageDirection,
  MessageProvider,
  Prisma,
  WebhookEventStatus,
  WebhookProvider,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SignatureService } from '../security/signature.service';

type ExtractedWhatsAppMessage = {
  providerEventId?: string;
  from: string;
  name?: string;
  text: string;
};

@Injectable()
export class WhatsappWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly signatures: SignatureService,
  ) {}

  verify(mode?: string, token?: string) {
    const expected = this.config.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
      'local-dev',
    );
    return mode === 'subscribe' && token === expected;
  }

  async receive(
    payload: Record<string, unknown>,
    tenantSlug?: string,
    signature?: string,
    rawBody?: string,
  ) {
    const signatureSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    const signatureVerified = signatureSecret
      ? this.signatures.verifyHmacSha256({
          secret: signatureSecret,
          payload: rawBody ?? JSON.stringify(payload),
          signature,
          prefix: 'sha256=',
        })
      : null;

    if (signatureSecret && !signatureVerified) {
      throw new UnauthorizedException('Invalid WhatsApp webhook signature');
    }

    const tenant = tenantSlug
      ? await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
      : await this.prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
    const message = this.extractMessage(payload);
    const providerEventId = message.providerEventId ?? `local_${Date.now()}`;

    const event = await this.prisma.webhookEvent.upsert({
      where: {
        provider_providerEventId: {
          provider: WebhookProvider.WHATSAPP,
          providerEventId,
        },
      },
      create: {
        tenantId: tenant?.id,
        provider: WebhookProvider.WHATSAPP,
        providerEventId,
        status:
          tenant && message.text
            ? WebhookEventStatus.PROCESSED
            : WebhookEventStatus.IGNORED,
        payload: payload as Prisma.InputJsonValue,
        processedAt: tenant && message.text ? new Date() : undefined,
      },
      update: {},
    });

    if (!tenant || !message.text) {
      return { event, processed: false };
    }

    const customer = await this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId: tenant.id,
          phone: this.normalizePhone(message.from),
        },
      },
      create: {
        tenantId: tenant.id,
        name: message.name ?? 'WhatsApp inquiry',
        phone: this.normalizePhone(message.from),
        notes: 'Created from WhatsApp inbound webhook',
      },
      update: {
        name: message.name,
      },
    });

    const log = await this.prisma.messageLog.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        direction: MessageDirection.INBOUND,
        provider: MessageProvider.WHATSAPP,
        content: message.text,
        metadata: {
          webhookEventId: event.id,
          providerEventId: message.providerEventId,
          signaturePresent: Boolean(signature),
          signatureVerified,
        },
      },
    });

    await this.audit.record({
      tenantId: tenant.id,
      action: 'WHATSAPP_INBOUND_RECEIVED',
      entityType: 'MessageLog',
      entityId: log.id,
      summary: `Received WhatsApp message from ${customer.name}`,
      metadata: { customerId: customer.id, webhookEventId: event.id },
    });

    return { event, customer, message: log, processed: true };
  }

  private extractMessage(
    payload: Record<string, unknown>,
  ): ExtractedWhatsAppMessage {
    const entry = this.firstArrayItem(payload.entry);
    const change = this.firstArrayItem(entry?.changes);
    const value = change?.value as Record<string, unknown> | undefined;
    const rawMessage = this.firstArrayItem(value?.messages);
    const contact = this.firstArrayItem(value?.contacts);
    const text = rawMessage?.text as Record<string, unknown> | undefined;
    const profile = contact?.profile as Record<string, unknown> | undefined;

    return {
      providerEventId: rawMessage?.id as string | undefined,
      from: (rawMessage?.from as string | undefined) ?? 'unknown',
      name: profile?.name as string | undefined,
      text: (text?.body as string | undefined) ?? '',
    };
  }

  private firstArrayItem(value: unknown): Record<string, unknown> | undefined {
    return Array.isArray(value)
      ? (value[0] as Record<string, unknown>)
      : undefined;
  }

  private normalizePhone(phone: string) {
    if (phone.startsWith('+')) {
      return phone;
    }
    return `+${phone}`;
  }
}
