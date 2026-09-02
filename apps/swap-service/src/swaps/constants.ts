export const SHAPESHIFT_BPS = 10
export const REFERRER_FEE_RATE = 0.1

// no enabled swapper settles this slowly: an unmined source tx is long gone from every mempool by
// now, and NEAR Intents quotes carry a 24h deadline of their own
export const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000
