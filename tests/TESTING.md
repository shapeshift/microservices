# Comprehensive Swapper Testing Guide

This guide covers how to run the full swapper test suite that validates all 18 swappers' `checkTradeStatus` implementations, affiliate fee verification, and the polling lifecycle.

## Prerequisites

### Services Running

All 3 backend NestJS services must be running:

```bash
# From shapeshift-backend root
yarn start:dev
```

| Service               | Port | Database                             |
| --------------------- | ---- | ------------------------------------ |
| swap-service          | 3001 | `swap_service` (PostgreSQL)          |
| user-service          | 3002 | `user_service` (PostgreSQL)          |
| notifications-service | 3003 | `notifications_service` (PostgreSQL) |

PostgreSQL must be running on `localhost:5432` (Docker).

### Health Check

```bash
curl http://localhost:3001/swaps/pending
# Should return a JSON array (empty or with existing pending swaps)
```

## Running the Test Script

```bash
cd /Users/0xm4king/Projects/shapeshift-backend
node tests/test-all-swappers.mjs
```

The script runs 4 phases:

1. **Cleanup** — Marks old `test-*` swaps as FAILED via `DELETE /swaps/test-cleanup` to clear the polling queue
2. **Create** — POSTs fake pending swaps to `POST /swaps` for each swapper
3. **Poll** — Polls ALL swaps in parallel for up to 2 minutes total
4. **Report** — Prints pass/fail summary with affiliate verification status

### Expected Runtime

~2-3 minutes total. Most swaps resolve in the first 3 poll cycles (18 seconds). The remaining time is spent waiting for expected-PENDING swaps to time out.

### Expected Output

```
✓ SUCCESS:            14 (4 affiliate verified)
✗ FAILED:             0
◌ STUCK (expected):   3
⚠ STUCK (unexpected): 0
⊘ SKIPPED:            0
✗ CREATE FAILED:      0
TOTAL:                17/18
```

The 18th swapper is `Test` (internal, not tested).

## What the Test Validates

For each swapper, the test verifies:

1. **Swap creation** — `POST /swaps` accepts the payload without error
2. **Status polling** — The 5-second cron job picks up the swap and calls `checkTradeStatus`
3. **Status resolution** — The swap transitions from `PENDING` to `SUCCESS` (or `FAILED`)
4. **Affiliate verification** — `isAffiliateVerified` is set and `affiliateVerificationDetails` is populated
5. **Affiliate bps** — For metadata-based verifiers, `affiliateBps` matches the input (60)

## Swapper Coverage Matrix

### Resolves to SUCCESS (14 swappers)

| Swapper         | Status Check Method                         | Test Tx Type            | Affiliate Verified           | Notes                                                  |
| --------------- | ------------------------------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------ |
| THORChain       | Midgard API (`/thorchain/tx/{hash}`)        | Real BTC swap tx        | No (not a real affiliate tx) | Uses `VITE_THORCHAIN_NODE_URL`                         |
| MAYAChain       | Midgard API (`/mayachain/tx/{hash}`)        | Real ZEC swap tx        | No                           | Uses `VITE_MAYACHAIN_NODE_URL`                         |
| CowSwap         | CoW Protocol API (`/v1/trades?orderUid=`)   | Real orderUid           | No                           | `sellTxHash` IS the orderUid                           |
| 0x (Zrx)        | `checkEvmSwapStatus` (unchained)            | Any confirmed ETH tx    | No                           | Simple on-chain confirmation                           |
| Portals         | `checkEvmSwapStatus` (unchained)            | Any confirmed ETH tx    | No                           | Simple on-chain confirmation                           |
| Bebop           | `checkEvmSwapStatus` (unchained)            | Any confirmed ETH tx    | No                           | Simple on-chain confirmation                           |
| Jupiter         | `checkSolanaSwapStatus` (unchained)         | Successful Solana tx    | Yes (bps=60)                 | MUST be a successful tx (no `transactionError`)        |
| AVNU            | `checkStarknetSwapStatus` (Starknet RPC)    | Real Starknet tx        | Yes (bps=60)                 | Uses `VITE_STARKNET_NODE_URL`                          |
| Sun.io          | `checkTronSwapStatus` (Tron RPC)            | Real Tron tx            | Yes (bps=60)                 | Uses `VITE_TRON_NODE_URL`                              |
| Cetus           | `checkSuiSwapStatus` (Sui RPC)              | Confirmed Sui tx digest | Yes (bps=60)                 | Requires `receiveAddress` on swap                      |
| Relay           | Relay API (`/intents/status/v2?requestId=`) | Real Relay requestId    | No (bps=85 from Relay)       | Requires `metadata.relayTransactionMetadata.relayId`   |
| Arbitrum Bridge | `checkEvmSwapStatus` (unchained)            | Confirmed Arbitrum tx   | No                           | L2→L1 withdraw path returns SUCCESS on tx confirmation |
| ButterSwap      | `checkEvmSwapStatus` (unchained)            | Any confirmed ETH tx    | No                           | Same-chain EVM path, no bridge indexer needed          |
| NEAR Intents    | 1Click API (`/v0/status?depositAddress=`)   | Real completed deposit  | No (bps=25 from real tx)     | Requires `metadata.nearIntentsSpecific.depositAddress` |

