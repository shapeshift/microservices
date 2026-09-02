-- Ordering key and resolution outcome for attribution claims contending for one transaction.

-- existing rows stay NULL: createdAt is registration time, not when the quote was minted
ALTER TABLE "swaps" ADD COLUMN "quotedAt" TIMESTAMP(3);

CREATE TYPE "AttributionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'DISPUTED');
ALTER TABLE "swaps" ADD COLUMN "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "swaps" ADD COLUMN "attributionResolvedAt" TIMESTAMP(3);
ALTER TABLE "swaps" ADD COLUMN "attributionDetails" JSONB;

-- the existing composite index leads with status, so it cannot serve a lookup on sellTxHash alone
CREATE INDEX "swaps_sellTxHash_idx" ON "swaps"("sellTxHash");
