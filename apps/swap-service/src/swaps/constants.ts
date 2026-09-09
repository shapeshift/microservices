export const SHAPESHIFT_BPS = 10
export const REFERRER_FEE_RATE = 0.1
export const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000
export const ATTRIBUTION_BATCH_SIZE = 200
// a quote only just postdating its block may be miner clock skew rather than a harvested transaction,
// so rejections inside this margin are logged for review - it never changes the verdict
export const SKEW_REVIEW_MS = 30 * 60 * 1000
