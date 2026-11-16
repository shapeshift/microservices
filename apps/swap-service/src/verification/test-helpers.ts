import type { HttpService } from '@nestjs/axios'
import { of, throwError } from 'rxjs'

export const mockHttp = (response: unknown) => {
  const get = jest.fn<unknown, [url: string, ...rest: unknown[]]>().mockReturnValue(of({ data: response }))
  const post = jest.fn<unknown, [url: string, ...rest: unknown[]]>().mockReturnValue(of({ data: response }))
  return { http: { get, post } as unknown as HttpService, get, post }
}

export const failingHttp = (message = 'upstream 500'): HttpService => {
  const fail = () => throwError(() => new Error(message))
  return { get: jest.fn(fail), post: jest.fn(fail) } as unknown as HttpService
}
