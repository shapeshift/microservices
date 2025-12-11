import { Injectable, Logger } from '@nestjs/common';
import { SwapVerificationResult } from '@shapeshift/shared-types';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OneClickService, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';
import { assertGetCowNetwork, getTreasuryAddressFromChainId } from '@shapeshiftoss/swapper';

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
      this.logger.log(`Verifying affiliate for swap ${swapId} on protocol ${protocol}`);

      switch (protocol.toLowerCase()) {
        case 'near':
        case 'nearintents':
        case 'near intents':
          return await this.verifyNearIntents(swapId, metadata);

        case 'relay':
          return await this.verifyRelay(swapId, metadata.relayTransactionMetadata.relayId);

        case 'cow swap':
          return await this.verifyCowSwap(swapId, sellChainId, metadata);

        case 'portals':
          return await this.verifyPortals(swapId, sellChainId, metadata);

        case 'thorchain':
          return await this.verifyThorchain(swapId, txHash);

        case 'maya':
        case 'mayachain':
          return await this.verifyMaya(swapId, txHash);

        case 'chainflip':
          return await this.verifyChainflip(swapId, metadata);

        case '0x':
        case 'zrx':
          return await this.verifyZrx(swapId, txHash, metadata);

        case 'bebop':
          return await this.verifyBebop(swapId, txHash, metadata);

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
      this.logger.error(`Error verifying swap ${swapId} for protocol ${protocol}:`, error);
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

    const depositAddress = metadata?.nearIntentsSpecific?.depositAddress;

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
        this.logger.error('Missing VITE_NEAR_INTENTS_API_KEY for NEAR Intents verification');
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'near',
          swapId,
          error: 'Missing VITE_NEAR_INTENTS_API_KEY',
        };
      }

      this.initializeOneClickService(apiKey);

      const statusResponse = await OneClickService.getExecutionStatus(depositAddress);

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
      const shapeshiftReferral = process.env.SHAPESHIFT_NEAR_REFERRAL || 'shapeshift';
      const hasShapeshiftReferral = referral?.toLowerCase() === shapeshiftReferral.toLowerCase();

      // Check if there are app fees
      const appFees = quoteRequest?.appFees || [];
      const hasAppFees = appFees.length > 0;

      const hasShapeshiftAffiliate = hasShapeshiftReferral && hasAppFees;

      // Extract fee amount if present
      let affiliateBps: number | undefined;
      if (hasAppFees && appFees[0]) {
        affiliateBps = appFees[0].fee;
      }

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftReferral : undefined,
        protocol: 'near',
        swapId,
        details: {
          depositAddress,
          referral,
          appFees,
          quoteRequest,
        },
      };
    } catch (error) {
      this.logger.error(`Error verifying NEAR intents for swap ${swapId}:`, error);
      return {
        isVerified: false,
        hasAffiliate: false,
        protocol: 'near',
        swapId,
        error: error instanceof Error ? error.message : 'Failed to fetch NEAR intents status',
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
      const relayApiUrl = process.env.VITE_RELAY_API_URL || 'https://api.relay.link';
      const requestUrl = `${relayApiUrl}/requests/v2?id=${txHash}`;

      const response = await firstValueFrom(
        this.httpService.get(requestUrl),
      );

      // Response has a requests array
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
      const shapeshiftReferrer = process.env.SHAPESHIFT_RELAY_REFERRER || 'shapeshift';
      const hasShapeshiftReferrer = referrer?.toLowerCase() === shapeshiftReferrer.toLowerCase();

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
      const hasShapeshiftAffiliate = hasShapeshiftReferrer && appFees.length > 0;

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress,
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
        error: error instanceof Error ? error.message : 'Failed to fetch Relay request data',
      };
    }
  }

  private async verifyCowSwap(
    swapId: string,
    sellChainId: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    // SECURITY: Always verify appData from CowSwap API using appDataHash
    // to prevent users from pushing fake data to abuse the referral system
    const appDataHash = metadata?.cowswapQuoteSpecific?.quote?.appDataHash;

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
      this.logger.log(`CowSwap - Fetching appData from API using hash ${appDataHash} for swap ${swapId}`);
      const cowswapApiUrl = process.env.VITE_COWSWAP_BASE_URL || 'https://api.cow.fi';
      const cowNetwork = assertGetCowNetwork(sellChainId);
      const response = await firstValueFrom(
        this.httpService.get(`${cowswapApiUrl}/${cowNetwork}/api/v1/app_data/${appDataHash}`),
      );

      const decodedAppData = JSON.parse(response.data.fullAppData);

      // Check if appCode is "shapeshift"
      const appCode = decodedAppData?.appCode;
      const shapeshiftAppCode = process.env.SHAPESHIFT_COWSWAP_APPCODE || 'shapeshift';
      const hasShapeshiftAppCode = appCode?.toLowerCase() === shapeshiftAppCode.toLowerCase();

      // Extract partner fee information from metadata.partnerFee
      const partnerFee = decodedAppData?.metadata?.partnerFee;
      const affiliateBps = partnerFee?.bps;
      const affiliateAddress = partnerFee?.recipient;

      // We have ShapeShift affiliate if appCode is shapeshift AND we have partnerFee
      const hasShapeshiftAffiliate = hasShapeshiftAppCode && !!partnerFee;

      this.logger.log(
        `CowSwap verification for swap ${swapId}: appCode=${appCode}, hasPartnerFee=${!!partnerFee}, bps=${affiliateBps}, verified=${hasShapeshiftAffiliate}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? affiliateAddress : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to decode CowSwap appData',
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
    const orderId = metadata?.portalsTransactionMetadata?.orderId;

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
    } catch (error) {
      this.logger.warn(`Portals - Unsupported chain for treasury address: ${sellChainId}`);
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
      this.logger.log(`Portals - Fetching order status from API using orderId ${orderId} for swap ${swapId}`);
      const portalsProxyUrl = process.env.PORTALS_PROXY_URL || 'https://api.proxy.shapeshift.com/api/v1/portals';
      const response = await firstValueFrom(
        this.httpService.get(`${portalsProxyUrl}/v2/portal/status?orderId=${orderId}`),
      );

      const orderData = response.data;
      this.logger.log(`Portals - Fetched and verified order from API for swap ${swapId}`);

      // Get partner from the API response context
      const partner = orderData?.context?.partner;

      if (!partner) {
        this.logger.warn(`Portals - No partner found in API response for swap ${swapId}`);
        return {
          isVerified: false,
          hasAffiliate: false,
          protocol: 'portals',
          swapId,
          error: 'No partner found in Portals API response',
        };
      }

      // Verify partner matches the expected treasury address (case-insensitive for EVM addresses)
      const hasShapeshiftAffiliate = partner.toLowerCase() === expectedTreasuryAddress.toLowerCase();

      // Extract fee information from the order context
      // feeAmount and feeAmountUsd are in the context
      const feeAmount = orderData?.context?.feeAmount;
      const feeAmountUsd = orderData?.context?.feeAmountUsd;

      this.logger.log(
        `Portals verification for swap ${swapId}: partner=${partner}, expectedTreasury=${expectedTreasuryAddress}, verified=${hasShapeshiftAffiliate}, feeAmount=${feeAmount}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: metadata?.affiliateBps ? parseInt(metadata.affiliateBps) : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? expectedTreasuryAddress : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to verify Portals order',
      };
    }
  }

  private async verifyThorchain(
    swapId: string,
    txHash?: string,
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
      const nodeUrl = process.env.VITE_THORCHAIN_NODE_URL || 'https://thornode.ninerealms.com';
      const txUrl = `${nodeUrl}/thorchain/tx/${txHash}`;

      this.logger.log(`Thorchain - Fetching tx from node API: ${txUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(txUrl),
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

      const memo = observedTx.tx.memo;
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
      const shapeshiftAffiliate = process.env.SHAPESHIFT_THORCHAIN_AFFILIATE || 'ss';
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i');
      const memoMatch = memo.match(memoPattern);

      const hasShapeshiftAffiliate = !!memoMatch;
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined;

      this.logger.log(
        `Thorchain verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to fetch Thorchain data from node',
      };
    }
  }

  private async verifyMaya(
    swapId: string,
    txHash?: string,
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
      const nodeUrl = process.env.VITE_MAYACHAIN_NODE_URL || 'https://mayanode.mayachain.info';
      const txUrl = `${nodeUrl}/mayachain/tx/${txHash}`;

      this.logger.log(`Maya - Fetching tx from node API: ${txUrl}`);

      const response = await firstValueFrom(
        this.httpService.get(txUrl),
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

      const memo = observedTx.tx.memo;
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
      const shapeshiftAffiliate = process.env.SHAPESHIFT_MAYA_AFFILIATE || 'ssmaya';
      const memoPattern = new RegExp(`:${shapeshiftAffiliate}:(\\d+)`, 'i');
      const memoMatch = memo.match(memoPattern);

      const hasShapeshiftAffiliate = !!memoMatch;
      const affiliateBps = memoMatch ? parseInt(memoMatch[1]) : undefined;

      this.logger.log(
        `Maya verification for swap ${swapId}: memo=${memo}, affiliate=${shapeshiftAffiliate}, hasAffiliate=${hasShapeshiftAffiliate}, bps=${affiliateBps}`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? affiliateBps : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to fetch Maya data from node',
      };
    }
  }

  private async verifyChainflip(
    swapId: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    const chainflipSwapId = metadata?.chainflipSwapId;

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
      const chainflipApiUrl = process.env.VITE_CHAINFLIP_API_URL || 'https://api.chainflip.io';
      const statusUrl = `${chainflipApiUrl}/swaps/${chainflipSwapId}`;

      const headers: Record<string, string> = {};
      const apiKey = process.env.VITE_CHAINFLIP_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await firstValueFrom(
        this.httpService.get(statusUrl, { headers }),
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

      const shapeshiftAffiliate = process.env.SHAPESHIFT_CHAINFLIP_AFFILIATE || 'shapeshift';
      const hasShapeshiftAffiliate = affiliate?.toLowerCase() === shapeshiftAffiliate.toLowerCase();

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps: hasShapeshiftAffiliate && affiliateBps ? parseInt(affiliateBps) : undefined,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftAffiliate : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to fetch Chainflip swap data',
      };
    }
  }

  private async verifyZrx(
    swapId: string,
    txHash?: string,
    metadata?: Record<string, any>,
  ): Promise<SwapVerificationResult> {
    const tradeHash = txHash || metadata?.tradeHash || metadata?.txHash;

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
      const zrxProxyUrl = process.env.ZRX_PROXY_URL || 'https://api.proxy.shapeshift.com/api/v1/zrx';
      const requestUrl = `${zrxProxyUrl}/trade-analytics/swap`;

      const response = await firstValueFrom(
        this.httpService.get(requestUrl),
      );

      // Response could be an array of trades or have a trades/results field
      const trades = Array.isArray(response.data) ? response.data : (response.data?.trades || response.data?.results || []);

      // Find trade matching our txHash
      const trade = trades.find((t: any) =>
        t.txHash?.toLowerCase() === tradeHash.toLowerCase() ||
        t.transactionHash?.toLowerCase() === tradeHash.toLowerCase()
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
      const integratorId = trade.integratorId || trade.integratorName || trade.affiliateName;
      const shapeshiftIntegrator = process.env.SHAPESHIFT_0X_INTEGRATOR || 'ShapeShift';
      const hasShapeshiftAffiliate = integratorId?.toLowerCase() === shapeshiftIntegrator.toLowerCase();

      // Extract fee information
      // The fee could be in integratorFee, affiliateFee, or partnerFee fields
      // Note: 0x fees are typically in decimal format (e.g., 0.0015 for 15 bps)
      const integratorFee = trade.integratorFee || trade.affiliateFee || trade.partnerFee;
      let affiliateBps: number | undefined;

      if (integratorFee) {
        // Convert decimal fee to basis points (e.g., 0.0015 -> 15 bps)
        affiliateBps = parseFloat(integratorFee) * 10000;
      }

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: hasShapeshiftAffiliate ? shapeshiftIntegrator : undefined,
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
        error: error instanceof Error ? error.message : 'Failed to verify 0x trade',
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
      const bebopApiUrl = process.env.VITE_BEBOP_API_URL || 'https://api.bebop.xyz';
      const shapeshiftSource = process.env.SHAPESHIFT_BEBOP_SOURCE || 'shapeshift';

      // Get swap timestamp to create time range (swap createdAt +/- 1 hour)
      const swapTimestamp = metadata?.createdAt || Date.now();
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
      this.logger.log(`Bebop API Request - Params: ${JSON.stringify({
        start: startNano.toString(),
        end: endNano.toString(),
        source: shapeshiftSource,
        swapTimestamp: new Date(swapTimestamp).toISOString(),
      })}`);
      this.logger.log(`Bebop API Request - Headers: { 'source-auth': '${apiKey.substring(0, 8)}...' }`);
      this.logger.log(`Bebop API Request - Looking for txHash: ${txHash}`);

      const response = await firstValueFrom(
        this.httpService.get(requestUrl, { headers }),
      );

      // Log response
      this.logger.log(`Bebop API Response - Status: ${response.status}`);
      this.logger.log(`Bebop API Response - Data: ${JSON.stringify(response.data)}`);

      const trades = response.data?.results || [];
      this.logger.log(`Bebop API Response - Found ${trades.length} trades`);

      // Find trade matching our txHash
      const trade = trades.find((t: any) => t.txHash?.toLowerCase() === txHash.toLowerCase());

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
      const affiliateBps = partnerFeeBps ? parseFloat(partnerFeeBps) : undefined;

      this.logger.log(
        `Bebop verification: trade found, partnerFeeBps=${partnerFeeBps}, hasAffiliate=true`,
      );

      return {
        isVerified: true,
        hasAffiliate: hasShapeshiftAffiliate,
        affiliateBps,
        affiliateAddress: shapeshiftSource,
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
        error: error instanceof Error ? error.message : 'Failed to verify Bebop trade',
      };
    }
  }
}
