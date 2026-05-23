import { Injectable } from '@nestjs/common';
import {
  AutomationRunStatus,
  AutomationTrigger,
  MessageDirection,
  MessageProvider,
  Prisma,
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
        active: dto.active ?? true,
        delayMinutes: dto.delayMinutes ?? 0,
      },
      update: {
        provider: dto.provider,
        template: dto.template,
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
        metadata: data,
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
    const customer = context.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: context.customerId, tenantId: context.tenantId },
        })
      : (booking?.customer ?? invoice?.customer ?? null);

    return {
      tenantId: context.tenantId,
      businessName: tenant.businessName,
      customerId: customer?.id,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      service: booking?.service.title ?? invoice?.booking?.service.title,
      startTime: booking?.startTime,
      staffName: booking?.assignedStaff?.name,
      invoiceNo: invoice?.invoiceNo,
      dueDate: invoice?.dueDate,
      total: invoice ? (invoice.totalCents / 100).toFixed(2) : undefined,
    };
  }

  private idempotencyKey(context: AutomationContext) {
    return [
      context.trigger,
      context.bookingId ?? 'no-booking',
      context.invoiceId ?? 'no-invoice',
      context.customerId ?? 'no-customer',
    ].join(':');
  }
}
