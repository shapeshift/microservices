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
| Eligible swaps | `status='SUCCESS' AND isAffiliateVerified=true`, **all origins** (web + api). Matches the affiliate `/stats` endpoint partners already see. |
| Minimum payout | **No minimum** — any partner with `feesEarnedUsd > 0` and a valid address gets a row. |
| Invalid/non-EVM recipient | **Exclude from CSV + warn** (listed in summary and JSON). Run still succeeds. |
| Location / invocation | `scripts/affiliate-payouts.ts`, wired as `yarn affiliate-payouts`. |
| USD → USDC | Treated **1:1**, valued at swap time and summed over the window. |

## Invocation

```bash
yarn affiliate-payouts generate [startDate] [endDate]
```

- **No args** → previous calendar month in **UTC**. Run on 2026-07-01 → covers
  `2026-06-01T00:00:00Z` (inclusive) to `2026-07-01T00:00:00Z` (**exclusive**).
- Optional ISO date args override the window. End is always treated as
  **exclusive** (`gte: start, lt: end`) to avoid boundary double-counting.

## Computation

1. **Query once:**
   ```ts
   prisma.swap.findMany({
     where: {
       partnerCode: { not: null },
       status: 'SUCCESS',
       isAffiliateVerified: true,
       createdAt: { gte: start, lt: end },
     },
   })
   ```
2. **Group by `partnerCode`.** For each swap, run
   `calculateFeeForSwap(toSwap(swap))`. If it returns `null` (missing/unpriceable
   verification details), skip the swap and increment a `skippedSwaps` counter.
   Otherwise:
   ```ts
   const rate = getPartnerFeeRate(fee.verifiedBps, swap.partnerBps)
   partner.feesEarnedUsd += fee.feeUsd * rate
   partner.volumeUsd     += fee.volumeUsd
   partner.swapCount     += 1
   ```
   Reusing the app functions keeps payout numbers identical to the affiliate
   `/stats` dashboard (single source of truth).
3. **Resolve addresses:** for each `partnerCode`, look up the `Affiliate` and take
   `receiveAddress ?? walletAddress`.
4. **Convert to USDC:** USD amount is treated 1:1 with USDC. Floor each partner
   total to **6 dp** (USDC precision) so we never overpay. Use `BigNumber` for the
   formatting (avoid float drift).

## Address validation

- A recipient is valid if it is a well-formed EVM address. Prefer `viem`'s
  `isAddress` / `getAddress` (checksum) if present in the workspace; otherwise a
  `^0x[0-9a-fA-F]{40}$` regex fallback.
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
       "eligibleSwaps": 0,
       "skippedSwaps": 0
     },
     "partners": [
       {
         "partnerCode": "...",
         "receiveAddress": "0x...",
         "swapCount": 0,
         "volumeUsd": "0.00",
         "feesEarnedUsd": "0.000000",
         "included": true,
         "excludedReason": null
       }
     ],
     "warnings": [ { "partnerCode": "...", "reason": "invalid receive address: ..." } ]
   }
   ```
   This is the seam the future settlement-tracking feature builds on.

3. **Console summary** — window, total USDC, partner count, top partners by
   earnings, skipped-swap count, and any warnings.

## Module structure

Single-file script is acceptable (mirrors `referral-rewards.ts`), but factor pure
helpers so they are independently testable:

- `resolveWindow(args): { start, end, label }` — UTC previous-month default + ISO override, end-exclusive.
- `aggregateByPartner(swaps): Map<partnerCode, PartnerAccrual>` — pure; uses `calculateFeeForSwap` / `getPartnerFeeRate`.
- `toCsv(rows): string` — pure; Safe format.
- `formatUsdc(usd): string` — floor to 6 dp via BigNumber.
- `isValidRecipient(addr): boolean` / `normalizeRecipient(addr): string`.
- `main()` — wires Prisma query → aggregate → resolve addresses → validate → write artifacts → print summary; `prisma.$disconnect()` in `finally`.

## Testing

- Unit-test the pure helpers (no DB): `resolveWindow` (default UTC month +
  explicit override + exclusivity), `aggregateByPartner` (rate capping, skipped
  unpriceable swaps, multi-swap accrual), `formatUsdc` (6-dp floor, no float
  drift), `toCsv` (header + row shape + indices), address validation
  (valid/invalid/checksum).
- Test file: `scripts/affiliate-payouts.test.ts` (`*.test.ts` convention).

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
