import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { AffiliateStatsQueryDto, AffiliateSwapsQueryDto } from '../types'

// mirrors the global ValidationPipe, which transforms the query before validating it
const errorsFor = async (dto: ClassConstructor<object>, query: object) => {
  const errors = await validate(plainToInstance(dto, query), { whitelist: true, forbidNonWhitelisted: true })
  return errors.map(({ property }) => property)
}

describe.each([
  ['AffiliateStatsQueryDto', AffiliateStatsQueryDto],
  ['AffiliateSwapsQueryDto', AffiliateSwapsQueryDto],
])('%s date range', (_, dto) => {
  const partnerCode = 'venice'

  it('accepts dates since the epoch', async () => {
    await expect(
      errorsFor(dto, { partnerCode, startDate: '1970-01-01T00:00:00.000Z', endDate: '2026-11-13T00:00:00.000Z' }),
    ).resolves.toEqual([])
  })

  it.each(['startDate', 'endDate'])('rejects a %s in year 0, which Postgres cannot store', async (field) => {
    await expect(errorsFor(dto, { partnerCode, [field]: '0000-01-01' })).resolves.toEqual([field])
  })

  it('rejects a date that does not parse', async () => {
    await expect(errorsFor(dto, { partnerCode, startDate: 'not-a-date' })).resolves.toEqual(['startDate'])
  })
})
