import { Injectable, Logger } from '@nestjs/common';
import { SwapVerificationResult } from '@shapeshift/shared-types';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  OneClickService,
  OpenAPI,
} from '@defuse-protocol/one-click-sdk-typescript';
import {
  assertGetCowNetwork,
  getTreasuryAddressFromChainId,
} from '@shapeshiftoss/swapper';

interface ThorchainMayaTxResponse {
  observed_tx?: {
    tx?: {
      memo?: string;
      coins?: Array<{ amount?: string }>;
    };
  };
}

interface RelayAppFee {
  bps?: string;
  recipient?: string;
}

interface RelayRequest {
  referrer?: string;
  data?: {
    appFees?: RelayAppFee[];
    paidAppFees?: RelayAppFee[];
    inTxs?: Array<{ data?: { value?: string } }>;
    metadata?: { currencyIn?: { amount?: string } };
  };
}

interface RelayRequestsResponse {
  requests?: RelayRequest[];
}

interface CowSwapAppDataResponse {
  fullAppData: string;
}

interface CowSwapDecodedAppData {
  appCode?: string;
  metadata?: {
    partnerFee?: {
      bps?: number;
      recipient?: string;
    };
  };
}

interface CowSwapOrderResponse {
  executedSellAmountBeforeFees?: string;
  executedSellAmount?: string;
}

interface PortalsOrderResponse {
  context?: {
    partner?: string;
    inputAmount?: string;
    feeAmount?: string;
    feeAmountUsd?: string;
  };
}

interface ChainflipSwapResponse {
  affiliate?: string;
  affiliateName?: string;
  affiliateBps?: string;
  affiliateFee?: string;
  depositAmount?: string;
  ingressAmount?: string;
  sourceAmount?: string;
}

interface ZrxTrade {
  txHash?: string;
  transactionHash?: string;
  integratorId?: string;
  integratorName?: string;
  affiliateName?: string;
  integratorFee?: string;
  affiliateFee?: string;
  partnerFee?: string;
  sellAmount?: string;
  inputTokenAmount?: string;
  amount?: string;
}

interface ZrxApiResponse {
  trades?: ZrxTrade[];
  results?: ZrxTrade[];
}

interface BebopTrade {
  txHash?: string;
  partnerFeeBps?: number;
  sellTokens?: Record<string, { amount?: string }>;
  partnerFeeNative?: string;
}

interface BebopTradesResponse {
  results?: BebopTrade[];
}

interface ButterBridgeInfo {
  state?: number;
  toHash?: string;
  relayerHash?: string;
  entrance?: string;
  sourceHash?: string;
  relayerChain?: { scanUrl?: string };
}

interface ButterBridgeInfoApiResponse {
  code?: number;
  data?: {
    info?: ButterBridgeInfo;
  };
}

interface AcrossDepositStatusResponse {
  status?: 'filled' | 'pending' | 'expired' | 'refunded' | 'slowFillRequested';
  fillTxnRef?: string;
  depositTxnRef?: string;
  destinationChainId?: number;
  originChainId?: number;
  depositId?: number;
}

interface StonfiQuoteMetadata {
  quoteId?: string;
  referrerAddress?: string;
  referrerFeeUnits?: string;
  referrerFeeBps?: number;
}

const THORCHAIN_PRECISION = 8;

const thorchainToNativePrecision = (
  thorchainAmount: string,
  nativePrecision: number,
): string => {
  const diff = nativePrecision - THORCHAIN_PRECISION;
  if (diff === 0) return thorchainAmount;
  if (diff > 0) return thorchainAmount + '0'.repeat(diff);
  const trimmed = thorchainAmount.slice(0, diff);
  return trimmed || '0';
};

@Injectable()
export class SwapVerificationService {
  private readonly logger = new Logger(SwapVerificationService.name);
  private oneClickServiceInitialized = false;

  constructor(private readonly httpService: HttpService) {}

  private initializeOneClickService(apiKey: string) {
    if (this.oneClickServiceInitialized) return;

    const oneClickBaseUrl = 'https://1click.chaindefuser.com';
    OpenAPI.BASE = oneClickBaseUrl;
    OpenAPI.TOKEN = apiKey;

    this.oneClickServiceInitialized = true;
    this.logger.log('OneClickService initialized');
  }

