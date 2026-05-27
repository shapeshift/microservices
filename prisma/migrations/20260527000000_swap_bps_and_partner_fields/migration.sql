-- Backfill any NULL affiliateBps rows with the unattributed default (60)
UPDATE "swaps" SET "affiliateBps" = 60 WHERE "affiliateBps" IS NULL;

-- Make affiliateBps non-nullable
ALTER TABLE "swaps" ALTER COLUMN "affiliateBps" SET NOT NULL;

-- Add partnerBps column with default 0
ALTER TABLE "swaps" ADD COLUMN "partnerBps" INTEGER NOT NULL DEFAULT 0;

-- Backfill partnerBps for partner swaps (affiliateAddress present)
UPDATE "swaps" SET "partnerBps" = GREATEST(0, "affiliateBps" - "shapeshiftBps")
  WHERE "affiliateAddress" IS NOT NULL;

-- Fix shapeshiftBps for non-partner swaps (all fee goes to ShapeShift)
UPDATE "swaps" SET "shapeshiftBps" = "affiliateBps"
  WHERE "affiliateAddress" IS NULL;

-- Rename affiliateAddress -> partnerAddress
ALTER TABLE "swaps" RENAME COLUMN "affiliateAddress" TO "partnerAddress";

-- Drop old index and create new one with renamed column
DROP INDEX IF EXISTS "swaps_affiliateAddress_idx";
CREATE INDEX "swaps_partnerAddress_idx" ON "swaps"("partnerAddress");

-- Backfill any NULL receiveAddress rows
UPDATE "swaps" SET "receiveAddress" = 'unknown' WHERE "receiveAddress" IS NULL;

-- Make receiveAddress non-nullable
ALTER TABLE "swaps" ALTER COLUMN "receiveAddress" SET NOT NULL;
