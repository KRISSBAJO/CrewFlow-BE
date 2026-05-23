import { addMinutes, makeInvoiceNo, toCents } from './domain';

describe('domain helpers', () => {
  it('converts display money to cents', () => {
    expect(toCents(149.99)).toBe(14999);
  });

  it('adds minutes without mutating the original date', () => {
    const start = new Date('2026-05-23T10:00:00.000Z');

    expect(addMinutes(start, 90).toISOString()).toBe(
      '2026-05-23T11:30:00.000Z',
    );
    expect(start.toISOString()).toBe('2026-05-23T10:00:00.000Z');
  });

  it('creates invoice numbers with the requested prefix', () => {
    expect(makeInvoiceNo('TEST')).toMatch(/^TEST-\d{8}-[A-Z0-9]{5}$/);
  });
});
