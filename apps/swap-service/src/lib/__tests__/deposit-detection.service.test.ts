import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript'
import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

import type { Swap } from '../../swaps/types'
import { DepositDetectionService, findDepositInHistory } from '../deposit-detection.service'

// unchained-client is ESM; ts-jest can't transform it. Only the utxo history clients are built here.
jest.mock('@shapeshiftoss/unchained-client', () => {
  const namespace = {
    V1Api: class {
      getTxHistory = getTxHistory
    },
    Configuration: class {},
  }
  return { bitcoin: namespace, bitcoincash: namespace, dogecoin: namespace, litecoin: namespace, zcash: namespace }
})

const getTxHistory = jest.fn()

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
  sellAsset: { chainId: 'eip155:1' },
  metadata: { swapperMetadata: { name: 'nearIntents', depositAddress: 'deposit.near' } },
} as unknown as Swap

const DEPOSIT = 't1eYDHMYzCv1vNPA5gy16RcqxG4YKwTSxeR'
const SWEEP_TO = 't1KfwsnwJeNRVjQGBDZhwKskpQbih2qx5Ua'

const zcashSwap = {
  ...nearSwap,
  sellAsset: { chainId: 'bip122:00040fe8ec8471911baa1db1266ea15d' },
  metadata: { swapperMetadata: { name: 'nearIntents', depositAddress: DEPOSIT } },
} as unknown as Swap

// A shielded spend into the deposit address (no inputs), then the provider's sweep out of it
const shieldedDeposit = {
  txid: 'f85da1de',
  blockHeight: 3479873,
  timestamp: 100,
  vin: [],
  vout: [{ addresses: [DEPOSIT] }],
}
const sweep = {
  txid: '7d75ada4',
  blockHeight: 3479880,
  timestamp: 200,
  vin: [{ addresses: [DEPOSIT] }, { addresses: [SWEEP_TO] }],
  vout: [{ addresses: [SWEEP_TO] }],
}

describe('DepositDetectionService', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    getTxHistory.mockReset()
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

  describe('on-chain fallback', () => {
    it('finds a shielded zcash deposit the provider does not report', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'SUCCESS',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [{ hash: '0xbuy', explorerUrl: '' }] },
      } as never)
      getTxHistory.mockResolvedValue({ txs: [sweep, shieldedDeposit] })
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(zcashSwap)).resolves.toBe('f85da1de')

      expect(getTxHistory).toHaveBeenCalledWith({ pubkey: DEPOSIT, pageSize: 25 })
    })

    it('prefers the hash the provider reports and never scans', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'PROCESSING',
        swapDetails: { originChainTxHashes: [{ hash: 'reported', explorerUrl: '' }], destinationChainTxHashes: [] },
      } as never)
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(zcashSwap)).resolves.toBe('reported')
      expect(getTxHistory).not.toHaveBeenCalled()
    })

    it('does not scan chains without a utxo history client', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'PENDING_DEPOSIT',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
      } as never)
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(nearSwap)).resolves.toBeUndefined()
      expect(getTxHistory).not.toHaveBeenCalled()
    })

    it('returns undefined when the address has only been swept', async () => {
      jest.spyOn(OneClickService, 'getExecutionStatus').mockResolvedValue({
        status: 'PENDING_DEPOSIT',
        swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
      } as never)
      getTxHistory.mockResolvedValue({ txs: [sweep] })
      const service = new DepositDetectionService(makeHttpMock({}).http)

      await expect(service.findDepositTxHash(zcashSwap)).resolves.toBeUndefined()
    })
  })

  describe('findDepositInHistory', () => {
    it('takes the earliest deposit, mined before unmined', () => {
      const unmined = { ...shieldedDeposit, txid: 'mempool', blockHeight: -1, timestamp: 50 }
      const later = { ...shieldedDeposit, txid: 'later', blockHeight: 3479875 }
      expect(findDepositInHistory([unmined, later, shieldedDeposit, sweep], DEPOSIT)).toBe('f85da1de')
    })

    it('returns an unmined deposit when nothing else has paid the address', () => {
      const unmined = { ...shieldedDeposit, txid: 'mempool', blockHeight: -1 }
      expect(findDepositInHistory([unmined], DEPOSIT)).toBe('mempool')
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
