import { fromAccountId } from '@shapeshiftoss/caip'
import { bnOrZero } from '@shapeshiftoss/chain-adapters'

// how far the amount a transaction sold may sit from the quoted sell amount and still count as that quote's swap
export const SELL_AMOUNT_TOLERANCE = 0.01

// the web app registers a CAIP-10 account id, the public API a bare address
export const accountAddress = (accountId: string): string => {
  try {
    return fromAccountId(accountId).account
  } catch {
    return accountId
  }
}

export const isSellAmountWithinTolerance = (quoted: string, actual: string): boolean => {
  const quotedAmount = bnOrZero(quoted)
  if (quotedAmount.lte(0)) return false

  return bnOrZero(actual).minus(quotedAmount).abs().div(quotedAmount).lte(SELL_AMOUNT_TOLERANCE)
}
