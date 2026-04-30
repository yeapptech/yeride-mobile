import { fireEvent, render } from '@testing-library/react-native';

import { Money } from '@domain/entities/Money';

import type { TipFlowState } from '../../view-models/useTipFlowViewModel';
import { TipSelector } from '../TipSelector';

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number): Money {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const noop = (): void => undefined;

const idleState: TipFlowState = {
  kind: 'idle',
  isCustom: false,
  customText: '',
  selectedPresetMinor: null,
  onSelectPreset: noop,
  onSelectCustom: noop,
  onCustomAmountChange: noop,
};

describe('TipSelector', () => {
  it('renders nothing on the hidden arm', () => {
    const { queryByTestId } = render(
      <TipSelector state={{ kind: 'hidden' }} />,
    );
    expect(queryByTestId('tip-selector')).toBeNull();
    expect(queryByTestId('tip-selector-submitted')).toBeNull();
  });

  it('renders preset chips and a disabled submit on idle', () => {
    const { getByTestId, getAllByText } = render(
      <TipSelector state={idleState} />,
    );
    expect(getByTestId('tip-selector')).toBeTruthy();
    expect(getByTestId('tip-selector-preset-100')).toBeTruthy();
    expect(getByTestId('tip-selector-preset-300')).toBeTruthy();
    expect(getByTestId('tip-selector-preset-500')).toBeTruthy();
    expect(getByTestId('tip-selector-preset-custom')).toBeTruthy();
    // Both the header and the disabled submit read "Tip your driver".
    expect(getAllByText('Tip your driver').length).toBeGreaterThanOrEqual(1);
    const submit = getByTestId('tip-selector-submit');
    expect(submit.props.accessibilityState.disabled).toBe(true);
  });

  it('forwards a $3 preset tap through onSelectPreset', () => {
    const onSelectPreset = jest.fn();
    const { getByTestId } = render(
      <TipSelector
        state={{
          ...idleState,
          onSelectPreset,
        }}
      />,
    );
    fireEvent.press(getByTestId('tip-selector-preset-300'));
    expect(onSelectPreset).toHaveBeenCalledWith(300);
  });

  it('on selected: enables submit, shows "Tip $X", and forwards onSubmit', () => {
    const onSubmit = jest.fn();
    const { getByTestId, getByText } = render(
      <TipSelector
        state={{
          kind: 'selected',
          tipAmount: usd(3),
          isCustom: false,
          customText: '',
          selectedPresetMinor: 300,
          onSelectPreset: noop,
          onSelectCustom: noop,
          onCustomAmountChange: noop,
          onSubmit,
        }}
      />,
    );
    expect(getByText('Tip $3.00')).toBeTruthy();
    const submit = getByTestId('tip-selector-submit');
    expect(submit.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('on custom-mode idle: shows the TextInput and forwards onCustomAmountChange', () => {
    const onCustomAmountChange = jest.fn();
    const { getByTestId } = render(
      <TipSelector
        state={{
          ...idleState,
          isCustom: true,
          onCustomAmountChange,
        }}
      />,
    );
    const input = getByTestId('tip-selector-custom-input');
    fireEvent.changeText(input, '7');
    expect(onCustomAmountChange).toHaveBeenCalledWith('7');
  });

  it('on submitting: shows the spinner and disables the submit', () => {
    const { getByTestId } = render(
      <TipSelector state={{ kind: 'submitting', tipAmount: usd(3) }} />,
    );
    expect(getByTestId('tip-selector-submit-spinner')).toBeTruthy();
    expect(
      getByTestId('tip-selector-submit').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('on submitted: renders a thank-you strip in place of the form', () => {
    const { getByTestId, queryByTestId } = render(
      <TipSelector state={{ kind: 'submitted', tipAmount: usd(5) }} />,
    );
    expect(getByTestId('tip-selector-submitted')).toBeTruthy();
    // The form chips are replaced.
    expect(queryByTestId('tip-selector-presets')).toBeNull();
  });

  it('on error: shows the error band and routes Dismiss through onDismissError', () => {
    const onDismissError = jest.fn();
    const { getByTestId } = render(
      <TipSelector
        state={{
          kind: 'error',
          error: { kind: 'network', message: 'down' },
          tipAmount: usd(3),
          isCustom: false,
          customText: '',
          selectedPresetMinor: 300,
          onSelectPreset: noop,
          onSelectCustom: noop,
          onCustomAmountChange: noop,
          onSubmit: noop,
          onDismissError,
        }}
      />,
    );
    expect(getByTestId('tip-selector-error')).toBeTruthy();
    fireEvent.press(getByTestId('tip-selector-error-dismiss'));
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
