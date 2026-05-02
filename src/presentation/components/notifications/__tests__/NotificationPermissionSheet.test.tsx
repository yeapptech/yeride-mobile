import { fireEvent, render } from '@testing-library/react-native';

import { NotificationPermissionSheet } from '../NotificationPermissionSheet';

describe('NotificationPermissionSheet', () => {
  it('renders nothing when visible is false', () => {
    const { queryByTestId } = render(
      <NotificationPermissionSheet
        visible={false}
        onEnable={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(queryByTestId('notification-permission-sheet')).toBeNull();
  });

  it('renders the title + body + both CTAs when visible', () => {
    const { getByText, getByTestId } = render(
      <NotificationPermissionSheet
        visible={true}
        onEnable={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(getByText('Stay updated on your rides')).toBeDefined();
    expect(getByTestId('notification-permission-enable')).toBeDefined();
    expect(getByTestId('notification-permission-dismiss')).toBeDefined();
  });

  it('fires onEnable when the primary CTA is pressed', () => {
    const onEnable = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <NotificationPermissionSheet
        visible={true}
        onEnable={onEnable}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('notification-permission-enable'));
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('fires onDismiss when the secondary CTA is pressed', () => {
    const onEnable = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <NotificationPermissionSheet
        visible={true}
        onEnable={onEnable}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByTestId('notification-permission-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('disables the Enable CTA while submitting (prevents double-tap)', () => {
    const onEnable = jest.fn();
    const { getByTestId } = render(
      <NotificationPermissionSheet
        visible={true}
        isSubmitting
        onEnable={onEnable}
        onDismiss={() => {}}
      />,
    );
    fireEvent.press(getByTestId('notification-permission-enable'));
    expect(onEnable).not.toHaveBeenCalled();
  });
});
