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

const DEPOSIT = 't1eYDHMYzCv1vNPA5gy16RcqxG4YKwTSxeR'
const SWEEP_TO = 't1KfwsnwJeNRVjQGBDZhwKskpQbih2qx5Ua'

const zcashSwap = {
  swapId: 'swap-zec',
  swapperName: 'NEAR Intents',
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
    getTxHistory.mockReset()
  })

  it('finds a shielded zcash deposit in the address history', async () => {
    getTxHistory.mockResolvedValue({ txs: [sweep, shieldedDeposit] })

    await expect(new DepositDetectionService().findDepositOnChain(zcashSwap)).resolves.toBe('f85da1de')

    expect(getTxHistory).toHaveBeenCalledWith({ pubkey: DEPOSIT, pageSize: 25 })
  })

  it('returns undefined when the address has only been swept', async () => {
    getTxHistory.mockResolvedValue({ txs: [sweep] })

    await expect(new DepositDetectionService().findDepositOnChain(zcashSwap)).resolves.toBeUndefined()
  })

  it('does not scan chains without a utxo history client', async () => {
    const swap = { ...zcashSwap, sellAsset: { chainId: 'eip155:1' } } as unknown as Swap

    await expect(new DepositDetectionService().findDepositOnChain(swap)).resolves.toBeUndefined()
    expect(getTxHistory).not.toHaveBeenCalled()
  })

  it('does not scan for a swapper that reports every deposit', async () => {
    const swap = { ...zcashSwap, swapperName: 'Chainflip' } as unknown as Swap

    await expect(new DepositDetectionService().findDepositOnChain(swap)).resolves.toBeUndefined()
    expect(getTxHistory).not.toHaveBeenCalled()
  })

  it('returns undefined when the lookup throws', async () => {
    getTxHistory.mockRejectedValue(new Error('boom'))

    await expect(new DepositDetectionService().findDepositOnChain(zcashSwap)).resolves.toBeUndefined()
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
