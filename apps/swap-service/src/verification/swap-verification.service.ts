import { OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'
import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'

import { SwapVerificationResult } from '@shapeshift/shared-types'
import { assertGetCowNetwork, getTreasuryAddressFromChainId, SwapperName } from '@shapeshiftoss/swapper'

import { env } from '../env'
import type { Swap } from '../swaps/types'
import { getAssetPriceUsd } from '../utils/pricing'

import {
  AcrossDepositStatusResponse,
  BebopTrade,
  BebopTradesResponse,
  ButterBridgeInfoApiResponse,
  ChainflipSwapResponse,
  CowSwapAppDataResponse,
  CowSwapDecodedAppData,
  CowSwapOrderResponse,
  MidgardActionsResponse,
  PortalsOrderResponse,
  RelayRequestsResponse,
  StonfiQuoteMetadata,
  ZrxApiResponse,
  ZrxTrade,
} from './types'
import { applyBps, noAffiliateResult, thorchainToNativePrecision } from './utils'

@Injectable()
export class SwapVerificationService {
  private readonly logger = new Logger(SwapVerificationService.name)

  private readonly shapeshift0xIntegrator = 'ShapeShift'
  private readonly shapeshiftBebopSource = 'shapeshift'
  private readonly shapeshiftButterswapEntrance = 'shapeshift'
  private readonly shapeshiftChainflipAffiliate = 'shapeshift'
  private readonly shapeshiftCowswapAppCode = 'shapeshift'

  private readonly bebopApiKey = env.VITE_BEBOP_API_KEY
  private readonly chainflipApiKey = env.VITE_CHAINFLIP_API_KEY

  private readonly acrossApiUrl = env.VITE_ACROSS_API_URL
  private readonly bebopApiUrl = env.VITE_BEBOP_API_URL
  private readonly chainflipApiUrl = env.VITE_CHAINFLIP_API_URL
  private readonly cowswapApiUrl = env.VITE_COWSWAP_BASE_URL
  private readonly portalsApiUrl = env.VITE_PORTALS_BASE_URL
  private readonly zrxApiUrl = env.VITE_ZRX_BASE_URL

  constructor(private readonly httpService: HttpService) {
    OpenAPI.BASE = 'https://1click.chaindefuser.com'
    OpenAPI.TOKEN = env.VITE_NEAR_INTENTS_API_KEY
  }

  async verifySwap(swap: Swap): Promise<SwapVerificationResult> {
    const result = await (async () => {
      try {
        switch (swap.swapperName) {
          case SwapperName.NearIntents:
            return await this.verifyNearIntents(swap)
          case SwapperName.Relay:
            return await this.verifyRelay(swap)
          case SwapperName.CowSwap:
            return await this.verifyCowSwap(swap)
          case SwapperName.Portals:
            return await this.verifyPortals(swap)
          case SwapperName.Thorchain:
            return await this.verifyThorchain(swap)
          case SwapperName.Mayachain:
            return await this.verifyMaya(swap)
          case SwapperName.Chainflip:
            return await this.verifyChainflip(swap)
          case SwapperName.Zrx:
            return await this.verifyZrx(swap)
          case SwapperName.Bebop:
            return await this.verifyBebop(swap)
          case SwapperName.ArbitrumBridge:
            return await this.verifyArbitrumBridge(swap)
          case SwapperName.ButterSwap:
            return await this.verifyButterSwap(swap)
          case SwapperName.Cetus:
            return await this.verifyCetus(swap)
          case SwapperName.Sunio:
            return await this.verifySunio(swap)
          case SwapperName.Avnu:
            return await this.verifyAvnu(swap)
          case SwapperName.Stonfi:
            return await this.verifyStonfi(swap)
          case SwapperName.Across:
            return await this.verifyAcross(swap)
          case SwapperName.Debridge:
          case SwapperName.Test:
            return noAffiliateResult('SUCCESS', 'Verification not implemented')
          default: {
            const _exhaustive: never = swap.swapperName
            void _exhaustive
            throw new Error('unreachable')
          }
        }
      } catch (error) {
        return noAffiliateResult('PENDING', error instanceof Error ? error.message : 'Unknown error')
      }
    })()

    this.logResult(swap, result)

    return result
  }

  private logResult(swap: Swap, result: SwapVerificationResult): void {
    const affiliateDetails = result.hasAffiliate
      ? `${result.affiliateAddress} - ${result.affiliateBps} bps`
      : `noAffiliateReason=${result.noAffiliateReason ?? 'unknown'}`

    this.logger.log(
      `${swap.swapperName} verification for swap: ${swap.swapId} ${result.verificationStatus} (${affiliateDetails})`,
    )
  }

  private async verifyNearIntents(swap: Swap): Promise<SwapVerificationResult> {
    const { metadata } = swap

    const depositAddress = metadata.nearIntentsSpecific?.depositAddress
    if (!depositAddress) return noAffiliateResult('FAILED', 'Missing depositAddress in nearIntentsSpecific metadata')

    const status = await OneClickService.getExecutionStatus(depositAddress)

    const { quoteResponse, swapDetails } = status
    const { quoteRequest, quote } = quoteResponse
    const { referral, appFees = [] } = quoteRequest

    const affiliateAddresses = ['shapeshifttokenomics.sputnik-dao.near']

    const shapeshiftFee =
      referral?.toLowerCase() === 'shapeshift'
        ? appFees.find(({ recipient }) => affiliateAddresses.includes(recipient.toLowerCase()))
        : undefined

    const verifiedSellAmountCryptoBaseUnit = swapDetails.depositedAmount || swapDetails.amountIn || quote.amountIn

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: Boolean(shapeshiftFee),
      affiliateBps: shapeshiftFee?.fee,
      affiliateAddress: shapeshiftFee?.recipient,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: swapDetails.amountOut || quote.amountOut,
      // 1Click applies the appFee bps to the input amount, so realized fee = input × bps / 10000.
      actualAffiliateFeeAmountCryptoBaseUnit: applyBps(verifiedSellAmountCryptoBaseUnit, shapeshiftFee?.fee),
    }
  }

  private async verifyRelay(swap: Swap): Promise<SwapVerificationResult> {
    const { metadata } = swap

    const relayId = metadata.relayTransactionMetadata?.relayId
    if (!relayId) return noAffiliateResult('FAILED', 'Missing relayId in relayTransactionMetadata')

    const { data } = await firstValueFrom(
      this.httpService.get<RelayRequestsResponse>(`${env.VITE_RELAY_API_URL}/requests/v2?id=${relayId}`),
    )

    const request = data?.requests?.[0]
    if (!request?.data) return noAffiliateResult('PENDING', 'No request data returned from Relay API')

    const appFees = request.data.appFees?.length ? request.data.appFees : (request.data.paidAppFees ?? [])

    // Relay routes affiliate fees to our BASE-chain treasury
    const affiliateAddresses = ['0x9c9aa90363630d4ab1d9dbf416cc3bbc8d3ed502']

    const shapeshiftFee =
      request.referrer?.toLowerCase() === 'shapeshift'
        ? appFees.find(({ recipient }) => recipient && affiliateAddresses.includes(recipient.toLowerCase()))
        : undefined

    const parsedBps = Number(shapeshiftFee?.bps)
    const affiliateBps = Number.isFinite(parsedBps) ? parsedBps : undefined

    // Relay's appFeeCurrencyObject is the source of truth for which asset the affiliate fee was paid in —
    // it can be the sell asset, the buy asset, or neither, depending on the route.
    // TODO: replace with `relayTokenToAssetId` from `@shapeshiftoss/swapper`
    const actualAffiliateFeeAssetId = (() => {
      if (!shapeshiftFee) return

      const chainId = request.data.appFeeCurrencyObject?.chainId
      const address = request.data.appFeeCurrencyObject?.address?.toLowerCase()

      if (!chainId || !address) return

      const isNative = address === '0x0000000000000000000000000000000000000000'

      return isNative ? `eip155:${chainId}/slip44:60` : `eip155:${chainId}/erc20:${address}`
    })()

    const actualAffiliateFeeUsd = await (async () => {
      if (!actualAffiliateFeeAssetId) return

      if (actualAffiliateFeeAssetId === swap.sellAsset.assetId) return swap.sellAssetUsd
      if (actualAffiliateFeeAssetId === swap.buyAsset.assetId) return swap.buyAssetUsd

      const priceUsd = await getAssetPriceUsd(actualAffiliateFeeAssetId)

      return priceUsd?.toString()
    })()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: Boolean(shapeshiftFee),
      affiliateBps,
      affiliateAddress: shapeshiftFee?.recipient,
      verifiedSellAmountCryptoBaseUnit: request.data.metadata?.currencyIn?.amount,
      actualBuyAmountCryptoBaseUnit: request.data.metadata?.currencyOut?.amount,
      actualAffiliateFeeAmountCryptoBaseUnit: shapeshiftFee?.amount,
      actualAffiliateFeeAssetId,
      actualAffiliateFeeUsd: actualAffiliateFeeUsd ?? undefined,
    }
  }

  private async verifyCowSwap(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const sellChainId = swap.sellAsset.chainId
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    // SECURITY: Always verify appData from CowSwap API using appDataHash
    // to prevent users from pushing fake data to abuse the referral system
    const appDataHash = (metadata?.cowswapQuoteSpecific as { quote?: { appDataHash?: string } } | undefined)?.quote
      ?.appDataHash

    if (!appDataHash) return noAffiliateResult('FAILED', 'Missing appDataHash in metadata')

    // ALWAYS fetch appData from CowSwap API to verify it's legitimate
    this.logger.log(`CowSwap - Fetching appData from API using hash ${appDataHash} for swap ${swapId}`)
    const cowNetwork = assertGetCowNetwork(sellChainId)
    const response = await firstValueFrom(
      this.httpService.get<CowSwapAppDataResponse>(
        `${this.cowswapApiUrl}/${cowNetwork}/api/v1/app_data/${appDataHash}`,
      ),
    )

    const decodedAppData = JSON.parse(response.data.fullAppData) as CowSwapDecodedAppData

    const appCode = decodedAppData?.appCode
    const hasShapeshiftAppCode = appCode?.toLowerCase() === this.shapeshiftCowswapAppCode.toLowerCase()

    const partnerFee = decodedAppData?.metadata?.partnerFee
    const affiliateBps = partnerFee?.bps
    const affiliateAddress = partnerFee?.recipient

    const hasShapeshiftAffiliate = hasShapeshiftAppCode && !!partnerFee

    // Order-amount fetch is best-effort — failure here shouldn't fail the whole verification.
    let verifiedSellAmountCryptoBaseUnit: string | undefined
    const orderUid = txHash || (metadata?.cowswapOrderUid as string | undefined)
    if (orderUid) {
      try {
        const orderResponse = await firstValueFrom(
          this.httpService.get<CowSwapOrderResponse>(`${this.cowswapApiUrl}/${cowNetwork}/api/v1/orders/${orderUid}`),
        )
        verifiedSellAmountCryptoBaseUnit =
          orderResponse.data?.executedSellAmountBeforeFees?.toString() ??
          orderResponse.data?.executedSellAmount?.toString()
      } catch (orderErr) {
        this.logger.warn(`CowSwap - Failed to fetch order ${orderUid} for amount verification:`, orderErr)
      }
    }

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
      affiliateAddress: hasShapeshiftAffiliate ? affiliateAddress : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  private async verifyPortals(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const sellChainId = swap.sellAsset.chainId
    const metadata = swap.metadata as Record<string, any>

    // SECURITY: Always verify partner address from Portals API using orderId
    // to prevent users from pushing fake data to abuse the referral system

    // Get the orderId from the swap (stored as the quote id)
    const orderId = (metadata?.portalsTransactionMetadata as { orderId?: string } | undefined)?.orderId
    if (!orderId) return noAffiliateResult('FAILED', 'Missing orderId in metadata')

    // Get the expected treasury address for this chain
    let expectedTreasuryAddress: string
    try {
      expectedTreasuryAddress = getTreasuryAddressFromChainId(sellChainId)
    } catch {
      return noAffiliateResult('FAILED', `Unsupported chain for treasury address: ${sellChainId}`)
    }

    // ALWAYS fetch order status from Portals API to verify it's legitimate
    this.logger.log(`Portals - Fetching order status from API using orderId ${orderId} for swap ${swapId}`)
    const response = await firstValueFrom(
      this.httpService.get<PortalsOrderResponse>(`${this.portalsApiUrl}/v2/portal/status?orderId=${orderId}`),
    )

    const orderData = response.data
    this.logger.log(`Portals - Fetched and verified order from API for swap ${swapId}`)

    const partner = orderData?.context?.partner
    if (!partner) return noAffiliateResult('SUCCESS', 'No partner found in Portals API response')

    const hasShapeshiftAffiliate = partner.toLowerCase() === expectedTreasuryAddress.toLowerCase()

    const verifiedSellAmountCryptoBaseUnit = orderData?.context?.inputAmount?.toString() ?? undefined

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps: swap.affiliateBps ?? undefined,
      affiliateAddress: hasShapeshiftAffiliate ? expectedTreasuryAddress : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: orderData?.context?.feeAmount,
    }
  }

  private verifyThorchain(swap: Swap): Promise<SwapVerificationResult> {
    return this.verifyMidgardSwap(swap, { midgardUrl: env.VITE_THORCHAIN_MIDGARD_URL, affiliate: 'ss' })
  }

  private verifyMaya(swap: Swap): Promise<SwapVerificationResult> {
    return this.verifyMidgardSwap(swap, { midgardUrl: env.VITE_MAYACHAIN_MIDGARD_URL, affiliate: 'ssmaya' })
  }

  private async verifyMidgardSwap(
    swap: Swap,
    config: { midgardUrl: string; affiliate: string },
  ): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash?.replace(/^0x/, '')
    if (!txHash) return noAffiliateResult('FAILED', 'Missing sell txHash')

    const { data } = await firstValueFrom(
      this.httpService.get<MidgardActionsResponse>(`${config.midgardUrl}/actions?txid=${txHash}`),
    )

    const action = data.actions[0]
    if (!action) return noAffiliateResult('PENDING', 'No action found in Midgard')

    if (action.type !== 'swap') return noAffiliateResult('FAILED', 'Invalid swap action type')
    if (action.status === 'pending') return noAffiliateResult('PENDING', 'Swap action still pending')
    if (action.status === 'failed') return noAffiliateResult('FAILED', 'Swap action failed')

    const swapMetadata = action.metadata.swap
    if (!swapMetadata) return noAffiliateResult('FAILED', 'No swap metadata found')

    const affiliateAddress = swapMetadata.affiliateAddress

    // Memo format: =:ASSET:DESTADDR:LIM/INTERVAL/QUANTITY:AFFILIATE:FEE
    // The destination is what Midgard observed on-chain, so it's the trusted source for matching the buy out.
    const destinationAddress = swapMetadata.memo.split(':')[2]
    if (!destinationAddress) return noAffiliateResult('FAILED', 'Could not parse destination address from memo')

    const buyOut = action.out.find(
      (out) => !out.affiliate && out.address.toLowerCase() === destinationAddress.toLowerCase(),
    )
    if (!buyOut) return noAffiliateResult('FAILED', 'No outbound matching memo destination')

    const feeOut = action.out.find((out) => out.affiliate)
    const hasAffiliate = affiliateAddress === config.affiliate && !!feeOut

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? parseInt(swapMetadata.affiliateFee) : undefined,
      affiliateAddress: hasAffiliate ? affiliateAddress : undefined,
      verifiedSellAmountCryptoBaseUnit: thorchainToNativePrecision(
        action.in[0].coins[0].amount,
        swap.sellAsset.precision,
      ),
      actualBuyAmountCryptoBaseUnit: thorchainToNativePrecision(buyOut.coins[0].amount, swap.buyAsset.precision),
      actualAffiliateFeeAmountCryptoBaseUnit: hasAffiliate ? feeOut?.coins[0].amount : undefined,
    }
  }

  private async verifyChainflip(swap: Swap): Promise<SwapVerificationResult> {
    const metadata = swap.metadata as Record<string, any>
    const chainflipSwapId = metadata?.chainflipSwapId as string | undefined

    if (!chainflipSwapId) return noAffiliateResult('FAILED', 'Missing chainflipSwapId in metadata')

    const statusUrl = `${this.chainflipApiUrl}/swaps/${chainflipSwapId}`

    const headers: Record<string, string> = {}
    if (this.chainflipApiKey) {
      headers['Authorization'] = `Bearer ${this.chainflipApiKey}`
    }

    const response = await firstValueFrom(this.httpService.get<ChainflipSwapResponse>(statusUrl, { headers }))

    const swapData = response.data

    if (!swapData) return noAffiliateResult('PENDING', 'No swap data found from Chainflip API')

    const affiliate = swapData.affiliate || swapData.affiliateName
    const affiliateBps = swapData.affiliateBps || swapData.affiliateFee

    const hasShapeshiftAffiliate = affiliate?.toLowerCase() === this.shapeshiftChainflipAffiliate.toLowerCase()

    const verifiedSellAmountCryptoBaseUnit = (
      swapData.depositAmount ??
      swapData.ingressAmount ??
      swapData.sourceAmount
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps: hasShapeshiftAffiliate && affiliateBps ? parseInt(String(affiliateBps)) : undefined,
      affiliateAddress: hasShapeshiftAffiliate ? this.shapeshiftChainflipAffiliate : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  private async verifyZrx(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>
    const tradeHash = txHash || (metadata?.tradeHash as string | undefined) || (metadata?.txHash as string | undefined)

    if (!tradeHash) return noAffiliateResult('FAILED', 'Missing tradeHash in metadata')

    // Use 0x Trade Analytics API via ShapeShift proxy to verify the trade
    const requestUrl = `${this.zrxApiUrl}/trade-analytics/swap?txHash=${tradeHash}`

    const response = await firstValueFrom(this.httpService.get<ZrxTrade[] | ZrxApiResponse>(requestUrl))

    const trades: ZrxTrade[] = Array.isArray(response.data)
      ? response.data
      : response.data?.trades || response.data?.results || []

    const trade = trades.find(
      (t: ZrxTrade) =>
        t.txHash?.toLowerCase() === tradeHash.toLowerCase() ||
        t.transactionHash?.toLowerCase() === tradeHash.toLowerCase(),
    )

    if (!trade)
      return noAffiliateResult('PENDING', `Trade not found in 0x analytics (searched ${trades.length} trades)`)

    // The integrator field could be integratorId, integratorName, or affiliateName
    const integratorId = trade.integratorId || trade.integratorName || trade.affiliateName
    const hasShapeshiftAffiliate = integratorId?.toLowerCase() === this.shapeshift0xIntegrator.toLowerCase()

    // 0x fees are decimal (e.g., 0.0015 == 15 bps)
    const integratorFee = trade.integratorFee || trade.affiliateFee || trade.partnerFee
    const affiliateBps = integratorFee ? Math.round(parseFloat(integratorFee) * 10000) : undefined

    const verifiedSellAmountCryptoBaseUnit = (trade.sellAmount ?? trade.inputTokenAmount ?? trade.amount)?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps,
      affiliateAddress: hasShapeshiftAffiliate ? this.shapeshift0xIntegrator : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  private async verifyBebop(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for Bebop verification')

    // Query trade history with source filter, scoped to swap createdAt +/- 1 hour (nanoseconds)
    const swapTimestamp = swap.createdAt.getTime()
    const oneHour = 60 * 60 * 1000
    const startNano = (swapTimestamp - oneHour) * 1_000_000
    const endNano = (swapTimestamp + oneHour) * 1_000_000

    const queryParams = new URLSearchParams({
      start: startNano.toString(),
      end: endNano.toString(),
      source: this.shapeshiftBebopSource,
    })

    const headers = {
      'source-auth': this.bebopApiKey,
    }

    const requestUrl = `${this.bebopApiUrl}/history/v2/trades?${queryParams.toString()}`

    this.logger.log(`Bebop API Request - URL: ${requestUrl}`)
    this.logger.log(
      `Bebop API Request - Params: ${JSON.stringify({
        start: startNano.toString(),
        end: endNano.toString(),
        source: this.shapeshiftBebopSource,
        swapTimestamp: new Date(swapTimestamp).toISOString(),
      })}`,
    )
    this.logger.log(`Bebop API Request - Looking for txHash: ${txHash}`)

    const response = await firstValueFrom(this.httpService.get<BebopTradesResponse>(requestUrl, { headers }))

    this.logger.log(`Bebop API Response - Status: ${response.status}`)
    this.logger.log(`Bebop API Response - Data: ${JSON.stringify(response.data)}`)

    const trades = response.data?.results || []
    this.logger.log(`Bebop API Response - Found ${trades.length} trades`)

    const trade = trades.find((t: BebopTrade) => t.txHash?.toLowerCase() === txHash.toLowerCase())

    if (!trade) return noAffiliateResult('PENDING', 'Trade not found in Bebop history')

    // Filtered by source=shapeshift, so finding the trade implies a ShapeShift route.
    const hasShapeshiftAffiliate = true

    const partnerFeeBps = trade.partnerFeeBps
    const affiliateBps = partnerFeeBps != null ? Number(partnerFeeBps) : undefined

    const sellTokenEntries = trade.sellTokens ? Object.values(trade.sellTokens) : []
    const verifiedSellAmountCryptoBaseUnit = sellTokenEntries[0]?.amount?.toString() ?? undefined

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps,
      affiliateAddress: this.shapeshiftBebopSource,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private verifyArbitrumBridge(_swap: Swap): Promise<SwapVerificationResult> {
    return Promise.resolve({
      verificationStatus: 'SUCCESS',
      hasAffiliate: false,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    })
  }

  private async verifyButterSwap(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for ButterSwap verification')

    const apiUrl = `https://bs-app-api.chainservice.io/api/queryBridgeInfoBySourceHash?hash=${txHash}`

    this.logger.log(`ButterSwap - Fetching bridge info from API: ${apiUrl}`)

    const response = await firstValueFrom(this.httpService.get<ButterBridgeInfoApiResponse>(apiUrl))

    const bridgeInfo = response.data?.data?.info
    if (!bridgeInfo) return noAffiliateResult('PENDING', 'No bridge info found')

    const entrance = bridgeInfo.entrance
    const hasShapeshiftAffiliate = entrance?.toLowerCase() === this.shapeshiftButterswapEntrance.toLowerCase()

    const affiliateBps = swap.affiliateBps ?? undefined

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate: hasShapeshiftAffiliate,
      affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
      affiliateAddress: hasShapeshiftAffiliate ? this.shapeshiftButterswapEntrance : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async verifyCetus(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for Cetus verification')

    // TODO: Implement on-chain/API verification for Cetus
    const affiliateBps = swap.affiliateBps ?? undefined
    const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? affiliateBps : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async verifySunio(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for Sun.io verification')

    // TODO: Implement on-chain/API verification for Sun.io
    const affiliateBps = swap.affiliateBps ?? undefined
    const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? affiliateBps : undefined,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async verifyAvnu(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for AVNU verification')

    // TODO: Implement on-chain/API verification for AVNU
    const affiliateBps = swap.affiliateBps ?? undefined
    const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0
    const affiliateAddress = swap.affiliateAddress ?? undefined

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? affiliateBps : undefined,
      affiliateAddress,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async verifyStonfi(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for STON.fi verification')

    // TODO: Implement on-chain/API verification for STON.fi
    const stonfiSpecific = metadata?.stonfiSpecific as StonfiQuoteMetadata | undefined

    const referrerAddress = stonfiSpecific?.referrerAddress

    const affiliateBps = swap.affiliateBps ?? stonfiSpecific?.referrerFeeBps ?? undefined

    const hasAffiliate = !!referrerAddress && (affiliateBps !== undefined ? affiliateBps > 0 : false)

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? affiliateBps : undefined,
      affiliateAddress: referrerAddress,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }

  private async verifyAcross(swap: Swap): Promise<SwapVerificationResult> {
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) return noAffiliateResult('FAILED', 'Missing txHash for Across verification')

    const statusUrl = `${this.acrossApiUrl}/deposit/status?depositTxnRef=${txHash}`

    this.logger.log(`Across - Fetching deposit status from API: ${statusUrl}`)

    const response = await firstValueFrom(this.httpService.get<AcrossDepositStatusResponse>(statusUrl))

    // TODO: Implement on-chain/API verification for Across
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const depositStatus = response.data

    const affiliateBps = swap.affiliateBps ?? undefined
    const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

    const affiliateAddress =
      (metadata?.appFeeRecipient as string | undefined) || (metadata?.integratorId as string | undefined)

    const verifiedSellAmountCryptoBaseUnit = (
      (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
    )?.toString()

    return {
      verificationStatus: 'SUCCESS',
      hasAffiliate,
      affiliateBps: hasAffiliate ? affiliateBps : undefined,
      affiliateAddress,
      verifiedSellAmountCryptoBaseUnit,
      actualBuyAmountCryptoBaseUnit: undefined,
      actualAffiliateFeeAmountCryptoBaseUnit: undefined,
    }
  }
}