### Expected to Stay PENDING (3 swappers)

| Swapper   | Reason                                                                           | How to Fix                                              |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| STON.fi   | TON chain adapter `parseTx()` needs sender address; falls back when no `quoteId` | Provide real `quoteId` from STON.fi/Omniston SDK        |
| Across    | Across deposit status API won't recognize a random ETH tx as a valid deposit     | Use a real Across bridge deposit tx hash                |
| Chainflip | Broker API returns 404 for unknown swapId; the API key is broker-specific        | Use a real swap ID created through this specific broker |

### Not Tested

| Swapper | Reason                                        |
| ------- | --------------------------------------------- |
| Test    | Internal test swapper, no real implementation |

## Affiliate Verification Behavior

There are two types of affiliate verification:

### On-chain Verification (THORChain, MAYAChain, CowSwap, 0x, Portals, Bebop, Relay, Arbitrum Bridge, ButterSwap)

These check the actual transaction on-chain or via protocol APIs for affiliate fee data. Test txs are NOT real ShapeShift affiliate swaps, so they correctly report `hasAffiliate=false`. This is **expected behavior** — the verification logic works, it just doesn't find affiliate data in random txs.

### Metadata-based Verification (Jupiter, AVNU, Sun.io, Cetus, STON.fi)

These check the swap's `affiliateBps` from the enriched metadata passed during verification. Since we set `affiliateBps=60` in the test payload, these correctly report `hasAffiliate=true, affiliateBps=60`.

### API-based Verification (NEAR Intents, Relay)

These read affiliate data from the external API response. The real NEAR Intents deposit shows `bps=25` (the actual appFee from that transaction). Relay shows `bps=85` from the Relay API.

## Updating Test Data

### When Tx Hashes Expire or Stop Working

Some tx hashes may stop working over time (pruned from RPC nodes, API changes). To update:

1. **EVM txs (0x, Portals, Bebop, ButterSwap, Arbitrum Bridge)**: Any confirmed mainnet tx works:

   ```bash
   # Ethereum
   curl -s 'https://api.ethereum.shapeshift.com/api/v1/tx/0x<ANY_ETH_TX_HASH>'
   # Arbitrum
   curl -s 'https://api.arbitrum.shapeshift.com/api/v1/tx/0x<ANY_ARB_TX_HASH>'
   # Should return JSON with "status": 1
   ```

2. **Solana tx (Jupiter)**: Must be a SUCCESSFUL tx (no `transactionError`):

   ```bash
   # Find a recent successful Jupiter tx
   curl -s -X POST "https://api.solana.shapeshift.com/api/v1/jsonrpc" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",{"limit":30}]}'
   # Pick one where "err": null

   # Verify it's successful
   curl -s "https://api.solana.shapeshift.com/api/v1/tx/<SIGNATURE>"
   # Should have "transactionError": null
   ```

3. **Starknet tx (AVNU)**: Any confirmed Starknet tx:

   ```bash
   curl -s -X POST "https://rpc.starknet.lava.build" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt","params":["0x<TX_HASH>"]}'
   # Should show execution_status: "SUCCEEDED"
   ```

4. **Tron tx (Sun.io)**: Any confirmed Tron tx:

   ```bash
   curl -s "https://api.trongrid.io/walletsolidity/gettransactioninfobyid" \
     -X POST -H "Content-Type: application/json" \
     -d '{"value":"<TX_HASH>"}'
   # Should return receipt with result: "SUCCESS"
   ```

5. **Sui tx digest (Cetus)**: Any confirmed Sui tx:

   ```bash
   curl -s -X POST https://fullnode.mainnet.sui.io:443 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"sui_getCheckpoint","params":["latest"]}'
   # Get a tx digest from the transactions array
   ```

6. **THORChain tx**: Must be a real THORChain swap visible on Midgard:

   ```bash
   curl -s "https://thornode.ninerealms.com/thorchain/tx/<TX_HASH>"
   # Should return observed_tx with swap data
   ```

