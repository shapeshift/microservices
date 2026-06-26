-- Add stable partnerCode attribution alongside the existing partnerAddress snapshot.

-- Add nullable partnerCode column to swaps
ALTER TABLE "swaps" ADD COLUMN "partnerCode" CITEXT;

-- Backfill partnerCode from the affiliate registry, matching the snapshotted
-- partnerAddress against either the affiliate's receive or wallet address.
-- Only attribute addresses that resolve to exactly one affiliate; ambiguous
-- matches (shared receive address, etc.) are left NULL.
UPDATE "swaps" s
SET "partnerCode" = m.partner_code
FROM (
  SELECT addrs."partnerAddress" AS addr,
         MIN(a."partner_code")   AS partner_code,
         COUNT(*)                AS match_count
  FROM (SELECT DISTINCT "partnerAddress" FROM "swaps" WHERE "partnerAddress" IS NOT NULL) addrs
  JOIN "affiliates" a
    ON a."partner_code" IS NOT NULL
   AND (addrs."partnerAddress" = a."receive_address" OR addrs."partnerAddress" = a."wallet_address")
  GROUP BY addrs."partnerAddress"
) m
WHERE s."partnerAddress" = m.addr
  AND m.match_count = 1;

-- Enforce that every affiliate has a partner code (now the canonical attribution key).
-- Abort the migration if any legacy affiliate is missing one so they can be assigned first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "affiliates" WHERE "partner_code" IS NULL) THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL: % affiliate row(s) have a NULL partner_code. Assign codes before migrating.',
      (SELECT COUNT(*) FROM "affiliates" WHERE "partner_code" IS NULL);
  END IF;
END $$;

ALTER TABLE "affiliates" ALTER COLUMN "partner_code" SET NOT NULL;

-- Tie swaps to affiliates by partner code with referential integrity.
ALTER TABLE "swaps"
  ADD CONSTRAINT "swaps_partnerCode_fkey"
  FOREIGN KEY ("partnerCode") REFERENCES "affiliates"("partner_code")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index the new attribution key. partnerAddress and its index are retained as a
-- per-swap payout snapshot and for legacy callers still attributing by address.
CREATE INDEX "swaps_partnerCode_idx" ON "swaps"("partnerCode");
