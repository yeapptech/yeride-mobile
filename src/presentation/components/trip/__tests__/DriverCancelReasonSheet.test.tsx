import { fireEvent, render } from '@testing-library/react-native';

import { CancellationReason } from '@domain/entities/CancellationReason';

import { DriverCancelReasonSheet } from '../DriverCancelReasonSheet';

/**
 * Rendering tests for the DriverCancelReasonSheet — the per-reason picker
 * the driver sees when cancelling a ride. Companion to the existing
 * useDriverMonitorViewModel.test.tsx coverage.
 *
 * What we assert here:
 *   1. Code list filter — only driver-allowed codes render. In particular
 *      `'driver_no_show'` (rider-only) must NOT appear, and
 *      `'passenger_no_show'` (driver-only) MUST appear.
 *   2. `'other'` reasonText gating — confirm button stays disabled until
 *      the freeform field has a non-empty value.
 *   3. Confirm builds a `CancellationReason` with the right `code` and
 *      `reasonText`, then calls `onConfirm` with it.
 */
describe('DriverCancelReasonSheet', () => {
  const noop = (): void => undefined;

  it('renders only driver-allowed codes (no driver_no_show)', () => {
    const { queryByTestId } = render(
      <DriverCancelReasonSheet
        visible={true}
        onClose={noop}
        onConfirm={noop}
      />,
    );
    // Driver-allowed codes — must all be present.
    expect(queryByTestId('driver-cancel-reason-changed_mind')).not.toBeNull();
    expect(
      queryByTestId('driver-cancel-reason-passenger_no_show'),
    ).not.toBeNull();
    expect(
      queryByTestId('driver-cancel-reason-vehicle_malfunction'),
    ).not.toBeNull();
    expect(
      queryByTestId('driver-cancel-reason-vehicle_accident'),
    ).not.toBeNull();
    expect(
      queryByTestId('driver-cancel-reason-safety_concerns'),
    ).not.toBeNull();
    expect(queryByTestId('driver-cancel-reason-other')).not.toBeNull();
    // Driver should NOT see the rider-only `driver_no_show` code.
    expect(queryByTestId('driver-cancel-reason-driver_no_show')).toBeNull();
  });

  it("'other' branch requires non-empty reasonText before confirm fires", () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <DriverCancelReasonSheet
        visible={true}
        onClose={noop}
        onConfirm={onConfirm}
      />,
    );

    // Pick "Other" — text input appears and the confirm button stays
    // gated on a non-empty value.
    fireEvent.press(getByTestId('driver-cancel-reason-other'));
    fireEvent.press(getByTestId('driver-cancel-reason-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    // Whitespace-only is treated as empty (the sheet trims).
    fireEvent.changeText(getByTestId('driver-cancel-reason-other-text'), '   ');
    fireEvent.press(getByTestId('driver-cancel-reason-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    // Real text — confirm fires now.
    fireEvent.changeText(
      getByTestId('driver-cancel-reason-other-text'),
      'rider was abusive',
    );
    fireEvent.press(getByTestId('driver-cancel-reason-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirm builds CancellationReason with the selected code and trimmed text', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <DriverCancelReasonSheet
        visible={true}
        onClose={noop}
        onConfirm={onConfirm}
      />,
    );

    // Pick the driver-only code and confirm.
    fireEvent.press(getByTestId('driver-cancel-reason-passenger_no_show'));
    fireEvent.press(getByTestId('driver-cancel-reason-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]?.[0] as CancellationReason;
    expect(arg).toBeInstanceOf(CancellationReason);
    expect(arg.code).toBe('passenger_no_show');
    // Non-`other` codes carry no reasonText.
    expect(arg.reasonText).toBeNull();
  });

  it("'other' confirm carries the trimmed reasonText", () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <DriverCancelReasonSheet
        visible={true}
        onClose={noop}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.press(getByTestId('driver-cancel-reason-other'));
    fireEvent.changeText(
      getByTestId('driver-cancel-reason-other-text'),
      '  car broke down  ',
    );
    fireEvent.press(getByTestId('driver-cancel-reason-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]?.[0] as CancellationReason;
    expect(arg.code).toBe('other');
    expect(arg.reasonText).toBe('car broke down');
  });
});
