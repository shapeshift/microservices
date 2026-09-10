import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript'
import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { Swap } from '../../swaps/types'
import { DepositDetectionService } from '../deposit-detection.service'

const makeHttpMock = (response: unknown) => {
  const get = jest.fn().mockReturnValue(of({ data: response }))
  return { get, http: { get } as unknown as HttpService }
}

const chainflipSwap = {
  swapId: 'swap-cf',
  swapperName: 'Chainflip',
  metadata: { swapperMetadata: { name: 'chainflip', swapId: 12345 } },
} as unknown as Swap

const nearSwap = {
  swapId: 'swap-near',
  swapperName: 'NEAR Intents',
  metadata: { swapperMetadata: { name: 'nearIntents', depositAddress: 'deposit.near' } },
} as unknown as Swap

describe('DepositDetectionService', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  describe('chainflip', () => {
    it('returns the deposit transaction reference from the broker status', async () => {
      const { get, http } = makeHttpMock({
        status: { state: 'swapping', deposit: { transactionReference: '0xdeposit' } },
      })
      const service = new DepositDetectionService(http)

      await expect(service.findDepositTxHash(chainflipSwap)).resolves.toBe('0xdeposit')

      expect(get).toHaveBeenCalledWith('https://chainflip.test/status-by-id?apiKey=x&swapId=12345')
    })

    it('returns undefined while the channel has no deposit', async () => {
      const { http } = makeHttpMock({ status: { state: 'waiting', deposit: null } })
      const service = new DepositDetectionService(http)

      await expect(service.findDepositTxHash(chainflipSwap)).resolves.toBeUndefined()
    })

    it('returns undefined when the broker is unreachable', async () => {
      const http = { get: jest.fn().mockReturnValue(throwError(() => new Error('boom'))) } as unknown as HttpService
      const service = new DepositDetectionService(http)

      await expect(service.findDepositTxHash(chainflipSwap)).resolves.toBeUndefined()
    })

    it('returns undefined when the metadata carries no swapId', async () => {
      const { get, http } = makeHttpMock({})
      const service = new DepositDetectionService(http)
      const swap = { ...chainflipSwap, metadata: { swapperMetadata: { name: 'chainflip' } } } as unknown as Swap

      await expect(service.findDepositTxHash(swap)).resolves.toBeUndefined()
      expect(get).not.toHaveBeenCalled()
    })
  })

  describe('near intents', () => {
    it('returns the first origin chain transaction hash', async () => {
      const getExecutionStatus = jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'PROCESSING',
        swapDetails: { originChainTxHashes: [{ hash: 'nearhash', explorerUrl: '' }], destinationChainTxHashes: [] },
      } as never)
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(nearSwap)).resolves.toBe('nearhash')

      expect(getExecutionStatus).toHaveBeenCalledWith('deposit.near')
    })

    it('returns undefined before the deposit is seen', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'PENDING_DEPOSIT',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
      } as never)
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(nearSwap)).resolves.toBeUndefined()
    })

    it('returns undefined when the lookup throws', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockRejectedValue(new Error('404'))
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(nearSwap)).resolves.toBeUndefined()
    })
  })

  it('returns undefined for a swapper that is not externally paid', async () => {
    const { get, http } = makeHttpMock({})
    const service = new DepositDetectionService(http)

    await expect(
      service.findDepositTxHash({ ...chainflipSwap, swapperName: 'Relay' } as never),
    ).resolves.toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })
})
