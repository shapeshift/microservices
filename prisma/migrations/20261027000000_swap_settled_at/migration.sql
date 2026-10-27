-- When a swap reached SUCCESS or FAILED, which anchors the verification and attribution deadlines.

-- existing rows stay NULL and fall back to createdAt, which their 24h settlement window kept close
ALTER TABLE "swaps" ADD COLUMN "settledAt" TIMESTAMP(3);

-- bounds the scans for settled swaps still missing a price
CREATE INDEX "swaps_status_createdAt_idx" ON "swaps"("status", "createdAt");
