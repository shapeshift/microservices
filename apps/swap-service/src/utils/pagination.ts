import type { Prisma } from '@prisma/client'

export function swapCursorArgs(
  limit: number,
  cursor?: string,
): Pick<Prisma.SwapFindManyArgs, 'take' | 'orderBy' | 'cursor' | 'skip'> {
  return {
    take: limit,
    orderBy: [{ createdAt: 'desc' }, { swapId: 'desc' }],
    ...(cursor ? { cursor: { swapId: cursor }, skip: 1 } : {}),
  }
}

export function getNextCursor<T extends { swapId: string }>(items: T[], limit: number): string | null {
  return items.length === limit ? items[items.length - 1].swapId : null
}
