import { PrismaPg } from '@prisma/adapter-pg'

export * from './generated/client'

// Each service runs a single replica, so its pool size is its total share of the database's connections
export const createPrismaAdapter = (max: number, connectionString = process.env.DATABASE_URL) =>
  new PrismaPg({
    connectionString,
    max,
    // bounds both new connections and waiting for a free one; pg waits forever by default
    connectionTimeoutMillis: 5_000,
    // matches prisma 6; pg's 10s default churns connections between bursts
    idleTimeoutMillis: 300_000,
  })
