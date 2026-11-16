import type { HttpService } from '@nestjs/axios'
import { Logger } from '@nestjs/common'
import { of } from 'rxjs'

import { usdcAssetId } from '@shapeshiftoss/caip'
import type { SwapMetadata } from '@shapeshiftoss/swapper'

import type { Swap } from '../../../../swaps/types'
import { SwapVerificationService } from '../../../swap-verification.service'
import { failingHttp } from '../../../test-helpers'
import { TREASURY_ACCOUNTS, verifyChainflip } from '../chainflip'

import dcaExplorer from './chainflip.dca.explorer.json'
import dcaStatus from './chainflip.dca.status.json'
import failedStatus from './chainflip.failed.status.json'
import partialRefundExplorer from './chainflip.partialRefund.explorer.json'
import partialRefundStatus from './chainflip.partialRefund.status.json'
import refundExplorer from './chainflip.refund.explorer.json'
import refundStatus from './chainflip.refund.status.json'
import singleExplorer from './chainflip.single.explorer.json'
import singleStatus from './chainflip.single.status.json'
import waitingStatus from './chainflip.waiting.status.json'
import waitingSwap from './chainflip.waiting.swap'
import zeroBpsExplorer from './chainflip.zeroBps.explorer.json'
import zeroBpsStatus from './chainflip.zeroBps.status.json'

const [TREASURY] = TREASURY_ACCOUNTS

type Status = { id: number; status: { depositChannel: { depositAddress: string } } }
type Explorer = typeof singleExplorer
type Affiliate = Explorer['data']['swapRequest']['beneficiaries']['nodes'][number]

const mockChainflip = (status: unknown, explorer?: unknown) => {
  const get = jest.fn<unknown, [url: string, ...rest: unknown[]]>().mockReturnValue(of({ data: status }))
  const post = jest.fn<unknown, [url: string, ...rest: unknown[]]>().mockReturnValue(of({ data: explorer }))
  return { http: { get, post } as unknown as HttpService, get, post }
}

// the metadata the swapper stores for the broker swap the status response describes
const swapFor = ({ id, status }: Status) =>
  ({
    metadata: { swapperMetadata: { name: 'chainflip', swapId: id, depositAddress: status.depositChannel.depositAddress } },
  }) as unknown as Swap

const verify = async (status: Status, explorer?: unknown) => {
  const mock = mockChainflip(status, explorer)
  const result = await verifyChainflip(swapFor(status), { http: mock.http, logger: new Logger() })
  return { result, ...mock }
}

const withAffiliate = (update: (affiliate: Affiliate) => void): Explorer => {
  const explorer = structuredClone(singleExplorer)
  const affiliate = explorer.data.swapRequest.beneficiaries.nodes.find(({ type }) => type === 'AFFILIATE')
  if (!affiliate) throw new Error('fixture has no AFFILIATE beneficiary')
  update(affiliate)
  return explorer
}