7. **MAYAChain tx**: Same as THORChain but on MAYAChain Midgard:

   ```bash
   curl -s "https://mayanode.mayachain.info/mayachain/tx/<TX_HASH>"
   ```

8. **CowSwap orderUid**: Get from CoW Protocol API:

   ```bash
   curl -s "https://api.cow.fi/mainnet/api/v1/orders/<ORDER_UID>"
   # Should return order with status: "fulfilled"
   ```

9. **Relay requestId**: Get from Relay API:

   ```bash
   curl -s "https://api.relay.link/intents/status/v2?requestId=<REQUEST_ID>"
   # Should return status data
   ```

10. **NEAR Intents depositAddress**: Get from 1Click API (completed swaps):
    ```bash
    # Browse https://explorer.near-intents.org for recent completed transactions
    # Copy the deposit address from a completed swap
    # Verify:
    curl -s "https://1click.chaindefuser.com/v0/status?depositAddress=<DEPOSIT_ADDRESS>"
    # Should return { "status": "SUCCESS", ... }
    ```

## Environment Variables That Affect Tests

These `.env` values in the backend root must point to working endpoints:

```env
# Critical for THORChain/MAYAChain (daemon URLs that resolve)
VITE_THORCHAIN_NODE_URL="https://thornode.ninerealms.com"
VITE_MAYACHAIN_NODE_URL="https://mayanode.mayachain.info"

# Critical for EVM swappers
VITE_UNCHAINED_ETHEREUM_HTTP_URL="https://api.ethereum.shapeshift.com"

# Critical for Solana/Jupiter
VITE_UNCHAINED_SOLANA_HTTP_URL="https://api.solana.shapeshift.com"

# Critical for AVNU/Starknet
VITE_STARKNET_NODE_URL="https://rpc.starknet.lava.build"

# Critical for Sun.io/Tron
VITE_TRON_NODE_URL="https://api.trongrid.io"

# Critical for Cetus/Sui
VITE_SUI_NODE_URL="https://fullnode.mainnet.sui.io"

# Critical for STON.fi/TON
VITE_TON_NODE_URL="https://toncenter.com/api/v2/jsonRPC"

# Critical for CowSwap
VITE_COWSWAP_BASE_URL="https://api.cow.fi"

# Critical for Relay
VITE_RELAY_API_URL="https://api.relay.link"

# Critical for Across
VITE_ACROSS_API_URL="https://app.across.to/api"

# Critical for Chainflip
VITE_CHAINFLIP_API_URL="https://chainflip-broker.io"
VITE_CHAINFLIP_API_KEY="09bc0796ff40435482c0a54fa6ae2784"

# Critical for NEAR Intents
VITE_NEAR_INTENTS_API_KEY="<JWT token>"
```

If any URL is dead (DNS failure, 5xx, etc.), the corresponding swapper will stay `PENDING` indefinitely.

## Swap Creation DTO Reference

Every test swap requires these fields:

```typescript
{
  swapId: string;              // Unique ID (test script generates: "test-{swapper}-{timestamp}")
  sellAsset: Asset;            // { chainId, assetId, symbol, precision, name }
  buyAsset: Asset;             // Same structure
  sellTxHash: string;          // REQUIRED for polling to pick up the swap
  sellAmountCryptoBaseUnit: string;
  expectedBuyAmountCryptoBaseUnit: string;
  sellAmountCryptoPrecision: string;
  expectedBuyAmountCryptoPrecision: string;
  source: string;              // "test-script"
  swapperName: string;         // Must match SwapperName enum display value
  sellAccountId: string;       // Gets hashed by hashAccountId()
  receiveAddress?: string;     // REQUIRED for Cetus, Solana — some swappers use it
  metadata?: Record<string, any>; // Relay needs relayTransactionMetadata here
  affiliateAddress?: string;   // Our affiliate address for verification
  affiliateBps?: string;       // "60" — the affiliate fee in basis points
  origin?: 'web' | 'api' | 'widget'; // Affects commission rate calculation
}
```

### SwapperName Values (exact strings)

```
THORChain, MAYAChain, CoW Swap, 0x, Portals, Chainflip,
Jupiter, Relay, ButterSwap, Bebop, NEAR Intents, Cetus,
Sun.io, AVNU, STON.fi, Across, Arbitrum Bridge, Test
```

### Metadata Requirements per Swapper

