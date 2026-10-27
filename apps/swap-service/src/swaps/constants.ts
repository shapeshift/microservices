export const SHAPESHIFT_BPS = 10
export const REFERRER_FEE_RATE = 0.1
export const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000
export const ATTRIBUTION_BATCH_SIZE = 200
export const MISSING_PRICE_BATCH_SIZE = 200
// how long a settled swap may keep retrying an outside lookup before it is resolved without one
export const RESOLUTION_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000
// markers of a resolution reached by timing out rather than by evidence, read back by the payout report
export const ABANDONED_STATUS_PREFIX = 'Abandoned:'
export const VERIFICATION_TIMEOUT_PREFIX = 'timeout:'
export const UNRESOLVED_ATTRIBUTION_PREFIX = 'unresolved:'
