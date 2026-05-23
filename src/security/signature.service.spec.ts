import { createHmac } from 'crypto';
import { SignatureService } from './signature.service';

describe('SignatureService', () => {
  const service = new SignatureService();

  it('verifies prefixed HMAC SHA256 signatures', () => {
    const payload = '{"hello":"world"}';
    const secret = 'secret';
    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    expect(
      service.verifyHmacSha256({
        secret,
        payload,
        signature: `sha256=${signature}`,
        prefix: 'sha256=',
      }),
    ).toBe(true);
  });

  it('rejects invalid HMAC SHA256 signatures', () => {
    expect(
      service.verifyHmacSha256({
        secret: 'secret',
        payload: '{}',
        signature: 'sha256=deadbeef',
        prefix: 'sha256=',
      }),
    ).toBe(false);
  });

  it('verifies Stripe signed payloads', () => {
    const rawBody = '{"type":"checkout.session.completed"}';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = 'whsec_test';
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    expect(
      service.verifyStripeSignature({
        secret,
        rawBody,
        signature: `t=${timestamp},v1=${signature}`,
      }),
    ).toBe(true);
  });
});
