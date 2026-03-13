import {
  Controller,
  Post,
  Body,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { SiweMessage } from 'siwe';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

const JWT_SECRET = process.env.SIWE_JWT_SECRET || 'affiliate-siwe-secret-dev';
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

const nonceStore = new Map<string, { createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of nonceStore.entries()) {
    if (now - data.createdAt > NONCE_EXPIRY_MS) {
      nonceStore.delete(nonce);
    }
  }
}, 60_000);

@Controller('v1/auth/siwe')
export class SiweAuthController {
  @Post('nonce')
  generateNonce(): { nonce: string } {
    const nonce = crypto.randomBytes(16).toString('hex');
    nonceStore.set(nonce, { createdAt: Date.now() });
    return { nonce };
  }

  @Post('verify')
  async verify(
    @Body() body: { message: string; signature: string },
  ): Promise<{ token: string; address: string }> {
    if (!body.message || !body.signature) {
      throw new BadRequestException('message and signature are required');
    }

    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(body.message);
    } catch {
      throw new BadRequestException('Invalid SIWE message format');
    }

    const nonceData = nonceStore.get(siweMessage.nonce);
    if (!nonceData) {
      throw new UnauthorizedException('Invalid or expired nonce');
    }

    if (Date.now() - nonceData.createdAt > NONCE_EXPIRY_MS) {
      nonceStore.delete(siweMessage.nonce);
      throw new UnauthorizedException('Nonce has expired');
    }

    try {
      await siweMessage.verify({ signature: body.signature });
    } catch {
      throw new UnauthorizedException('Invalid signature');
    }

    nonceStore.delete(siweMessage.nonce);

    const address = siweMessage.address.toLowerCase();
    const token = jwt.sign({ address }, JWT_SECRET, { expiresIn: '24h' });

    return { token, address };
  }
}
