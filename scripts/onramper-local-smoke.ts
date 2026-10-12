import assert from 'node:assert/strict'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = 'http://localhost:3002'
const origin = 'http://localhost:5173'
const account = privateKeyToAccount(generatePrivateKey())
const post = (path: string, body: unknown, token?: string) =>
  fetch(api + path, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
async function main() {
  const health = await fetch(api + '/health')
  assert.equal(health.status, 200)
  assert.equal(
    ((await health.json()) as { simulator?: boolean }).simulator,
    true,
    'Run only against the local simulator',
  )
  const checkout = {
    crypto: 'eth',
    chainId: 1,
    fiat: 'USD',
    action: 'buy',
    amount: '100',
    language: 'en',
    theme: 'light',
  }
  assert.equal((await post('/onramper/intents', checkout)).status, 401)
  const challengeResponse = await post('/onramper/auth/challenge', { address: account.address, chainId: 1 })
  assert.equal(challengeResponse.status, 201)
  const challenge = (await challengeResponse.json()) as { id: string; message: string }
  const proof = { id: challenge.id, signature: await account.signMessage({ message: challenge.message }) }
  const auth = await post('/onramper/auth/verify', proof)
  assert.equal(auth.status, 201)
  const session = (await auth.json()) as { token: string }
  assert.equal((await post('/onramper/auth/verify', proof)).status, 401)
  assert.equal(
    (await post('/onramper/intents', { ...checkout, address: '0x' + '11'.repeat(20) }, session.token)).status,
    400,
  )
  const intentResponse = await post('/onramper/intents', checkout, session.token)
  assert.equal(intentResponse.status, 201)
  const intent = (await intentResponse.json()) as { id: string; token: string }
  const redeem = await post(`/onramper/intents/${intent.id}/checkout`, { token: intent.token }, session.token)
  assert.equal(redeem.status, 201)
  const { url } = (await redeem.json()) as { url: string }
  const signed = new URL(url)
  assert.equal(signed.origin, 'http://localhost:3999')
  assert.equal(signed.searchParams.get('wallets'), `eth:${account.address}`)
  const tampered = new URL(url)
  tampered.searchParams.set('wallets', `eth:${'0x' + '11'.repeat(20)}`)
  assert.equal((await fetch(tampered)).status, 401)
  assert.equal((await fetch(url)).status, 200)
  assert.equal((await fetch(url)).status, 401)
  assert.equal(
    (await post(`/onramper/intents/${intent.id}/checkout`, { token: intent.token }, session.token)).status,
    401,
  )
  assert.equal(
    (
      await fetch(api + '/onramper/auth/session', {
        method: 'DELETE',
        headers: { Origin: origin, Authorization: `Bearer ${session.token}` },
      })
    ).status,
    200,
  )
  assert.equal((await post('/onramper/intents', checkout, session.token)).status, 401)
  console.log(
    'PASS: wallet proof, derived destination, signature verification, tamper rejection, single-use challenge/intent/widget, and session revocation',
  )
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Smoke test failed')
  process.exitCode = 1
})