| Swapper      | Required Metadata                    | Example                                                  |
| ------------ | ------------------------------------ | -------------------------------------------------------- |
| Relay        | `relayTransactionMetadata.relayId`   | `{ relayTransactionMetadata: { relayId: "0xabc..." } }`  |
| Chainflip    | `chainflipSwapId` (integer)          | `{ chainflipSwapId: 12345 }`                             |
| NEAR Intents | `nearIntentsSpecific.depositAddress` | `{ nearIntentsSpecific: { depositAddress: "1Q7c..." } }` |
| All others   | None required                        | `{}`                                                     |

## Polling Behavior

- Polls every **5 seconds** via `@Cron(CronExpression.EVERY_5_SECONDS)`
- Only polls swaps with `status IN ('IDLE', 'PENDING')` AND `sellTxHash IS NOT NULL`
- No retry limits or age limits — polls indefinitely
- Affiliate verification runs on **every poll cycle**
- On error: returns `status: 'PENDING'` (doesn't fail the swap)

## Cleanup Endpoint

The test script uses `DELETE /swaps/test-cleanup` to mark old test swaps as FAILED before creating new ones. This prevents old swaps from clogging the polling queue.

```bash
# Manual cleanup
curl -X DELETE http://localhost:3001/swaps/test-cleanup
# Returns: { "cleaned": N }
```

## Troubleshooting

### Swap stays PENDING forever

1. Check `sellTxHash` is set (null = never polled)
2. Check backend logs: `tmux capture-pane -t backend -p -S -200 | grep "test-{swapper}"`
3. Check the env URL for that chain's RPC/API is resolving
4. Verify the tx hash is valid and confirmed on the respective chain

### Swap goes to FAILED

1. The on-chain tx actually failed (check `transactionError` field)
2. The chain adapter threw an unrecoverable error
3. The API returned a definitive "failed" status (e.g., CowSwap order cancelled)

### Affiliate shows NOT_VERIFIED for metadata-based swappers

Check that `affiliateBps` and `affiliateAddress` are set in the CreateSwapDto. The enriched metadata in `pollSwapStatus` reads these from the DB record:

```typescript
affiliateBps: swap.affiliateBps,
affiliateAddress: swap.affiliateAddress,
integratorFeeRecipient: swap.affiliateAddress,
sellAmountCryptoBaseUnit: swap.sellAmountCryptoBaseUnit,
```

### DNS errors (ENOTFOUND)

A daemon/node URL is dead. Update in `.env` and restart the backend:

```bash
# Check DNS resolution
curl -sv --max-time 5 "https://the-url.com" 2>&1 | head -5

# Find working alternatives for THORChain/MAYAChain:
# THORChain: https://thornode.ninerealms.com
# MAYAChain: https://mayanode.mayachain.info
```

### Old test swaps clogging polling queue

If old test swaps are slowing down polling (24+ pending swaps), cleanup before running:

```bash
curl -X DELETE http://localhost:3001/swaps/test-cleanup
```

## Architecture Reference

```
test-all-swappers.mjs
  |
  +-- DELETE /swaps/test-cleanup (mark old test-* swaps as FAILED)
  |
  +-- POST /swaps (swap-service:3001)
  |     |
  |     +-- swaps.controller.ts -> swaps.service.ts createSwap()
  |           |
  |           +-- Prisma insert into swap_service.swaps table
  |
  +-- [5s cron] swap-polling.service.ts pollPendingSwaps()
        |
        +-- swaps.service.ts pollSwapStatus(swapId)
              |
              +-- swappers[swapperName].checkTradeStatus({...})
              |     |
              |     +-- [per-swapper implementation in @shapeshiftoss/swapper]
              |
              +-- swapVerificationService.verifySwapAffiliate(...)
              |     |
              |     +-- [per-swapper verification in swap-verification.service.ts]
              |
              +-- Prisma update (status, affiliateVerification, buyTxHash)
```

## Key Files

| File                                                              | Purpose                               |
| ----------------------------------------------------------------- | ------------------------------------- |
| `tests/test-all-swappers.mjs`                                     | The test script                       |
| `apps/swap-service/src/swaps/swaps.service.ts`                    | Swap creation + pollSwapStatus        |
| `apps/swap-service/src/swaps/swaps.controller.ts`                 | REST endpoints including test-cleanup |
| `apps/swap-service/src/polling/swap-polling.service.ts`           | 5s cron loop                          |
| `apps/swap-service/src/verification/swap-verification.service.ts` | All 18 affiliate verifiers            |
| `apps/swap-service/prisma/schema.prisma`                          | Swap model (53 columns)               |
| `packages/shared-types/src/index.ts`                              | CreateSwapDto, UpdateSwapStatusDto    |
| `.env`                                                            | All RPC/API URLs                      |
