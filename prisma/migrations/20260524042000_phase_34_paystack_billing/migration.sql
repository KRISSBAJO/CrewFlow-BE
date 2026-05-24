ALTER TABLE "Tenant" ADD COLUMN "paystackCustomerCode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "paystackSubscriptionCode" TEXT;
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'PAYSTACK';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYSTACK';
