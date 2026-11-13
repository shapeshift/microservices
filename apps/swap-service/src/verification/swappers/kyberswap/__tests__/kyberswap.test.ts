import { viemClientByChainId } from '@shapeshiftoss/contracts'
import { getTreasuryAddressFromChainId } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { mockHttp } from '../../../test-helpers'
import { KYBER_ROUTER } from '../kyberswap'

import baseReceipt from './kyberswap.base.receipt.json'
import elysiumReceipt from './kyberswap.elysium.receipt.json'
import ethereumReceipt from './kyberswap.ethereum.receipt.json'
import robinhoodReceipt from './kyberswap.robinhood.receipt.json'
import robinhoodSwap from './kyberswap.robinhood.swap'

const TREASURY = '0xF5AA59151bE6515C4Ca68A0282CF68B3eA4846fC'
const ELYSIUM = 'eip155:99901'
const ELYSIUM_USDC = `${ELYSIUM}/erc20:0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65`
const ELYSIUM_NATIVE = `${ELYSIUM}/slip44:60`

// 0.06 USDC to native on Elysium, fee in the native buy asset
const elysiumSwap = {
  ...robinhoodSwap,
  sellAsset: { ...robinhoodSwap.sellAsset, assetId: ELYSIUM_USDC, chainId: ELYSIUM, precision: 6 },
  buyAsset: { ...robinhoodSwap.buyAsset, assetId: ELYSIUM_NATIVE, chainId: ELYSIUM },
  sellAmountCryptoBaseUnit: '60000',
  sellTxHash: elysiumReceipt.transactionHash,
}

// another integrator's 25 bps fee taken from the WETH input on Base
const BASE = 'eip155:8453'
const BASE_WETH = `${BASE}/erc20:0x4200000000000000000000000000000000000006`
const BASE_FEE_RECIPIENT = '0xcD6b980029E6E6e0733ac8eC3E02be9410D09799'
const baseSwap = {
  ...robinhoodSwap,
  sellAsset: { ...robinhoodSwap.sellAsset, assetId: BASE_WETH, chainId: BASE },
  buyAsset: {
    ...robinhoodSwap.buyAsset,
    assetId: `${BASE}/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`,
    chainId: BASE,
  },
  sellTxHash: baseReceipt.transactionHash,
  affiliateBps: 25,
  shapeshiftBps: 25,
}

// another integrator's USDC output fee split 66/10 bps between two recipients on Ethereum
const ETHEREUM = 'eip155:1'
const ETHEREUM_USDC = `${ETHEREUM}/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`
const SPLIT_FEE_RECIPIENT = '0x041cbBc7d068155E5083ee619e09B433027b3290'
const ethereumSwap = {
  ...robinhoodSwap,
  sellAsset: {
    ...robinhoodSwap.sellAsset,
    assetId: `${ETHEREUM}/erc20:0x24c2c6f74f7d34664d85b98bdde5b6048420476c`,
    chainId: ETHEREUM,
  },
  buyAsset: { ...robinhoodSwap.buyAsset, assetId: ETHEREUM_USDC, chainId: ETHEREUM },
  sellTxHash: ethereumReceipt.transactionHash,
  affiliateBps: 10,
  shapeshiftBps: 10,
}

const getTransactionReceipt = jest.fn()
Object.assign(viemClientByChainId, {
  [robinhoodSwap.sellAsset.chainId]: { getTransactionReceipt },
  [ELYSIUM]: { getTransactionReceipt },
  [BASE]: { getTransactionReceipt },
  [ETHEREUM]: { getTransactionReceipt },
})

type Receipt = typeof robinhoodReceipt

const verify = (swap: unknown) => new SwapVerificationService(mockHttp({}).http).verifySwap(swap as Swap)

// a copy of the Robinhood receipt with its router logs moved to another address
const withLogsFrom = (address: string): Receipt => ({
  ...robinhoodReceipt,
  logs: robinhoodReceipt.logs.map((log) => (log.address === KYBER_ROUTER.toLowerCase() ? { ...log, address } : log)),
})

const FEE_TOPIC = '0x4c39b7ce5f4f514f45cb6f82b171b8b0b7f2cbf488ad28e4eff451588e2f014b'
const SWAPPED_TOPIC = '0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8'

// a copy of the Robinhood receipt with the router log for this event appearing twice
const withDuplicated = (topic: string): Receipt => ({
  ...robinhoodReceipt,
  logs: robinhoodReceipt.logs.flatMap((log) => (log.topics[0] === topic ? [log, log] : [log])),
})

// a copy of the Robinhood receipt whose Fee event reports amounts instead of bps, i.e. its isBps word cleared
const withAbsoluteFee = (): Receipt => ({
  ...robinhoodReceipt,
  logs: robinhoodReceipt.logs.map((log) => {
    if (log.topics[0] !== FEE_TOPIC) return log
    const isBpsWord = 2 + 64 * 5
    return { ...log, data: `${log.data.slice(0, isBpsWord)}${'0'.repeat(64)}${log.data.slice(isBpsWord + 64)}` }
  }),
})

