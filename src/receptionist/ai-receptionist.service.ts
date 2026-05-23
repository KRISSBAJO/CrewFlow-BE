import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ReceptionistAiInput = {
  model: string;
  system: string;
  user: string;
};

type ReceptionistAiOutput = {
  reply: string;
  intent: 'quote' | 'book' | 'reschedule' | 'cancel' | 'question' | 'handoff';
  confidence: number;
  extracted: {
    serviceTitle?: string;
    preferredWindow?: string;
    address?: string;
    notes?: string;
  };
};

@Injectable()
export class AiReceptionistService {
  constructor(private readonly config: ConfigService) {}

  async generate(
    input: ReceptionistAiInput,
  ): Promise<ReceptionistAiOutput | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      return null;
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'receptionist_reply',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['reply', 'intent', 'confidence', 'extracted'],
              properties: {
                reply: { type: 'string' },
                intent: {
                  type: 'string',
                  enum: [
                    'quote',
                    'book',
                    'reschedule',
                    'cancel',
                    'question',
                    'handoff',
                  ],
                },
                confidence: { type: 'number' },
                extracted: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'serviceTitle',
                    'preferredWindow',
                    'address',
                    'notes',
                  ],
                  properties: {
                    serviceTitle: { type: ['string', 'null'] },
                    preferredWindow: { type: ['string', 'null'] },
                    address: { type: ['string', 'null'] },
                    notes: { type: ['string', 'null'] },
                  },
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const text =
      payload.output_text ??
      payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.text)?.text;

    if (!text) {
      return null;
    }

    return JSON.parse(text) as ReceptionistAiOutput;
  }
}
