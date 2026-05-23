-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "featureFlags" JSONB,
ADD COLUMN     "planLimits" JSONB;

-- CreateTable
CREATE TABLE "PlatformSupportNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSupportNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSupportAccess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSupportAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSupportNote_tenantId_createdAt_idx" ON "PlatformSupportNote"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformSupportNote_authorId_idx" ON "PlatformSupportNote"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSupportAccess_token_key" ON "PlatformSupportAccess"("token");

-- CreateIndex
CREATE INDEX "PlatformSupportAccess_tenantId_createdAt_idx" ON "PlatformSupportAccess"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformSupportAccess_adminId_createdAt_idx" ON "PlatformSupportAccess"("adminId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformSupportNote" ADD CONSTRAINT "PlatformSupportNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSupportNote" ADD CONSTRAINT "PlatformSupportNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSupportAccess" ADD CONSTRAINT "PlatformSupportAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSupportAccess" ADD CONSTRAINT "PlatformSupportAccess_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
