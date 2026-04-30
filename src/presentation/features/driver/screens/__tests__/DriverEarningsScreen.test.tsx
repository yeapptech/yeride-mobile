import { fireEvent, render } from '@testing-library/react-native';

import { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import { Money } from '@domain/entities/Money';
import { Payout } from '@domain/entities/Payout';
import { StripeAccountId } from '@domain/entities/StripeAccountId';

import DriverEarningsScreen from '../DriverEarningsScreen';

/**
 * Smoke renders for the driver Earnings screen. The view-model is mocked
 * at the hook seam so each test can hand a tagged-union state directly
 * into the screen — keeping these tests isolated from the data layer +
 * Stripe integration tested by `useDriverEarningsViewModel.test.tsx`.
 */

const mockUseDriverEarningsViewModel = jest.fn();
jest.mock('../../view-models/useDriverEarningsViewModel', () => ({
  useDriverEarningsViewModel: () => mockUseDriverEarningsViewModel(),
}));

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const aid = unwrap(StripeAccountId.create('acct_smokeTest1'));

const samplePayout = unwrap(
  Payout.create({
    id: 'po_smoke',
    amount: unwrap(Money.create(5_000, 'USD')),
    status: 'paid',
    arrivalDate: new Date('2026-04-29T12:00:00Z'),
  }),
);
const sampleTxn = unwrap(
  BalanceTransaction.create({
    id: 'txn_smoke',
    amount: unwrap(Money.create(2_500, 'USD')),
    fee: unwrap(Money.create(100, 'USD')),
    net: unwrap(Money.create(2_400, 'USD')),
    createdAt: new Date('2026-04-29T12:00:00Z'),
    type: 'charge',
    tripId: null,
  }),
);

describe('DriverEarningsScreen', () => {
  beforeEach(() => {
    mockUseDriverEarningsViewModel.mockReset();
  });

  it('renders the unconfigured state when no publishable key is configured', () => {
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: { kind: 'unconfigured' },
    });

    const { queryByText } = render(<DriverEarningsScreen />);
    expect(queryByText(/Earnings unavailable/)).not.toBeNull();
  });

  it('renders the loading spinner', () => {
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: { kind: 'loading' },
    });

    const { getByTestId } = render(<DriverEarningsScreen />);
    expect(getByTestId('earnings-loading-spinner')).toBeTruthy();
  });

  it('renders no_account state with Set-up-payouts CTA', () => {
    const onSetupPayouts = jest.fn();
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: {
        kind: 'no_account',
        isOnboarding: false,
        onSetupPayouts,
      },
    });

    const { getByTestId } = render(<DriverEarningsScreen />);
    fireEvent.press(getByTestId('earnings-setup-payouts'));
    expect(onSetupPayouts).toHaveBeenCalledTimes(1);
  });

  it('renders pending state with Continue-setup CTA', () => {
    const onContinueSetup = jest.fn();
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: {
        kind: 'pending',
        accountId: aid,
        isOnboarding: false,
        onContinueSetup,
        onRefresh: jest.fn(),
        isRefreshing: false,
      },
    });

    const { getByTestId, queryByText } = render(<DriverEarningsScreen />);
    expect(queryByText(/verifying your account/i)).not.toBeNull();
    fireEvent.press(getByTestId('earnings-continue-setup'));
    expect(onContinueSetup).toHaveBeenCalledTimes(1);
  });

  it('renders enabled state with balance card + payouts + balance txns + dashboard', () => {
    const onViewExpressDashboard = jest.fn();
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: {
        kind: 'enabled',
        accountId: aid,
        available: unwrap(Money.create(12_450, 'USD')),
        pending: unwrap(Money.create(3_600, 'USD')),
        payouts: [samplePayout],
        balanceTxns: [sampleTxn],
        onViewExpressDashboard,
        isOpeningDashboard: false,
        onRefresh: jest.fn(),
        isRefreshing: false,
      },
    });

    const { getByTestId, queryByText } = render(<DriverEarningsScreen />);
    expect(getByTestId('earnings-balance-card')).toBeTruthy();
    expect(queryByText('$124.50')).not.toBeNull();
    expect(queryByText('$36.00')).not.toBeNull();
    expect(getByTestId('payout-row-po_smoke')).toBeTruthy();
    expect(getByTestId('balance-txn-row-txn_smoke')).toBeTruthy();

    fireEvent.press(getByTestId('earnings-express-dashboard'));
    expect(onViewExpressDashboard).toHaveBeenCalledTimes(1);
  });

  it('renders error state with Retry CTA', () => {
    const onRetry = jest.fn();
    mockUseDriverEarningsViewModel.mockReturnValue({
      state: {
        kind: 'error',
        error: new Error('boom'),
        onRetry,
      },
    });

    const { getByTestId, queryByText } = render(<DriverEarningsScreen />);
    expect(queryByText(/Couldn.+t load your earnings/)).not.toBeNull();
    fireEvent.press(getByTestId('earnings-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
