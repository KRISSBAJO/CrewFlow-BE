-- Create reusable platform subscription plans.
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "setupFeeCents" INTEGER NOT NULL DEFAULT 0,
    "stripePriceId" TEXT,
    "paystackPlanCode" TEXT,
    "featureFlags" JSONB,
    "planLimits" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");

ALTER TABLE "Tenant" ADD COLUMN "subscriptionPlanId" TEXT;
CREATE INDEX "Tenant_subscriptionPlanId_idx" ON "Tenant"("subscriptionPlanId");

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_subscriptionPlanId_fkey" FOREIGN KEY ("subscriptionPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SubscriptionPlan" (
    "id",
    "name",
    "slug",
    "description",
    "active",
    "currency",
    "monthlyPriceCents",
    "setupFeeCents",
    "featureFlags",
    "planLimits",
    "sortOrder",
    "updatedAt"
) VALUES
(
    'plan_starter',
    'Starter',
    'starter',
    'For small crews proving CrewFlow with core bookings, customers, invoices, and WhatsApp follow-up.',
    true,
    'USD',
    19900,
    30000,
    '{"aiReceptionist":true,"leadPipeline":true,"whatsappAutomation":true,"retention":false,"customerPortal":true,"fieldDispatch":false}'::jsonb,
    '{"staff":5,"customers":250,"leads":100,"monthlyBookings":100,"monthlyMessages":1000}'::jsonb,
    10,
    CURRENT_TIMESTAMP
),
(
    'plan_growth',
    'Growth',
    'growth',
    'For active home-service teams that need sales pipeline, reminders, dispatch, retention, and owner reporting.',
    true,
    'USD',
    29900,
    100000,
    '{"aiReceptionist":true,"leadPipeline":true,"whatsappAutomation":true,"retention":true,"customerPortal":true,"fieldDispatch":true,"weeklyDigest":true}'::jsonb,
    '{"staff":25,"customers":2000,"leads":500,"monthlyBookings":500,"monthlyMessages":5000}'::jsonb,
    20,
    CURRENT_TIMESTAMP
),
(
    'plan_scale',
    'Scale',
    'scale',
    'For multi-manager operations that need larger limits, stronger automation, and premium support.',
    true,
    'USD',
    49900,
    200000,
    '{"aiReceptionist":true,"leadPipeline":true,"whatsappAutomation":true,"retention":true,"customerPortal":true,"fieldDispatch":true,"weeklyDigest":true,"prioritySupport":true,"advancedAdmin":true}'::jsonb,
    '{"staff":75,"customers":10000,"leads":2500,"monthlyBookings":2000,"monthlyMessages":20000}'::jsonb,
    30,
    CURRENT_TIMESTAMP
);

UPDATE "Tenant"
SET "subscriptionPlanId" = CASE
    WHEN lower("subscriptionPlan") IN ('starter') THEN 'plan_starter'
    WHEN lower("subscriptionPlan") IN ('growth', 'pilot') THEN 'plan_growth'
    WHEN lower("subscriptionPlan") IN ('scale', 'enterprise') THEN 'plan_scale'
    ELSE NULL
END;
