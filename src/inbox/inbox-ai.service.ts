import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type SuggestedReplyInput = {
  businessName: string;
  customerName?: string | null;
  conversation: string;
  services: Array<{
    title: string;
    priceCents: number;
    durationMinutes: number;
  }>;
};

@Injectable()
export class InboxAiService {
  constructor(private readonly config: ConfigService) {}

  async suggestReply(input: SuggestedReplyInput) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      return this.fallback(input);
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content:
              'You write concise, operational customer-service replies for service businesses. Do not invent availability, prices, or policies.',
          },
          {
            role: 'user',
            content: [
              `Business: ${input.businessName}`,
              `Customer: ${input.customerName ?? 'Unknown'}`,
              `Services: ${input.services
                .map(
                  (service) =>
                    `${service.title} $${(service.priceCents / 100).toFixed(2)} ${service.durationMinutes}min`,
                )
                .join('; ')}`,
              `Conversation:\n${input.conversation}`,
              'Return a ready-to-send reply in 1-3 sentences.',
            ].join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) {
      return this.fallback(input);
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const reply =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.text)?.text;

    return {
      reply: reply?.trim() || this.fallback(input).reply,
      mode: 'openai_responses',
    };
  }

  private fallback(input: SuggestedReplyInput) {
    const latestCustomerLine = input.conversation
      .split('\n')
      .reverse()
      .find((line) => line.startsWith('CUSTOMER:'));
    const service = input.services[0];
    const price = service
      ? ` ${service.title} starts at $${(service.priceCents / 100).toFixed(2)}.`
      : '';
    return {
      reply: `Thanks${input.customerName ? ` ${input.customerName}` : ''}. We can help with that.${price} What day, time window, and service address work best for you?`,
      mode: 'local_fallback',
      source: latestCustomerLine,
    };
  }
}
