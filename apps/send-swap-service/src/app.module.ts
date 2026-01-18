import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    ConfigModule.forRoot({
      envFilePath: '../../.env',
    }),
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
