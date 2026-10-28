-- When a swap reached SUCCESS or FAILED, which anchors the verification and attribution deadlines.
ALTER TABLE "swaps" ADD COLUMN "settledAt" TIMESTAMP(3);

-- swaps already settled used to settle within 24h of registration, so registration stands in for them
UPDATE "swaps" SET "settledAt" = "createdAt" WHERE "status" IN ('SUCCESS', 'FAILED');

-- bounds the scans for settled swaps still missing a price
CREATE INDEX "swaps_status_settledAt_idx" ON "swaps"("status", "settledAt");
