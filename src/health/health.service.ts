import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      database: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const started = Date.now();
    const warnings: string[] = [];
    let database = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
      warnings.push('Database connectivity check failed.');
    }

    const environment = process.env.NODE_ENV ?? 'development';
    const production = environment === 'production';
    const corsOrigins = (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const whatsappFields = [
      process.env.WHATSAPP_ACCESS_TOKEN,
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
    ];
    const whatsappConfigured = whatsappFields.every(Boolean);
    const whatsappPartial = whatsappFields.some(Boolean) && !whatsappConfigured;
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
    const stripeWebhookReady = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    const publicApiUrl = this.urlStatus(process.env.PUBLIC_API_URL, production);

    if (production && corsOrigins.length === 0) {
      warnings.push('CORS_ORIGIN should be set to explicit frontend origins.');
    }
    if (production && !publicApiUrl.valid) {
      warnings.push('PUBLIC_API_URL should be set to the HTTPS backend URL.');
    }
    if (stripeConfigured && !stripeWebhookReady) {
      warnings.push('Stripe is configured without STRIPE_WEBHOOK_SECRET.');
    }
    if (whatsappPartial) {
      warnings.push('WhatsApp credentials are partially configured.');
    }
    if (whatsappConfigured && !process.env.WHATSAPP_APP_SECRET) {
      warnings.push('WhatsApp is configured without WHATSAPP_APP_SECRET.');
    }
    if (production && !process.env.RATE_LIMIT_ENABLED) {
      warnings.push('RATE_LIMIT_ENABLED should be enabled in production.');
    }
    if (production && process.env.ENABLE_SCHEDULER !== 'true') {
      warnings.push(
        'ENABLE_SCHEDULER should be true when automation scans are live.',
      );
    }

    const productionReady =
      database === 'ok' &&
      (!production ||
        (warnings.length === 0 &&
          corsOrigins.length > 0 &&
          publicApiUrl.valid &&
          (process.env.RATE_LIMIT_ENABLED ?? '').toLowerCase() === 'true'));

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      productionReady,
      checks: {
        database,
        api: {
          publicUrlConfigured: Boolean(process.env.PUBLIC_API_URL),
          https: publicApiUrl.https,
        },
        security: {
          corsOrigins: corsOrigins.length,
          rateLimitEnabled:
            (process.env.RATE_LIMIT_ENABLED ?? '').toLowerCase() === 'true',
          jwtConfigured: Boolean(process.env.JWT_SECRET),
        },
        integrations: {
          stripe: {
            configured: stripeConfigured,
            webhookSecretConfigured: stripeWebhookReady,
          },
          whatsapp: {
            configured: whatsappConfigured,
            appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
            mode: whatsappConfigured ? 'live' : 'mock',
          },
          openai: {
            configured: Boolean(process.env.OPENAI_API_KEY),
            model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          },
        },
        scheduler: {
          enabled: process.env.ENABLE_SCHEDULER === 'true',
          intervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 300000),
        },
      },
      warnings,
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      environment,
      timestamp: new Date().toISOString(),
    };
  }

  private urlStatus(value: string | undefined, requireHttps: boolean) {
    if (!value) {
      return { valid: false, https: false };
    }

    try {
      const url = new URL(value);
      return {
        valid: requireHttps ? url.protocol === 'https:' : true,
        https: url.protocol === 'https:',
      };
    } catch {
      return { valid: false, https: false };
    }
  }
}
