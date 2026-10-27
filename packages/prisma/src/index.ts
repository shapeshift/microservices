import { PrismaPg } from '@prisma/adapter-pg'

export * from './generated/client'

export const createPrismaAdapter = (max: number, connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  return new PrismaPg({
    connectionString,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 300_000,
  })
}
