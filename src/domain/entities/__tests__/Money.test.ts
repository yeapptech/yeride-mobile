import { Money } from '../Money';

describe('Money', () => {
  describe('create', () => {
    it('accepts positive integer minor units', () => {
      const r = Money.create(150, 'USD');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.minorUnits).toBe(150);
        expect(r.value.currency).toBe('USD');
        expect(r.value.majorUnits).toBe(1.5);
      }
    });

    it('accepts zero', () => {
      expect(Money.create(0, 'USD').ok).toBe(true);
    });

    it('rejects fractional minor units', () => {
      const r = Money.create(150.5, 'USD');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_non_integer_minor_units');
    });

    it('rejects negative amounts', () => {
      const r = Money.create(-1, 'USD');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_negative');
    });

    it('rejects amounts above the ceiling', () => {
      const r = Money.create(1_000_000_000_000, 'USD');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_overflow');
    });

    it('rejects unsupported currencies', () => {
      // We're forcing the type to test runtime guard.
      const r = Money.create(100, 'XYZ' as 'USD');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_unsupported_currency');
    });
  });

  describe('fromMajor', () => {
    it('rounds 1.5 to 150 cents', () => {
      const r = Money.fromMajor(1.5, 'USD');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.minorUnits).toBe(150);
    });

    it('rounds 1.005 to 100 cents (float artifact)', () => {
      // 1.005 in IEEE-754 is actually 1.00499999... so this rounds to 100.
      const r = Money.fromMajor(1.005, 'USD');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.minorUnits).toBe(100);
    });

    it('rejects NaN', () => {
      const r = Money.fromMajor(Number.NaN, 'USD');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_not_finite');
    });

    it('rejects Infinity', () => {
      const r = Money.fromMajor(Number.POSITIVE_INFINITY, 'USD');
      expect(r.ok).toBe(false);
    });
  });

  describe('arithmetic', () => {
    const fiveDollars = (() => {
      const r = Money.create(500, 'USD');
      if (!r.ok) throw r.error;
      return r.value;
    })();

    const twoDollars = (() => {
      const r = Money.create(200, 'USD');
      if (!r.ok) throw r.error;
      return r.value;
    })();

    it('adds two same-currency amounts', () => {
      const r = fiveDollars.add(twoDollars);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.minorUnits).toBe(700);
    });

    it('subtracts smaller from larger', () => {
      const r = fiveDollars.subtract(twoDollars);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.minorUnits).toBe(300);
    });

    it('rejects subtraction that would go negative', () => {
      const r = twoDollars.subtract(fiveDollars);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_negative');
    });

    it('multiplies by a non-negative factor and rounds', () => {
      const r = fiveDollars.multiply(0.15);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.minorUnits).toBe(75); // round(75) = 75
    });

    it('rejects negative multipliers', () => {
      const r = fiveDollars.multiply(-1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('money_invalid_factor');
    });

    it('rejects non-finite multipliers', () => {
      const r = fiveDollars.multiply(Number.NaN);
      expect(r.ok).toBe(false);
    });
  });

  describe('format', () => {
    it('formats USD with $ and two decimals', () => {
      const r = Money.create(12345, 'USD');
      if (r.ok) expect(r.value.format()).toBe('$123.45');
    });

    it('formats zero', () => {
      const r = Money.create(0, 'USD');
      if (r.ok) expect(r.value.format()).toBe('$0.00');
    });
  });

  describe('equals', () => {
    it('is true for matching amounts and currency', () => {
      const a = Money.create(100, 'USD');
      const b = Money.create(100, 'USD');
      if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(true);
    });

    it('is false for differing amounts', () => {
      const a = Money.create(100, 'USD');
      const b = Money.create(200, 'USD');
      if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(false);
    });
  });
});
