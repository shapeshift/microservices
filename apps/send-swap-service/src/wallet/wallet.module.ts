import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletManagerService } from './wallet-manager.service';
import { WalletInitService } from './wallet-init.service';

@Module({
  imports: [ConfigModule],
  providers: [WalletManagerService, WalletInitService],
  exports: [WalletManagerService, WalletInitService],
})
export class WalletModule {}
