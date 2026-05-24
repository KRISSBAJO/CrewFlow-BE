import { Injectable } from '@nestjs/common';
import {
  ConversationMessageRole,
  ConversationStatus,
  LeadSource,
  LeadStatus,
  MessageDirection,
  MessageProvider,
} from '@prisma/client';
import { PlanLimitsService } from '../common/plan-limits.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  ImportCustomerRowDto,
  ImportWhatsAppCustomersDto,
} from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto) {
    await this.planLimits.assertCanWrite(tenantId);
    await this.planLimits.assertBelowLimit(
      tenantId,
      'customers',
      await this.prisma.customer.count({ where: { tenantId } }),
    );
    return this.prisma.customer.create({ data: { ...dto, tenantId } });
  }

  async import(tenantId: string, customers: ImportCustomerRowDto[]) {
    await this.planLimits.assertCanWrite(tenantId);
    const customerLimit = await this.planLimits.limitFor(tenantId, 'customers');
    const existingCustomers = await this.prisma.customer.count({
      where: { tenantId },
    });
    const rows = customers
      .map((customer) => ({
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email?.trim() || undefined,
        avatarUrl: customer.avatarUrl?.trim() || undefined,
        notes: customer.notes?.trim() || undefined,
      }))
      .filter((customer) => customer.name && customer.phone)
      .slice(
        0,
        Math.min(500, Math.max(0, (customerLimit ?? 500) - existingCustomers)),
      );

    let created = 0;
    let updated = 0;
    let skipped = customers.length - rows.length;
    const results: Array<{
      phone: string;
      status: 'created' | 'updated' | 'skipped';
      id?: string;
      reason?: string;
    }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (seen.has(row.phone)) {
        skipped += 1;
        results.push({
          phone: row.phone,
          status: 'skipped',
          reason: 'Duplicate phone in import',
        });
        continue;
      }
      seen.add(row.phone);

      const existing = await this.prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId, phone: row.phone } },
        select: { id: true },
      });

      const customer = await this.prisma.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: row.phone } },
        create: { ...row, tenantId },
        update: {
          name: row.name,
          email: row.email,
          avatarUrl: row.avatarUrl,
          notes: row.notes,
        },
        select: { id: true },
      });

      if (existing) {
        updated += 1;
        results.push({ phone: row.phone, status: 'updated', id: customer.id });
      } else {
        created += 1;
        results.push({ phone: row.phone, status: 'created', id: customer.id });
      }
    }

    return { created, updated, skipped, total: customers.length, results };
  }

  async importWhatsApp(tenantId: string, dto: ImportWhatsAppCustomersDto) {
    await this.planLimits.assertCanWrite(tenantId);
    const parsed = this.parseWhatsAppExport(dto.text);
    const grouped = new Map<string, ParsedWhatsAppMessage[]>();

    for (const message of parsed.messages) {
      if (!message.phone) continue;
      const current = grouped.get(message.phone) ?? [];
      current.push(message);
      grouped.set(message.phone, current);
    }

    const customers = [...grouped.entries()].map(([phone, messages]) => {
      const senderName = messages.find((message) => message.senderName)
        ?.senderName;
      const recentMessages = messages
        .slice(-5)
        .map((message) => message.content)
        .join(' | ');

      return {
        name: senderName || phone,
        phone,
        notes: `Imported from WhatsApp export. Recent messages: ${recentMessages}`.slice(
          0,
          900,
        ),
      };
    });

    const customerImport = await this.import(tenantId, customers);
    const customerByPhone = await this.prisma.customer.findMany({
      where: { tenantId, phone: { in: customers.map((customer) => customer.phone) } },
      select: { id: true, phone: true, name: true },
    });
    const customerMap = new Map(
      customerByPhone.map((customer) => [customer.phone, customer]),
    );

    let conversationsCreated = 0;
    let messagesCreated = 0;
    let leadsCreated = 0;

    for (const [phone, messages] of grouped.entries()) {
      const customer = customerMap.get(phone);
      if (!customer) continue;

      const lastMessage = messages[messages.length - 1];
      const conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          customerId: customer.id,
          channel: MessageProvider.WHATSAPP,
          status: ConversationStatus.OPEN,
          lastMessageAt: lastMessage?.occurredAt ?? new Date(),
        },
        select: { id: true },
      });
      conversationsCreated += 1;

      await this.prisma.conversationMessage.createMany({
        data: messages.slice(-25).map((message) => ({
          tenantId,
          conversationId: conversation.id,
          role: ConversationMessageRole.CUSTOMER,
          content: message.content,
          createdAt: message.occurredAt,
          metadata: {
            importedFrom: 'whatsapp_export',
            rawSender: message.sender,
          },
        })),
      });

      await this.prisma.messageLog.createMany({
        data: messages.slice(-25).map((message) => ({
          tenantId,
          customerId: customer.id,
          direction: MessageDirection.INBOUND,
          provider: MessageProvider.WHATSAPP,
          content: message.content,
          createdAt: message.occurredAt,
          metadata: {
            importedFrom: 'whatsapp_export',
            rawSender: message.sender,
          },
        })),
      });
      messagesCreated += Math.min(messages.length, 25);

      if (dto.createLeads !== false && this.looksLikeBookingInquiry(messages)) {
        await this.prisma.lead.create({
          data: {
            tenantId,
            customerId: customer.id,
            conversationId: conversation.id,
            status: LeadStatus.NEW,
            source: LeadSource.WHATSAPP,
            title: `${customer.name} WhatsApp inquiry`,
            conversionProbability: 35,
            notes: messages
              .slice(-3)
              .map((message) => message.content)
              .join(' | ')
              .slice(0, 900),
          },
        });
        leadsCreated += 1;
      }
    }

    return {
      ...customerImport,
      parsedMessages: parsed.messages.length,
      ignoredLines: parsed.ignoredLines,
      conversationsCreated,
      messagesCreated,
      leadsCreated,
    };
  }

  findAll(tenantId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  findOne(tenantId: string, id: string) {
    return this.prisma.customer.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        bookings: { orderBy: { startTime: 'desc' }, take: 10 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 10 },
        messages: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }

  async timeline(tenantId: string, id: string) {
    await this.prisma.customer.findFirstOrThrow({
      where: { id, tenantId },
      select: { id: true },
    });

    const [bookings, invoices, payments, messages, actions, conversations] =
      await Promise.all([
        this.prisma.booking.findMany({
          where: { tenantId, customerId: id },
          include: { service: true, assignedStaff: true },
          orderBy: { startTime: 'desc' },
          take: 25,
        }),
        this.prisma.invoice.findMany({
          where: { tenantId, customerId: id },
          include: { lineItems: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.payment.findMany({
          where: { tenantId, invoice: { customerId: id } },
          include: { invoice: true },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.messageLog.findMany({
          where: { tenantId, customerId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.operationalAction.findMany({
          where: { tenantId, customerId: id },
          orderBy: { createdAt: 'desc' },
          take: 25,
        }),
        this.prisma.conversation.findMany({
          where: { tenantId, customerId: id },
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: 3 },
            bookingIntents: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 25,
        }),
      ]);

    const items = [
      ...bookings.map((item) => ({
        type: 'booking',
        occurredAt: item.startTime,
        item,
      })),
      ...invoices.map((item) => ({
        type: 'invoice',
        occurredAt: item.createdAt,
        item,
      })),
      ...payments.map((item) => ({
        type: 'payment',
        occurredAt: item.paidAt ?? item.createdAt,
        item,
      })),
      ...messages.map((item) => ({
        type: 'message',
        occurredAt: item.createdAt,
        item,
      })),
      ...actions.map((item) => ({
        type: 'action',
        occurredAt: item.createdAt,
        item,
      })),
      ...conversations.map((item) => ({
        type: 'conversation',
        occurredAt: item.lastMessageAt,
        item,
      })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const now = new Date();
    const paidTotalCents = invoices
      .filter((invoice) => invoice.status === 'PAID')
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const openInvoiceCents = invoices
      .filter((invoice) => ['SENT', 'OVERDUE'].includes(invoice.status))
      .reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const lastBooking = bookings.find((booking) => booking.startTime <= now);
    const nextBooking = [...bookings]
      .filter((booking) => booking.startTime > now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];

    return {
      customerId: id,
      summary: {
        paidTotalCents,
        openInvoiceCents,
        bookingCount: bookings.length,
        invoiceCount: invoices.length,
        lastBooking,
        nextBooking,
      },
      items,
    };
  }

  private parseWhatsAppExport(text: string) {
    const lines = text.split(/\r?\n/);
    const messages: ParsedWhatsAppMessage[] = [];
    let ignoredLines = 0;
    let current: ParsedWhatsAppMessage | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const parsed = this.parseWhatsAppLine(line);
      if (parsed) {
        if (current) messages.push(current);
        current = parsed;
      } else if (current) {
        current.content = `${current.content}\n${line}`;
      } else {
        ignoredLines += 1;
      }
    }

    if (current) messages.push(current);
    return { messages, ignoredLines };
  }

  private parseWhatsAppLine(line: string): ParsedWhatsAppMessage | null {
    const patterns = [
      /^\[?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM|am|pm)?)\]?\s+-\s+([^:]+):\s+([\s\S]+)$/,
      /^(\d{4}[/-]\d{1,2}[/-]\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+([^:]+):\s+([\s\S]+)$/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const [, date, time, sender, content] = match;
      const phone = this.extractPhone(`${sender} ${content}`);
      return {
        sender: sender.trim(),
        senderName: this.senderName(sender),
        phone,
        content: content.trim(),
        occurredAt: this.parseWhatsAppDate(date, time),
      };
    }

    return null;
  }

  private parseWhatsAppDate(date: string, time: string) {
    const normalized = `${date} ${time}`.replace(/\//g, '-');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private extractPhone(value: string) {
    const match = value.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/);
    if (!match) return '';
    const digits = match[0].replace(/[^\d+]/g, '');
    return digits.startsWith('+')
      ? digits
      : digits.startsWith('00')
        ? `+${digits.slice(2)}`
        : `+${digits}`;
  }

  private senderName(sender: string) {
    const trimmed = sender.trim();
    return this.extractPhone(trimmed) ? '' : trimmed;
  }

  private looksLikeBookingInquiry(messages: ParsedWhatsAppMessage[]) {
    const text = messages.map((message) => message.content).join(' ').toLowerCase();
    return /\b(book|booking|appointment|schedule|clean|cleaning|quote|price|cost|available|tomorrow|today|friday|saturday|monday|service|repair|detail)\b/.test(
      text,
    );
  }

  update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({
      where: { id, tenantId },
      data: dto,
    });
  }
}

type ParsedWhatsAppMessage = {
  sender: string;
  senderName: string;
  phone: string;
  content: string;
  occurredAt: Date;
};
