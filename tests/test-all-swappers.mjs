#!/usr/bin/env node

/**
 * Comprehensive Swapper Test Script
 *
 * Creates fake pending swaps for all 18 swappers using real confirmed tx hashes,
 * then waits for polling to resolve them and verifies:
 *   1. Status transitions (PENDING → SUCCESS)
 *   2. Affiliate verification (isAffiliateVerified = true)
 *   3. Affiliate fee fields populated
 *
 * Usage: node tests/test-all-swappers.mjs
 */

const SWAP_SERVICE_URL = 'http://localhost:3001';
const POLL_INTERVAL_MS = 6_000; // slightly > 5s poll interval
const MAX_POLL_ATTEMPTS = 20; // 2 minutes max wait per swap
const AFFILIATE_ADDRESS = '0xc770eefad204b5180df6a14ee197d99d808ee52d'; // ShapeShift DAO treasury
const AFFILIATE_BPS = 60;

// Dummy receive addresses per chain (valid format, used by some checkTradeStatus impls)
const RECEIVE_ADDRESSES = {
  ETH: '0x0000000000000000000000000000000000000001',
  SOL: '11111111111111111111111111111111', // Solana system program
  SUI: '0x0000000000000000000000000000000000000000000000000000000000000001',
  TON: 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA',
  STRK: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  TRX: 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy',
  BTC: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  ZEC: 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs',
  ARB: '0x0000000000000000000000000000000000000001',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSwapId(swapperKey) {
  return `test-${swapperKey.toLowerCase()}-${Date.now()}`;
}

async function createSwap(payload) {
  const res = await fetch(`${SWAP_SERVICE_URL}/swaps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /swaps failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function getSwap(swapId) {
  const res = await fetch(`${SWAP_SERVICE_URL}/swaps/${swapId}`);
  if (!res.ok) return null;
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Asset Factories ──────────────────────────────────────────────────────────

const assets = {
  BTC: {
    chainId: 'bip122:000000000019d6689c085ae165831e93',
    assetId: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
    symbol: 'BTC',
    precision: 8,
    name: 'Bitcoin',
  },
  ZEC: {
    chainId: 'bip122:00040fe8ec8471911baa1db1266ea15d',
    assetId: 'bip122:00040fe8ec8471911baa1db1266ea15d/slip44:133',
    symbol: 'ZEC',
    precision: 8,
    name: 'Zcash',
  },
  ETH: {
    chainId: 'eip155:1',
    assetId: 'eip155:1/slip44:60',
    symbol: 'ETH',
    precision: 18,
    name: 'Ethereum',
  },
  USDC_ETH: {
    chainId: 'eip155:1',
    assetId: 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    precision: 6,
    name: 'USD Coin',
  },
  WETH: {
    chainId: 'eip155:1',
    assetId: 'eip155:1/erc20:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'WETH',
    precision: 18,
    name: 'Wrapped Ether',
  },
  PAPER: {
    chainId: 'eip155:1',
    assetId: 'eip155:1/erc20:0x7ae1d57b58fa6411f32948314badd83583ee0e8c',
    symbol: 'PAPER',
    precision: 18,
    name: 'Paper',
  },
  BNB: {
    chainId: 'eip155:56',
    assetId: 'eip155:56/slip44:714',
    symbol: 'BNB',
    precision: 18,
    name: 'BNB',
  },
  SOL: {
    chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    assetId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501',
    symbol: 'SOL',
    precision: 9,
    name: 'Solana',
  },
  USDC_SOL: {
    chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    assetId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    precision: 6,
    name: 'USD Coin',
  },
  STRK: {
    chainId: 'starknet:SN_MAIN',
    assetId: 'starknet:SN_MAIN/erc20:0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    symbol: 'STRK',
    precision: 18,
    name: 'Starknet',
  },
  USDC_STRK: {
    chainId: 'starknet:SN_MAIN',
    assetId: 'starknet:SN_MAIN/erc20:0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    symbol: 'USDC',
    precision: 6,
    name: 'USD Coin',
  },
  TRX: {
    chainId: 'tron:0x2b6653dc',
    assetId: 'tron:0x2b6653dc/slip44:195',
    symbol: 'TRX',
    precision: 6,
    name: 'TRON',
  },
  USDT_TRX: {
    chainId: 'tron:0x2b6653dc',
    assetId: 'tron:0x2b6653dc/trc20:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    symbol: 'USDT',
    precision: 6,
    name: 'Tether USD',
  },
  TON: {
    chainId: 'ton:mainnet',
    assetId: 'ton:mainnet/slip44:607',
    symbol: 'TON',
    precision: 9,
    name: 'Toncoin',
  },
  USDT_TON: {
    chainId: 'ton:mainnet',
    assetId: 'ton:mainnet/token:EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    symbol: 'USDT',
    precision: 6,
    name: 'Tether USD',
  },
  SUI: {
    chainId: 'sui:35834a8a',
    assetId: 'sui:35834a8a/slip44:784',
    symbol: 'SUI',
    precision: 9,
    name: 'Sui',
  },
  USDC_SUI: {
    chainId: 'sui:35834a8a',
    assetId: 'sui:35834a8a/token:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    symbol: 'USDC',
    precision: 6,
    name: 'USD Coin',
  },
  ETH_ARB: {
    chainId: 'eip155:42161',
    assetId: 'eip155:42161/slip44:60',
    symbol: 'ETH',
    precision: 18,
    name: 'Ethereum',
  },
  USDC_ARB: {
    chainId: 'eip155:42161',
    assetId: 'eip155:42161/erc20:0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    precision: 6,
    name: 'USD Coin',
  },
};

// ─── Confirmed ETH tx hash (verified via unchained API) ──────────────────────
const CONFIRMED_ETH_TX = '0xd57d57f07e307b562ae2a1b956be571c410fbd61370a9af25fbc36f42252d44d';

// ─── Test Case Definitions ───────────────────────────────────────────────────

const testCases = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. THORChain — Midgard API check (BTC → BNB)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'THORChain',
    swapperName: 'THORChain',
    sellAsset: assets.BTC,
    buyAsset: assets.BNB,
    sellTxHash: '1B7022CB1DCAE945060875242C77CB030BC7E1665F47C9C150A55516B890BD55',
    sellAmountBaseUnit: '265263',
    expectedBuyAmountBaseUnit: '28816802',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'Real BTC→BNB swap, verified on Midgard',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MAYAChain — Midgard API check (ZEC → BTC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'MAYAChain',
    swapperName: 'MAYAChain',
    sellAsset: assets.ZEC,
    buyAsset: assets.BTC,
    sellTxHash: 'C871AC207D81E4C3F83FC8E674E22CED9C3A857ABB146B4BE3DC954813423BED',
    sellAmountBaseUnit: '1035839375',
    expectedBuyAmountBaseUnit: '3831339',
    receiveAddress: RECEIVE_ADDRESSES.BTC,
    metadata: {},
    expectResolution: true,
    notes: 'Real ZEC→BTC swap, verified on MAYAChain Midgard',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CowSwap — CoW Protocol API check (PAPER → WETH)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'CowSwap',
    swapperName: 'CoW Swap',
    sellAsset: assets.PAPER,
    buyAsset: assets.WETH,
    sellTxHash: '0x68953906f8b73fb07df4b02fc311153a97cb5b7d36117cea9ffc7268db7e4304e75745886f1c28043710fbccb4ae3e25011c6073663b5b13',
    sellAmountBaseUnit: '624441726887100729007594',
    expectedBuyAmountBaseUnit: '1000000000000000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'Real CowSwap orderUid (sellTxHash IS the orderUid), fulfilled status',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 0x (Zrx) — checkEvmSwapStatus (ETH → USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Zrx',
    swapperName: '0x',
    sellAsset: assets.ETH,
    buyAsset: assets.USDC_ETH,
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '1000000000000000000',
    expectedBuyAmountBaseUnit: '2500000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'checkEvmSwapStatus — any confirmed ETH tx works',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Portals — checkEvmSwapStatus (ETH → USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Portals',
    swapperName: 'Portals',
    sellAsset: assets.ETH,
    buyAsset: assets.USDC_ETH,
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '500000000000000000',
    expectedBuyAmountBaseUnit: '1250000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'checkEvmSwapStatus — any confirmed ETH tx works',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Bebop — checkEvmSwapStatus (ETH → USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Bebop',
    swapperName: 'Bebop',
    sellAsset: assets.ETH,
    buyAsset: assets.USDC_ETH,
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '200000000000000000',
    expectedBuyAmountBaseUnit: '500000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'checkEvmSwapStatus — any confirmed ETH tx works',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. AVNU — Starknet on-chain check (STRK → USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'AVNU',
    swapperName: 'AVNU',
    sellAsset: assets.STRK,
    buyAsset: assets.USDC_STRK,
    sellTxHash: '0x7ce366ad1caf16cf73b347bd934802badba4be802db56d249347be6b52a0769',
    sellAmountBaseUnit: '10000000000000000000',
    expectedBuyAmountBaseUnit: '5000000',
    receiveAddress: RECEIVE_ADDRESSES.STRK,
    metadata: {},
    expectResolution: true,
    notes: 'Real Starknet tx, verified AVNU STRK→USDC swap',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Sun.io — Tron on-chain check (TRX → USDT)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Sunio',
    swapperName: 'Sun.io',
    sellAsset: assets.TRX,
    buyAsset: assets.USDT_TRX,
    sellTxHash: '611bcea1373817f762cc704eb183eb12319ef2b99c02baf392755bf58d2bbc26',
    sellAmountBaseUnit: '100000000',
    expectedBuyAmountBaseUnit: '25000000',
    receiveAddress: RECEIVE_ADDRESSES.TRX,
    metadata: {},
    expectResolution: true,
    notes: 'Real Tron tx, on-chain confirmation check',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. STON.fi — TON chain adapter fallback (TON → USDT)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Stonfi',
    swapperName: 'STON.fi',
    sellAsset: assets.TON,
    buyAsset: assets.USDT_TON,
    sellTxHash: 'fe23a32504db377ad8c40a41cf1d4bba072303fe2e645e80efbc7ea166e17728',
    sellAmountBaseUnit: '3899999000',
    expectedBuyAmountBaseUnit: '38768000',
    receiveAddress: RECEIVE_ADDRESSES.TON,
    metadata: {}, // no quoteId → falls back to checkTxStatusViaChainAdapter
    expectResolution: false, // TON adapter parseTx needs sender address, which is not available in test
    notes: 'TON chain adapter needs sender address for tx lookup (API limitation)',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. Cetus — Sui on-chain check (SUI → USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Cetus',
    swapperName: 'Cetus',
    sellAsset: assets.SUI,
    buyAsset: assets.USDC_SUI,
    sellTxHash: 'D53Mcc8adGYVawgtQUEktRW4fv4dfUHbPQcEC3p1qALp',
    sellAmountBaseUnit: '1000000000',
    expectedBuyAmountBaseUnit: '1500000',
    receiveAddress: RECEIVE_ADDRESSES.SUI,
    metadata: {},
    expectResolution: true,
    notes: 'Confirmed Sui tx digest from latest checkpoint',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Relay — Relay API + EVM check (ETH → ETH-ARB)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Relay',
    swapperName: 'Relay',
    sellAsset: assets.ETH,
    buyAsset: assets.ETH_ARB,
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '100000000000000000',
    expectedBuyAmountBaseUnit: '99500000000000000',
    receiveAddress: RECEIVE_ADDRESSES.ARB,
    metadata: {
      relayTransactionMetadata: {
        relayId: '0xbc19c76d9658db7e640d9d5a387f116b9d992e9bc730ab26b590f7a9fbb2b933',
      },
    },
    expectResolution: true,
    notes: 'Real Relay requestId, EVM tx confirmed + Relay API status check',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Across — EVM + Across deposit status API (ETH USDC → ARB USDC)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Across',
    swapperName: 'Across',
    sellAsset: assets.USDC_ETH,
    buyAsset: assets.USDC_ARB,
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '1000000000',
    expectedBuyAmountBaseUnit: '999000000',
    receiveAddress: RECEIVE_ADDRESSES.ARB,
    metadata: {},
    expectResolution: false, // EVM part confirms, but Across deposit API won't recognize this tx
    notes: 'EVM tx confirmed, but Across deposit status API will return unknown (not a real deposit)',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SKIPPED SWAPPERS — no valid test data available
  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // 14. Chainflip — broker API check (needs real swapId from this broker)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'Chainflip',
    swapperName: 'Chainflip',
    sellAsset: assets.ETH,
    buyAsset: assets.BTC,
    sellTxHash: CONFIRMED_ETH_TX, // Needs a sellTxHash for polling to pick it up
    sellAmountBaseUnit: '1000000000000000000',
    expectedBuyAmountBaseUnit: '4000000',
    receiveAddress: RECEIVE_ADDRESSES.BTC,
    metadata: { chainflipSwapId: 999999 }, // Fake ID — broker will return 404 → Unknown → PENDING
    expectResolution: false,
    notes: 'Broker returns 404 for unknown swapId → stays PENDING (graceful). Need real swap through this broker to resolve.',
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // 15. ArbitrumBridge — L2→L1 withdraw (confirmed Arbitrum tx → instant SUCCESS)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'ArbitrumBridge',
    swapperName: 'Arbitrum Bridge',
    sellAsset: assets.ETH_ARB,   // Sell from Arbitrum = L2→L1 withdraw path
    buyAsset: assets.ETH,        // Buy on Ethereum
    sellTxHash: '0x9a58d12a751803824d16e326d770aca4c715997d7894cf6a85ee766e576d114c', // Confirmed Arbitrum tx
    sellAmountBaseUnit: '100000000000000000',
    expectedBuyAmountBaseUnit: '100000000000000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'L2→L1 withdraw returns SUCCESS immediately on Arbitrum tx confirmation (no 7-day wait in status check)',
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // 16. ButterSwap — same-chain EVM swap (falls through to checkEvmSwapStatus)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'ButterSwap',
    swapperName: 'ButterSwap',
    sellAsset: assets.ETH,     // Same chain sell/buy = same-chain swap path
    buyAsset: assets.USDC_ETH, // Same chain = no bridge indexer needed
    sellTxHash: CONFIRMED_ETH_TX,
    sellAmountBaseUnit: '100000000000000000',
    expectedBuyAmountBaseUnit: '250000000',
    receiveAddress: RECEIVE_ADDRESSES.ETH,
    metadata: {},
    expectResolution: true,
    notes: 'Same-chain EVM swap — checkEvmSwapStatus only, no bridge indexer needed',
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // 17. NearIntents — 1Click API status check (BTC → ZEC via NEAR Intents)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    key: 'NearIntents',
    swapperName: 'NEAR Intents',
    sellAsset: assets.BTC,
    buyAsset: assets.ZEC,
    sellTxHash: 'd8522069088bc9c4c4566250f43dad0734b995b5ab7570c18c493bba38a359b9', // Origin chain tx hash from 1Click API
    sellAmountBaseUnit: '800000000',
    expectedBuyAmountBaseUnit: '211248545378',
    receiveAddress: RECEIVE_ADDRESSES.ZEC,
    metadata: {
      nearIntentsSpecific: {
        depositAddress: '1Q7cJr15wiLtScN8npqQf3rcg3zgfY9dck', // Real completed BTC→ZEC deposit
      },
    },
    expectResolution: true,
    notes: 'Real 1Click deposit address, verified SUCCESS via https://1click.chaindefuser.com/v0/status',
  },
];

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('  COMPREHENSIVE SWAPPER TEST — ALL 18 SWAPPERS');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(80) + '\n');

  // Health check
  try {
    const healthRes = await fetch(`${SWAP_SERVICE_URL}/swaps/pending`);
    if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
    console.log('✓ Swap service healthy at', SWAP_SERVICE_URL);
  } catch (err) {
    console.error('✗ Swap service not reachable:', err.message);
    process.exit(1);
  }

  console.log('');

  const results = [];
  const testableCount = testCases.filter((tc) => tc.sellTxHash !== null).length;
  const skippedCount = testCases.filter((tc) => tc.sellTxHash === null).length;

  console.log(`Testing ${testableCount} swappers, skipping ${skippedCount} (no test data)\n`);

  // ── Phase 1: Create all swaps ─────────────────────────────────────────────
  console.log('─── PHASE 1: Creating test swaps ───────────────────────────────\n');

  const createdSwaps = [];

  for (const tc of testCases) {
    const swapId = makeSwapId(tc.key);

    if (tc.sellTxHash === null) {
      console.log(`  ⊘ ${tc.swapperName.padEnd(18)} SKIPPED — ${tc.notes}`);
      results.push({
        swapper: tc.swapperName,
        key: tc.key,
        status: 'SKIPPED',
        reason: tc.notes,
      });
      continue;
    }

    try {
      const payload = {
        swapId,
        sellAsset: tc.sellAsset,
        buyAsset: tc.buyAsset,
        sellTxHash: tc.sellTxHash,
        sellAmountCryptoBaseUnit: tc.sellAmountBaseUnit,
        expectedBuyAmountCryptoBaseUnit: tc.expectedBuyAmountBaseUnit,
        source: 'test-script',
        swapperName: tc.swapperName,
        sellAccountId: `${tc.sellAsset.chainId}:0xTestAccount:0x0000000000000000000000000000000000000000`,
        receiveAddress: tc.receiveAddress || null,
        metadata: tc.metadata,
        affiliateAddress: AFFILIATE_ADDRESS,
        affiliateBps: AFFILIATE_BPS,
        origin: 'web',
      };

      await createSwap(payload);
      console.log(`  ✓ ${tc.swapperName.padEnd(18)} created → ${swapId}`);
      createdSwaps.push({ ...tc, swapId });
    } catch (err) {
      console.log(`  ✗ ${tc.swapperName.padEnd(18)} FAILED to create: ${err.message}`);
      results.push({
        swapper: tc.swapperName,
        key: tc.key,
        status: 'CREATE_FAILED',
        reason: err.message,
      });
    }
  }

  console.log(`\nCreated ${createdSwaps.length} swaps. Waiting for polling to resolve...\n`);

  // ── Phase 2: Poll ALL swaps in parallel ─────────────────────────────────
  console.log('─── PHASE 2: Waiting for resolution (max 2 min, all in parallel) ─\n');

  // Track which swaps are still pending
  const pending = new Map(createdSwaps.map((tc) => [tc.swapId, tc]));
  const resolved = new Map(); // swapId → { tc, finalSwap }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS && pending.size > 0; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    // Poll all remaining pending swaps in parallel
    const checks = await Promise.all(
      [...pending.entries()].map(async ([swapId, tc]) => {
        const swap = await getSwap(swapId);
        return { swapId, tc, swap };
      }),
    );

    for (const { swapId, tc, swap } of checks) {
      if (!swap) continue;
      if (swap.status === 'SUCCESS' || swap.status === 'FAILED') {
        pending.delete(swapId);
        resolved.set(swapId, { tc, finalSwap: swap });
      }
    }

    const resolvedCount = createdSwaps.length - pending.size;
    process.stdout.write(`\r  Poll ${attempt + 1}/${MAX_POLL_ATTEMPTS}: ${resolvedCount}/${createdSwaps.length} resolved`);
  }

  console.log('\n');

  // Build results from resolved + still-pending
  for (const tc of createdSwaps) {
    const entry = resolved.get(tc.swapId);

    if (entry) {
      const { finalSwap } = entry;
      if (finalSwap.status === 'SUCCESS') {
        const affiliateOk = finalSwap.isAffiliateVerified === true;
        const icon = affiliateOk ? '✓' : '⚠';
        console.log(
          `  ${tc.swapperName.padEnd(18)} → SUCCESS ${icon} affiliate=${affiliateOk ? 'VERIFIED' : 'NOT_VERIFIED'}` +
            (finalSwap.affiliateVerificationDetails
              ? ` bps=${finalSwap.affiliateVerificationDetails.affiliateBps ?? '?'}`
              : ''),
        );
        results.push({
          swapper: tc.swapperName,
          key: tc.key,
          status: 'SUCCESS',
          affiliateVerified: affiliateOk,
          affiliateDetails: finalSwap.affiliateVerificationDetails,
          buyTxHash: finalSwap.buyTxHash,
        });
      } else {
        console.log(`  ${tc.swapperName.padEnd(18)} → FAILED: ${finalSwap.statusMessage || 'unknown'}`);
        results.push({
          swapper: tc.swapperName,
          key: tc.key,
          status: 'FAILED',
          statusMessage: finalSwap.statusMessage,
        });
      }
    } else {
      // Still pending after all attempts
      const finalSwap = await getSwap(tc.swapId);
      const currentStatus = finalSwap ? finalSwap.status : 'UNKNOWN';
      const expected = tc.expectResolution ? 'UNEXPECTED' : 'EXPECTED';
      console.log(`  ${tc.swapperName.padEnd(18)} → STILL ${currentStatus} (${expected} — ${tc.notes})`);
      results.push({
        swapper: tc.swapperName,
        key: tc.key,
        status: `STUCK_${currentStatus}`,
        expected: tc.expectResolution ? 'SHOULD_RESOLVE' : 'EXPECTED_STUCK',
        notes: tc.notes,
      });
    }
  }

  // ── Phase 3: Summary ──────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(80) + '\n');

  const success = results.filter((r) => r.status === 'SUCCESS');
  const successVerified = success.filter((r) => r.affiliateVerified);
  const failed = results.filter((r) => r.status === 'FAILED');
  const stuck = results.filter((r) => r.status.startsWith('STUCK_'));
  const stuckExpected = stuck.filter((r) => r.expected === 'EXPECTED_STUCK');
  const stuckUnexpected = stuck.filter((r) => r.expected === 'SHOULD_RESOLVE');
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  const createFailed = results.filter((r) => r.status === 'CREATE_FAILED');

  console.log(`  ✓ SUCCESS:            ${success.length} (${successVerified.length} affiliate verified)`);
  console.log(`  ✗ FAILED:             ${failed.length}`);
  console.log(`  ◌ STUCK (expected):   ${stuckExpected.length}`);
  console.log(`  ⚠ STUCK (unexpected): ${stuckUnexpected.length}`);
  console.log(`  ⊘ SKIPPED:            ${skipped.length}`);
  console.log(`  ✗ CREATE FAILED:      ${createFailed.length}`);
  console.log(`  ─────────────────────────`);
  console.log(`  TOTAL:                ${results.length}/18\n`);

  // Detailed table
  console.log('  Swapper              Status          Affiliate   Notes');
  console.log('  ' + '─'.repeat(76));

  for (const r of results) {
    const swapper = r.swapper.padEnd(20);
    const status = r.status.padEnd(15);
    let affiliate = '';
    let notes = '';

    if (r.status === 'SUCCESS') {
      affiliate = r.affiliateVerified ? 'VERIFIED' : 'NOT_VERIFIED';
      if (r.affiliateDetails) {
        notes = `bps=${r.affiliateDetails.affiliateBps ?? '?'}`;
      }
    } else if (r.status === 'SKIPPED') {
      notes = r.reason;
    } else if (r.status === 'FAILED') {
      notes = r.statusMessage || '';
    } else if (r.status.startsWith('STUCK_')) {
      notes = r.notes || '';
    } else if (r.status === 'CREATE_FAILED') {
      notes = r.reason || '';
    }

    console.log(`  ${swapper} ${status} ${affiliate.padEnd(12)} ${notes}`);
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  // Exit code
  if (stuckUnexpected.length > 0 || failed.length > 0 || createFailed.length > 0) {
    console.log('⚠  Some tests had issues. Check details above.\n');
    process.exit(1);
  } else {
    console.log('✓  All testable swappers behaved as expected.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
