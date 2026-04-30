import { Money } from '@domain/entities/Money';
import { formatMoney } from '@presentation/utils/formatMoney';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

describe('formatMoney', () => {
  it('formats whole dollars with two decimals', () => {
    const m = unwrap(Money.create(10_000, 'USD'));
    expect(formatMoney(m)).toBe('$100.00');
  });

  it('formats sub-dollar amounts', () => {
    const m = unwrap(Money.create(45, 'USD'));
    expect(formatMoney(m)).toBe('$0.45');
  });

  it('formats large amounts with thousands separators', () => {
    const m = unwrap(Money.create(12_345_678, 'USD'));
    expect(formatMoney(m)).toBe('$123,456.78');
  });

  it('formats zero as $0.00', () => {
    const m = unwrap(Money.create(0, 'USD'));
    expect(formatMoney(m)).toBe('$0.00');
  });
});
