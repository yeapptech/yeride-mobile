import { render } from '@testing-library/react-native';

import { Money } from '@domain/entities/Money';
import { Payout, type PayoutStatus } from '@domain/entities/Payout';

import { PayoutRow } from '../PayoutRow';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makePayout(args: {
  readonly id: string;
  readonly status: PayoutStatus;
  readonly amountMinor: number;
}): Payout {
  return unwrap(
    Payout.create({
      id: args.id,
      amount: unwrap(Money.create(args.amountMinor, 'USD')),
      status: args.status,
      arrivalDate: new Date('2026-04-29T12:00:00Z'),
    }),
  );
}

describe('PayoutRow', () => {
  it('renders amount + paid pill', () => {
    const payout = makePayout({
      id: 'po_1',
      status: 'paid',
      amountMinor: 5_000,
    });
    const { getByTestId, getByText } = render(<PayoutRow payout={payout} />);

    expect(getByTestId('payout-row-po_1')).toBeTruthy();
    expect(getByTestId('payout-status-paid')).toBeTruthy();
    expect(getByText('$50.00')).toBeTruthy();
    expect(getByText('Paid')).toBeTruthy();
  });

  it('renders pending pill', () => {
    const payout = makePayout({
      id: 'po_2',
      status: 'pending',
      amountMinor: 1_234,
    });
    const { getByTestId, getByText } = render(<PayoutRow payout={payout} />);

    expect(getByTestId('payout-status-pending')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
    expect(getByText('$12.34')).toBeTruthy();
  });

  it('renders failed pill with the right label', () => {
    const payout = makePayout({
      id: 'po_3',
      status: 'failed',
      amountMinor: 0,
    });
    const { getByText } = render(<PayoutRow payout={payout} />);

    expect(getByText('Failed')).toBeTruthy();
    expect(getByText('$0.00')).toBeTruthy();
  });
});
