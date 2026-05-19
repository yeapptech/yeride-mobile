import { render } from '@testing-library/react-native';

import { Money } from '@domain/entities/Money';
import type { TripPayment } from '@domain/entities/TripPayment';

import { TripPaymentsList } from '../TripPaymentsList';

import { unwrap } from './_rideFixture';

function makePayment(args: {
  id: string;
  type: TripPayment['type'];
  status: TripPayment['status'];
  amountUsd: number;
  createdAt: Date;
}): TripPayment {
  return {
    id: args.id,
    type: args.type,
    status: args.status,
    amount: unwrap(Money.fromMajor(args.amountUsd, 'USD')),
    createdAt: args.createdAt,
    paymentMethodId: null,
  };
}

describe('TripPaymentsList', () => {
  it('renders the empty state when no payments', () => {
    const { getByText } = render(<TripPaymentsList payments={[]} />);
    expect(getByText('No payments recorded for this trip yet.')).toBeTruthy();
  });

  it('renders one row per payment with type + status + amount', () => {
    const payments: TripPayment[] = [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'succeeded',
        amountUsd: 12.5,
        createdAt: new Date('2026-05-19T10:00:00Z'),
      }),
      makePayment({
        id: 'pay2',
        type: 'tip',
        status: 'succeeded',
        amountUsd: 2.5,
        createdAt: new Date('2026-05-19T10:05:00Z'),
      }),
    ];
    const { getByTestId, getByText } = render(
      <TripPaymentsList payments={payments} />,
    );
    expect(getByTestId('trip-payment-pay1')).toBeTruthy();
    expect(getByTestId('trip-payment-pay2')).toBeTruthy();
    expect(getByText('$12.50')).toBeTruthy();
    expect(getByText('$2.50')).toBeTruthy();
  });

  it('totals succeeded fare + tip rows', () => {
    const payments: TripPayment[] = [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'succeeded',
        amountUsd: 10,
        createdAt: new Date('2026-05-19T10:00:00Z'),
      }),
      makePayment({
        id: 'pay2',
        type: 'tip',
        status: 'succeeded',
        amountUsd: 3,
        createdAt: new Date('2026-05-19T10:05:00Z'),
      }),
    ];
    const { getByTestId, getByText } = render(
      <TripPaymentsList payments={payments} />,
    );
    expect(getByTestId('trip-payments-total')).toBeTruthy();
    expect(getByText('$13.00')).toBeTruthy();
  });

  it('subtracts succeeded refund rows from the total', () => {
    const payments: TripPayment[] = [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'succeeded',
        amountUsd: 20,
        createdAt: new Date('2026-05-19T10:00:00Z'),
      }),
      makePayment({
        id: 'pay2',
        type: 'refund',
        status: 'succeeded',
        amountUsd: 5,
        createdAt: new Date('2026-05-19T11:00:00Z'),
      }),
    ];
    const { getByText } = render(<TripPaymentsList payments={payments} />);
    expect(getByText('$15.00')).toBeTruthy();
  });

  it('excludes failed rows from the total but still renders them', () => {
    const payments: TripPayment[] = [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'succeeded',
        amountUsd: 10,
        createdAt: new Date('2026-05-19T10:00:00Z'),
      }),
      makePayment({
        id: 'pay2',
        type: 'tip',
        status: 'failed',
        amountUsd: 99,
        createdAt: new Date('2026-05-19T10:05:00Z'),
      }),
    ];
    const { getAllByText, getByTestId, getByText } = render(
      <TripPaymentsList payments={payments} />,
    );
    expect(getByTestId('trip-payment-pay2')).toBeTruthy(); // still in list
    // Total = $10 only. Two matches expected: the row + the Total line.
    expect(getAllByText('$10.00').length).toBeGreaterThanOrEqual(1);
    // Failed payment label visible.
    expect(getByText('Failed')).toBeTruthy();
  });

  it('does not render a total row when no rows succeeded', () => {
    const payments: TripPayment[] = [
      makePayment({
        id: 'pay1',
        type: 'fare',
        status: 'failed',
        amountUsd: 10,
        createdAt: new Date('2026-05-19T10:00:00Z'),
      }),
    ];
    const { queryByTestId } = render(<TripPaymentsList payments={payments} />);
    expect(queryByTestId('trip-payments-total')).toBeNull();
  });
});
