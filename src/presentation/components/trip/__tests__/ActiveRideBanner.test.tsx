import { fireEvent, render } from '@testing-library/react-native';

import { ActiveRideBanner } from '@presentation/components/trip/ActiveRideBanner';

describe('ActiveRideBanner', () => {
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <ActiveRideBanner
        visible={false}
        statusLabel=""
        onReturn={() => {}}
        topInset={0}
      />,
    );
    expect(queryByTestId('active-ride-banner')).toBeNull();
  });

  it('renders the status label when visible', () => {
    const { getByTestId, getByText } = render(
      <ActiveRideBanner
        visible
        statusLabel="Driver on the way"
        onReturn={() => {}}
        topInset={0}
      />,
    );
    expect(getByTestId('active-ride-banner')).toBeTruthy();
    expect(getByText('Driver on the way')).toBeTruthy();
  });

  it('calls onReturn when pressed', () => {
    const onReturn = jest.fn();
    const { getByTestId } = render(
      <ActiveRideBanner
        visible
        statusLabel="On your trip"
        onReturn={onReturn}
        topInset={0}
      />,
    );
    fireEvent.press(getByTestId('active-ride-banner'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
