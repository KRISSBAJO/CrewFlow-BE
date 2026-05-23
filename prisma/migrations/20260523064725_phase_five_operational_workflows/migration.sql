-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('CONFIRM_BOOKING', 'DISPATCH_STAFF', 'FOLLOW_UP_NO_SHOW', 'COLLECT_PAYMENT', 'REQUEST_REVIEW', 'RESOLVE_STAFF_CONFLICT', 'FOLLOW_UP_STALE_INQUIRY');

-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED');

-- CreateTable
CREATE TABLE "OperationalAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customerId" TEXT,
    "bookingId" TEXT,
    "invoiceId" TEXT,
    "assignedToId" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'workflow',
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalAction_tenantId_status_priority_dueAt_idx" ON "OperationalAction"("tenantId", "status", "priority", "dueAt");

-- CreateIndex
CREATE INDEX "OperationalAction_tenantId_type_idx" ON "OperationalAction"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalAction_tenantId_idempotencyKey_key" ON "OperationalAction"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "OperationalAction" ADD CONSTRAINT "OperationalAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAction" ADD CONSTRAINT "OperationalAction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAction" ADD CONSTRAINT "OperationalAction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAction" ADD CONSTRAINT "OperationalAction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAction" ADD CONSTRAINT "OperationalAction_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
