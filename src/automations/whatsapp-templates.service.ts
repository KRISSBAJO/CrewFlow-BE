import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AutomationTrigger,
  Prisma,
  WhatsAppTemplateCategory,
  WhatsAppTemplateStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertWhatsappTemplateDto } from './dto/upsert-whatsapp-template.dto';

type DefaultTemplate = {
  trigger: AutomationTrigger;
  name: string;
  body: string;
  variableKeys: string[];
  sampleValues: Record<string, string>;
};

@Injectable()
export class WhatsappTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  list(tenantId: string) {
    return this.prisma.whatsAppTemplate.findMany({
      where: { tenantId },
      orderBy: [{ trigger: 'asc' }, { name: 'asc' }],
    });
  }

  async upsert(
    tenantId: string,
    actorId: string,
    dto: UpsertWhatsappTemplateDto,
  ) {
    const name = this.normalizeName(dto.name);
    const body = dto.body.trim();
    const variableKeys = dto.variableKeys?.length
      ? dto.variableKeys
      : this.extractVariableKeys(body);
    const template = await this.prisma.whatsAppTemplate.upsert({
      where: {
        tenantId_name_language: {
          tenantId,
          name,
          language: dto.language ?? 'en_US',
        },
      },
      create: {
        tenantId,
        trigger: dto.trigger,
        name,
        language: dto.language ?? 'en_US',
        category: dto.category ?? WhatsAppTemplateCategory.UTILITY,
        status: dto.status ?? WhatsAppTemplateStatus.DRAFT,
        body,
        variableKeys,
        sampleValues: this.sampleValues(body, dto.sampleValues),
        active: dto.active ?? true,
      },
      update: {
        trigger: dto.trigger,
        category: dto.category,
        status: dto.status,
        body,
        variableKeys,
        sampleValues: this.sampleValues(body, dto.sampleValues),
        active: dto.active,
      },
    });

    await this.audit.record({
      tenantId,
      actorId,
      action: 'WHATSAPP_TEMPLATE_UPSERTED',
      entityType: 'WhatsAppTemplate',
      entityId: template.id,
      summary: `Updated WhatsApp template ${template.name}`,
      metadata: { trigger: template.trigger, status: template.status },
    });

    return template;
  }

  async seedDefaults(tenantId: string, actorId: string) {
    const templates: Array<
      Awaited<ReturnType<typeof this.prisma.whatsAppTemplate.upsert>>
    > = [];
    for (const item of this.defaultTemplates()) {
      const template = await this.prisma.whatsAppTemplate.upsert({
        where: {
          tenantId_name_language: {
            tenantId,
            name: item.name,
            language: 'en_US',
          },
        },
        create: {
          tenantId,
          trigger: item.trigger,
          name: item.name,
          language: 'en_US',
          category: WhatsAppTemplateCategory.UTILITY,
          status: WhatsAppTemplateStatus.DRAFT,
          body: item.body,
          variableKeys: item.variableKeys,
          sampleValues: item.sampleValues,
        },
        update: {
          trigger: item.trigger,
          body: item.body,
          variableKeys: item.variableKeys,
          sampleValues: item.sampleValues,
          active: true,
        },
      });
      await this.prisma.automationRule.updateMany({
        where: { tenantId, trigger: item.trigger },
        data: { whatsappTemplateId: template.id, template: item.body },
      });
      templates.push(template);
    }

    await this.audit.record({
      tenantId,
      actorId,
      action: 'WHATSAPP_TEMPLATE_DEFAULTS_SEEDED',
      entityType: 'Tenant',
      summary: `Seeded ${templates.length} WhatsApp production templates`,
      metadata: { count: templates.length },
    });

    return { count: templates.length, templates };
  }

  async submitToMeta(tenantId: string, actorId: string, templateId: string) {
    const template = await this.prisma.whatsAppTemplate.findFirstOrThrow({
      where: { id: templateId, tenantId },
    });
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const businessAccountId = this.config.get<string>(
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
    );

    if (!accessToken || !businessAccountId) {
      const updated = await this.prisma.whatsAppTemplate.update({
        where: { id: template.id },
        data: { status: WhatsAppTemplateStatus.PENDING_REVIEW },
      });
      await this.audit.record({
        tenantId,
        actorId,
        action: 'WHATSAPP_TEMPLATE_MARKED_FOR_META_SUBMISSION',
        entityType: 'WhatsAppTemplate',
        entityId: template.id,
        summary: `Marked ${template.name} for Meta template submission`,
        metadata: {
          mode: 'mock',
          missingBusinessAccountId: !businessAccountId,
        },
      });
      return {
        mode: 'mock',
        template: updated,
        payload: this.metaPayload(template),
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${businessAccountId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.metaPayload(template)),
      },
    );
    const raw = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new BadRequestException({
        message: 'Meta rejected WhatsApp template submission',
        raw,
      });
    }

    const updated = await this.prisma.whatsAppTemplate.update({
      where: { id: template.id },
      data: {
        status: WhatsAppTemplateStatus.PENDING_REVIEW,
        metaTemplateId:
          typeof raw.id === 'string' ? raw.id : template.metaTemplateId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId,
      action: 'WHATSAPP_TEMPLATE_SUBMITTED_TO_META',
      entityType: 'WhatsAppTemplate',
      entityId: template.id,
      summary: `Submitted ${template.name} to Meta for review`,
      metadata: raw as Prisma.InputJsonValue,
    });

    return { mode: 'live', template: updated, raw };
  }

  async linkAutomation(
    tenantId: string,
    actorId: string,
    templateId: string,
    trigger: AutomationTrigger,
  ) {
    const template = await this.prisma.whatsAppTemplate.findFirstOrThrow({
      where: { id: templateId, tenantId },
    });
    const rule = await this.prisma.automationRule.update({
      where: { tenantId_trigger: { tenantId, trigger } },
      data: {
        whatsappTemplateId: template.id,
        template: template.body,
      },
    });

    await this.audit.record({
      tenantId,
      actorId,
      action: 'WHATSAPP_TEMPLATE_LINKED_TO_AUTOMATION',
      entityType: 'AutomationRule',
      entityId: rule.id,
      summary: `Linked ${template.name} to ${trigger}`,
      metadata: { templateId: template.id, trigger },
    });

    return rule;
  }

  onboarding(tenantId: string) {
    return this.prisma.whatsAppTemplate.findMany({
      where: { tenantId },
      orderBy: [{ trigger: 'asc' }, { name: 'asc' }],
    });
  }

  metaPayload(template: {
    name: string;
    language: string;
    category: WhatsAppTemplateCategory;
    body: string;
    sampleValues: Prisma.JsonValue | null;
    variableKeys: string[];
  }) {
    const samples = this.asRecord(template.sampleValues);
    const exampleValues = template.variableKeys.map((key) =>
      this.sampleText(samples[key], this.humanize(key)),
    );
    return {
      name: template.name,
      language: template.language,
      category: template.category,
      components: [
        {
          type: 'BODY',
          text: this.toMetaBody(template.body, template.variableKeys),
          ...(exampleValues.length
            ? { example: { body_text: [exampleValues] } }
            : {}),
        },
      ],
    };
  }

  private defaultTemplates(): DefaultTemplate[] {
    return [
      {
        trigger: AutomationTrigger.BOOKING_CONFIRMED,
        name: 'crewflow_booking_confirmed',
        body: 'Hi {{customerName}}, your {{service}} appointment with {{businessName}} is confirmed for {{startTime}}. Reply here if anything changes.',
        variableKeys: ['customerName', 'service', 'businessName', 'startTime'],
        sampleValues: {
          customerName: 'Ava',
          service: 'Deep Home Cleaning',
          businessName: 'Sparkle Home Services',
          startTime: 'Friday at 2:00 PM',
        },
      },
      {
        trigger: AutomationTrigger.STAFF_ON_THE_WAY,
        name: 'crewflow_staff_on_the_way',
        body: 'Hi {{customerName}}, {{staffName}} from {{businessName}} is on the way for your {{service}} appointment.',
        variableKeys: ['customerName', 'staffName', 'businessName', 'service'],
        sampleValues: {
          customerName: 'Ava',
          staffName: 'Maya',
          businessName: 'Sparkle Home Services',
          service: 'Deep Home Cleaning',
        },
      },
      {
        trigger: AutomationTrigger.MISSED_APPOINTMENT,
        name: 'crewflow_missed_appointment',
        body: 'Hi {{customerName}}, we missed you for your {{service}} appointment with {{businessName}}. Reply here and we can help reschedule.',
        variableKeys: ['customerName', 'service', 'businessName'],
        sampleValues: {
          customerName: 'Ava',
          service: 'Deep Home Cleaning',
          businessName: 'Sparkle Home Services',
        },
      },
      {
        trigger: AutomationTrigger.INVOICE_DUE,
        name: 'crewflow_invoice_due',
        body: 'Hi {{customerName}}, invoice {{invoiceNo}} from {{businessName}} for {{total}} is due on {{dueDate}}. You can pay here: {{paymentUrl}}',
        variableKeys: [
          'customerName',
          'invoiceNo',
          'businessName',
          'total',
          'dueDate',
          'paymentUrl',
        ],
        sampleValues: {
          customerName: 'Ava',
          invoiceNo: 'INV-1042',
          businessName: 'Sparkle Home Services',
          total: '$249.00',
          dueDate: 'May 30',
          paymentUrl: 'https://pay.example/inv-1042',
        },
      },
      {
        trigger: AutomationTrigger.REVIEW_REQUEST,
        name: 'crewflow_review_request',
        body: 'Thanks for choosing {{businessName}}, {{customerName}}. If everything looked good, could you leave a quick review?',
        variableKeys: ['businessName', 'customerName'],
        sampleValues: {
          businessName: 'Sparkle Home Services',
          customerName: 'Ava',
        },
      },
      {
        trigger: AutomationTrigger.LEAD_FOLLOW_UP,
        name: 'crewflow_lead_follow_up',
        body: 'Hi {{customerName}}, this is {{businessName}} following up on {{leadTitle}}. Would you like us to help get this scheduled?',
        variableKeys: ['customerName', 'businessName', 'leadTitle'],
        sampleValues: {
          customerName: 'Ava',
          businessName: 'Sparkle Home Services',
          leadTitle: 'move-out cleaning',
        },
      },
    ];
  }

  private normalizeName(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private extractVariableKeys(body: string) {
    return [...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(
      (match) => match[1],
    );
  }

  private sampleValues(body: string, value?: Record<string, string>) {
    const keys = this.extractVariableKeys(body);
    return keys.reduce(
      (acc, key) => ({ ...acc, [key]: value?.[key] ?? this.humanize(key) }),
      {} as Record<string, string>,
    );
  }

  private toMetaBody(body: string, keys: string[]) {
    return keys.reduce(
      (text, key, index) =>
        text.replace(
          new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'),
          `{{${index + 1}}}`,
        ),
      body,
    );
  }

  private humanize(value: string) {
    return value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase());
  }

  private sampleText(value: unknown, fallback: string) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return fallback;
  }

  private asRecord(value: Prisma.JsonValue | null) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
