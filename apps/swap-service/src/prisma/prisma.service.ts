import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { createPrismaAdapter, PrismaClient } from '@shapeshift/prisma'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createPrismaAdapter(20) })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