describe('verifyChainflip', () => {
  it('resolves the broker swap to its swap request and reports the USDC commission', async () => {
    const { result, get, post } = await verify(singleStatus, singleExplorer)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      affiliateAddress: TREASURY,
      // the executed input, net of the 156 sat ingress fee, not the 3086372 deposit
      verifiedSellAmountCryptoBaseUnit: '3086216',
      actualBuyAmountCryptoBaseUnit: '1975154551',
      actualAffiliateFeeAmountCryptoBaseUnit: '11921208',
      actualAffiliateFeeAssetId: usdcAssetId,
    })

    expect(get).toHaveBeenCalledWith('https://chainflip-broker.test/status-by-id?swapId=81541', {
      headers: { 'X-API-Key': 'x' },
    })
    expect(post).toHaveBeenCalledWith(
      'https://chainflip-explorer.test/graphql',
      expect.objectContaining({ operationName: 'GetSwapByNativeId', variables: { nativeId: '2095482' } }),
    )
  })

  it('sums the commission of every DCA chunk', async () => {
    const { result } = await verify(dcaStatus, dcaExplorer)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 60,
      verifiedSellAmountCryptoBaseUnit: '10019653322684281161543',
      actualBuyAmountCryptoBaseUnit: '15367185',
      actualAffiliateFeeAmountCryptoBaseUnit: '59928344',
      actualAffiliateFeeAssetId: usdcAssetId,
    })
  })

  it('reports only the executed input of a partially refunded swap', async () => {
    const { result } = await verify(partialRefundStatus, partialRefundExplorer)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: true,
      affiliateBps: 55,
      verifiedSellAmountCryptoBaseUnit: '42749981954282099995',
      actualBuyAmountCryptoBaseUnit: '174325505',
      actualAffiliateFeeAmountCryptoBaseUnit: '1112559655',
    })
  })

  it('fails a swap the broker completed by refunding all of it', async () => {
    const { result } = await verify(refundStatus, refundExplorer)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip swap refunded',
    })
  })

  it('fails a swap the broker reports failed without querying the explorer', async () => {
    const { result, post } = await verify(failedStatus)

    expect(result).toMatchObject({
      verificationStatus: 'FAILED',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip swap failed',
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('finds no affiliate when the affiliate beneficiary is not ShapeShift', async () => {
    const { result } = await verify(
      singleStatus,
      withAffiliate(({ account }) => {
        account.idSs58 = 'cFJZVRaybb2PBwxTiAiRLiQfHY4KPB3RpJK22Q7Fhqk979aCH'
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip swap names no ShapeShift affiliate',
      verifiedSellAmountCryptoBaseUnit: '3086216',
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
  })

  it('finds no affiliate fee on a fee-free related-asset swap, which registers the affiliate at 0 bps', async () => {
    const { result } = await verify(zeroBpsStatus, zeroBpsExplorer)

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip affiliate commission is 0 bps',
      verifiedSellAmountCryptoBaseUnit: '9996837',
      actualBuyAmountCryptoBaseUnit: '9433835',
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
  })

  it('finds no affiliate fee when the commission at a nonzero rate rounds down to 0', async () => {
    const { result } = await verify(
      singleStatus,
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates[0].sum.amount = '0'
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      noAffiliateReason: 'Chainflip collected a 0 affiliate commission',
    })
  })

  it('stays PENDING while the explorer has not indexed the commission', async () => {
    const { result } = await verify(
      singleStatus,
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates = []
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip has not indexed the affiliate commission yet',
    })
  })

  it('stays PENDING when the commission is not in USDC', async () => {
    const { result } = await verify(
      singleStatus,
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates[0].asset = ['Usdt']
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip affiliate commission is in Usdt, not USDC',
    })
  })

  it('stays PENDING when the commission spans more than one asset', async () => {
    const { result } = await verify(
      singleStatus,
      withAffiliate(({ commissions }) => {
        commissions.groupedAggregates.push({ ...commissions.groupedAggregates[0], asset: ['Usdt'] })
      }),
    )

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip reports affiliate commission in more than one asset',
    })
  })

  it('stays PENDING until the swap request completes', async () => {
    const explorer = structuredClone(singleExplorer) as { data: { swapRequest: { completedEventId: string | null } } }
    explorer.data.swapRequest.completedEventId = null

    const { result } = await verify(singleStatus, explorer)

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'Chainflip swap request not completed yet',
    })
  })

  it('stays PENDING when the explorer has no swap request yet', async () => {
    const { result } = await verify(singleStatus, { data: { swapRequest: null } })

    expect(result).toMatchObject({
      verificationStatus: 'PENDING',
      noAffiliateReason: 'No swap request returned from the Chainflip explorer',
    })
  })

  it('throws when the explorer returns GraphQL errors, which the service keeps PENDING', async () => {
    await expect(verify(singleStatus, { errors: [{ message: 'rate limited' }] })).rejects.toThrow(
      'Chainflip explorer error: rate limited',
    )
  })

  describe('through the verification service', () => {
    it('stays PENDING while the broker waits for the deposit of a recorded swap', async () => {
      const { http, get, post } = mockChainflip(waitingStatus)

      const result = await new SwapVerificationService(http).verifySwap(waitingSwap as unknown as Swap)

      expect(result).toMatchObject({
        verificationStatus: 'PENDING',
        hasAffiliate: false,
        noAffiliateReason: 'Chainflip swap waiting',
      })
      expect(get.mock.calls[0][0]).toBe('https://chainflip-broker.test/status-by-id?swapId=81350')
      expect(post).not.toHaveBeenCalled()
    })

    it('returns FAILED when the swap metadata has no swapId', async () => {
      const { http, get } = mockChainflip(waitingStatus)

      const result = await new SwapVerificationService(http).verifySwap({
        ...waitingSwap,
        metadata: { quoteId: waitingSwap.metadata.quoteId, stepIndex: 0 } as SwapMetadata,
      } as unknown as Swap)

      expect(result).toMatchObject({
        verificationStatus: 'FAILED',
        noAffiliateReason: 'Missing swapId in chainflip metadata',
      })
      expect(get).not.toHaveBeenCalled()
    })

    it('stays PENDING when the broker request fails', async () => {
      const result = await new SwapVerificationService(failingHttp()).verifySwap(waitingSwap as unknown as Swap)

      expect(result).toMatchObject({ verificationStatus: 'PENDING', noAffiliateReason: 'upstream 500' })
    })
  })
})
