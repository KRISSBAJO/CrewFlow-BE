import { Injectable } from '@nestjs/common';
import {
  AutomationRunStatus,
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
  LeadSource,
  LeadStatus,
  MessageDirection,
  MessageProvider,
  Prisma,
  UserRole,
  WhatsAppTemplateStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MessageProviderService } from '../messaging/message-provider.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAutomationDto } from './dto/upsert-automation.dto';
import { TemplateService } from './template.service';

type AutomationContext = {
  tenantId: string;
  trigger: AutomationTrigger;
  customerId?: string;
  bookingId?: string;
  invoiceId?: string;
  leadId?: string;
};

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MessageProviderService,
    private readonly templates: TemplateService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.prisma.automationRule.findMany({
      where: { tenantId },
      orderBy: { trigger: 'asc' },
    });
  }

  upsert(tenantId: string, dto: UpsertAutomationDto) {
    return this.prisma.automationRule.upsert({
      where: { tenantId_trigger: { tenantId, trigger: dto.trigger } },
      create: {
        tenantId,
        trigger: dto.trigger,
        provider: dto.provider ?? MessageProvider.WHATSAPP,
        template: dto.template,
        whatsappTemplateId: dto.whatsappTemplateId,
        active: dto.active ?? true,
        delayMinutes: dto.delayMinutes ?? 0,
      },
      update: {
        provider: dto.provider,
        template: dto.template,
        whatsappTemplateId: dto.whatsappTemplateId,
        active: dto.active,
        delayMinutes: dto.delayMinutes,
      },
    });
  }

  findRuns(
    tenantId: string,
    status?: AutomationRunStatus,
    trigger?: AutomationTrigger,
  ) {
    return this.prisma.automationRun.findMany({
      where: { tenantId, status, trigger },
      include: {
        customer: true,
        booking: { include: { service: true, assignedStaff: true } },
        invoice: true,
        rule: { include: { whatsappTemplate: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async trigger(context: AutomationContext) {
    const rule = await this.prisma.automationRule.findFirst({
      where: {
        tenantId: context.tenantId,
        trigger: context.trigger,
        active: true,
      },
      include: { whatsappTemplate: true },
    });

    if (!rule) {
      return null;
    }

    const data = await this.buildTemplateData(context);
    const customerId = context.customerId ?? data.customerId;
    const phone = data.customerPhone;

    if (!customerId || !phone) {
      return this.prisma.automationRun.create({
        data: {
          tenantId: context.tenantId,
          ruleId: rule.id,
          trigger: context.trigger,
          provider: rule.provider,
          status: AutomationRunStatus.SKIPPED,
          scheduledFor: new Date(),
          content: rule.template,
          idempotencyKey: this.idempotencyKey(context),
          customerId,
          bookingId: context.bookingId,
          invoiceId: context.invoiceId,
          error: 'Missing customer or phone number',
          metadata: data,
        },
      });
    }

    const scheduledFor = new Date(Date.now() + rule.delayMinutes * 60_000);
    const content = this.templates.render(rule.template, data);
    const whatsappTemplate = this.whatsappTemplatePayload(rule, data);
    const run = await this.prisma.automationRun.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: context.tenantId,
          idempotencyKey: this.idempotencyKey(context),
        },
      },
      create: {
        tenantId: context.tenantId,
        ruleId: rule.id,
        trigger: context.trigger,
        provider: rule.provider,
        status: AutomationRunStatus.PENDING,
        scheduledFor,
        content,
        customerId,
        bookingId: context.bookingId,
        invoiceId: context.invoiceId,
        idempotencyKey: this.idempotencyKey(context),
        metadata: {
          ...data,
          ...(whatsappTemplate ? { whatsappTemplate } : {}),
        },
      },
      update: {},
    });

    if (
      run.status !== AutomationRunStatus.PENDING ||
      scheduledFor > new Date()
    ) {
      return run;
    }

    return this.sendRun(run.id);
  }

  async retry(
    tenantId: string,
    runId: string,
    actorId: string,
    reason?: string,
  ) {
    const run = await this.prisma.automationRun.findFirstOrThrow({
      where: { id: runId, tenantId },
    });

    await this.prisma.automationRun.update({
      where: { id: run.id },
      data: {
        status: AutomationRunStatus.PENDING,
        error: null,
        metadata: {
          ...(run.metadata as Record<string, unknown> | null),
          retryReason: reason,
        },
      },
    });

    const sent = await this.sendRun(run.id);
    await this.audit.record({
      tenantId,
      actorId,
      action: 'AUTOMATION_RETRIED',
      entityType: 'AutomationRun',
      entityId: run.id,
      summary: `Retried ${run.trigger} automation`,
      metadata: { reason },
    });
    return sent;
  }

  async verifyWorkflowPack(tenantId: string, actorId: string) {
    const fixture = await this.createWorkflowVerificationFixture(tenantId);
    const contexts: Array<AutomationContext & { label: string }> = [
      {
        label: 'booking reminder',
        tenantId,
        trigger: AutomationTrigger.BOOKING_CONFIRMED,
        customerId: fixture.customer.id,
        bookingId: fixture.booking.id,
      },
      {
        label: 'technician on the way',
        tenantId,
        trigger: AutomationTrigger.STAFF_ON_THE_WAY,
        customerId: fixture.customer.id,
        bookingId: fixture.booking.id,
      },
      {
        label: 'invoice reminder',
        tenantId,
        trigger: AutomationTrigger.INVOICE_DUE,
        customerId: fixture.customer.id,
        invoiceId: fixture.invoice.id,
        bookingId: fixture.booking.id,
      },
      {
        label: 'review request',
        tenantId,
        trigger: AutomationTrigger.REVIEW_REQUEST,
        customerId: fixture.customer.id,
        bookingId: fixture.booking.id,
      },
      {
        label: 'missed lead follow-up',
        tenantId,
        trigger: AutomationTrigger.LEAD_FOLLOW_UP,
        customerId: fixture.customer.id,
        leadId: fixture.lead.id,
      },
    ];

    const results: Array<{
      label: string;
      trigger: AutomationTrigger;
      runId?: string;
      status: AutomationRunStatus | 'MISSING_RULE';
      provider?: MessageProvider;
      content?: string | null;
      error?: string | null;
    }> = [];
    for (const context of contexts) {
      const run = await this.ensureVerificationRuleAndTrigger(context);
      const sent =
        run?.status === AutomationRunStatus.PENDING
          ? await this.sendRun(run.id)
          : run;
      results.push({
        label: context.label,
        trigger: context.trigger,
        runId: sent?.id,
        status: sent?.status ?? 'MISSING_RULE',
        provider: sent?.provider,
        content: sent?.content,
        error: sent?.error,
      });
    }

    await this.audit.record({
      tenantId,
      actorId,
      action: 'WHATSAPP_WORKFLOW_PACK_VERIFIED',
      entityType: 'AutomationRun',
      summary: 'Verified booking, dispatch, invoice, review, and lead follow-up workflows',
      metadata: {
        bookingId: fixture.booking.id,
        invoiceId: fixture.invoice.id,
        leadId: fixture.lead.id,
        results,
      },
    });

    return {
      tenantId,
      bookingId: fixture.booking.id,
      invoiceId: fixture.invoice.id,
      leadId: fixture.lead.id,
      passed: results.every((result) => result.status === AutomationRunStatus.SENT),
      results,
    };
  }

  private async ensureVerificationRuleAndTrigger(
    context: AutomationContext & { label: string },
  ) {
    await this.prisma.automationRule.upsert({
      where: {
        tenantId_trigger: {
          tenantId: context.tenantId,
          trigger: context.trigger,
        },
      },
      create: {
        tenantId: context.tenantId,
        trigger: context.trigger,
        provider: MessageProvider.WHATSAPP,
        template: this.verificationTemplate(context.trigger),
        active: true,
        delayMinutes: 0,
      },
      update: {
        active: true,
      },
    });
    return this.trigger(context);
  }

  private async createWorkflowVerificationFixture(tenantId: string) {
    const now = Date.now();
    const customer = await this.prisma.customer.upsert({
      where: {
        tenantId_phone: {
          tenantId,
          phone: '+15550009992',
        },
      },
      create: {
        tenantId,
        name: 'WhatsApp Workflow Verification',
        phone: '+15550009992',
        email: 'whatsapp-verification@crewflow.local',
        notes: 'Created by WhatsApp workflow verification.',
      },
      update: {
        email: 'whatsapp-verification@crewflow.local',
      },
    });
    const service =
      (await this.prisma.service.findFirst({
        where: { tenantId, active: true },
        orderBy: { createdAt: 'asc' },
      })) ??
      (await this.prisma.service.create({
        data: {
          tenantId,
          title: 'Workflow Verification Service',
          durationMinutes: 90,
          priceCents: 14900,
          active: true,
        },
      }));
    const assignedStaff = await this.prisma.user.findFirst({
      where: {
        tenantId,
        active: true,
        role: { in: [UserRole.STAFF, UserRole.MANAGER] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const startTime = new Date(now + 2 * 86_400_000);
    startTime.setHours(10, 0, 0, 0);
    const booking = await this.prisma.booking.create({
      data: {
        tenantId,
        customerId: customer.id,
        serviceId: service.id,
        assignedStaffId: assignedStaff?.id,
        startTime,
        status: BookingStatus.CONFIRMED,
        source: 'workflow_verification',
        notes: 'Created by WhatsApp workflow verification.',
      },
    });
    const dueDate = new Date(now + 7 * 86_400_000);
    const invoice = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: { invoiceCounter: { increment: 1 } },
        select: { invoiceCounter: true },
      });
      return tx.invoice.create({
        data: {
          tenantId,
          customerId: customer.id,
          bookingId: booking.id,
          invoiceNo: `INV-${tenant.invoiceCounter.toString().padStart(6, '0')}`,
          subtotalCents: service.priceCents,
          totalCents: service.priceCents,
          dueDate,
          status: InvoiceStatus.SENT,
          paymentUrl: `https://pay.crewflow.local/verify/${booking.id}`,
          lineItems: {
            create: {
              tenantId,
              description: service.title,
              quantity: 1,
              unitCents: service.priceCents,
              totalCents: service.priceCents,
            },
          },
        },
      });
    });
    const lead = await this.prisma.lead.create({
      data: {
        tenantId,
        customerId: customer.id,
        bookingId: booking.id,
        assignedToId: assignedStaff?.id,
        status: LeadStatus.CONTACTED,
        source: LeadSource.WHATSAPP,
        title: 'Missed lead verification follow-up',
        estimatedValueCents: service.priceCents,
        conversionProbability: 60,
        followUpAt: new Date(),
        notes: 'Created by WhatsApp workflow verification.',
      },
    });

    return { customer, service, booking, invoice, lead };
  }

  private verificationTemplate(trigger: AutomationTrigger) {
    const templates: Record<AutomationTrigger, string> = {
      [AutomationTrigger.BOOKING_CONFIRMED]:
        'Hi {{customerName}}, your {{service}} booking with {{businessName}} is confirmed for {{startTime}}.',
      [AutomationTrigger.STAFF_ON_THE_WAY]:
        'Hi {{customerName}}, {{staffName}} is on the way for your {{service}} appointment.',
      [AutomationTrigger.MISSED_APPOINTMENT]:
        'Hi {{customerName}}, we missed you for {{service}}. Reply here and we can help reschedule.',
      [AutomationTrigger.INVOICE_DUE]:
        'Hi {{customerName}}, invoice {{invoiceNo}} for ${{total}} is ready. Pay here: {{paymentUrl}}',
      [AutomationTrigger.REVIEW_REQUEST]:
        'Hi {{customerName}}, thanks for choosing {{businessName}}. Could you leave us a quick review?',
      [AutomationTrigger.LEAD_FOLLOW_UP]:
        'Hi {{customerName}}, checking back on your {{leadTitle}} request. Would you like us to finish booking it?',
      [AutomationTrigger.REBOOKING_REMINDER]:
        'Hi {{customerName}}, ready to schedule your next {{service}} with {{businessName}}?',
      [AutomationTrigger.CUSTOMER_WINBACK]:
        'Hi {{customerName}}, we would love to help again when you are ready.',
    };
    return templates[trigger];
  }

  private async sendRun(runId: string) {
    const run = await this.prisma.automationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { customer: true },
    });

    if (!run.customer?.phone || !run.content) {
      return this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: AutomationRunStatus.SKIPPED,
          error: 'Missing customer phone or message content',
        },
      });
    }

    try {
      const result = await this.provider.send({
        provider: run.provider,
        to: run.customer.phone,
        content: run.content,
        whatsappTemplate: this.metadataWhatsappTemplate(run.metadata),
      });

      const message = await this.prisma.messageLog.create({
        data: {
          tenantId: run.tenantId,
          customerId: run.customer.id,
          direction: MessageDirection.OUTBOUND,
          provider: run.provider,
          content: run.content,
          metadata: {
            automationRunId: run.id,
            providerMessageId: result.providerMessageId,
            providerStatus: result.status,
            raw: result.raw,
          } as Prisma.InputJsonValue,
        },
      });

      const updated = await this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: AutomationRunStatus.SENT,
          sentAt: new Date(),
          error: null,
          metadata: {
            ...(run.metadata as Record<string, unknown> | null),
            messageLogId: message.id,
            providerMessageId: result.providerMessageId,
            providerStatus: result.status,
          },
        },
      });

      await this.audit.record({
        tenantId: run.tenantId,
        action: 'AUTOMATION_SENT',
        entityType: 'AutomationRun',
        entityId: run.id,
        summary: `Sent ${run.trigger} automation to ${run.customer.name}`,
        metadata: {
          customerId: run.customer.id,
          messageLogId: message.id,
          providerMessageId: result.providerMessageId,
        },
      });

      return updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown send error';
      await this.audit.record({
        tenantId: run.tenantId,
        action: 'AUTOMATION_FAILED',
        entityType: 'AutomationRun',
        entityId: run.id,
        summary: `Failed ${run.trigger} automation`,
        metadata: { error: message },
      });

      return this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          status: AutomationRunStatus.FAILED,
          error: message,
        },
      });
    }
  }

  private async buildTemplateData(context: AutomationContext) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
    });
    const booking = context.bookingId
      ? await this.prisma.booking.findFirst({
          where: { id: context.bookingId, tenantId: context.tenantId },
          include: { customer: true, service: true, assignedStaff: true },
        })
      : null;
    const invoice = context.invoiceId
      ? await this.prisma.invoice.findFirst({
          where: { id: context.invoiceId, tenantId: context.tenantId },
          include: { customer: true, booking: { include: { service: true } } },
        })
      : null;
    const lead = context.leadId
      ? await this.prisma.lead.findFirst({
          where: { id: context.leadId, tenantId: context.tenantId },
          include: { customer: true, assignedTo: true },
        })
      : null;
    const customer = context.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: context.customerId, tenantId: context.tenantId },
        })
      : (lead?.customer ?? booking?.customer ?? invoice?.customer ?? null);

    return {
      tenantId: context.tenantId,
      businessName: tenant.businessName,
      customerId: customer?.id,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      leadId: lead?.id,
      leadTitle: lead?.title,
      leadValue: lead?.estimatedValueCents
        ? (lead.estimatedValueCents / 100).toFixed(2)
        : undefined,
      leadProbability: lead?.conversionProbability,
      leadFollowUpAt: lead?.followUpAt,
      leadOwnerName: lead?.assignedTo?.name,
      service:
        booking?.service.title ??
        invoice?.booking?.service.title ??
        lead?.title,
      startTime: booking?.startTime,
      staffName: booking?.assignedStaff?.name,
      invoiceNo: invoice?.invoiceNo,
      dueDate: invoice?.dueDate,
      total: invoice ? (invoice.totalCents / 100).toFixed(2) : undefined,
      paymentUrl: invoice?.paymentUrl,
    };
  }

  private whatsappTemplatePayload(
    rule: {
      whatsappTemplate?: {
        status: WhatsAppTemplateStatus;
        name: string;
        language: string;
        variableKeys: string[];
      } | null;
    },
    data: Record<string, unknown>,
  ) {
    const template = rule.whatsappTemplate;
    if (!template || template.status !== WhatsAppTemplateStatus.APPROVED) {
      return undefined;
    }
    return {
      name: template.name,
      language: template.language,
      parameters: template.variableKeys.map((key) =>
        this.templateParameter(data[key]),
      ),
    };
  }

  private templateParameter(value: unknown) {
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }

  private metadataWhatsappTemplate(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return undefined;
    }
    const template = (metadata as Record<string, unknown>).whatsappTemplate;
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
      return undefined;
    }
    const data = template as Record<string, unknown>;
    if (
      typeof data.name !== 'string' ||
      typeof data.language !== 'string' ||
      !Array.isArray(data.parameters)
    ) {
      return undefined;
    }
    return {
      name: data.name,
      language: data.language,
      parameters: data.parameters.map((value) => String(value)),
    };
  }

  private idempotencyKey(context: AutomationContext) {
    return [
      context.trigger,
      context.bookingId ?? 'no-booking',
      context.invoiceId ?? 'no-invoice',
      context.leadId ?? 'no-lead',
      context.customerId ?? 'no-customer',
    ].join(':');
  }
}
