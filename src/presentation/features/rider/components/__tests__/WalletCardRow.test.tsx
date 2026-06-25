import { fireEvent, render } from '@testing-library/react-native';

import { PaymentMethod, type CardBrand } from '@domain/entities/PaymentMethod';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';

import { WalletCardRow } from '../WalletCardRow';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makePM(args: {
  id: string;
  brand?: CardBrand;
  last4?: string;
  expiry?: { month: number; year: number } | null;
}): PaymentMethod {
  return unwrap(
    PaymentMethod.create({
      id: unwrap(PaymentMethodId.create(args.id)),
      brand: args.brand ?? 'visa',
      last4: args.last4 ?? '4242',
      expiry: args.expiry ?? null,
    }),
  );
}

describe('WalletCardRow', () => {
  it('renders brand label + last4 with no expiry suffix when expiry is null', () => {
    const method = makePM({ id: 'pm_visa001', brand: 'visa', last4: '4242' });
    const { queryByText } = render(
      <WalletCardRow
        method={method}
        isDefault={false}
        isSetDefaultInFlight={false}
        isDetachInFlight={false}
        onSetDefault={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(queryByText(/Visa •••• 4242/)).not.toBeNull();
    // No expiry suffix.
    expect(queryByText(/12\/30/)).toBeNull();
  });

  it('renders the expiry suffix when expiry is non-null', () => {
    const method = makePM({
      id: 'pm_amex001',
      brand: 'amex',
      last4: '0005',
      expiry: { month: 12, year: 2030 },
    });
    const { queryByText } = render(
      <WalletCardRow
        method={method}
        isDefault={false}
        isSetDefaultInFlight={false}
        isDetachInFlight={false}
        onSetDefault={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(queryByText(/Amex •••• 0005 · 12\/30/)).not.toBeNull();
  });

  it('shows the default indicator when isDefault is true', () => {
    const method = makePM({ id: 'pm_visa001' });
    const { queryByText } = render(
      <WalletCardRow
        method={method}
        isDefault={true}
        isSetDefaultInFlight={false}
        isDetachInFlight={false}
        onSetDefault={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(queryByText('Default')).not.toBeNull();
  });

  it('trash press fires onDelete with the row id', () => {
    const onDelete = jest.fn();
    const method = makePM({ id: 'pm_mc001' });
    const { getByTestId } = render(
      <WalletCardRow
        method={method}
        isDefault={false}
        isSetDefaultInFlight={false}
        isDetachInFlight={false}
        onSetDefault={() => undefined}
        onDelete={onDelete}
      />,
    );

    fireEvent.press(getByTestId('wallet-row-trash-pm_mc001'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(String(onDelete.mock.calls[0]?.[0])).toBe('pm_mc001');
  });

  it('row tap fires onSetDefault when not already default', () => {
    const onSetDefault = jest.fn();
    const method = makePM({ id: 'pm_disc001', brand: 'discover' });
    const { getByTestId } = render(
      <WalletCardRow
        method={method}
        isDefault={false}
        isSetDefaultInFlight={false}
        isDetachInFlight={false}
        onSetDefault={onSetDefault}
        onDelete={() => undefined}
      />,
    );

    fireEvent.press(getByTestId('wallet-row-tap-pm_disc001'));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(String(onSetDefault.mock.calls[0]?.[0])).toBe('pm_disc001');
  });

  it('shows spinners when in-flight flags are set', () => {
    const method = makePM({ id: 'pm_visa001' });
    const { queryByTestId } = render(
      <WalletCardRow
        method={method}
        isDefault={false}
        isSetDefaultInFlight={true}
        isDetachInFlight={true}
        onSetDefault={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(queryByTestId('wallet-row-set-default-spinner')).not.toBeNull();
    expect(queryByTestId('wallet-row-trash-spinner')).not.toBeNull();
  });
});
