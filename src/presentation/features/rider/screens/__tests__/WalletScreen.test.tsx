import { fireEvent, render } from '@testing-library/react-native';

import { PaymentMethod } from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';

import WalletScreen from '../WalletScreen';

/**
 * Smoke renders for the rider Wallet screen. The view-model is mocked at
 * the hook seam so each test can hand a tagged-union state directly into
 * the screen — keeping these tests isolated from the data layer + Stripe
 * integration tested by `useWalletViewModel.test.tsx`.
 */

const mockUseWalletViewModel = jest.fn();
jest.mock('../../view-models/useWalletViewModel', () => ({
  useWalletViewModel: () => mockUseWalletViewModel(),
}));

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const cid = unwrap(StripeCustomerId.create('cus_walletScreenTest'));
const pmId = unwrap(PaymentMethodId.create('pm_visaWalletScreen001'));
const visa = unwrap(
  PaymentMethod.create({
    id: pmId,
    brand: 'visa',
    last4: '4242',
    expiry: null,
  }),
);

describe('WalletScreen', () => {
  beforeEach(() => {
    mockUseWalletViewModel.mockReset();
  });

  it('renders the unconfigured state when no publishable key is configured', () => {
    mockUseWalletViewModel.mockReturnValue({
      state: { kind: 'unconfigured' },
    });

    const { queryByText } = render(<WalletScreen />);
    expect(queryByText(/Wallet unavailable/)).not.toBeNull();
  });

  it('renders the empty state with Add card CTA when rider has no methods', () => {
    const onAdd = jest.fn();
    mockUseWalletViewModel.mockReturnValue({
      state: {
        kind: 'empty',
        customerId: cid,
        onAdd,
        onRefresh: () => undefined,
        isRefreshing: false,
      },
    });

    const { getByTestId, queryByText } = render(<WalletScreen />);
    expect(queryByText(/No payment methods/)).not.toBeNull();
    fireEvent.press(getByTestId('wallet-empty-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders the populated list with the wallet row when ready', () => {
    mockUseWalletViewModel.mockReturnValue({
      state: {
        kind: 'ready',
        customerId: cid,
        methods: [visa],
        defaultMethodId: pmId,
        inFlight: { setDefault: new Set<string>(), detach: new Set<string>() },
        onAdd: () => undefined,
        onSetDefault: () => undefined,
        onDelete: () => undefined,
        onRefresh: () => undefined,
        isRefreshing: false,
      },
    });

    const { queryByText, queryByTestId } = render(<WalletScreen />);
    // Wallet header + Add affordance.
    expect(queryByText('Wallet')).not.toBeNull();
    expect(queryByTestId('wallet-header-add')).not.toBeNull();
    // Row content.
    expect(queryByText(/Visa •••• 4242/)).not.toBeNull();
    expect(queryByText('Default')).not.toBeNull();
  });
});
