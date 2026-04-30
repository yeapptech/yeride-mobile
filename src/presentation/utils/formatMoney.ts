import type { Money } from '@domain/entities/Money';

/**
 * Format a `Money` value as a USD-style currency string. Lives at the
 * neutral `presentation/utils/` location so both rider-side and
 * driver-side surfaces (Earnings tab, Payouts/BalanceTransactions rows,
 * the rider Tip CTA, etc.) share a single formatter.
 *
 * Phase 6 turn 5 is USD-only (legacy parity); when other currencies
 * arrive, swap the hardcoded `'USD'` for `money.currency` and let
 * `Intl.NumberFormat` route per-locale.
 *
 * Examples:
 *   formatMoney({ minorUnits: 12_345, currency: 'USD' })  → '$123.45'
 *   formatMoney({ minorUnits: 12_345_678, currency: 'USD' }) → '$123,456.78'
 *   formatMoney({ minorUnits: 0, currency: 'USD' })       → '$0.00'
 *
 * Negative balances are not currently constructible (`Money.create`
 * rejects negatives at the value-object boundary), but the formatter
 * handles a hypothetical signed input gracefully via `Intl.NumberFormat`
 * — future support for refunds / transfers-out can drop in negative
 * `minorUnits` and the formatter will render `-$X.YY`.
 */
export function formatMoney(money: Money): string {
  const major = money.minorUnits / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}
