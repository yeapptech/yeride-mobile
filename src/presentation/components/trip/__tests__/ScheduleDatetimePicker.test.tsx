import { fireEvent, render } from '@testing-library/react-native';

import { ScheduleDatetimePicker } from '../ScheduleDatetimePicker';

describe('ScheduleDatetimePicker', () => {
  it('renders nothing visible when visible=false', () => {
    const { queryByTestId } = render(
      <ScheduleDatetimePicker
        visible={false}
        onClose={jest.fn()}
        onSchedule={jest.fn()}
      />,
    );
    // RN Modal returns null children when not visible.
    expect(queryByTestId('schedule-datetime-picker-confirm')).toBeNull();
  });

  it('renders the title, the formatted row, and the confirm button when visible', () => {
    const initial = new Date(Date.now() + 60 * 60_000); // 1h from now
    const { getByText, getByTestId } = render(
      <ScheduleDatetimePicker
        visible={true}
        initialDate={initial}
        title="Schedule Your Ride"
        buttonText="Schedule Ride"
        onClose={jest.fn()}
        onSchedule={jest.fn()}
      />,
    );
    expect(getByText('Schedule Your Ride')).toBeTruthy();
    expect(getByText('Schedule Ride')).toBeTruthy();
    expect(getByTestId('schedule-datetime-picker-row')).toBeTruthy();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <ScheduleDatetimePicker
        visible={true}
        onClose={onClose}
        onSchedule={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('schedule-datetime-picker-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the minimum-minutes error when the picked date is too soon', () => {
    // Picker's `handleSchedule` validates against `now + minimumMinutes`.
    // Default initialDate = `new Date()` (now), so confirm immediately
    // surfaces the error.
    const { getByTestId, queryByTestId } = render(
      <ScheduleDatetimePicker
        visible={true}
        minimumMinutes={15}
        onClose={jest.fn()}
        onSchedule={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('schedule-datetime-picker-confirm'));
    expect(queryByTestId('schedule-datetime-picker-error')).not.toBeNull();
  });

  it('calls onSchedule + onClose when the picked date is past the minimum', () => {
    const onSchedule = jest.fn();
    const onClose = jest.fn();
    // 30 minutes ahead — well past the 15-minute floor.
    const future = new Date(Date.now() + 30 * 60_000);
    const { getByTestId } = render(
      <ScheduleDatetimePicker
        visible={true}
        initialDate={future}
        minimumMinutes={15}
        onClose={onClose}
        onSchedule={onSchedule}
      />,
    );
    fireEvent.press(getByTestId('schedule-datetime-picker-confirm'));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(onSchedule).toHaveBeenCalledWith(future);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('emits a Date strictly greater than the minimum (boundary)', () => {
    const onSchedule = jest.fn();
    const future = new Date(Date.now() + 30 * 60_000);
    const { getByTestId } = render(
      <ScheduleDatetimePicker
        visible={true}
        initialDate={future}
        onClose={jest.fn()}
        onSchedule={onSchedule}
      />,
    );
    fireEvent.press(getByTestId('schedule-datetime-picker-confirm'));
    expect(onSchedule).toHaveBeenCalled();
    const arg = onSchedule.mock.calls[0]?.[0] as Date;
    expect(arg.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
});
