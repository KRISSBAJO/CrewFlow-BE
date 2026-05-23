-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM ('SETUP_FEE_INVOICED', 'SETUP_FEE_PAID', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_RENEWED', 'PAYMENT_FAILED', 'PAST_DUE', 'CANCELED', 'CREDIT_APPLIED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "pastDueAt" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformBillingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "BillingEventType" NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerEventId" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformBillingEvent_tenantId_createdAt_idx" ON "PlatformBillingEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformBillingEvent_actorId_idx" ON "PlatformBillingEvent"("actorId");

-- CreateIndex
CREATE INDEX "PlatformBillingEvent_type_createdAt_idx" ON "PlatformBillingEvent"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformBillingEvent" ADD CONSTRAINT "PlatformBillingEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformBillingEvent" ADD CONSTRAINT "PlatformBillingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
