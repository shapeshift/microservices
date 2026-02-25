-- AlterTable
ALTER TABLE "public"."swaps" ADD COLUMN "affiliateAddress" TEXT;
ALTER TABLE "public"."swaps" ADD COLUMN "affiliateBps" TEXT;
ALTER TABLE "public"."swaps" ADD COLUMN "origin" TEXT;
ALTER TABLE "public"."swaps" ADD COLUMN "affiliateFeeAssetId" TEXT;
ALTER TABLE "public"."swaps" ADD COLUMN "affiliateFeeAmountCryptoBaseUnit" TEXT;
ALTER TABLE "public"."swaps" ADD COLUMN "pollFailCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "swaps_affiliateAddress_idx" ON "public"."swaps"("affiliateAddress");
