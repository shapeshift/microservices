import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SwapperManagerService } from './swapper-manager.service';
import { GasCalculatorService } from './gas-calculator.service';

@Module({
  imports: [ConfigModule],
  providers: [SwapperManagerService, GasCalculatorService],
  exports: [SwapperManagerService, GasCalculatorService],
})
export class SwappersModule {}
