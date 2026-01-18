import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletManagerService } from './wallet-manager.service';

@Module({
  imports: [ConfigModule],
  providers: [WalletManagerService],
  exports: [WalletManagerService],
})
export class WalletModule {}
