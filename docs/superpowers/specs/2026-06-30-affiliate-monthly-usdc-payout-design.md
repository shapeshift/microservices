# Affiliate Monthly USDC Payout Script — Design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Author:** kaladinlight (+ Claude)

## Purpose

Generate a Gnosis Safe CSV-airdrop file that pays each affiliate partner their
earned USDC revenue for a calendar month, aggregated by `partnerCode`, plus a
machine-readable run record that a later settlement-tracking feature can build
on.

Payouts are USDC on **Arbitrum One**, imported via the Safe CSV-airdrop app
(same target as `~/github/shapeshift/rFOX`).

## Context / prior art

- **`scripts/referral-rewards.ts`** (+ `yarn referral-rewards`) is the existing
  precedent for period-windowed payout scripts in this repo. We mirror its
  shape (root `scripts/` dir, `yarn` entry, ISO date args, output artifacts in a
  sibling dir).
- **rFOX `cli/src/safeWallet.ts`** defines the Safe CSV format we target.
- **`apps/swap-service`** owns the swap + affiliate data and the fee math we reuse.

## Data model (existing, swap-service / Postgres / Prisma)

- `Swap` (`swaps` table): `partnerCode` (FK → `Affiliate.partnerCode`), `status`,
  `isAffiliateVerified`, `createdAt`, `partnerBps`, `affiliateVerificationDetails`
  (`{ hasAffiliate, affiliateBps, verifiedSellAmountCryptoBaseUnit, ... }`),
  `actualAffiliateFeeAmountCryptoBaseUnit`, `affiliateFeeAssetId`, `sellAssetUsd`,
  `buyAssetUsd`, `affiliateAssetUsd`.
- `Affiliate` (`affiliates` table): `partnerCode` (unique), `walletAddress`
  (unique, SIWE/EVM), `receiveAddress` (optional, free-form Citext), `bps`.
- Payout destination for a partner = **current** `receiveAddress ?? walletAddress`
  (the live address, NOT the per-swap `partnerAddress` snapshot — we pay where the
  partner wants funds now).
- Fee math lives in `apps/swap-service/src/swaps/utils.ts`:
  - `calculateFeeForSwap(swap) -> { feeUsd, volumeUsd, verifiedBps } | null`
  - `getPartnerFeeRate(verifiedBps, partnerBps) -> min(partnerBps/verifiedBps, 1)`
  - `toSwap(prismaSwap) -> Swap` (deserializes JSON columns)
- `AffiliateService.getAffiliateStats` already performs the per-partner
  aggregation we want; this script generalizes it across all partners and emits
  payout artifacts.

## Scope decisions (locked)

| Decision | Choice |
|---|---|
| Eligible swaps | `status='SUCCESS'` with a `partnerCode`, **all origins** (web + api). All are fetched; only swaps that verified successfully as ours (`verificationStatus='SUCCESS'` **and** `isAffiliateVerified=true`) are paid. Swaps are partitioned by `verificationStatus` and surfaced (not dropped) so a swap verified *after* the run isn't silently lost — a `verificationStatus='SUCCESS'` filter in the query would never revisit a still-`PENDING` one, since the next window keys off `createdAt`. |
| Fee basis | **Always the on-chain verified fee** — the bps-implied fee is *never* a payout basis. Verified fee is guarded by a deviation check vs. the bps-implied fee; anomalies are flagged + excluded (see Fee-deviation guard). A swap with **no** resolvable verified fee is surfaced (`no-verified-fee`) and excluded, not paid on an estimate. |
| Minimum payout | **No minimum** — any partner with `feesEarnedUsd > 0` and a valid address gets a row. |
| Invalid/non-EVM recipient | **Exclude from CSV + warn** (listed in summary and JSON). Run still succeeds. |
| Database | Reads the swap-service Postgres. **`DATABASE_URL` must be exported for the run** (`DATABASE_URL=<url> yarn affiliate-payouts …`); the script fails fast if unset and logs the DB host it connected to. |
| Location / invocation | `scripts/affiliate-payouts.ts`, wired as `yarn affiliate-payouts`. |
| USD → USDC | Treated **1:1**, valued at swap time and summed over the window. |

## Invocation

```bash
yarn affiliate-payouts generate [startDate] [endDate] [--force]
```

