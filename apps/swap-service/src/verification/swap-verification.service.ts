import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'

import { SwapVerificationResult } from '@shapeshift/shared-types'

import type { Swap } from '../swaps/types'

import { verifiers } from './registry'
import type { VerifierDeps } from './types'
import { noAffiliateResult } from './utils'

@Injectable()
export class SwapVerificationService {
  private readonly logger = new Logger(SwapVerificationService.name)
  private readonly deps: VerifierDeps

  constructor(httpService: HttpService) {
    this.deps = { http: httpService, logger: this.logger }
  }

  async verifySwap(swap: Swap): Promise<SwapVerificationResult> {
    const result = await this.verify(swap)

    this.logResult(swap, result)

    return result
  }

  private async verify(swap: Swap): Promise<SwapVerificationResult> {
    const verifier = verifiers[swap.swapperName]
    if (!verifier) return noAffiliateResult('PENDING', `No verifier for ${swap.swapperName}`)

    try {
      return await verifier(swap, this.deps)
    } catch (error) {
      return noAffiliateResult('PENDING', error instanceof Error ? error.message : 'Unknown error')
    }
  }

  private logResult(swap: Swap, result: SwapVerificationResult): void {
    const affiliateDetails = result.hasAffiliate
      ? `${result.affiliateAddress} - ${result.affiliateBps} bps`
      : `noAffiliateReason=${result.noAffiliateReason ?? 'unknown'}`

    this.logger.log(
      `${swap.swapperName} verification for swap: ${swap.swapId} ${result.verificationStatus} (${affiliateDetails})`,
    )
  }
}
