import { randomBytes, randomUUID } from 'node:crypto'
import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Post, Req } from '@nestjs/common'
import { z } from 'zod'

import type { UserRequest } from '@shapeshift/shared-utils'
import { DeviceAccess, hashToken, NotificationsServiceClient, SecurityRateLimiter } from '@shapeshift/shared-utils'

import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'

const deviceSchema = z.strictObject({ deviceToken: z.string().min(1).max(256), deviceType: z.enum(['MOBILE', 'WEB']) })

@Controller('me')
@DeviceAccess()
export class ProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly limits: SecurityRateLimiter,
    private readonly db: PrismaService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async profile(@Req() request: UserRequest) {
    await this.limits.consume('device-profile-read', request.userId, 60)
    const user = await this.users.getUserById(request.userId)
    return { id: user?.id, createdAt: user?.createdAt, updatedAt: user?.updatedAt }
  }

  @Get('devices')
  @Header('Cache-Control', 'no-store')
  async devices(@Req() request: UserRequest) {
    await this.limits.consume('device-profile-read', request.userId, 60)
    return (await this.users.getUserDevices(request.userId)).map(({ id, deviceType, isActive }) => ({
      id,
      deviceType,
      isActive,
    }))
  }

  @Post('devices')
  async register(@Req() request: UserRequest, @Body() input: unknown) {
    const parsed = deviceSchema.safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid device')
    await this.limits.consume('device-registration', request.userId, 10)
    if (parsed.data.deviceType === 'MOBILE') {
      if (!/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(parsed.data.deviceToken))
        throw new BadRequestException('Invalid push token')
      const existing = await this.db.device.findUnique({ where: { deviceToken: parsed.data.deviceToken } })
      if (existing?.userId === request.userId && existing.isActive)
        return { device: { id: existing.id, deviceType: existing.deviceType, isActive: true } }
      await this.limits.consume('push-verification-token', parsed.data.deviceToken, 5, 3600)
      await this.limits.consume('push-verification-global', 'all', 500)
      const id = randomUUID()
      const nonce = randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 5 * 60_000)
      await this.db.pushRegistration.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      await this.db.pushRegistration.create({
        data: {
          id,
          userId: request.userId,
          deviceToken: parsed.data.deviceToken,
          nonceHash: hashToken(nonce),
          expiresAt,
        },
      })
      const client = new NotificationsServiceClient()
      await client.sendDeviceVerification({ deviceToken: parsed.data.deviceToken, registrationId: id, nonce })
      return { registrationId: id }
    }
    const device = await this.users.registerDevice({ ...parsed.data, userId: request.userId })
    return { device: { id: device.id, deviceType: device.deviceType, isActive: device.isActive } }
  }

  @Post('devices/confirm')
  async confirm(@Req() request: UserRequest, @Body() input: unknown) {
    const parsed = z
      .strictObject({ registrationId: z.uuid(), nonce: z.string().regex(/^[a-f0-9]{64}$/) })
      .safeParse(input)
    if (!parsed.success) throw new BadRequestException('Invalid device confirmation')
    await this.limits.consume('push-confirmation', request.userId, 20)
    const pending = await this.db.pushRegistration.findUnique({ where: { id: parsed.data.registrationId } })
    if (
      !pending ||
      pending.userId !== request.userId ||
      pending.expiresAt <= new Date() ||
      pending.nonceHash !== hashToken(parsed.data.nonce)
    )
      throw new BadRequestException('Invalid device confirmation')
    const device = await this.db.$transaction(async (tx) => {
      const consumed = await tx.pushRegistration.deleteMany({
        where: { id: pending.id, userId: request.userId, expiresAt: { gt: new Date() } },
      })
      if (consumed.count !== 1) throw new BadRequestException('Device confirmation already used')
      return tx.device.upsert({
        where: { deviceToken: pending.deviceToken },
        create: { deviceToken: pending.deviceToken, deviceType: 'MOBILE', userId: request.userId },
        update: { userId: request.userId, deviceType: 'MOBILE', isActive: true },
      })
    })
    return { device: { id: device.id, deviceType: device.deviceType, isActive: device.isActive } }
  }

  @Delete('devices/:id')
  async remove(@Req() request: UserRequest, @Param('id') id: string) {
    return this.users.removeDevice(request.userId, id)
  }
}
