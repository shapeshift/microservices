-- AlterTable
ALTER TABLE "public"."swaps" ADD COLUMN "affiliateAddress" TEXT;

-- CreateIndex
CREATE INDEX "swaps_affiliateAddress_idx" ON "public"."swaps"("affiliateAddress");
