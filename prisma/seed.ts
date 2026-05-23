import {
  ActionPriority,
  ActionStatus,
  ActionType,
  AutomationTrigger,
  BookingIntentStatus,
  BookingStatus,
  ConversationMessageRole,
  ConversationStatus,
  InvoiceStatus,
  LeadSource,
  LeadStatus,
  MessageDirection,
  MessageProvider,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'sparkle-home-services' },
    update: {},
    create: {
      businessName: 'Sparkle Home Services',
      slug: 'sparkle-home-services',
      industry: 'Cleaning + Home Services',
      subscriptionPlan: 'pilot',
    },
  });

  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'owner@sparkle.test' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Ava Johnson',
      email: 'owner@sparkle.test',
      passwordHash,
      role: UserRole.OWNER,
      phone: '+15550101010',
    },
  });

  const staff = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'crew@sparkle.test' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Marcus Lee',
      email: 'crew@sparkle.test',
      passwordHash,
      role: UserRole.STAFF,
      phone: '+15550101011',
    },
  });

  const manager = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'manager@sparkle.test' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Priya Shah',
      email: 'manager@sparkle.test',
      passwordHash,
      role: UserRole.MANAGER,
      phone: '+15550101012',
    },
  });

  const deepClean = await prisma.service.upsert({
    where: { tenantId_title: { tenantId: tenant.id, title: 'Deep Home Cleaning' } },
    update: {},
    create: {
      tenantId: tenant.id,
      title: 'Deep Home Cleaning',
      description: 'Kitchen, bathrooms, floors, dusting, and detailed reset.',
      durationMinutes: 180,
      priceCents: 24900,
    },
  });

  const standardClean = await prisma.service.upsert({
    where: { tenantId_title: { tenantId: tenant.id, title: 'Standard Cleaning' } },
    update: {},
    create: {
      tenantId: tenant.id,
      title: 'Standard Cleaning',
      description: 'Recurring maintenance cleaning for active customers.',
      durationMinutes: 120,
      priceCents: 14900,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone: '+15550102020' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Nia Carter',
      phone: '+15550102020',
      email: 'nia@example.com',
      notes: 'Prefers WhatsApp. Has a dog. Gate code 4821.',
    },
  });

  const leadCustomer = await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone: '+15550103030' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Jordan Ellis',
      phone: '+15550103030',
      email: 'jordan@example.com',
      notes: 'Asked for a move-out clean and wants text reminders.',
    },
  });

  const overdueCustomer = await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone: '+15550104040' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Maya Robinson',
      phone: '+15550104040',
      email: 'maya@example.com',
      notes: 'Repeat monthly customer. Usually pays by card link.',
    },
  });

  await prisma.receptionistConfig.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      displayName: 'Sparkle Assistant',
      serviceArea: 'Chicago metro area',
      fallbackMessage:
        'Thanks for reaching out. I will collect the details and have our team follow up shortly.',
    },
    update: {
      displayName: 'Sparkle Assistant',
      serviceArea: 'Chicago metro area',
      fallbackMessage:
        'Thanks for reaching out. I will collect the details and have our team follow up shortly.',
    },
  });

  const today = new Date();
  today.setHours(10, 0, 0, 0);

  await prisma.invoice.deleteMany({
    where: { tenantId: tenant.id, booking: { source: 'seed' } },
  });
  await prisma.operationalAction.deleteMany({
    where: { tenantId: tenant.id, source: 'seed' },
  });
  await prisma.lead.deleteMany({
    where: { tenantId: tenant.id },
  });
  await prisma.bookingIntent.deleteMany({
    where: { tenantId: tenant.id, conversation: { channel: MessageProvider.WEB_CHAT } },
  });
  await prisma.conversation.deleteMany({
    where: { tenantId: tenant.id, channel: MessageProvider.WEB_CHAT },
  });

  await prisma.booking.deleteMany({
    where: { tenantId: tenant.id, source: 'seed' },
  });

  const booking = await prisma.booking.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      serviceId: deepClean.id,
      assignedStaffId: staff.id,
      startTime: today,
      endTime: new Date(today.getTime() + deepClean.durationMinutes * 60_000),
      status: BookingStatus.CONFIRMED,
      source: 'seed',
      notes: 'Send technician-on-the-way message 30 minutes before arrival.',
    },
  });

  await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      bookingId: booking.id,
      invoiceNo: 'INV-000001',
      subtotalCents: deepClean.priceCents,
      taxCents: 0,
      totalCents: deepClean.priceCents,
      dueDate: new Date(today.getTime() + 7 * 24 * 60 * 60_000),
      status: InvoiceStatus.SENT,
      lineItems: {
        create: {
          tenantId: tenant.id,
          description: deepClean.title,
          quantity: 1,
          unitCents: deepClean.priceCents,
          totalCents: deepClean.priceCents,
        },
      },
    },
  });

  const completedAt = new Date(today);
  completedAt.setDate(completedAt.getDate() - 2);
  completedAt.setHours(14, 0, 0, 0);
  const completedBooking = await prisma.booking.create({
    data: {
      tenantId: tenant.id,
      customerId: overdueCustomer.id,
      serviceId: standardClean.id,
      assignedStaffId: staff.id,
      startTime: completedAt,
      endTime: new Date(completedAt.getTime() + standardClean.durationMinutes * 60_000),
      status: BookingStatus.COMPLETED,
      source: 'seed',
      notes: 'Demo completed job with an overdue invoice.',
    },
  });

  const overdueDueDate = new Date(today);
  overdueDueDate.setDate(overdueDueDate.getDate() - 1);
  const overdueInvoice = await prisma.invoice.create({
    data: {
      tenantId: tenant.id,
      customerId: overdueCustomer.id,
      bookingId: completedBooking.id,
      invoiceNo: 'INV-DEMO-002',
      subtotalCents: standardClean.priceCents,
      taxCents: 0,
      totalCents: standardClean.priceCents,
      dueDate: overdueDueDate,
      status: InvoiceStatus.OVERDUE,
      lineItems: {
        create: {
          tenantId: tenant.id,
          description: standardClean.title,
          quantity: 1,
          unitCents: standardClean.priceCents,
          totalCents: standardClean.priceCents,
        },
      },
    },
  });

  const requestedTime = new Date(today);
  requestedTime.setDate(requestedTime.getDate() + 1);
  requestedTime.setHours(15, 0, 0, 0);
  await prisma.booking.create({
    data: {
      tenantId: tenant.id,
      customerId: leadCustomer.id,
      serviceId: deepClean.id,
      startTime: requestedTime,
      endTime: new Date(requestedTime.getTime() + deepClean.durationMinutes * 60_000),
      status: BookingStatus.REQUESTED,
      source: 'seed',
      notes: 'Booking request waiting for manager confirmation.',
    },
  });

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { invoiceCounter: 2 },
  });

  await prisma.messageLog.deleteMany({
    where: { tenantId: tenant.id, customerId: customer.id, provider: MessageProvider.WHATSAPP },
  });

  await prisma.messageLog.createMany({
    data: [
      {
        tenantId: tenant.id,
        customerId: customer.id,
        direction: MessageDirection.INBOUND,
        provider: MessageProvider.WHATSAPP,
        content: 'Hi, can I book a deep clean this week?',
      },
      {
        tenantId: tenant.id,
        customerId: customer.id,
        direction: MessageDirection.OUTBOUND,
        provider: MessageProvider.WHATSAPP,
        content: 'Yes. Deep Home Cleaning starts at $249. We have today at 10 AM or Friday at 2 PM.',
      },
    ],
  });

  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      customerId: leadCustomer.id,
      channel: MessageProvider.WEB_CHAT,
      status: ConversationStatus.BOOKING_READY,
      assignedToId: manager.id,
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            tenantId: tenant.id,
            role: ConversationMessageRole.CUSTOMER,
            content: 'Can I get a move-out deep clean Friday afternoon at 411 Lake St?',
          },
          {
            tenantId: tenant.id,
            role: ConversationMessageRole.ASSISTANT,
            content:
              'Absolutely. Deep Home Cleaning starts at $249. I can hold Friday afternoon and have the team confirm.',
          },
        ],
      },
    },
  });

  const bookingIntent = await prisma.bookingIntent.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      customerId: leadCustomer.id,
      serviceId: deepClean.id,
      status: BookingIntentStatus.READY,
      preferredWindow: 'Friday afternoon',
      address: '411 Lake St, Chicago, IL',
      notes: 'Move-out cleaning request from web chat.',
      quotedPriceCents: deepClean.priceCents,
      missingFields: [],
    },
  });

  await prisma.lead.createMany({
    data: [
      {
        tenantId: tenant.id,
        customerId: leadCustomer.id,
        conversationId: conversation.id,
        bookingIntentId: bookingIntent.id,
        assignedToId: manager.id,
        status: LeadStatus.BOOKING_READY,
        source: LeadSource.WEB_CHAT,
        title: `${deepClean.title} for ${leadCustomer.name}`,
        estimatedValueCents: deepClean.priceCents,
        conversionProbability: 85,
        followUpAt: new Date(today.getTime() + 2 * 60 * 60_000),
        notes: 'Hot web-chat lead. Needs manager confirmation.',
      },
      {
        tenantId: tenant.id,
        customerId: overdueCustomer.id,
        bookingId: completedBooking.id,
        assignedToId: manager.id,
        status: LeadStatus.WON,
        source: LeadSource.REFERRAL,
        title: `${standardClean.title} won from referral`,
        estimatedValueCents: standardClean.priceCents,
        conversionProbability: 100,
        wonLostReason: 'Converted to completed recurring clean.',
        notes: 'Demo won lead for lead-to-booking analytics.',
      },
      {
        tenantId: tenant.id,
        assignedToId: manager.id,
        status: LeadStatus.CONTACTED,
        source: LeadSource.PHONE,
        title: 'Recurring office cleaning inquiry',
        estimatedValueCents: 69900,
        conversionProbability: 45,
        followUpAt: new Date(today.getTime() - 60 * 60_000),
        notes: 'Needs callback about weekend availability.',
      },
      {
        tenantId: tenant.id,
        status: LeadStatus.LOST,
        source: LeadSource.MANUAL,
        title: 'Post-renovation clean outside service area',
        estimatedValueCents: 39900,
        conversionProbability: 0,
        wonLostReason: 'Outside current service area.',
        notes: 'Useful lost reason example.',
      },
    ],
  });

  await prisma.operationalAction.createMany({
    data: [
      {
        tenantId: tenant.id,
        type: ActionType.COLLECT_PAYMENT,
        priority: ActionPriority.URGENT,
        status: ActionStatus.OPEN,
        title: `Collect overdue invoice ${overdueInvoice.invoiceNo}`,
        description: `${overdueCustomer.name} has an overdue ${standardClean.title} invoice.`,
        customerId: overdueCustomer.id,
        bookingId: completedBooking.id,
        invoiceId: overdueInvoice.id,
        assignedToId: manager.id,
        dueAt: new Date(),
        source: 'seed',
        idempotencyKey: 'seed:collect-overdue-invoice',
        metadata: { totalCents: overdueInvoice.totalCents },
      },
      {
        tenantId: tenant.id,
        type: ActionType.CONFIRM_BOOKING,
        priority: ActionPriority.HIGH,
        status: ActionStatus.OPEN,
        title: 'Book hot receptionist lead',
        description: `${leadCustomer.name} is ready to book a deep clean.`,
        customerId: leadCustomer.id,
        assignedToId: manager.id,
        dueAt: new Date(),
        source: 'seed',
        idempotencyKey: 'seed:book-hot-lead',
        metadata: { conversationId: conversation.id },
      },
    ],
    skipDuplicates: true,
  });

  const automationRules = [
    {
      trigger: AutomationTrigger.BOOKING_CONFIRMED,
      template:
        'Hi {{customerName}}, your {{service}} appointment with {{businessName}} is confirmed for {{startTime}}.',
    },
    {
      trigger: AutomationTrigger.STAFF_ON_THE_WAY,
      template:
        '{{staffName}} from {{businessName}} is on the way. Reply here if anything changed.',
    },
    {
      trigger: AutomationTrigger.MISSED_APPOINTMENT,
      template:
        'Hi {{customerName}}, we missed you for your {{service}} appointment. Reply here and we can help reschedule.',
    },
    {
      trigger: AutomationTrigger.INVOICE_DUE,
      template:
        'Friendly reminder from {{businessName}}: invoice {{invoiceNo}} for ${{total}} is due on {{dueDate}}.',
    },
    {
      trigger: AutomationTrigger.REVIEW_REQUEST,
      template:
        'Thanks for choosing {{businessName}}, {{customerName}}. Could you leave a quick review?',
    },
  ];

  for (const rule of automationRules) {
    await prisma.automationRule.upsert({
      where: {
        tenantId_trigger: { tenantId: tenant.id, trigger: rule.trigger },
      },
      create: {
        tenantId: tenant.id,
        trigger: rule.trigger,
        template: rule.template,
      },
      update: {
        template: rule.template,
        active: true,
      },
    });
  }

  await prisma.attendance.deleteMany({
    where: { tenantId: tenant.id, userId: staff.id, notes: 'Demo active shift' },
  });

  await prisma.attendance.create({
    data: {
      tenantId: tenant.id,
      userId: staff.id,
      latitude: 41.8781,
      longitude: -87.6298,
      notes: 'Demo active shift',
    },
  });

  console.log('Seeded CrewFlow demo tenant');
  console.log('Login: owner@sparkle.test / Password123!');
  console.log(`Tenant: ${tenant.businessName} (${tenant.id})`);
  console.log(`Owner: ${owner.name}`);
  console.log(`Manager: ${manager.email}`);
  console.log(`Service: ${standardClean.title}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
