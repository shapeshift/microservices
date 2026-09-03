-- the attribution pass filters on status and takes the oldest rows, so the index carries both
CREATE INDEX "swaps_attributionStatus_createdAt_idx" ON "swaps"("attributionStatus", "createdAt");