- **No args** → previous calendar month in **UTC**. Run on 2026-07-01 → covers
  `2026-06-01T00:00:00Z` (inclusive) to `2026-07-01T00:00:00Z` (**exclusive**).
- Optional ISO date args override the window. End is always treated as
  **exclusive** (`gte: start, lt: end`) to avoid boundary double-counting.
- **`--force`** is required to overwrite an existing window's artifacts. A re-run whose numbers
  shifted (e.g. more swaps verified since) must not silently clobber a file that may already have
  been executed on the Safe — the guard makes re-generation an explicit choice.

## Computation

1. **Query once:**
   ```ts
   prisma.swap.findMany({
     where: {
       partnerCode: { not: null },
       status: 'SUCCESS',
       createdAt: { gte: start, lt: end },
     },
   })
   ```
   Verification is intentionally **not** filtered in the query — it's partitioned in step 2 so
   unverified swaps can be surfaced instead of silently dropped. `partnerCode` is Postgres
   **citext** (case-insensitive), so all in-memory keying canonicalizes to lower-case; otherwise
   a case difference between a swap and its affiliate row splits accruals or drops the lookup.
2. **Partition + group by `partnerCode`.** Read `verificationStatus` (the tri-state verification
   *job* outcome) directly — `isAffiliateVerified` alone can't distinguish a real failure from a
   swap that verified fine but has no affiliate fee for us. For each swap:
   - `verificationStatus = PENDING` → **not paid**; `unverified` review item (`pending`). Only
     these can still flip to paid on a later run, so they're the ones to re-check before payout.
   - `verificationStatus = FAILED` → **not paid**; `unverified` review item (`failed`) — investigate.
   - `verificationStatus = SUCCESS` but `isAffiliateVerified = false` (`hasAffiliate=false`)
     → **not paid**; counted as `noAffiliateFee`. This is *no affiliate fee for us* — either the
     on-chain affiliate wasn't ours, or it **was** ours but the applied/verified affiliate bps was 0
     (nothing collected). Expected, so it's counted in totals but *not* warned per-swap.
   - `calculateFeeForSwap(toSwap(swap))` returns `null` (missing/unpriceable verification
     details) → skip, increment `skippedSwaps`.
   - no resolvable **verified on-chain fee** (`fee.actualFeeUsd === null`) → recorded as a
     `no-verified-fee` review item and excluded. Payouts are **only** on the verified fee; the
     bps-implied fee is never paid.
   - verified fee fails the **fee-deviation guard** (below) → excluded as an `anomaly`.
   - partner share resolves to 0 (`partnerBps = 0`) → recorded as a `partner-bps-unset` review item
     and excluded. `partnerBps` is set independently of `partnerCode` at creation (client-supplied,
     column default 0), so an attributed swap can arrive with it unset — usually a mis-populated
     `partnerBps` rather than a real 0% deal.
   - otherwise accrue the **verified fee** (amounts summed with `BigNumber` to avoid float drift):
   ```ts
   const rate = getPartnerFeeRate(fee.verifiedBps, swap.partnerBps)
   partner.feesEarnedUsd = partner.feesEarnedUsd.plus(new BigNumber(fee.actualFeeUsd).times(rate))
   partner.volumeUsd     = partner.volumeUsd.plus(fee.volumeUsd)
   partner.swapCount     += 1
   ```
   Reusing the app fee math keeps volume/rate consistent with the affiliate `/stats` dashboard;
   the payout differs only in that it pays **strictly** the verified fee (no implied fallback).

### Fee-deviation guard (money-correctness)

The payout uses the **on-chain verified affiliate fee** (`actualAffiliateFeeAmountCryptoBaseUnit`
→ `fee.actualFeeUsd`) when present, because that is what was actually collected. But that
field is **not always trustworthy**: some swaps record a fee asset / amount that doesn't match
what was really taken. Confirmed example: **MayaChain swaps** (affiliate `ssmaya`) label the
affiliate fee asset as USDC while the fee is actually collected in **CACAO**, so the stored
base-unit amount, priced/scaled as USDC, produces a wildly wrong USD fee (observed: **$39,020
"fee" on a $100 swap**, which would have paid a partner ~$29k).

