/*
  Warnings:

  - You are about to drop the column `fieldJobReportId` on the `Customer` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_fieldJobReportId_fkey";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "fieldJobReportId";
