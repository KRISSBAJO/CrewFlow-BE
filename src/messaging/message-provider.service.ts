import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageProvider } from '@prisma/client';

export type SendMessageInput = {
  provider: MessageProvider;
  to: string;
  content: string;
};

export type SendMessageResult = {
  provider: MessageProvider;
  providerMessageId: string;
  status: 'sent' | 'mock_sent';
  raw: Record<string, unknown>;
};

@Injectable()
export class MessageProviderService {
  private readonly logger = new Logger(MessageProviderService.name);

  constructor(private readonly config: ConfigService) {}

  readiness() {
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const verifyToken = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');

    return {
      mode: accessToken && phoneNumberId ? 'live' : 'mock',
      ready: Boolean(accessToken && phoneNumberId && verifyToken),
      checks: {
        accessToken: Boolean(accessToken),
        phoneNumberId: Boolean(phoneNumberId),
        verifyToken: Boolean(verifyToken),
        appSecret: Boolean(appSecret),
        signatureVerification: Boolean(appSecret),
      },
    };
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    if (input.provider !== MessageProvider.WHATSAPP) {
      return this.mock(input, 'provider_not_configured');
    }

    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');

    if (!accessToken || !phoneNumberId) {
      return this.mock(input, 'missing_whatsapp_credentials');
    }

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: input.to.replace(/^\+/, ''),
          type: 'text',
          text: { preview_url: false, body: input.content },
        }),
      },
    );
    const raw = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      this.logger.warn(`WhatsApp send failed: ${JSON.stringify(raw)}`);
      throw new Error('WhatsApp provider rejected the message');
    }

    const messages = raw.messages as Array<{ id?: string }> | undefined;
    return {
      provider: MessageProvider.WHATSAPP,
      providerMessageId: messages?.[0]?.id ?? `wa_${Date.now()}`,
      status: 'sent',
      raw,
    };
  }

  private mock(input: SendMessageInput, reason: string): SendMessageResult {
    return {
      provider: input.provider,
      providerMessageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status: 'mock_sent',
      raw: {
        reason,
        to: input.to,
        content: input.content,
      },
    };
  }
}