To catch this, `calculateFeeForSwap` is extended to also expose `actualFeeUsd` and
`impliedFeeUsd` (`= verifiedVolumeUsd × verifiedBps / 10000`). The implied fee is used **only** as
this guard's reference bound — never as an amount paid. For each swap the script compares the two:

```
deviation = |actualFeeUsd - impliedFeeUsd| / impliedFeeUsd
```

- An on-chain fee never equals the implied fee exactly (quote→execution price drift, partial /
  streaming fills, fee-asset conversion), so a relative tolerance band is allowed:
  `FEE_DEVIATION_TOLERANCE = 0.25` (±25%, tunable). Corrupt cases seen in the wild are orders of
  magnitude off (e.g. 750×), so a tight band still catches them while limiting how far a
  within-band amount can drift from the implied fee.
- If `deviation > tolerance`, **or** the implied fee can't be computed (volume unpriceable),
  the swap is treated as an **anomaly**: excluded from the partner's total and recorded in
  `warnings`. The partner is still paid for their other, non-anomalous swaps.
- Swaps with **no** verified on-chain fee are excluded as `no-verified-fee` (see step 2) — they
  are never paid on the bps-implied estimate.

This diverges from the current `/stats` numbers for affected swaps — by design, because
`/stats` would surface the same corrupt figures.
3. **Resolve addresses:** for each `partnerCode`, look up the `Affiliate` and take
   `receiveAddress ?? walletAddress`.
4. **Convert to USDC:** USD amount is treated 1:1 with USDC. Floor each partner
   total to **6 dp** (USDC precision) so we never overpay. Use `BigNumber` for the
   formatting (avoid float drift).

## Address validation

- A recipient is valid if it is a well-formed EVM address. We use `viem`'s
  `isAddress` / `getAddress` (checksum). The zero address is also rejected (never pay the burn
  address).
- Destination is `receiveAddress ?? walletAddress`; the fallback only fires when `receiveAddress`
  is null. A **non-null but non-EVM** `receiveAddress` (Citext is free-form) excludes the partner
  rather than falling back — we don't redirect funds to an address the partner didn't choose for
  USDC. The durable fix is validating `receiveAddress` at **write time** in the affiliate
  service (currently stored raw); the payout script stays defensive regardless.
- Partners failing validation are **excluded from the CSV** and recorded as
  warnings (with `excludedReason`) in the summary and JSON record. The run still
  exits 0.

## Outputs

Written to `payouts/` at repo root (add to `.gitignore` if not already ignored).

