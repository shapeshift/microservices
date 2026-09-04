-- the attribution pass filters on status and orders by age, so the index carries both
CREATE INDEX "swaps_attributionStatus_createdAt_idx" ON "swaps"("attributionStatus", "createdAt");
