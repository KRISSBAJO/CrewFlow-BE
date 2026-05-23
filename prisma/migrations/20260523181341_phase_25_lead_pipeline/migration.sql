-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'BOOKING_READY', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('AI_RECEPTIONIST', 'WEB_CHAT', 'WHATSAPP', 'SMS', 'EMAIL', 'PHONE', 'REFERRAL', 'MANUAL');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "bookingIntentId" TEXT,
    "bookingId" TEXT,
    "assignedToId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "title" TEXT NOT NULL,
    "estimatedValueCents" INTEGER,
    "conversionProbability" INTEGER NOT NULL DEFAULT 25,
    "followUpAt" TIMESTAMP(3),
    "wonLostReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_bookingIntentId_key" ON "Lead"("bookingIntentId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_status_followUpAt_idx" ON "Lead"("tenantId", "status", "followUpAt");

-- CreateIndex
CREATE INDEX "Lead_tenantId_source_idx" ON "Lead"("tenantId", "source");

-- CreateIndex
CREATE INDEX "Lead_tenantId_assignedToId_idx" ON "Lead"("tenantId", "assignedToId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_customerId_idx" ON "Lead"("tenantId", "customerId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_bookingIntentId_fkey" FOREIGN KEY ("bookingIntentId") REFERENCES "BookingIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
