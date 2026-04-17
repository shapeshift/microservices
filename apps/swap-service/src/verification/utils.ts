export const THORCHAIN_PRECISION = 8

export const thorchainToNativePrecision = (thorchainAmount: string, nativePrecision: number): string => {
  const diff = nativePrecision - THORCHAIN_PRECISION
  if (diff === 0) return thorchainAmount
  if (diff > 0) return thorchainAmount + '0'.repeat(diff)
  const trimmed = thorchainAmount.slice(0, diff)
  return trimmed || '0'
}
