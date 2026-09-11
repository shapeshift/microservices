import type { SwapsService } from '../../swaps/swaps.service'
import type { Swap } from '../../swaps/types'
import type { WebsocketGateway } from '../../websocket/websocket.gateway'
import { SwapPollingService } from '../swap-polling.service'

// unchained-client is ESM; ts-jest can't transform it and nothing here uses it.
jest.mock('@shapeshiftoss/unchained-client', () => ({ TxStatus: {} }))

// contracts reaches lodash-es, which is ESM for the same reason, and only the block time lookup needs it.
jest.mock('@shapeshiftoss/contracts', () => ({ viemClientByChainId: {} }))

const swap = {
  swapId: 'swap-1',
  userId: 'api',
  status: 'PENDING',
  sellTxHash: null,
  buyTxHash: null,
} as unknown as Swap

const buildService = (statusUpdate: Record<string, unknown>) => {
  const updateSwapStatus = jest.fn().mockImplementation((data) => Promise.resolve({ ...swap, ...data }))
  const updateSwapTxHashes = jest.fn().mockImplementation((data) => Promise.resolve({ ...swap, ...data }))
  const swapsService = {
    getPendingTxSwaps: jest.fn().mockResolvedValue([swap]),
    checkSwapStatus: jest.fn().mockResolvedValue(statusUpdate),
    updateSwapStatus,
    updateSwapTxHashes,
  } as unknown as SwapsService
  const sendSwapUpdateToUser = jest.fn()
  const websocketGateway = { sendSwapUpdateToUser } as unknown as WebsocketGateway

  return {
    service: new SwapPollingService(swapsService, websocketGateway),
    updateSwapStatus,
    updateSwapTxHashes,
    sendSwapUpdateToUser,
  }
}

describe('pollPendingTxStatus', () => {
  it('leaves a swap alone when neither its status nor its hashes changed', async () => {
    const { service, updateSwapStatus, updateSwapTxHashes } = buildService({
      status: 'PENDING',
      statusMessage: 'Awaiting deposit',
    })

    await service.pollPendingTxStatus()

    expect(updateSwapStatus).not.toHaveBeenCalled()
    expect(updateSwapTxHashes).not.toHaveBeenCalled()
  })

  it('writes a newly reported sell tx hash without touching the status', async () => {
    const { service, updateSwapStatus, updateSwapTxHashes, sendSwapUpdateToUser } = buildService({
      status: 'PENDING',
      statusMessage: 'Deposit detected',
      sellTxHash: '0xdeposit',
    })

    await service.pollPendingTxStatus()

    expect(updateSwapStatus).not.toHaveBeenCalled()
    expect(updateSwapTxHashes).toHaveBeenCalledWith({
      swapId: 'swap-1',
      sellTxHash: '0xdeposit',
      buyTxHash: undefined,
      txLink: undefined,
    })
    expect(sendSwapUpdateToUser).toHaveBeenCalledWith('api', expect.objectContaining({ sellTxHash: '0xdeposit' }))
  })

  it('writes a tracker link the provider reports even when nothing else changed', async () => {
    const { service, updateSwapTxHashes } = buildService({
      status: 'PENDING',
      statusMessage: 'Processing swap...',
      sellTxHash: '0xdeposit',
      txLink: 'https://explorer.near-intents.org/transactions/deposit',
    })

    await service.pollPendingTxStatus()

    expect(updateSwapTxHashes).toHaveBeenCalledWith(
      expect.objectContaining({ txLink: 'https://explorer.near-intents.org/transactions/deposit' }),
    )
  })

  it('writes a status change as before', async () => {
    const { service, updateSwapStatus } = buildService({
      status: 'SUCCESS',
      statusMessage: '',
      sellTxHash: '0xsell',
      buyTxHash: '0xbuy',
    })

    await service.pollPendingTxStatus()

    expect(updateSwapStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS', buyTxHash: '0xbuy' }))
  })
})
