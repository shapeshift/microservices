import { OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript'
import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'

import { SwapVerificationResult } from '@shapeshift/shared-types'
import { assertGetCowNetwork, getTreasuryAddressFromChainId, SwapperName } from '@shapeshiftoss/swapper'

import type { Swap } from '../swaps/types'

import {
  AcrossDepositStatusResponse,
  BebopTrade,
  BebopTradesResponse,
  ButterBridgeInfoApiResponse,
  ChainflipSwapResponse,
  CowSwapAppDataResponse,
  CowSwapDecodedAppData,
  CowSwapOrderResponse,
  PortalsOrderResponse,
  RelayRequestsResponse,
  StonfiQuoteMetadata,
  ThorchainMayaTxResponse,
  ZrxApiResponse,
  ZrxTrade,
} from './types'
import { THORCHAIN_PRECISION, thorchainToNativePrecision } from './utils'

@Injectable()
export class SwapVerificationService {
  private readonly logger = new Logger(SwapVerificationService.name)

  private oneClickServiceInitialized = false

  constructor(private readonly httpService: HttpService) {}

  private initializeOneClickService(apiKey: string) {
    if (this.oneClickServiceInitialized) return

    OpenAPI.BASE = 'https://1click.chaindefuser.com'
    OpenAPI.TOKEN = apiKey

    this.oneClickServiceInitialized = true
    this.logger.log('OneClickService initialized')
  }

  async verifySwap(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId, swapperName } = swap

    const unverified = (error: string): SwapVerificationResult => ({
      isVerified: false,
      hasAffiliate: false,
      swapperName,
      swapId,
      error,
    })

    try {
      this.logger.log(`Verifying affiliate for swap ${swapId} on ${swapperName}`)

      switch (swapperName) {
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
          return unverified(`Verification not implemented for ${swapperName}`)
        default: {
          const _exhaustive: never = swapperName
          void _exhaustive
          return unverified(`Verification not implemented for ${swapperName}`)
        }
      }
    } catch (error) {
      this.logger.error(`Error verifying swap ${swapId} for ${swapperName}:`, error)

      return unverified(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  private async verifyNearIntents(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId, metadata } = swap

    // NEAR intents uses depositAddress to query execution status
    const depositAddress = metadata.nearIntentsSpecific?.depositAddress

    if (!depositAddress) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.NearIntents,
        swapId,
        error: 'Missing depositAddress in metadata.nearIntentsSpecific',
      }
    }

    try {
      // Initialize OneClickService with API key (same approach as web)
      const apiKey = process.env.VITE_NEAR_INTENTS_API_KEY
      if (!apiKey) {
        this.logger.error('Missing VITE_NEAR_INTENTS_API_KEY for NEAR Intents verification')
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.NearIntents,
          swapId,
          error: 'Missing VITE_NEAR_INTENTS_API_KEY',
        }
      }

      this.initializeOneClickService(apiKey)

      const statusResponse = await OneClickService.getExecutionStatus(depositAddress)

      if (!statusResponse) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.NearIntents,
          swapId,
          error: 'No execution status found',
        }
      }

      // Check if the quote request contains affiliate fees
      // SDK structure: statusResponse.quoteResponse.quoteRequest
      const quoteRequest = statusResponse.quoteResponse?.quoteRequest

      // Verify it's ShapeShift's affiliate
      // The referral field should be 'shapeshift' from the quote request
      const referral = quoteRequest?.referral
      const shapeshiftReferral = process.env.SHAPESHIFT_NEAR_REFERRAL || 'shapeshift'
      const hasShapeshiftReferral = referral?.toLowerCase() === shapeshiftReferral.toLowerCase()

      // Check if there are app fees
      const appFees = quoteRequest?.appFees || []
      const hasAppFees = appFees.length > 0

      const hasShapeshiftAffiliate = hasShapeshiftReferral && hasAppFees

      // Extract fee amount if present
      let affiliateBps: number | undefined
      if (hasAppFees && appFees[0]) {
        affiliateBps = appFees[0].fee
      }

      const swapDetails = (
        statusResponse as unknown as {
          swapDetails?: { depositedAmount?: string; amountIn?: string }
        }
      ).swapDetails
      const quoteAmounts = statusResponse.quoteResponse?.quote
      let verifiedSellAmountCryptoBaseUnit: string | undefined

      const rawDepositedAmount: string | undefined =
        swapDetails?.depositedAmount ?? swapDetails?.amountIn ?? quoteAmounts?.amountIn
      if (rawDepositedAmount) {
        const sellAssetPrecision = swap.sellAsset.precision
        if (sellAssetPrecision && rawDepositedAmount.includes('.')) {
          const [whole, frac = ''] = rawDepositedAmount.split('.')
          verifiedSellAmountCryptoBaseUnit = whole + frac.padEnd(sellAssetPrecision, '0').slice(0, sellAssetPrecision)
        } else {
          verifiedSellAmountCryptoBaseUnit = rawDepositedAmount
        }
      }

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftReferral : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.NearIntents,
        swapId,
        details: {
          depositAddress,
          referral,
          appFees,
          quoteRequest,
          swapDetails,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying NEAR intents for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.NearIntents,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch NEAR intents status',
      }
    }
  }

  private async verifyRelay(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const metadata = swap.metadata as Record<string, any>
    const relayId = (metadata?.relayTransactionMetadata as { relayId?: string } | undefined)?.relayId

    if (!relayId) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Relay,
        swapId,
        error: 'Missing relay transaction metadata',
      }
    }

    try {
      const relayApiUrl = process.env.VITE_RELAY_API_URL || 'https://api.relay.link'
      const requestUrl = `${relayApiUrl}/requests/v2?id=${relayId}`

      const response = await firstValueFrom(this.httpService.get<RelayRequestsResponse>(requestUrl))

      const requests = response.data?.requests

      if (!requests || requests.length === 0) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Relay,
          swapId,
          error: 'No request data found from Relay API',
        }
      }

      const request = requests[0]

      // Check for referrer field at top level
      const referrer = request.referrer
      const shapeshiftReferrer = process.env.SHAPESHIFT_RELAY_REFERRER || 'shapeshift'
      const hasShapeshiftReferrer = referrer?.toLowerCase() === shapeshiftReferrer.toLowerCase()

      // Check for appFees or paidAppFees in the data object
      const appFees = request.data?.appFees || request.data?.paidAppFees || []

      // Extract affiliate info from appFees
      let affiliateBps: number | undefined
      let affiliateAddress: string | undefined

      if (appFees.length > 0) {
        // Get the first app fee entry (should be ShapeShift's)
        const fee = appFees[0]
        affiliateBps = fee.bps ? parseInt(fee.bps) : undefined
        affiliateAddress = fee.recipient
      }

      // Verification is successful if we have shapeshift as referrer AND we have app fees
      const hasShapeshiftAffiliate = hasShapeshiftReferrer && appFees.length > 0

      const verifiedSellAmountCryptoBaseUnit =
        request.data?.inTxs?.[0]?.data?.value?.toString() ??
        request.data?.metadata?.currencyIn?.amount?.toString() ??
        undefined

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Relay,
        swapId,
        details: {
          relayId,
          referrer,
          appFees,
          request,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Relay for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Relay,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch Relay request data',
      }
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

    if (!appDataHash) {
      this.logger.warn(`CowSwap - Missing appDataHash for swap ${swapId}`)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.CowSwap,
        swapId,
        error: 'Missing appDataHash in metadata',
      }
    }

    try {
      // ALWAYS fetch appData from CowSwap API to verify it's legitimate
      this.logger.log(`CowSwap - Fetching appData from API using hash ${appDataHash} for swap ${swapId}`)
      const cowswapApiUrl = process.env.VITE_COWSWAP_BASE_URL || 'https://api.cow.fi'
      const cowNetwork = assertGetCowNetwork(sellChainId)
      const response = await firstValueFrom(
        this.httpService.get<CowSwapAppDataResponse>(`${cowswapApiUrl}/${cowNetwork}/api/v1/app_data/${appDataHash}`),
      )

      const decodedAppData = JSON.parse(response.data.fullAppData) as CowSwapDecodedAppData

      // Check if appCode is "shapeshift"
      const appCode = decodedAppData?.appCode
      const shapeshiftAppCode = process.env.SHAPESHIFT_COWSWAP_APPCODE || 'shapeshift'
      const hasShapeshiftAppCode = appCode?.toLowerCase() === shapeshiftAppCode.toLowerCase()

      // Extract partner fee information from metadata.partnerFee
      const partnerFee = decodedAppData?.metadata?.partnerFee
      const affiliateBps = partnerFee?.bps
      const affiliateAddress = partnerFee?.recipient

      // We have ShapeShift affiliate if appCode is shapeshift AND we have partnerFee
      const hasShapeshiftAffiliate = hasShapeshiftAppCode && !!partnerFee

      let verifiedSellAmountCryptoBaseUnit: string | undefined
      const orderUid = txHash || (metadata?.cowswapOrderUid as string | undefined)
      if (orderUid) {
        try {
          const orderResponse = await firstValueFrom(
            this.httpService.get<CowSwapOrderResponse>(`${cowswapApiUrl}/${cowNetwork}/api/v1/orders/${orderUid}`),
          )
          verifiedSellAmountCryptoBaseUnit =
            orderResponse.data?.executedSellAmountBeforeFees?.toString() ??
            orderResponse.data?.executedSellAmount?.toString()
        } catch (orderErr) {
          this.logger.warn(`CowSwap - Failed to fetch order ${orderUid} for amount verification:`, orderErr)
        }
      }

      this.logger.log(
        `CowSwap verification for swap ${swapId}: appCode=${appCode}, hasPartnerFee=${!!partnerFee}, bps=${affiliateBps}, verified=${hasShapeshiftAffiliate}`,
      )

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? affiliateAddress : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.CowSwap,
        swapId,
        details: {
          appCode,
          partnerFee,
          decodedAppData,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying CowSwap for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.CowSwap,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to decode CowSwap appData',
      }
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

    if (!orderId) {
      this.logger.warn(`Portals - Missing orderId for swap ${swapId}`)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Portals,
        swapId,
        error: 'Missing orderId in metadata',
      }
    }

    // Get the expected treasury address for this chain
    let expectedTreasuryAddress: string
    try {
      expectedTreasuryAddress = getTreasuryAddressFromChainId(sellChainId)
    } catch {
      this.logger.warn(`Portals - Unsupported chain for treasury address: ${sellChainId}`)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Portals,
        swapId,
        error: `Unsupported chain for treasury address: ${sellChainId}`,
      }
    }

    try {
      // ALWAYS fetch order status from Portals API to verify it's legitimate
      this.logger.log(`Portals - Fetching order status from API using orderId ${orderId} for swap ${swapId}`)
      const portalsProxyUrl = process.env.PORTALS_PROXY_URL || 'https://api.proxy.shapeshift.com/api/v1/portals'
      const response = await firstValueFrom(
        this.httpService.get<PortalsOrderResponse>(`${portalsProxyUrl}/v2/portal/status?orderId=${orderId}`),
      )

      const orderData = response.data
      this.logger.log(`Portals - Fetched and verified order from API for swap ${swapId}`)

      // Get partner from the API response context
      const partner = orderData?.context?.partner

      if (!partner) {
        this.logger.warn(`Portals - No partner found in API response for swap ${swapId}`)
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Portals,
          swapId,
          error: 'No partner found in Portals API response',
        }
      }

      // Verify partner matches the expected treasury address (case-insensitive for EVM addresses)
      const hasShapeshiftAffiliate = partner.toLowerCase() === expectedTreasuryAddress.toLowerCase()

      // Extract fee information from the order context
      // feeAmount and feeAmountUsd are in the context
      const feeAmount = orderData?.context?.feeAmount
      const feeAmountUsd = orderData?.context?.feeAmountUsd

      const verifiedSellAmountCryptoBaseUnit = orderData?.context?.inputAmount?.toString() ?? undefined

      this.logger.log(
        `Portals verification for swap ${swapId}: partner=${partner}, expectedTreasury=${expectedTreasuryAddress}, verified=${hasShapeshiftAffiliate}, feeAmount=${feeAmount}`,
      )

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: swap.affiliateBps ?? undefined,
        affiliateAddress: hasShapeshiftAffiliate ? expectedTreasuryAddress : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Portals,
        swapId,
        details: {
          orderId,
          partner,
          expectedTreasuryAddress,
          sellChainId,
          feeAmount,
          feeAmountUsd,
          orderData,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Portals for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Portals,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify Portals order',
      }
    }
  }

  private async verifyThorchain(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined

    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Thorchain,
        swapId,
        error: 'Missing txHash for Thorchain verification',
      }
    }

    try {
      // SECURITY: Query Thorchain node API to verify memo contains affiliate info
      const nodeUrl = process.env.VITE_THORCHAIN_NODE_URL || 'https://thornode.ninerealms.com'
      const txUrl = `${nodeUrl}/thorchain/tx/${txHash}`

      this.logger.log(`Thorchain - Fetching tx from node API: ${txUrl}`)

      const response = await firstValueFrom(this.httpService.get<ThorchainMayaTxResponse>(txUrl))

      const observedTx = response.data?.observed_tx

      if (!observedTx || !observedTx.tx) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Thorchain,
          swapId,
          error: 'No observed transaction found',
        }
      }

      const memo: string | undefined = observedTx.tx.memo
      if (!memo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Thorchain,
          swapId,
          error: 'No memo found in transaction',
        }
      }

      // Parse memo format: =:r:thor1dz68dtlzrxnjflha9vvs7yt7p77mqdnf5yugww:131082237:ss:0
      // The affiliate code is after the 4th colon, followed by fee in bps
      const shapeshiftAffiliate = process.env.SHAPESHIFT_THORCHAIN_AFFILIATE || 'ss'
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i')
      const memoMatch = memo.match(memoPattern)

      const hasShapeshiftAffiliate = !!memoMatch
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined

      const coins = observedTx.tx.coins
      const sellAssetPrecision = swap.sellAsset.precision ?? THORCHAIN_PRECISION
      const firstCoinAmount = coins?.[0]?.amount
      const verifiedSellAmountCryptoBaseUnit = firstCoinAmount
        ? thorchainToNativePrecision(firstCoinAmount, sellAssetPrecision)
        : undefined

      this.logger.log(
        `Thorchain verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      )

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Thorchain,
        swapId,
        details: {
          txHash,
          memo,
          observedTx,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Thorchain for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Thorchain,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch Thorchain data from node',
      }
    }
  }

  private async verifyMaya(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined

    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Mayachain,
        swapId,
        error: 'Missing txHash for Maya verification',
      }
    }

    try {
      // SECURITY: Query Maya node API to verify memo contains affiliate info
      const nodeUrl = process.env.VITE_MAYACHAIN_NODE_URL || 'https://mayanode.mayachain.info'
      const txUrl = `${nodeUrl}/mayachain/tx/${txHash}`

      this.logger.log(`Maya - Fetching tx from node API: ${txUrl}`)

      const response = await firstValueFrom(this.httpService.get<ThorchainMayaTxResponse>(txUrl))

      const observedTx = response.data?.observed_tx

      if (!observedTx || !observedTx.tx) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Mayachain,
          swapId,
          error: 'No observed transaction found',
        }
      }

      const memo: string | undefined = observedTx.tx.memo
      if (!memo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Mayachain,
          swapId,
          error: 'No memo found in transaction',
        }
      }

      // Parse memo format: =:r:maya1dz68dtlzrxnjflha9vvs7yt7p77mqdnf5yugww:131082237:ss:0
      // The affiliate code is after the 4th colon, followed by fee in bps
      const shapeshiftAffiliate = process.env.SHAPESHIFT_MAYA_AFFILIATE || 'ssmaya'
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i')
      const memoMatch = memo.match(memoPattern)

      const hasShapeshiftAffiliate = !!memoMatch
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined

      const coins = observedTx.tx.coins
      const sellAssetPrecision = swap.sellAsset.precision ?? THORCHAIN_PRECISION
      const firstCoinAmount = coins?.[0]?.amount
      const verifiedSellAmountCryptoBaseUnit = firstCoinAmount
        ? thorchainToNativePrecision(firstCoinAmount, sellAssetPrecision)
        : undefined

      this.logger.log(
        `Maya verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      )

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Mayachain,
        swapId,
        details: {
          txHash,
          memo,
          observedTx,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Maya for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Mayachain,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch Maya data from node',
      }
    }
  }

  private async verifyChainflip(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const metadata = swap.metadata as Record<string, any>
    const chainflipSwapId = metadata?.chainflipSwapId as string | undefined

    if (!chainflipSwapId) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Chainflip,
        swapId,
        error: 'Missing chainflipSwapId in metadata',
      }
    }

    try {
      const chainflipApiUrl = process.env.VITE_CHAINFLIP_API_URL || 'https://api.chainflip.io'
      const statusUrl = `${chainflipApiUrl}/swaps/${chainflipSwapId}`

      const headers: Record<string, string> = {}
      const apiKey = process.env.VITE_CHAINFLIP_API_KEY
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await firstValueFrom(this.httpService.get<ChainflipSwapResponse>(statusUrl, { headers }))

      const swapData = response.data

      if (!swapData) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Chainflip,
          swapId,
          error: 'No swap data found from Chainflip API',
        }
      }

      // Check for affiliate information in the swap data
      const affiliate = swapData.affiliate || swapData.affiliateName
      const affiliateBps = swapData.affiliateBps || swapData.affiliateFee

      const shapeshiftAffiliate = process.env.SHAPESHIFT_CHAINFLIP_AFFILIATE || 'shapeshift'
      const hasShapeshiftAffiliate = affiliate?.toLowerCase() === shapeshiftAffiliate.toLowerCase()

      const verifiedSellAmountCryptoBaseUnit = (
        swapData.depositAmount ??
        swapData.ingressAmount ??
        swapData.sourceAmount
      )?.toString()

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? parseInt(String(affiliateBps)) : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Chainflip,
        swapId,
        details: {
          chainflipSwapId,
          affiliate,
          swapData,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Chainflip for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Chainflip,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch Chainflip swap data',
      }
    }
  }

  private async verifyZrx(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>
    const tradeHash = txHash || (metadata?.tradeHash as string | undefined) || (metadata?.txHash as string | undefined)

    if (!tradeHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Zrx,
        swapId,
        error: 'Missing tradeHash in metadata',
      }
    }

    try {
      // Use 0x Trade Analytics API via ShapeShift proxy to verify the trade
      const zrxProxyUrl = process.env.ZRX_PROXY_URL || 'https://api.proxy.shapeshift.com/api/v1/zrx'
      const requestUrl = `${zrxProxyUrl}/trade-analytics/swap?txHash=${tradeHash}`

      const response = await firstValueFrom(this.httpService.get<ZrxTrade[] | ZrxApiResponse>(requestUrl))

      const trades: ZrxTrade[] = Array.isArray(response.data)
        ? response.data
        : response.data?.trades || response.data?.results || []

      const trade = trades.find(
        (t: ZrxTrade) =>
          t.txHash?.toLowerCase() === tradeHash.toLowerCase() ||
          t.transactionHash?.toLowerCase() === tradeHash.toLowerCase(),
      )

      if (!trade) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Zrx,
          swapId,
          error: `Trade not found in 0x analytics (searched ${trades.length} trades)`,
        }
      }

      // Check for ShapeShift's partner/integrator name
      // The field could be integratorId, integratorName, or affiliateName
      const integratorId = trade.integratorId || trade.integratorName || trade.affiliateName
      const shapeshiftIntegrator = process.env.SHAPESHIFT_0X_INTEGRATOR || 'ShapeShift'
      const hasShapeshiftAffiliate = integratorId?.toLowerCase() === shapeshiftIntegrator.toLowerCase()

      // Extract fee information
      // The fee could be in integratorFee, affiliateFee, or partnerFee fields
      // Note: 0x fees are typically in decimal format (e.g., 0.0015 for 15 bps)
      const integratorFee = trade.integratorFee || trade.affiliateFee || trade.partnerFee
      let affiliateBps: number | undefined

      if (integratorFee) {
        // Convert decimal fee to basis points (e.g., 0.0015 -> 15 bps)
        affiliateBps = parseFloat(integratorFee) * 10000
      }

      const verifiedSellAmountCryptoBaseUnit = (trade.sellAmount ?? trade.inputTokenAmount ?? trade.amount)?.toString()

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftIntegrator : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Zrx,
        swapId,
        details: {
          tradeHash,
          integratorId,
          integratorFee,
          trade,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying 0x for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Zrx,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify 0x trade',
      }
    }
  }

  private async verifyBebop(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined

    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Bebop,
        swapId,
        error: 'Missing txHash for Bebop verification',
      }
    }

    try {
      // Use trade history API to find the trade by source filter
      const bebopApiUrl = process.env.VITE_BEBOP_API_URL || 'https://api.bebop.xyz'
      const shapeshiftSource = process.env.SHAPESHIFT_BEBOP_SOURCE || 'shapeshift'

      // Get swap timestamp to create time range (swap createdAt +/- 1 hour)
      const swapTimestamp = swap.createdAt.getTime()
      const oneHour = 60 * 60 * 1000
      const startNano = (swapTimestamp - oneHour) * 1_000_000 // Convert to nanoseconds
      const endNano = (swapTimestamp + oneHour) * 1_000_000

      // Query trade history with source filter and time range
      const queryParams = new URLSearchParams({
        start: startNano.toString(),
        end: endNano.toString(),
        source: shapeshiftSource,
      })

      // Need source-auth header with API key to query by source
      const apiKey = process.env.VITE_BEBOP_API_KEY
      if (!apiKey) {
        this.logger.error('Missing VITE_BEBOP_API_KEY for Bebop verification')
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Bebop,
          swapId,
          error: 'Missing VITE_BEBOP_API_KEY for source authentication',
        }
      }

      const headers = {
        'source-auth': apiKey,
      }

      const requestUrl = `${bebopApiUrl}/history/v2/trades?${queryParams.toString()}`

      // Log request details
      this.logger.log(`Bebop API Request - URL: ${requestUrl}`)
      this.logger.log(
        `Bebop API Request - Params: ${JSON.stringify({
          start: startNano.toString(),
          end: endNano.toString(),
          source: shapeshiftSource,
          swapTimestamp: new Date(swapTimestamp).toISOString(),
        })}`,
      )
      this.logger.log(`Bebop API Request - Headers: { 'source-auth': '[REDACTED]' }`)
      this.logger.log(`Bebop API Request - Looking for txHash: ${txHash}`)

      const response = await firstValueFrom(this.httpService.get<BebopTradesResponse>(requestUrl, { headers }))

      this.logger.log(`Bebop API Response - Status: ${response.status}`)
      this.logger.log(`Bebop API Response - Data: ${JSON.stringify(response.data)}`)

      const trades = response.data?.results || []
      this.logger.log(`Bebop API Response - Found ${trades.length} trades`)

      const trade = trades.find((t: BebopTrade) => t.txHash?.toLowerCase() === txHash.toLowerCase())

      if (!trade) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.Bebop,
          swapId,
          error: 'Trade not found in Bebop history',
        }
      }

      // Since we filtered by source=shapeshift, finding the trade means it was made through ShapeShift
      const hasShapeshiftAffiliate = true

      // Extract partner fee from the response (partnerFeeBps is in basis points)
      const partnerFeeBps = trade.partnerFeeBps
      const affiliateBps = partnerFeeBps != null ? Number(partnerFeeBps) : undefined

      const sellTokenEntries = trade.sellTokens ? Object.values(trade.sellTokens) : []
      const verifiedSellAmountCryptoBaseUnit = sellTokenEntries[0]?.amount?.toString() ?? undefined

      this.logger.log(`Bebop verification: trade found, partnerFeeBps=${partnerFeeBps}, hasAffiliate=true`)

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: shapeshiftSource,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Bebop,
        swapId,
        details: {
          txHash,
          trade,
          partnerFeeBps,
          partnerFeeNative: trade.partnerFeeNative,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Bebop for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Bebop,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify Bebop trade',
      }
    }
  }

  private verifyArbitrumBridge(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    this.logger.log(`ArbitrumBridge verification for swap ${swapId}: no affiliate fees supported`)

    return Promise.resolve({
      isVerified: true,
      hasAffiliate: false,
      swapperName: SwapperName.ArbitrumBridge,
      swapId,
      details: {
        note: 'ArbitrumBridge does not support affiliate fees',
      },
    })
  }

  private async verifyButterSwap(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.ButterSwap,
        swapId,
        error: 'Missing txHash for ButterSwap verification',
      }
    }

    try {
      const apiUrl = `https://bs-app-api.chainservice.io/api/queryBridgeInfoBySourceHash?hash=${txHash}`

      this.logger.log(`ButterSwap - Fetching bridge info from API: ${apiUrl}`)

      const response = await firstValueFrom(this.httpService.get<ButterBridgeInfoApiResponse>(apiUrl))

      const bridgeInfo = response.data?.data?.info

      if (!bridgeInfo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          swapperName: SwapperName.ButterSwap,
          swapId,
          error: 'No bridge info found',
        }
      }

      const entrance = bridgeInfo.entrance
      const shapeshiftEntrance = process.env.SHAPESHIFT_BUTTERSWAP_ENTRANCE || 'shapeshift'
      const hasShapeshiftAffiliate = entrance?.toLowerCase() === shapeshiftEntrance.toLowerCase()

      const affiliateBps = swap.affiliateBps ?? undefined

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `ButterSwap verification for swap ${swapId}: entrance=${entrance}, hasAffiliate=${hasShapeshiftAffiliate}`,
      )

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.ButterSwap,
        swapId,
        details: {
          txHash,
          entrance,
          bridgeInfo,
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying ButterSwap for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.ButterSwap,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify ButterSwap trade',
      }
    }
  }

  private verifyCetus(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Cetus,
        swapId,
        error: 'Missing txHash for Cetus verification',
      })
    }

    try {
      // TODO: Implement on-chain/API verification for Cetus
      const affiliateBps = swap.affiliateBps ?? undefined
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `Cetus verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}`,
      )

      return Promise.resolve({
        isVerified: false,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Cetus,
        swapId,
        details: {
          txHash,
          affiliateBps,
          verificationMethod: 'client_metadata_only',
        },
      })
    } catch (error) {
      this.logger.error(`Error verifying Cetus for swap ${swapId}:`, error)
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Cetus,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify Cetus trade',
      })
    }
  }

  private verifySunio(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Sunio,
        swapId,
        error: 'Missing txHash for Sun.io verification',
      })
    }

    try {
      // TODO: Implement on-chain/API verification for Sun.io
      const affiliateBps = swap.affiliateBps ?? undefined
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `Sun.io verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}`,
      )

      return Promise.resolve({
        isVerified: false,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Sunio,
        swapId,
        details: {
          txHash,
          affiliateBps,
          verificationMethod: 'client_metadata_only',
        },
      })
    } catch (error) {
      this.logger.error(`Error verifying Sun.io for swap ${swapId}:`, error)
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Sunio,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify Sun.io trade',
      })
    }
  }

  private verifyAvnu(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Avnu,
        swapId,
        error: 'Missing txHash for AVNU verification',
      })
    }

    try {
      // TODO: Implement on-chain/API verification for AVNU
      const affiliateBps = swap.affiliateBps ?? undefined
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0
      const affiliateAddress = swap.affiliateAddress ?? undefined

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `AVNU verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}, integratorFeeRecipient=${affiliateAddress}`,
      )

      return Promise.resolve({
        isVerified: false,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Avnu,
        swapId,
        details: {
          txHash,
          affiliateBps,
          integratorFeeRecipient: affiliateAddress,
          verificationMethod: 'client_metadata_only',
        },
      })
    } catch (error) {
      this.logger.error(`Error verifying AVNU for swap ${swapId}:`, error)
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Avnu,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify AVNU trade',
      })
    }
  }

  private verifyStonfi(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Stonfi,
        swapId,
        error: 'Missing txHash for STON.fi verification',
      })
    }

    try {
      // TODO: Implement on-chain/API verification for STON.fi
      const stonfiSpecific = metadata?.stonfiSpecific as StonfiQuoteMetadata | undefined

      const referrerAddress = stonfiSpecific?.referrerAddress
      const referrerFeeUnits = stonfiSpecific?.referrerFeeUnits

      const affiliateBps = swap.affiliateBps ?? stonfiSpecific?.referrerFeeBps ?? undefined

      const hasAffiliate = !!referrerAddress && (affiliateBps !== undefined ? affiliateBps > 0 : false)

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `STON.fi verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}, referrerAddress=${referrerAddress}`,
      )

      return Promise.resolve({
        isVerified: false,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress: referrerAddress,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Stonfi,
        swapId,
        details: {
          txHash,
          referrerAddress,
          referrerFeeUnits,
          stonfiSpecific: metadata?.stonfiSpecific as Record<string, unknown> | undefined,
          verificationMethod: 'client_metadata_only',
        },
      })
    } catch (error) {
      this.logger.error(`Error verifying STON.fi for swap ${swapId}:`, error)
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Stonfi,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify STON.fi trade',
      })
    }
  }

  private async verifyAcross(swap: Swap): Promise<SwapVerificationResult> {
    const { swapId } = swap
    const txHash = swap.sellTxHash || undefined
    const metadata = swap.metadata as Record<string, any>

    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Across,
        swapId,
        error: 'Missing txHash for Across verification',
      }
    }

    try {
      const acrossApiUrl = process.env.VITE_ACROSS_API_URL || 'https://app.across.to/api'
      const statusUrl = `${acrossApiUrl}/deposit/status?depositTxnRef=${txHash}`

      this.logger.log(`Across - Fetching deposit status from API: ${statusUrl}`)

      const response = await firstValueFrom(this.httpService.get<AcrossDepositStatusResponse>(statusUrl))

      // TODO: Implement on-chain/API verification for Across
      const depositStatus = response.data

      const affiliateBps = swap.affiliateBps ?? undefined
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0

      const affiliateAddress =
        (metadata?.appFeeRecipient as string | undefined) || (metadata?.integratorId as string | undefined)

      const fillTxnRef = depositStatus?.fillTxnRef

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as string | undefined) ?? swap.sellAmountCryptoBaseUnit
      )?.toString()

      this.logger.log(
        `Across verification for swap ${swapId}: status=${depositStatus?.status}, hasAffiliate=${hasAffiliate}, affiliateBps=${affiliateBps}`,
      )

      return {
        isVerified: false,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        swapperName: SwapperName.Across,
        swapId,
        details: {
          txHash,
          fillTxnRef,
          depositStatus,
          integratorId: metadata?.integratorId as string | undefined,
          appFeeRecipient: metadata?.appFeeRecipient as string | undefined,
          verificationMethod: 'client_metadata_only',
        },
      }
    } catch (error) {
      this.logger.error(`Error verifying Across for swap ${swapId}:`, error)
      return {
        isVerified: false,
        hasAffiliate: false,
        swapperName: SwapperName.Across,
        swapId,
        error: error instanceof Error ? error.message : 'Failed to verify Across deposit',
      }
    }
  }
}
