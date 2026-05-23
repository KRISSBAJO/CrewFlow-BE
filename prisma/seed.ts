import {
  AutomationTrigger,
  BookingStatus,
  InvoiceStatus,
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

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { invoiceCounter: 1 },
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
