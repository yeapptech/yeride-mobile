import { fireEvent, render } from '@testing-library/react-native';

import { PermissionDeniedBanner } from '../PermissionDeniedBanner';

describe('PermissionDeniedBanner', () => {
  it('renders title + message + Open settings CTA', () => {
    const onOpenSettings = jest.fn();
    const { getByText } = render(
      <PermissionDeniedBanner
        title="Location is off"
        message="We need your location to show the map."
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(getByText('Location is off')).toBeTruthy();
    expect(getByText('We need your location to show the map.')).toBeTruthy();
    expect(getByText('Open settings')).toBeTruthy();
  });

  it('fires onOpenSettings when the CTA is tapped', () => {
    const onOpenSettings = jest.fn();
    const { getByText } = render(
      <PermissionDeniedBanner
        title="Location is off"
        message="…"
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.press(getByText('Open settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('hides the dismiss button by default', () => {
    const { queryByText } = render(
      <PermissionDeniedBanner
        title="Title"
        message="Body"
        onOpenSettings={jest.fn()}
      />,
    );
    expect(queryByText('Not now')).toBeNull();
  });

  it('renders + wires the dismiss button when onDismiss is provided', () => {
    const onDismiss = jest.fn();
    const { getByText } = render(
      <PermissionDeniedBanner
        title="Title"
        message="Body"
        onOpenSettings={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByText('Not now'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses the provided testID for the wrapping View', () => {
    const { getByTestId } = render(
      <PermissionDeniedBanner
        title="t"
        message="m"
        onOpenSettings={jest.fn()}
        testID="my-banner"
      />,
    );
    expect(getByTestId('my-banner')).toBeTruthy();
    expect(getByTestId('my-banner-open-settings')).toBeTruthy();
  });
});
