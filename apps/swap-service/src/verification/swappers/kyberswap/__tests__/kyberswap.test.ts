import { viemClientByChainId } from '@shapeshiftoss/contracts'
import { getTreasuryAddressFromChainId } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { mockHttp } from '../../../test-helpers'
import { KYBER_ROUTER } from '../kyberswap'

import elysiumReceipt from './kyberswap.elysium.receipt.json'
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

const getTransactionReceipt = jest.fn()
Object.assign(viemClientByChainId, {
  [robinhoodSwap.sellAsset.chainId]: { getTransactionReceipt },
  [ELYSIUM]: { getTransactionReceipt },
})

type Receipt = typeof robinhoodReceipt

const verify = (swap: unknown) => new SwapVerificationService(mockHttp({}).http).verifySwap(swap as Swap)

// a copy of the Robinhood receipt with its router logs moved to another address
const withLogsFrom = (address: string): Receipt => ({
  ...robinhoodReceipt,
  logs: robinhoodReceipt.logs.map((log) =>
    log.address === KYBER_ROUTER.toLowerCase() ? { ...log, address } : log,
  ),
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

  it('stays PENDING when a native fee has no native asset on either side of the swap', async () => {
    getTransactionReceipt.mockResolvedValue(elysiumReceipt)

    const result = await verify({ ...elysiumSwap, buyAsset: { ...elysiumSwap.buyAsset, assetId: ELYSIUM_USDC } })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      hasAffiliate: false,
      noAffiliateReason: 'KyberSwap fee token has no known asset',
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
    const chainId = 'eip155:1'
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
