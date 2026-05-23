import { BadRequestException } from '@nestjs/common';

export function toCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException('Amount must be a positive number');
  }

  return Math.round(amount * 100);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function makeInvoiceNo(prefix = 'INV'): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}
