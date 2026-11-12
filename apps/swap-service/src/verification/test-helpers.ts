import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

export const mockHttp = (response: unknown) => {
  const get = jest.fn().mockReturnValue(of({ data: response }))
  return { http: { get } as unknown as HttpService, get }
}

export const failingHttp = (message = 'upstream 500'): HttpService =>
  ({ get: jest.fn().mockReturnValue(throwError(() => new Error(message))) }) as unknown as HttpService
