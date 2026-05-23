import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

type Bucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    if (this.config.get<string>('RATE_LIMIT_ENABLED', 'true') === 'false') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    const windowMs = Number(
      this.config.get<string>('RATE_LIMIT_WINDOW_MS', '60000'),
    );
    const max = Number(this.config.get<string>('RATE_LIMIT_MAX', '240'));
    const key = this.key(request);
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.cleanup(now);
      return true;
    }

    existing.count += 1;
    if (existing.count > max) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Too many requests',
          retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
        },
        429,
      );
    }

    return true;
  }

  private key(request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const ip =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : request.ip;
    return `${ip}:${request.method}:${request.path}`;
  }

  private cleanup(now: number) {
    if (this.buckets.size < 5000) {
      return;
    }
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
