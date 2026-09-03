-- the attribution pass selects on this every cycle and the composite indexes all lead with another column
CREATE INDEX "swaps_attributionStatus_idx" ON "swaps"("attributionStatus");
