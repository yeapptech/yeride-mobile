import { fireEvent, render } from '@testing-library/react-native';

import { Button } from '../Button';

describe('Button', () => {
  it('renders the label and fires onPress when enabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button label="Confirm ride" onPress={onPress} testID="cta" />,
    );
    fireEvent.press(getByText('Confirm ride'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button label="Continue" onPress={onPress} disabled testID="cta" />,
    );
    fireEvent.press(getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows a spinner instead of the label while loading and blocks presses', () => {
    const onPress = jest.fn();
    const { queryByText, getByTestId } = render(
      <Button label="Confirm ride" onPress={onPress} loading testID="cta" />,
    );
    expect(queryByText('Confirm ride')).toBeNull();
    fireEvent.press(getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks busy/disabled accessibility state while loading', () => {
    const { getByTestId } = render(
      <Button label="Go" onPress={jest.fn()} loading testID="cta" />,
    );
    expect(getByTestId('cta').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });
});
