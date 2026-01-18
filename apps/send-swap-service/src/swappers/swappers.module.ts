import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SwapperManagerService } from './swapper-manager.service';

@Module({
  imports: [ConfigModule],
  providers: [SwapperManagerService],
  exports: [SwapperManagerService],
})
export class SwappersModule {}
