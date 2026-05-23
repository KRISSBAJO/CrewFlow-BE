-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MOCK', 'CASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "WebhookProvider" ADD VALUE 'STRIPE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentProvider" "PaymentProvider",
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "paymentUrl" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MOCK',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "checkoutUrl" TEXT,
    "providerPaymentId" TEXT,
    "providerSessionId" TEXT,
    "receiptUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_tenantId_status_createdAt_idx" ON "Payment"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_tenantId_invoiceId_idx" ON "Payment"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerSessionId_key" ON "Payment"("provider", "providerSessionId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
