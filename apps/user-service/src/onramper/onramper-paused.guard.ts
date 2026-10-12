import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common'

@Injectable()
export class OnramperPausedGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.ONRAMPER_CHECKOUT_ENABLED !== 'true')
      throw new ServiceUnavailableException('Onramper checkout is temporarily unavailable')
    return true
  }
}