1. **`affiliate-payouts-<YYYY-MM>.csv`** — Safe CSV-airdrop format:
   ```
   token_type,token_address,receiver,amount,id
   erc20,0xaf88d065e77c8cC2239327C5EDb3A432268e5831,<recipient>,<usdcDecimal>,<index>
   ```
   - `token_address` = Arbitrum USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`.
   - `amount` = human-decimal USDC (≤6 dp).
   - `id` = sequential index starting at 0.
   - Only included (valid-address, `>0`) partners appear, sorted by
     `feesEarnedUsd` descending.

2. **`affiliate-payouts-<YYYY-MM>.json`** — full run record:
   ```jsonc
   {
     "window": { "start": "...Z", "end": "...Z", "label": "2026-06" },
     "generatedAt": "...Z",
     "token": { "chain": "arbitrum", "address": "0xaf88...5831", "symbol": "USDC" },
     "totals": {
       "partnersPaid": 0,
       "totalUsdc": "0.000000",
       "paidSwaps": 0,
       "skippedSwaps": 0,
       "anomalousSwaps": 0,
       "unverifiedSwaps": 0,
       "noAffiliateFeeSwaps": 0,
       "partnerBpsUnsetSwaps": 0,
       "noVerifiedFeeSwaps": 0
     },
     "partners": [
       {
         "partnerCode": "...",
         "receiveAddress": "0x...",
         "swapCount": 0,
         "volumeUsd": "0.00",
         "feesEarnedUsd": "0.000000",
         "usdcAmount": "0",
         "included": true,
         "excludedReason": null
       }
     ],
     "warnings": [
       { "type": "fee-anomaly", "partnerCode": "...", "swapId": "...", "reason": "on-chain fee ... deviates ...% from bps-implied ..." },
       { "type": "address", "partnerCode": "...", "swapId": null, "reason": "invalid (non-EVM) payout address: ..." },
       { "type": "unverified", "partnerCode": "...", "swapId": "...", "reason": "affiliate verification pending — not paid, inspect before final payout" },
       { "type": "partner-bps-unset", "partnerCode": "...", "swapId": "...", "reason": "partnerBps is 0 (verifiedBps ...) — no partner share configured, excluded" },
       { "type": "no-verified-fee", "partnerCode": "...", "swapId": "...", "reason": "no verified on-chain fee — not paid (bps-implied fee is never a payout basis)" }
     ]
   }
   ```
   This is the seam the future settlement-tracking feature builds on.

3. **Console summary** — window, total USDC, partner count, top partners by
   earnings, skipped-swap count, and any warnings.

## Module structure

Split into a pure, dependency-light lib (jest-testable) and a thin IO entry, because the
swap-service fee math transitively imports ESM-only packages (`@shapeshiftoss/chain-adapters`
→ `p-queue`) that jest won't transform. The lib never imports the app graph; the entry injects
the real fee functions.

- **`scripts/affiliate-payouts-lib.ts`** — pure (only `bignumber.js` + `viem`):
  - `resolveWindow(start?, end?, now?)` — UTC previous-month default + ISO override, end-exclusive.
  - `aggregateByPartner(rows, deps, tolerance?)` — partitions + accrues (BigNumber); `deps` injects
    `{ toSwap, calculateFeeForSwap, getPartnerFeeRate }` so it's testable without the app graph.
    Returns `{ partners, skippedSwaps, anomalies, unverified, noAffiliateFee, partnerBpsUnset, noVerifiedFee }`.
  - `canonicalPartnerCode(code)` — lower-case, matching the citext columns; used for all keying.
  - `checkFeeAnomaly(row, fee, tolerance)` — the deviation guard; returns a `FeeAnomaly` or null.
  - `formatUsdc(usd)` — floor to 6 dp via BigNumber (accepts `BigNumber.Value`), strip trailing zeros.
  - `normalizeRecipient(addr)` — viem `isAddress` / `getAddress` checksum; null if invalid or zero.
  - `toCsv(rows)`, `buildPayouts(...)`, `buildRecord({ ... })`.
- **`scripts/affiliate-payouts.ts`** — entry: `PrismaClient`, the real `toSwap` /
  `calculateFeeForSwap` / `getPartnerFeeRate` from `apps/swap-service/src/swaps/utils`, plus
  `printSummary` / `writeArtifacts` / `generate` / `main`; `prisma.$disconnect()` in `finally`.
  Run via `ts-node --transpile-only` (Node 22 `require(esm)` handles the ESM deps at runtime).
- **App change:** `calculateFeeForSwap` (in `swaps/utils.ts`) extended to also return
  `actualFeeUsd` and `impliedFeeUsd` (additive, backward-compatible) so the guard can compare them.

## Testing

- Unit-test the lib helpers (no DB, jest via `scripts/jest.config.ts`, `*.test.ts`):
  `resolveWindow` (default UTC month + override + exclusivity + arg validation),
  `aggregateByPartner` (rate capping, skipped unpriceable swaps, multi-swap accrual,
  anomaly exclusion, partial-partner payout), `checkFeeAnomaly` (within/over tolerance,
  no-actual, missing-implied), `formatUsdc` (6-dp floor), `toCsv` (header + indices),
  `normalizeRecipient` (valid/invalid/checksum), `buildPayouts` (address exclusion + sort).
  `aggregateByPartner` / `checkFeeAnomaly` use stub fee deps to stay off the app graph.
- Test command: `yarn affiliate-payouts:test`.
- Integration: verified end-to-end against a live DB snapshot for 2026-06 — the guard
  excluded the Maya/`ssmaya` corrupt-fee swaps (total $29,265 → $0.05).

## Out of scope (next conversation)

Settlement tracking — idempotency, double-pay protection, marking a window as
paid, recording the executed Safe tx. The JSON run record is the foundation; the
actual tracking design comes after this script lands.

## Open implementation notes

- Confirm `viem` availability in the workspace for checksum validation; fall back
  to regex if absent.
- Importing app fee math into a root `scripts/` file couples the script to
  `apps/swap-service` internals. Accepted tradeoff for a single source of truth;
  revisit only if the script needs to run without the app present.
