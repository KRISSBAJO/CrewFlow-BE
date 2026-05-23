-- CreateEnum
CREATE TYPE "JobReportStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "fieldJobReportId" TEXT;

-- CreateTable
CREATE TABLE "FieldJobReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "status" "JobReportStatus" NOT NULL DEFAULT 'DRAFT',
    "checklist" JSONB,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffNotes" TEXT,
    "customerSignatureUrl" TEXT,
    "customerSignatureName" TEXT,
    "completedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldJobReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldJobReport_bookingId_key" ON "FieldJobReport"("bookingId");

-- CreateIndex
CREATE INDEX "FieldJobReport_tenantId_status_completedAt_idx" ON "FieldJobReport"("tenantId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "FieldJobReport_tenantId_completedById_idx" ON "FieldJobReport"("tenantId", "completedById");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_fieldJobReportId_fkey" FOREIGN KEY ("fieldJobReportId") REFERENCES "FieldJobReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJobReport" ADD CONSTRAINT "FieldJobReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJobReport" ADD CONSTRAINT "FieldJobReport_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJobReport" ADD CONSTRAINT "FieldJobReport_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