describe('verifyKyberSwap', () => {
  beforeEach(() => {
    getTransactionReceipt.mockReset().mockResolvedValue(robinhoodReceipt)
    jest.mocked(getTreasuryAddressFromChainId).mockReturnValue(TREASURY)
  })

  it('verifies a fee taken in an ERC20 buy asset from the router events', async () => {
    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: TREASURY,
      verifiedSellAmountCryptoBaseUnit: '515078935846919',
      actualBuyAmountCryptoBaseUnit: '996284704223460356',
      actualAffiliateFeeAmountCryptoBaseUnit: '6013790971167768',
      actualAffiliateFeeAssetId: robinhoodSwap.buyAsset.assetId,
    })
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: robinhoodSwap.sellTxHash })
  })

  it('maps a fee taken in the native token to the native side of the swap', async () => {
    getTransactionReceipt.mockResolvedValue(elysiumReceipt)

    const result = await verify(elysiumSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      verifiedSellAmountCryptoBaseUnit: '60000',
      actualBuyAmountCryptoBaseUnit: '797181003813722',
      actualAffiliateFeeAmountCryptoBaseUnit: '4811957769499',
      actualAffiliateFeeAssetId: ELYSIUM_NATIVE,
    })
  })

  it('reports the full sell amount when the fee is taken from the input', async () => {
    getTransactionReceipt.mockResolvedValue(baseReceipt)
    jest.mocked(getTreasuryAddressFromChainId).mockReturnValue(BASE_FEE_RECIPIENT)

    const result = await verify(baseSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 25,
      // Swapped.spentAmount of 3456698661483050 leaves out the fee
      verifiedSellAmountCryptoBaseUnit: '3465362066649674',
      actualBuyAmountCryptoBaseUnit: '6734564',
      actualAffiliateFeeAmountCryptoBaseUnit: '8663405166624',
      actualAffiliateFeeAssetId: BASE_WETH,
    })
  })

  it("takes only the treasury's share of a fee split between recipients", async () => {
    getTransactionReceipt.mockResolvedValue(ethereumReceipt)
    jest.mocked(getTreasuryAddressFromChainId).mockReturnValue(SPLIT_FEE_RECIPIENT)

    const result = await verify(ethereumSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 10,
      affiliateAddress: SPLIT_FEE_RECIPIENT,
      verifiedSellAmountCryptoBaseUnit: '2691459404027087285515944',
      // net of both shares
      actualBuyAmountCryptoBaseUnit: '113662046',
      // the 10 bps share, which is what the recipient received on chain
      actualAffiliateFeeAmountCryptoBaseUnit: '114532',
      actualAffiliateFeeAssetId: ETHEREUM_USDC,
    })
  })

  it('stays PENDING when the router swap does not match the swap assets', async () => {
    const result = await verify({
      ...robinhoodSwap,
      buyAsset: { ...robinhoodSwap.buyAsset, assetId: 'eip155:4663/erc20:0x0000000000000000000000000000000000000001' },
    })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: 'KyberSwap router swap does not match the swap assets',
    })
  })

  it('stays PENDING when the transaction holds more than one router swap', async () => {
    getTransactionReceipt.mockResolvedValue(withDuplicated(SWAPPED_TOPIC))

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: 'KyberSwap transaction contains more than one router swap',
    })
  })

  it('stays PENDING when the treasury fee is an absolute amount', async () => {
    getTransactionReceipt.mockResolvedValue(withAbsoluteFee())

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: 'KyberSwap fee is an absolute amount, not bps',
    })
  })

  it('finds no affiliate when the treasury is not a fee recipient', async () => {
    jest.mocked(getTreasuryAddressFromChainId).mockReturnValue('0x0000000000000000000000000000000000000001')

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'No ShapeShift fee in the KyberSwap Fee event',
      verifiedSellAmountCryptoBaseUnit: '515078935846919',
    })
  })

  it('fails a transaction with no swap through the Kyber router', async () => {
    getTransactionReceipt.mockResolvedValue(withLogsFrom(`0x${'1'.repeat(40)}`))

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      noAffiliateReason: 'No KyberSwap router swap in the transaction',
    })
  })

  it('stays PENDING when the fee bps differs from what the swap charged', async () => {
    const result = await verify({ ...robinhoodSwap, affiliateBps: 40, shapeshiftBps: 40 })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: "KyberSwap affiliate fee of 60 bps differs from the swap's 40 bps",
    })
  })

  it('fails a reverted transaction', async () => {
    getTransactionReceipt.mockResolvedValue({ ...robinhoodReceipt, status: 'reverted' })

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({ verificationStatus: 'FAILED', noAffiliateReason: 'KyberSwap transaction reverted' })
  })

  it('stays PENDING until the receipt exists', async () => {
    getTransactionReceipt.mockRejectedValue(new Error('Transaction receipt could not be found'))

    const result = await verify(robinhoodSwap)

    expect(result).toMatchObject({ verificationStatus: 'PENDING', hasAffiliate: false })
  })

  it('stays PENDING on a chain without an RPC client', async () => {
    const chainId = 'eip155:10'
    const result = await verify({ ...robinhoodSwap, sellAsset: { ...robinhoodSwap.sellAsset, chainId } })

    expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: `No RPC client for ${chainId}` })
  })

  it('fails without a sell tx hash', async () => {
    const result = await verify({ ...robinhoodSwap, sellTxHash: null })

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      noAffiliateReason: 'Missing sellTxHash for KyberSwap verification',
    })
  })
})
