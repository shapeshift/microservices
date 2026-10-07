import { createHash } from 'node:crypto'
import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'

@Injectable()
export class SecurityRateLimiter {
  constructor(@Inject('SECURITY_DB') private readonly db: PrismaClient) {}

  async consume(scope: string, subject: string, limit: number, windowSeconds = 60): Promise<void> {
    const key = createHash('sha256').update(`${scope}:${subject}`).digest('hex')
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO security_rate_limits (key, count, "expiresAt")
      VALUES (${key}, 1, NOW() + ${windowSeconds} * INTERVAL '1 second')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN security_rate_limits."expiresAt" <= NOW() THEN 1 ELSE security_rate_limits.count + 1 END,
        "expiresAt" = CASE WHEN security_rate_limits."expiresAt" <= NOW() THEN NOW() + ${windowSeconds} * INTERVAL '1 second' ELSE security_rate_limits."expiresAt" END
      RETURNING count`
    if (rows[0].count > limit) throw new HttpException('Too many requests', 429)
  }
}
