CREATE TYPE "WhatsAppTemplateStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED');
CREATE TYPE "WhatsAppTemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trigger" "AutomationTrigger",
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "category" "WhatsAppTemplateCategory" NOT NULL DEFAULT 'UTILITY',
    "status" "WhatsAppTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "sampleValues" JSONB,
    "variableKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metaTemplateId" TEXT,
    "rejectionReason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AutomationRule" ADD COLUMN "whatsappTemplateId" TEXT;

CREATE UNIQUE INDEX "WhatsAppTemplate_tenantId_name_language_key" ON "WhatsAppTemplate"("tenantId", "name", "language");
CREATE INDEX "WhatsAppTemplate_tenantId_status_idx" ON "WhatsAppTemplate"("tenantId", "status");
CREATE INDEX "WhatsAppTemplate_tenantId_trigger_idx" ON "WhatsAppTemplate"("tenantId", "trigger");
CREATE INDEX "AutomationRule_tenantId_whatsappTemplateId_idx" ON "AutomationRule"("tenantId", "whatsappTemplateId");

ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
