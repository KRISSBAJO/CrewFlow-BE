import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class SignatureService {
  verifyHmacSha256(input: {
    secret: string;
    payload: string;
    signature?: string;
    prefix?: string;
  }) {
    if (!input.signature) {
      return false;
    }
    const expected = createHmac('sha256', input.secret)
      .update(input.payload)
      .digest('hex');
    const provided = input.signature.startsWith(input.prefix ?? '')
      ? input.signature.slice((input.prefix ?? '').length)
      : input.signature;

    return this.safeCompare(expected, provided);
  }

  verifyStripeSignature(input: {
    secret: string;
    rawBody: string;
    signature?: string;
    toleranceSeconds?: number;
  }) {
    if (!input.signature) {
      return false;
    }
    const parts = new Map(
      input.signature.split(',').map((part) => {
        const [key, value] = part.split('=');
        return [key, value];
      }),
    );
    const timestamp = parts.get('t');
    const signature = parts.get('v1');
    if (!timestamp || !signature) {
      return false;
    }

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (age > (input.toleranceSeconds ?? 300)) {
      return false;
    }

    const expected = createHmac('sha256', input.secret)
      .update(`${timestamp}.${input.rawBody}`)
      .digest('hex');
    return this.safeCompare(expected, signature);
  }

  private safeCompare(expected: string, provided: string) {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(provided, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
