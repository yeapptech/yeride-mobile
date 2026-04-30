import { render } from '@testing-library/react-native';

import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import { Money } from '@domain/entities/Money';

import { BalanceTransactionRow } from '../BalanceTransactionRow';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makeTxn(args: {
  readonly id: string;
  readonly type: string;
  readonly amountMinor: number;
  readonly feeMinor: number;
}): BalanceTransaction {
  const amount = unwrap(Money.create(args.amountMinor, 'USD'));
  const fee = unwrap(Money.create(args.feeMinor, 'USD'));
  const net = unwrap(Money.create(args.amountMinor - args.feeMinor, 'USD'));
  return unwrap(
    BalanceTransaction.create({
      id: args.id,
      amount,
      fee,
      net,
      createdAt: new Date('2026-04-29T12:00:00Z'),
      type: args.type,
      tripId: null,
    }),
  );
}

describe('BalanceTransactionRow', () => {
  it('renders charge with mapped friendly label and fee subline', () => {
    const txn = makeTxn({
      id: 'txn_1',
      type: 'charge',
      amountMinor: 25_00,
      feeMinor: 1_00,
    });
    const { getByTestId, getByText, queryByText } = render(
      <BalanceTransactionRow txn={txn} />,
    );

    expect(getByTestId('balance-txn-row-txn_1')).toBeTruthy();
    expect(getByText('Payment received')).toBeTruthy();
    expect(getByText('$25.00')).toBeTruthy();
    // Fee + net subline appears
    expect(queryByText(/fee \$1.00/)).toBeTruthy();
    expect(queryByText(/net \$24.00/)).toBeTruthy();
  });

  it('hides the fee/net subline when fee is zero', () => {
    const txn = makeTxn({
      id: 'txn_2',
      type: 'transfer',
      amountMinor: 10_00,
      feeMinor: 0,
    });
    const { queryByText } = render(<BalanceTransactionRow txn={txn} />);

    expect(queryByText(/fee/i)).toBeNull();
    expect(queryByText('Transfer')).toBeTruthy();
  });

  it('falls through to a humanized label for unknown types', () => {
    const txn = makeTxn({
      id: 'txn_3',
      type: 'topup',
      amountMinor: 5_00,
      feeMinor: 0,
    });
    const { getByText } = render(<BalanceTransactionRow txn={txn} />);

    expect(getByText('topup')).toBeTruthy();
  });
});
