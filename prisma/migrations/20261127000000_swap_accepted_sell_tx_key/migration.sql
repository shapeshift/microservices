-- One spelling per sell transaction, and at most one accepted claim on it.

-- mirrors canonicalizeTxHash: hex hashes take each chain's usual form, anything else is only trimmed
UPDATE "swaps" s
SET "sellTxHash" = CASE
  WHEN c.hash !~* '^(0x)?[0-9a-f]+$' THEN c.hash
  WHEN c.namespace = 'eip155' THEN '0x' || lower(c.digits)
  WHEN c.namespace IN ('bip122', 'tron') THEN lower(c.digits)
  WHEN c.namespace = 'cosmos' THEN upper(c.digits)
  WHEN c.hash ~* '^0x' THEN '0x' || lower(c.digits)
  ELSE c.hash
END
FROM (
  SELECT
    "swapId",
    split_part("sellAsset"->>'chainId', ':', 1) AS namespace,
    regexp_replace("sellTxHash", '^\s+|\s+$', '', 'g') AS hash,
    regexp_replace(regexp_replace("sellTxHash", '^\s+|\s+$', '', 'g'), '^0[xX]', '') AS digits
  FROM "swaps"
  WHERE "sellTxHash" IS NOT NULL
) c
WHERE s."swapId" = c."swapId";

ALTER TABLE "swaps" ADD COLUMN "acceptedSellTxKey" TEXT;

-- a transaction already accepted for more than one swap is not settled for any of them until a person reviews it
WITH accepted AS (
  SELECT "swapId", ("sellAsset"->>'chainId') || ':' || "sellTxHash" AS key
  FROM "swaps"
  WHERE "attributionStatus" = 'ACCEPTED' AND "sellTxHash" IS NOT NULL
),
contested AS (
  SELECT key FROM accepted WHERE key IS NOT NULL GROUP BY key HAVING COUNT(*) > 1
)
UPDATE "swaps" s
SET
  "attributionStatus" = 'DISPUTED',
  "attributionDetails" = jsonb_build_object('checked', true, 'reason', 'duplicate-claim'),
  "attributionResolvedAt" = CURRENT_TIMESTAMP
FROM accepted a
JOIN contested c ON c.key = a.key
WHERE s."swapId" = a."swapId";

UPDATE "swaps"
SET "acceptedSellTxKey" = ("sellAsset"->>'chainId') || ':' || "sellTxHash"
WHERE "attributionStatus" = 'ACCEPTED' AND "sellTxHash" IS NOT NULL;

CREATE UNIQUE INDEX "swaps_acceptedSellTxKey_key" ON "swaps"("acceptedSellTxKey");
