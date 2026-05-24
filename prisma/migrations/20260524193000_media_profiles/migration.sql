ALTER TABLE "Tenant" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "coverImageUrl" TEXT;

ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;

ALTER TABLE "Customer" ADD COLUMN "avatarUrl" TEXT;

ALTER TABLE "Service" ADD COLUMN "imageUrl" TEXT;
