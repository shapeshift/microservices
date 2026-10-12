import type * as Viem from 'viem'
import { createPublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { WalletProofVerifier } from './wallet-auth'

jest.mock('@shapeshiftoss/chain-adapters', () => ({ bnOrZero: jest.fn() }))
jest.mock('viem', () => ({ ...jest.requireActual<typeof Viem>('viem'), createPublicClient: jest.fn() }))

const rpcVerify = jest.fn()
const getChainId = jest.fn()
const client = { verifyMessage: rpcVerify, getChainId } as unknown as ReturnType<typeof createPublicClient>
const account = privateKeyToAccount(generatePrivateKey())
const proof = {
  address: '0x' + '11'.repeat(20),
  chainId: 1,
  message: 'server-stored exact challenge',
  signature: '0x' + '00'.repeat(65),
}
const verifier = new WalletProofVerifier()

beforeEach(() => {
  jest.mocked(createPublicClient).mockClear().mockReturnValue(client)
  process.env.ONRAMPER_EVM_RPC_URLS = '{"1":"https://rpc.example"}'
  rpcVerify.mockReset()
  getChainId.mockReset().mockResolvedValue(1)
})

test('EOA signatures verify offline against the exact stored message', async () => {
  const message = 'wallet authentication challenge'
  expect(
    await verifier.verify({
      ...proof,
      address: account.address,
      message,
      signature: await account.signMessage({ message }),
    }),
  ).toBe(true)
  expect(createPublicClient).not.toHaveBeenCalled()
})
test('contract signatures use only the configured RPC and correct chain', async () => {
  rpcVerify.mockResolvedValue(true)
  expect(await verifier.verify(proof)).toBe(true)
  expect(getChainId).toHaveBeenCalled()
  expect(rpcVerify).toHaveBeenCalledWith({ address: proof.address, message: proof.message, signature: proof.signature })
})
test('contract authorization is rechecked and stops working after it is revoked', async () => {
  rpcVerify.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  expect(await verifier.verify(proof)).toBe(true)
  expect(await verifier.verify(proof)).toBe(false)
  expect(rpcVerify).toHaveBeenCalledTimes(2)
})
test('contract wallets without a configured verifier fail closed', async () => {
  process.env.ONRAMPER_EVM_RPC_URLS = '{}'
  expect(await verifier.verify(proof)).toBe(false)
  expect(createPublicClient).not.toHaveBeenCalled()
})
test('a mismatched RPC chain cannot authorize a wallet', async () => {
  getChainId.mockResolvedValue(10)
  await expect(verifier.verify(proof)).rejects.toMatchObject({ status: 503 })
  expect(rpcVerify).not.toHaveBeenCalled()
})
test('RPC failure cannot authorize a wallet', async () => {
  getChainId.mockRejectedValue(new Error('offline'))
  await expect(verifier.verify(proof)).rejects.toMatchObject({ status: 503 })
})
test('invalid verification configuration fails closed', async () => {
  process.env.ONRAMPER_EVM_RPC_URLS = 'invalid json'
  await expect(verifier.verify(proof)).rejects.toMatchObject({ status: 503 })
})