  async verifySwapAffiliate(
    swapId: string,
    protocol: string,
    sellChainId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    try {
      this.logger.log(
        `Verifying affiliate for swap ${swapId} on protocol ${protocol}`,
      );

      switch (protocol.toLowerCase()) {
        case 'near':
        case 'nearintents':
        case 'near intents':
          return await this.verifyNearIntents(swapId, metadata);

        case 'relay':
          return await this.verifyRelay(
            swapId,
            (metadata?.relayTransactionMetadata as { relayId: string }).relayId,
          );

        case 'cow swap':
          return await this.verifyCowSwap(
            swapId,
            sellChainId,
            txHash,
            metadata,
          );

        case 'portals':
          return await this.verifyPortals(swapId, sellChainId, metadata);

        case 'thorchain':
          return await this.verifyThorchain(swapId, txHash, metadata);

        case 'maya':
        case 'mayachain':
          return await this.verifyMaya(swapId, txHash, metadata);

        case 'chainflip':
          return await this.verifyChainflip(swapId, metadata);

        case '0x':
        case 'zrx':
          return await this.verifyZrx(swapId, txHash, metadata);

        case 'bebop':
          return await this.verifyBebop(swapId, txHash, metadata);

        case 'jupiter':
          return await this.verifyJupiter(swapId, txHash, metadata);

        case 'arbitrum bridge':
          return await this.verifyArbitrumBridge(swapId);

        case 'butterswap':
          return await this.verifyButterSwap(swapId, txHash, metadata);

        case 'cetus':
          return await this.verifyCetus(swapId, txHash, metadata);

        case 'sun.io':
        case 'sunio':
          return await this.verifySunio(swapId, txHash, metadata);

        case 'avnu':
          return await this.verifyAvnu(swapId, txHash, metadata);

        case 'ston.fi':
        case 'stonfi':
          return await this.verifyStonfi(swapId, txHash, metadata);

        case 'across':
          return await this.verifyAcross(swapId, txHash, metadata);

        default:
          return {
            isVerified: false,
            hasAffiliate: false,
            protocol,
            swapId,
            error: `Verification not implemented for protocol: ${protocol}`,
          };
      }
    } catch (error) {
      this.logger.error(
        `Error verifying swap ${swapId} for protocol ${protocol}:`,
        error,
      );
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol,
        swapId,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async verifyNearIntents(
    swapId: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    // NEAR intents uses depositAddress to query execution status
    // The depositAddress is stored in nearIntentsSpecific metadata

    const depositAddress = (
      metadata?.nearIntentsSpecific as { depositAddress?: string } | undefined
    )?.depositAddress;

    if (!depositAddress) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'near',
        swapId,
        error: 'Missing depositAddress in metadata.nearIntentsSpecific',
      };
    }

    try {
      // Initialize OneClickService with API key (same approach as web)
      const apiKey = process.env.VITE_NEAR_INTENTS_API_KEY;
      if (!apiKey) {
        this.logger.error(
          'Missing VITE_NEAR_INTENTS_API_KEY for NEAR Intents verification',
        );
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'near',
          swapId,
          error: 'Missing VITE_NEAR_INTENTS_API_KEY',
        };
      }

      this.initializeOneClickService(apiKey);

      const statusResponse =
        await OneClickService.getExecutionStatus(depositAddress);

      if (!statusResponse) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'near',
          swapId,
          error: 'No execution status found',
        };
      }

      // Check if the quote request contains affiliate fees
      // SDK structure: statusResponse.quoteResponse.quoteRequest
      const quoteRequest = statusResponse.quoteResponse?.quoteRequest;

      // Verify it's ShapeShift's affiliate
      // The referral field should be 'shapeshift' from the quote request
      const referral = quoteRequest?.referral;
      const shapeshiftReferral =
        process.env.SHAPESHIFT_NEAR_REFERRAL || 'shapeshift';
      const hasShapeshiftReferral =
        referral?.toLowerCase() === shapeshiftReferral.toLowerCase();

      // Check if there are app fees
      const appFees = quoteRequest?.appFees || [];
      const hasAppFees = appFees.length > 0;

      const hasShapeshiftAffiliate = hasShapeshiftReferral && hasAppFees;

      // Extract fee amount if present
      let affiliateBps: number | undefined;
      if (hasAppFees && appFees[0]) {
        affiliateBps = appFees[0].fee;
      }

      const swapDetails = (
        statusResponse as unknown as {
          swapDetails?: { depositedAmount?: string; amountIn?: string };
        }
      ).swapDetails;
      const quoteAmounts = statusResponse.quoteResponse?.quote;
      let verifiedSellAmountCryptoBaseUnit: string | undefined;

      const rawDepositedAmount: string | undefined =
        swapDetails?.depositedAmount ??
        swapDetails?.amountIn ??
        quoteAmounts?.amountIn;
      if (rawDepositedAmount) {
        const sellAssetPrecision = metadata?.sellAssetPrecision as
          | number
          | undefined;
        if (sellAssetPrecision && rawDepositedAmount.includes('.')) {
          const [whole, frac = ''] = rawDepositedAmount.split('.');
          verifiedSellAmountCryptoBaseUnit =
            whole +
            frac.padEnd(sellAssetPrecision, '0').slice(0, sellAssetPrecision);
        } else {
          verifiedSellAmountCryptoBaseUnit = rawDepositedAmount;
        }
      }

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate
          ? shapeshiftReferral
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'near',
        swapId,
        details: {
          depositAddress,
          referral,
          appFees,
          quoteRequest,
          swapDetails,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error verifying NEAR intents for swap ${swapId}:`,
        error,
      );
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'near',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch NEAR intents status',
      };
    }
  }

  private async verifyRelay(
    swapId: string,
    txHash?: string,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'relay',
        swapId,
        error: 'Missing txHash for Relay verification',
      };
    }

    try {
      const relayApiUrl =
        process.env.VITE_RELAY_API_URL || 'https://api.relay.link';
      const requestUrl = `${relayApiUrl}/requests/v2?id=${txHash}`;

      const response = await firstValueFrom(
        this.httpService.get<RelayRequestsResponse>(requestUrl),
      );

      const requests = response.data?.requests;

      if (!requests || requests.length === 0) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'relay',
          swapId,
          error: 'No request data found from Relay API',
        };
      }

      const request = requests[0];

      // Check for referrer field at top level
      const referrer = request.referrer;
      const shapeshiftReferrer =
        process.env.SHAPESHIFT_RELAY_REFERRER || 'shapeshift';
      const hasShapeshiftReferrer =
        referrer?.toLowerCase() === shapeshiftReferrer.toLowerCase();

      // Check for appFees or paidAppFees in the data object
      const appFees = request.data?.appFees || request.data?.paidAppFees || [];

      // Extract affiliate info from appFees
      let affiliateBps: number | undefined;
      let affiliateAddress: string | undefined;

      if (appFees.length > 0) {
        // Get the first app fee entry (should be ShapeShift's)
        const fee = appFees[0];
        affiliateBps = fee.bps ? parseInt(fee.bps) : undefined;
        affiliateAddress = fee.recipient;
      }

      // Verification is successful if we have shapeshift as referrer AND we have app fees
      const hasShapeshiftAffiliate =
        hasShapeshiftReferrer && appFees.length > 0;

      const verifiedSellAmountCryptoBaseUnit =
        request.data?.inTxs?.[0]?.data?.value?.toString() ??
        request.data?.metadata?.currencyIn?.amount?.toString() ??
        undefined;

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'relay',
        swapId,
        details: {
          txHash,
          referrer,
          appFees,
          request,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Relay for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'relay',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch Relay request data',
      };
    }
  }

  private async verifyCowSwap(
    swapId: string,
    sellChainId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    // SECURITY: Always verify appData from CowSwap API using appDataHash
    // to prevent users from pushing fake data to abuse the referral system
    const appDataHash = (
      metadata?.cowswapQuoteSpecific as
        | { quote?: { appDataHash?: string } }
        | undefined
    )?.quote?.appDataHash;

    if (!appDataHash) {
      this.logger.warn(`CowSwap - Missing appDataHash for swap ${swapId}`);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'cowswap',
        swapId,
        error: 'Missing appDataHash in metadata',
      };
    }

    try {
      // ALWAYS fetch appData from CowSwap API to verify it's legitimate
      this.logger.log(
        `CowSwap - Fetching appData from API using hash ${appDataHash} for swap ${swapId}`,
      );
      const cowswapApiUrl =
        process.env.VITE_COWSWAP_BASE_URL || 'https://api.cow.fi';
      const cowNetwork = assertGetCowNetwork(sellChainId);
      const response = await firstValueFrom(
        this.httpService.get<CowSwapAppDataResponse>(
          `${cowswapApiUrl}/${cowNetwork}/api/v1/app_data/${appDataHash}`,
        ),
      );

      const decodedAppData = JSON.parse(
        response.data.fullAppData,
      ) as CowSwapDecodedAppData;

      // Check if appCode is "shapeshift"
      const appCode = decodedAppData?.appCode;
      const shapeshiftAppCode =
        process.env.SHAPESHIFT_COWSWAP_APPCODE || 'shapeshift';
      const hasShapeshiftAppCode =
        appCode?.toLowerCase() === shapeshiftAppCode.toLowerCase();

      // Extract partner fee information from metadata.partnerFee
      const partnerFee = decodedAppData?.metadata?.partnerFee;
      const affiliateBps = partnerFee?.bps;
      const affiliateAddress = partnerFee?.recipient;

      // We have ShapeShift affiliate if appCode is shapeshift AND we have partnerFee
      const hasShapeshiftAffiliate = hasShapeshiftAppCode && !!partnerFee;

      let verifiedSellAmountCryptoBaseUnit: string | undefined;
      const orderUid =
        txHash || (metadata?.cowswapOrderUid as string | undefined);
      if (orderUid) {
        try {
          const orderResponse = await firstValueFrom(
            this.httpService.get<CowSwapOrderResponse>(
              `${cowswapApiUrl}/${cowNetwork}/api/v1/orders/${orderUid}`,
            ),
          );
          verifiedSellAmountCryptoBaseUnit =
            orderResponse.data?.executedSellAmountBeforeFees?.toString() ??
            orderResponse.data?.executedSellAmount?.toString();
        } catch (orderErr) {
          this.logger.warn(
            `CowSwap - Failed to fetch order ${orderUid} for amount verification:`,
            orderErr,
          );
        }
      }

      this.logger.log(
        `CowSwap verification for swap ${swapId}: appCode=${appCode}, hasPartnerFee=${!!partnerFee}, bps=${affiliateBps}, verified=${hasShapeshiftAffiliate}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps:
          hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? affiliateAddress : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'cowswap',
        swapId,
        details: {
          appCode,
          partnerFee,
          decodedAppData,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying CowSwap for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'cowswap',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to decode CowSwap appData',
      };
    }
  }

  private async verifyPortals(
    swapId: string,
    sellChainId: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    // SECURITY: Always verify partner address from Portals API using orderId
    // to prevent users from pushing fake data to abuse the referral system

    // Get the orderId from the swap (stored as the quote id)
    const orderId = (
      metadata?.portalsTransactionMetadata as { orderId?: string } | undefined
    )?.orderId;

    if (!orderId) {
      this.logger.warn(`Portals - Missing orderId for swap ${swapId}`);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'portals',
        swapId,
        error: 'Missing orderId in metadata',
      };
    }

    // Get the expected treasury address for this chain
    let expectedTreasuryAddress: string;
    try {
      expectedTreasuryAddress = getTreasuryAddressFromChainId(sellChainId);
    } catch {
      this.logger.warn(
        `Portals - Unsupported chain for treasury address: ${sellChainId}`,
      );
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'portals',
        swapId,
        error: `Unsupported chain for treasury address: ${sellChainId}`,
      };
    }

    try {
      // ALWAYS fetch order status from Portals API to verify it's legitimate
      this.logger.log(
        `Portals - Fetching order status from API using orderId ${orderId} for swap ${swapId}`,
      );
      const portalsProxyUrl =
        process.env.PORTALS_PROXY_URL ||
        'https://api.proxy.shapeshift.com/api/v1/portals';
      const response = await firstValueFrom(
        this.httpService.get<PortalsOrderResponse>(
          `${portalsProxyUrl}/v2/portal/status?orderId=${orderId}`,
        ),
      );

      const orderData = response.data;
      this.logger.log(
        `Portals - Fetched and verified order from API for swap ${swapId}`,
      );

      // Get partner from the API response context
      const partner = orderData?.context?.partner;

      if (!partner) {
        this.logger.warn(
          `Portals - No partner found in API response for swap ${swapId}`,
        );
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'portals',
          swapId,
          error: 'No partner found in Portals API response',
        };
      }

      // Verify partner matches the expected treasury address (case-insensitive for EVM addresses)
      const hasShapeshiftAffiliate =
        partner.toLowerCase() === expectedTreasuryAddress.toLowerCase();

      // Extract fee information from the order context
      // feeAmount and feeAmountUsd are in the context
      const feeAmount = orderData?.context?.feeAmount;
      const feeAmountUsd = orderData?.context?.feeAmountUsd;

      const verifiedSellAmountCryptoBaseUnit =
        orderData?.context?.inputAmount?.toString() ?? undefined;

      this.logger.log(
        `Portals verification for swap ${swapId}: partner=${partner}, expectedTreasury=${expectedTreasuryAddress}, verified=${hasShapeshiftAffiliate}, feeAmount=${feeAmount}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: metadata?.affiliateBps
          ? parseInt(metadata.affiliateBps as string)
          : undefined,
        affiliateAddress: hasShapeshiftAffiliate
          ? expectedTreasuryAddress
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'portals',
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
      };
    } catch (error) {
      this.logger.error(`Error verifying Portals for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'portals',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Portals order',
      };
    }
  }

  private async verifyThorchain(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'thorchain',
        swapId,
        error: 'Missing txHash for Thorchain verification',
      };
    }

    try {
      // SECURITY: Query Thorchain node API to verify memo contains affiliate info
      const nodeUrl =
        process.env.VITE_THORCHAIN_NODE_URL ||
        'https://thornode.ninerealms.com';
      const txUrl = `${nodeUrl}/thorchain/tx/${txHash}`;

      this.logger.log(`Thorchain - Fetching tx from node API: ${txUrl}`);

      const response = await firstValueFrom(
        this.httpService.get<ThorchainMayaTxResponse>(txUrl),
      );

      const observedTx = response.data?.observed_tx;

      if (!observedTx || !observedTx.tx) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'thorchain',
          swapId,
          error: 'No observed transaction found',
        };
      }

      const memo: string | undefined = observedTx.tx.memo;
      if (!memo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'thorchain',
          swapId,
          error: 'No memo found in transaction',
        };
      }

      // Parse memo format: =:r:thor1dz68dtlzrxnjflha9vvs7yt7p77mqdnf5yugww:131082237:ss:0
      // The affiliate code is after the 4th colon, followed by fee in bps
      const shapeshiftAffiliate =
        process.env.SHAPESHIFT_THORCHAIN_AFFILIATE || 'ss';
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i');
      const memoMatch = memo.match(memoPattern);

      const hasShapeshiftAffiliate = !!memoMatch;
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined;

      const coins = observedTx.tx.coins;
      const sellAssetPrecision =
        (metadata?.sellAssetPrecision as number | undefined) ??
        THORCHAIN_PRECISION;
      const firstCoinAmount = coins?.[0]?.amount;
      const verifiedSellAmountCryptoBaseUnit = firstCoinAmount
        ? thorchainToNativePrecision(firstCoinAmount, sellAssetPrecision)
        : undefined;

      this.logger.log(
        `Thorchain verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps:
          hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate
          ? shapeshiftAffiliate
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'thorchain',
        swapId,
        details: {
          txHash,
          memo,
          observedTx,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Thorchain for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'thorchain',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch Thorchain data from node',
      };
    }
  }

  private async verifyMaya(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'maya',
        swapId,
        error: 'Missing txHash for Maya verification',
      };
    }

    try {
      // SECURITY: Query Maya node API to verify memo contains affiliate info
      const nodeUrl =
        process.env.VITE_MAYACHAIN_NODE_URL ||
        'https://mayanode.mayachain.info';
      const txUrl = `${nodeUrl}/mayachain/tx/${txHash}`;

      this.logger.log(`Maya - Fetching tx from node API: ${txUrl}`);

      const response = await firstValueFrom(
        this.httpService.get<ThorchainMayaTxResponse>(txUrl),
      );

      const observedTx = response.data?.observed_tx;

      if (!observedTx || !observedTx.tx) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'maya',
          swapId,
          error: 'No observed transaction found',
        };
      }

      const memo: string | undefined = observedTx.tx.memo;
      if (!memo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'maya',
          swapId,
          error: 'No memo found in transaction',
        };
      }

      // Parse memo format: =:r:maya1dz68dtlzrxnjflha9vvs7yt7p77mqdnf5yugww:131082237:ss:0
      // The affiliate code is after the 4th colon, followed by fee in bps
      const shapeshiftAffiliate =
        process.env.SHAPESHIFT_MAYA_AFFILIATE || 'ssmaya';
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i');
      const memoMatch = memo.match(memoPattern);

      const hasShapeshiftAffiliate = !!memoMatch;
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined;

      const coins = observedTx.tx.coins;
      const sellAssetPrecision =
        (metadata?.sellAssetPrecision as number | undefined) ??
        THORCHAIN_PRECISION;
      const firstCoinAmount = coins?.[0]?.amount;
      const verifiedSellAmountCryptoBaseUnit = firstCoinAmount
        ? thorchainToNativePrecision(firstCoinAmount, sellAssetPrecision)
        : undefined;

      this.logger.log(
        `Maya verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps:
          hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate
          ? shapeshiftAffiliate
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'maya',
        swapId,
        details: {
          txHash,
          memo,
          observedTx,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Maya for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'maya',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch Maya data from node',
      };
    }
  }

  private async verifyChainflip(
    swapId: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    const chainflipSwapId = metadata?.chainflipSwapId as string | undefined;

    if (!chainflipSwapId) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'chainflip',
        swapId,
        error: 'Missing chainflipSwapId in metadata',
      };
    }

    try {
      const chainflipApiUrl =
        process.env.VITE_CHAINFLIP_API_URL || 'https://api.chainflip.io';
      const statusUrl = `${chainflipApiUrl}/swaps/${chainflipSwapId}`;

      const headers: Record<string, string> = {};
      const apiKey = process.env.VITE_CHAINFLIP_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.get<ChainflipSwapResponse>(statusUrl, { headers }),
      );

      const swapData = response.data;

      if (!swapData) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'chainflip',
          swapId,
          error: 'No swap data found from Chainflip API',
        };
      }

      // Check for affiliate information in the swap data
      const affiliate = swapData.affiliate || swapData.affiliateName;
      const affiliateBps = swapData.affiliateBps || swapData.affiliateFee;

      const shapeshiftAffiliate =
        process.env.SHAPESHIFT_CHAINFLIP_AFFILIATE || 'shapeshift';
      const hasShapeshiftAffiliate =
        affiliate?.toLowerCase() === shapeshiftAffiliate.toLowerCase();

      const verifiedSellAmountCryptoBaseUnit = (
        swapData.depositAmount ??
        swapData.ingressAmount ??
        swapData.sourceAmount
      )?.toString();

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps:
          hasShapeshiftAffiliate && affiliateBps
            ? parseInt(String(affiliateBps))
            : undefined,
        affiliateAddress: hasShapeshiftAffiliate
          ? shapeshiftAffiliate
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'chainflip',
        swapId,
        details: {
          chainflipSwapId,
          affiliate,
          swapData,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Chainflip for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'chainflip',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch Chainflip swap data',
      };
    }
  }

  private async verifyZrx(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    const tradeHash =
      txHash ||
      (metadata?.tradeHash as string | undefined) ||
      (metadata?.txHash as string | undefined);

    if (!tradeHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: '0x',
        swapId,
        error: 'Missing tradeHash in metadata',
      };
    }

    try {
      // Use 0x Trade Analytics API via ShapeShift proxy to verify the trade
      const zrxProxyUrl =
        process.env.ZRX_PROXY_URL ||
        'https://api.proxy.shapeshift.com/api/v1/zrx';
      const requestUrl = `${zrxProxyUrl}/trade-analytics/swap`;

      const response = await firstValueFrom(
        this.httpService.get<ZrxTrade[] | ZrxApiResponse>(requestUrl),
      );

      const trades: ZrxTrade[] = Array.isArray(response.data)
        ? response.data
        : response.data?.trades || response.data?.results || [];

      const trade = trades.find(
        (t: ZrxTrade) =>
          t.txHash?.toLowerCase() === tradeHash.toLowerCase() ||
          t.transactionHash?.toLowerCase() === tradeHash.toLowerCase(),
      );

      if (!trade) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: '0x',
          swapId,
          error: `Trade not found in 0x analytics (searched ${trades.length} trades)`,
        };
      }

      // Check for ShapeShift's partner/integrator name
      // The field could be integratorId, integratorName, or affiliateName
      const integratorId =
        trade.integratorId || trade.integratorName || trade.affiliateName;
      const shapeshiftIntegrator =
        process.env.SHAPESHIFT_0X_INTEGRATOR || 'ShapeShift';
      const hasShapeshiftAffiliate =
        integratorId?.toLowerCase() === shapeshiftIntegrator.toLowerCase();

      // Extract fee information
      // The fee could be in integratorFee, affiliateFee, or partnerFee fields
      // Note: 0x fees are typically in decimal format (e.g., 0.0015 for 15 bps)
      const integratorFee =
        trade.integratorFee || trade.affiliateFee || trade.partnerFee;
      let affiliateBps: number | undefined;

      if (integratorFee) {
        // Convert decimal fee to basis points (e.g., 0.0015 -> 15 bps)
        affiliateBps = parseFloat(integratorFee) * 10000;
      }

      const verifiedSellAmountCryptoBaseUnit = (
        trade.sellAmount ??
        trade.inputTokenAmount ??
        trade.amount
      )?.toString();

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate
          ? shapeshiftIntegrator
          : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: '0x',
        swapId,
        details: {
          tradeHash,
          integratorId,
          integratorFee,
          trade,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying 0x for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: '0x',
        swapId,
        error:
          error instanceof Error ? error.message : 'Failed to verify 0x trade',
      };
    }
  }

  private async verifyBebop(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'bebop',
        swapId,
        error: 'Missing txHash for Bebop verification',
      };
    }

    try {
      // Use trade history API to find the trade by source filter
      const bebopApiUrl =
        process.env.VITE_BEBOP_API_URL || 'https://api.bebop.xyz';
      const shapeshiftSource =
        process.env.SHAPESHIFT_BEBOP_SOURCE || 'shapeshift';

      // Get swap timestamp to create time range (swap createdAt +/- 1 hour)
      const swapTimestamp =
        (metadata?.createdAt as number | undefined) || Date.now();
      const oneHour = 60 * 60 * 1000;
      const startNano = (swapTimestamp - oneHour) * 1_000_000; // Convert to nanoseconds
      const endNano = (swapTimestamp + oneHour) * 1_000_000;

      // Query trade history with source filter and time range
      const queryParams = new URLSearchParams({
        start: startNano.toString(),
        end: endNano.toString(),
        source: shapeshiftSource,
      });

      // Need source-auth header with API key to query by source
      const apiKey = process.env.VITE_BEBOP_API_KEY;
      if (!apiKey) {
        this.logger.error('Missing VITE_BEBOP_API_KEY for Bebop verification');
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'bebop',
          swapId,
          error: 'Missing VITE_BEBOP_API_KEY for source authentication',
        };
      }

      const headers = {
        'source-auth': apiKey,
      };

      const requestUrl = `${bebopApiUrl}/history/v2/trades?${queryParams.toString()}`;

      // Log request details
      this.logger.log(`Bebop API Request - URL: ${requestUrl}`);
      this.logger.log(
        `Bebop API Request - Params: ${JSON.stringify({
          start: startNano.toString(),
          end: endNano.toString(),
          source: shapeshiftSource,
          swapTimestamp: new Date(swapTimestamp).toISOString(),
        })}`,
      );
      this.logger.log(
        `Bebop API Request - Headers: { 'source-auth': '${apiKey.substring(0, 8)}...' }`,
      );
      this.logger.log(`Bebop API Request - Looking for txHash: ${txHash}`);

      const response = await firstValueFrom(
        this.httpService.get<BebopTradesResponse>(requestUrl, { headers }),
      );

      this.logger.log(`Bebop API Response - Status: ${response.status}`);
      this.logger.log(
        `Bebop API Response - Data: ${JSON.stringify(response.data)}`,
      );

      const trades = response.data?.results || [];
      this.logger.log(`Bebop API Response - Found ${trades.length} trades`);

      const trade = trades.find(
        (t: BebopTrade) => t.txHash?.toLowerCase() === txHash.toLowerCase(),
      );

      if (!trade) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'bebop',
          swapId,
          error: 'Trade not found in Bebop history',
        };
      }

      // Since we filtered by source=shapeshift, finding the trade means it was made through ShapeShift
      const hasShapeshiftAffiliate = true;

      // Extract partner fee from the response (partnerFeeBps is in basis points)
      const partnerFeeBps = trade.partnerFeeBps;
      const affiliateBps =
        partnerFeeBps != null ? Number(partnerFeeBps) : undefined;

      const sellTokenEntries = trade.sellTokens
        ? Object.values(trade.sellTokens)
        : [];
      const verifiedSellAmountCryptoBaseUnit =
        sellTokenEntries[0]?.amount?.toString() ?? undefined;

      this.logger.log(
        `Bebop verification: trade found, partnerFeeBps=${partnerFeeBps}, hasAffiliate=true`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: shapeshiftSource,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'bebop',
        swapId,
        details: {
          txHash,
          trade,
          partnerFeeBps,
          partnerFeeNative: trade.partnerFeeNative,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Bebop for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'bebop',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Bebop trade',
      };
    }
  }

  private verifyJupiter(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'jupiter',
        swapId,
        error: 'Missing txHash for Jupiter verification',
      });
    }

    try {
      const referralKey =
        process.env.SHAPESHIFT_JUPITER_REFERRAL_KEY ||
        'Ajgmo453yGmcHDPoJBrMUj3GFwLVL7HaaZGNLkB8vREG';

      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `Jupiter verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}, referralKey=${referralKey}`,
      );

      return Promise.resolve({
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress: referralKey,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'jupiter',
        swapId,
        details: {
          txHash,
          affiliateBps: metadata?.affiliateBps as string | undefined,
          referralKey,
        },
      });
    } catch (error) {
      this.logger.error(`Error verifying Jupiter for swap ${swapId}:`, error);
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'jupiter',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Jupiter trade',
      });
    }
  }

  private verifyArbitrumBridge(
    swapId: string,
  ): Promise<SwapVerificationResult> {
    this.logger.log(
      `ArbitrumBridge verification for swap ${swapId}: no affiliate fees supported`,
    );

    return Promise.resolve({
      isVerified: true,
      hasAffiliate: false,
      protocol: 'arbitrum bridge',
      swapId,
      details: {
        note: 'ArbitrumBridge does not support affiliate fees',
      },
    });
  }

  private async verifyButterSwap(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'butterswap',
        swapId,
        error: 'Missing txHash for ButterSwap verification',
      };
    }

    try {
      const apiUrl = `https://bs-app-api.chainservice.io/api/queryBridgeInfoBySourceHash?hash=${txHash}`;

      this.logger.log(`ButterSwap - Fetching bridge info from API: ${apiUrl}`);

      const response = await firstValueFrom(
        this.httpService.get<ButterBridgeInfoApiResponse>(apiUrl),
      );

      const bridgeInfo = response.data?.data?.info;

      if (!bridgeInfo) {
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'butterswap',
          swapId,
          error: 'No bridge info found',
        };
      }

      const entrance = bridgeInfo.entrance;
      const shapeshiftEntrance =
        process.env.SHAPESHIFT_BUTTERSWAP_ENTRANCE || 'shapeshift';
      const hasShapeshiftAffiliate =
        entrance?.toLowerCase() === shapeshiftEntrance.toLowerCase();

      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `ButterSwap verification for swap ${swapId}: entrance=${entrance}, hasAffiliate=${hasShapeshiftAffiliate}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps:
          hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'butterswap',
        swapId,
        details: {
          txHash,
          entrance,
          bridgeInfo,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error verifying ButterSwap for swap ${swapId}:`,
        error,
      );
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'butterswap',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify ButterSwap trade',
      };
    }
  }

  private verifyCetus(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'cetus',
        swapId,
        error: 'Missing txHash for Cetus verification',
      });
    }

    try {
      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `Cetus verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}`,
      );

      return Promise.resolve({
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'cetus',
        swapId,
        details: {
          txHash,
          affiliateBps: metadata?.affiliateBps as string | undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Error verifying Cetus for swap ${swapId}:`, error);
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'cetus',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Cetus trade',
      });
    }
  }

  private verifySunio(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'sun.io',
        swapId,
        error: 'Missing txHash for Sun.io verification',
      });
    }

    try {
      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `Sun.io verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}`,
      );

      return Promise.resolve({
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'sun.io',
        swapId,
        details: {
          txHash,
          affiliateBps: metadata?.affiliateBps as string | undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Error verifying Sun.io for swap ${swapId}:`, error);
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'sun.io',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Sun.io trade',
      });
    }
  }

  private verifyAvnu(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'avnu',
        swapId,
        error: 'Missing txHash for AVNU verification',
      });
    }

    try {
      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0;
      const affiliateAddress = metadata?.integratorFeeRecipient as
        | string
        | undefined;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `AVNU verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}, integratorFeeRecipient=${affiliateAddress}`,
      );

      return Promise.resolve({
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'avnu',
        swapId,
        details: {
          txHash,
          affiliateBps: metadata?.affiliateBps as string | undefined,
          integratorFeeRecipient: metadata?.integratorFeeRecipient as
            | string
            | undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Error verifying AVNU for swap ${swapId}:`, error);
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'avnu',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify AVNU trade',
      });
    }
  }

  private verifyStonfi(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'ston.fi',
        swapId,
        error: 'Missing txHash for STON.fi verification',
      });
    }

    try {
      const stonfiSpecific = metadata?.stonfiSpecific as
        | StonfiQuoteMetadata
        | undefined;

      const referrerAddress = stonfiSpecific?.referrerAddress;
      const referrerFeeUnits = stonfiSpecific?.referrerFeeUnits;

      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : (stonfiSpecific?.referrerFeeBps ?? undefined);

      const hasAffiliate =
        !!referrerAddress &&
        (affiliateBps !== undefined ? affiliateBps > 0 : false);

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `STON.fi verification for swap ${swapId}: affiliateBps=${affiliateBps}, hasAffiliate=${hasAffiliate}, referrerAddress=${referrerAddress}`,
      );

      return Promise.resolve({
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress: referrerAddress,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'ston.fi',
        swapId,
        details: {
          txHash,
          referrerAddress,
          referrerFeeUnits,
          stonfiSpecific: metadata?.stonfiSpecific as
            | Record<string, unknown>
            | undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Error verifying STON.fi for swap ${swapId}:`, error);
      return Promise.resolve({
        isVerified: false,
        hasAffiliate: false,
        protocol: 'ston.fi',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify STON.fi trade',
      });
    }
  }

  private async verifyAcross(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    if (!txHash) {
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'across',
        swapId,
        error: 'Missing txHash for Across verification',
      };
    }

    try {
      const acrossApiUrl =
        process.env.VITE_ACROSS_API_URL || 'https://app.across.to/api';
      const statusUrl = `${acrossApiUrl}/deposit/status?depositTxnRef=${txHash}`;

      this.logger.log(
        `Across - Fetching deposit status from API: ${statusUrl}`,
      );

      const response = await firstValueFrom(
        this.httpService.get<AcrossDepositStatusResponse>(statusUrl),
      );

      const depositStatus = response.data;

      const affiliateBps = metadata?.affiliateBps
        ? parseInt(metadata.affiliateBps as string)
        : undefined;
      const hasAffiliate = affiliateBps !== undefined && affiliateBps > 0;

      const affiliateAddress =
        (metadata?.appFeeRecipient as string | undefined) ||
        (metadata?.integratorId as string | undefined);

      const fillTxnRef = depositStatus?.fillTxnRef;

      const verifiedSellAmountCryptoBaseUnit = (
        (metadata?.sellAmountIncludingProtocolFeesCryptoBaseUnit as
          | string
          | undefined) ?? (metadata?.sellAmount as string | undefined)
      )?.toString();

      this.logger.log(
        `Across verification for swap ${swapId}: status=${depositStatus?.status}, hasAffiliate=${hasAffiliate}, affiliateBps=${affiliateBps}`,
      );

      return {
        isVerified: true,
        hasAffiliate,
        affiliateBps: hasAffiliate ? affiliateBps : undefined,
        affiliateAddress,
        verifiedSellAmountCryptoBaseUnit,
        protocol: 'across',
        swapId,
        details: {
          txHash,
          fillTxnRef,
          depositStatus,
          integratorId: metadata?.integratorId as string | undefined,
          appFeeRecipient: metadata?.appFeeRecipient as string | undefined,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying Across for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'across',
        swapId,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to verify Across deposit',
      };
    }
  }
}
