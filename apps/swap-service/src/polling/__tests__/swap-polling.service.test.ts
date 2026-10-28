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
  statusMessage: 'Awaiting deposit',
  sellTxHash: null,
  buyTxHash: null,
  createdAt: new Date(),
} as unknown as Swap

const buildService = (statusUpdate: Record<string, unknown>, polled: Swap = swap) => {
  const updateSwapStatus = jest.fn().mockImplementation((data) => Promise.resolve({ ...polled, ...data }))
  const updateSwapTxHashes = jest.fn().mockImplementation((data) => Promise.resolve({ ...polled, ...data }))
  const checkSwapStatus = jest.fn().mockResolvedValue(statusUpdate)
  const getPendingTxSwapsByIds = jest.fn().mockResolvedValue([polled])
  const swapsService = {
    getPendingTxSwapRefs: jest.fn().mockResolvedValue([{ swapId: polled.swapId, createdAt: polled.createdAt }]),
    getPendingTxSwapsByIds,
    checkSwapStatus,
    updateSwapStatus,
    updateSwapTxHashes,
  } as unknown as SwapsService
  const sendSwapUpdateToUser = jest.fn()
  const websocketGateway = { sendSwapUpdateToUser } as unknown as WebsocketGateway

  return {
    checkSwapStatus,
    getPendingTxSwapsByIds,
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

  it('writes a status message the provider changed on its own', async () => {
    const { service, updateSwapStatus, updateSwapTxHashes, sendSwapUpdateToUser } = buildService({
      status: 'PENDING',
      statusMessage: 'Confirmed by provider, waiting for deposit hash',
    })

    await service.pollPendingTxStatus()

    expect(updateSwapStatus).not.toHaveBeenCalled()
    expect(updateSwapTxHashes).toHaveBeenCalledWith(
      expect.objectContaining({ statusMessage: 'Confirmed by provider, waiting for deposit hash' }),
    )
    expect(sendSwapUpdateToUser).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite a sell tx hash the row already holds', async () => {
    const { service, updateSwapStatus, updateSwapTxHashes, sendSwapUpdateToUser } = buildService(
      { status: 'PENDING', statusMessage: 'Awaiting deposit', sellTxHash: '0xknown' },
      { ...swap, sellTxHash: '0xknown' } as Swap,
    )

    await service.pollPendingTxStatus()

    expect(updateSwapStatus).not.toHaveBeenCalled()
    expect(updateSwapTxHashes).not.toHaveBeenCalled()
    expect(sendSwapUpdateToUser).not.toHaveBeenCalled()
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
      statusMessage: 'Deposit detected',
    })
    expect(sendSwapUpdateToUser).toHaveBeenCalledWith('api', expect.objectContaining({ sellTxHash: '0xdeposit' }))
  })

  it('writes a tracker link the provider reports even when nothing else changed', async () => {
    const { service, updateSwapTxHashes } = buildService({
      status: 'PENDING',
      statusMessage: 'Processing swap...',
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

describe('pollPendingTxStatus backoff', () => {
  afterEach(() => jest.restoreAllMocks())

  const pollsAt = async (service: SwapPollingService, times: number[]) => {
    const now = jest.spyOn(Date, 'now')
    for (const time of times) {
      now.mockReturnValue(time)
      await service.pollPendingTxStatus()
    }
  }

  it('polls a fresh swap on every tick', async () => {
    const start = Date.now()
    const fresh = { ...swap, createdAt: new Date(start) } as Swap
    const { service, checkSwapStatus } = buildService({ status: 'PENDING', statusMessage: 'Awaiting deposit' }, fresh)

    await pollsAt(service, [start, start + 5_000, start + 10_000])

    expect(checkSwapStatus).toHaveBeenCalledTimes(3)
  })

  it('still polls a fresh swap on a tick that lands just short of its interval', async () => {
    const start = Date.now()
    const fresh = { ...swap, createdAt: new Date(start) } as Swap
    const { service, checkSwapStatus } = buildService({ status: 'PENDING', statusMessage: 'Awaiting deposit' }, fresh)

    await pollsAt(service, [start, start + 4_990, start + 9_985])

    expect(checkSwapStatus).toHaveBeenCalledTimes(3)
  })

  it('polls a day-old swap once per ten minutes', async () => {
    const start = Date.now()
    const old = { ...swap, createdAt: new Date(start - 30 * 60 * 60 * 1000) } as Swap
    const { service, checkSwapStatus } = buildService({ status: 'PENDING', statusMessage: 'Awaiting deposit' }, old)

    await pollsAt(service, [start, start + 5_000, start + 9 * 60 * 1000, start + 10 * 60 * 1000])

    expect(checkSwapStatus).toHaveBeenCalledTimes(2)
  })

  it('polls a day-old swap live again once its deposit is detected', async () => {
    const start = Date.now()
    const old = { ...swap, createdAt: new Date(start - 30 * 60 * 60 * 1000) } as Swap
    const { service, checkSwapStatus, getPendingTxSwapsByIds } = buildService(
      { status: 'PENDING', statusMessage: 'Awaiting deposit', sellTxHash: '0xdeposit' },
      old,
    )
    getPendingTxSwapsByIds.mockResolvedValueOnce([old]).mockResolvedValue([{ ...old, sellTxHash: '0xdeposit' }])

    await pollsAt(service, [start, start + 5_000, start + 10_000])

    expect(checkSwapStatus).toHaveBeenCalledTimes(3)
  })

  it('polls a day-old swap live again once its status changes', async () => {
    const start = Date.now()
    const idle = { ...swap, status: 'IDLE', createdAt: new Date(start - 30 * 60 * 60 * 1000) } as Swap
    const { service, checkSwapStatus, getPendingTxSwapsByIds } = buildService(
      { status: 'PENDING', statusMessage: 'Awaiting deposit' },
      idle,
    )
    getPendingTxSwapsByIds.mockResolvedValueOnce([idle]).mockResolvedValue([{ ...idle, status: 'PENDING' }])

    await pollsAt(service, [start, start + 5_000, start + 10_000])

    expect(checkSwapStatus).toHaveBeenCalledTimes(3)
  })

  it('keeps backing off a swap whose message changes but nothing else does', async () => {
    const start = Date.now()
    const old = { ...swap, createdAt: new Date(start - 30 * 60 * 60 * 1000) } as Swap
    const { service, checkSwapStatus } = buildService(
      { status: 'PENDING', statusMessage: 'Error polling status: timeout' },
      old,
    )

    await pollsAt(service, [start, start + 5_000, start + 10_000])

    expect(checkSwapStatus).toHaveBeenCalledTimes(1)
  })
})
