-- CreateEnum
CREATE TYPE "public"."VerificationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "public"."swaps" ADD COLUMN "verificationStatus" "public"."VerificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "swaps_verificationStatus_sellTxHash_idx" ON "public"."swaps"("verificationStatus", "sellTxHash");
