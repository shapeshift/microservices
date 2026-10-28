export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export const SHAPESHIFT_BPS = 10
export const REFERRER_FEE_RATE = 0.1
export const PENDING_TIMEOUT_MS = DAY_MS
export const ACTIVE_STATUSES = ['IDLE', 'PENDING']
export const SETTLED_STATUSES = ['SUCCESS', 'FAILED']
export const DEPOSIT_WINDOW_MS = 3 * DAY_MS
export const ATTRIBUTION_BATCH_SIZE = 150
export const ATTRIBUTION_DEADLINE_BATCH_SIZE = 50
export const ABANDON_BATCH_SIZE = 200
export const MISSING_PRICE_BATCH_SIZE = 200
export const RESOLUTION_DEADLINE_MS = 7 * DAY_MS
export const ABANDONED_STATUS_PREFIX = 'Abandoned:'
