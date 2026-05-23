-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PLATFORM_ADMIN';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "monthlyPriceCents" INTEGER,
ADD COLUMN     "setupFeeCents" INTEGER,
ADD COLUMN     "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "suspendedAt" TIMESTAMP(3);
