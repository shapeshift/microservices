import type { HttpService } from '@nestjs/axios'
import type { Logger } from '@nestjs/common'

import type { SwapVerificationResult } from '@shapeshift/shared-types'

import type { Swap } from '../swaps/types'

export type VerifierDeps = {
  http: HttpService
  logger: Logger
}

export type Verifier = (swap: Swap, deps: VerifierDeps) => Promise<SwapVerificationResult>
