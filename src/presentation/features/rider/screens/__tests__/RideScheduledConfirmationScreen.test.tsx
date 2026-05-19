import { fireEvent, render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

import RideScheduledConfirmationScreen from '../RideScheduledConfirmationScreen';

function renderScreen(
  formattedSchedulePickupAt: string,
  pickupAddress: string | null,
) {
  const route = {
    key: 'RideScheduledConfirmation',
    name: 'RideScheduledConfirmation' as const,
    params: { formattedSchedulePickupAt, pickupAddress },
  };
  // The screen reads `route.params` plus a navigation hook (mocked
  // above). `navigation` itself isn't accessed by the screen body, but
  // the typed signature requires it to be present.
  const props = {
    route,
    navigation: {} as never,
  };
  return render(
    <RideScheduledConfirmationScreen
      {...(props as Parameters<typeof RideScheduledConfirmationScreen>[0])}
    />,
  );
}

describe('RideScheduledConfirmationScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders the formatted pickup datetime + pickup address', () => {
    const { getByTestId } = renderScreen(
      'Tomorrow at 9:00 AM',
      '123 Main St, Sunrise, FL',
    );
    expect(
      getByTestId('ride-scheduled-confirmation-datetime'),
    ).toHaveTextContent('Tomorrow at 9:00 AM');
    expect(
      getByTestId('ride-scheduled-confirmation-address'),
    ).toHaveTextContent('123 Main St, Sunrise, FL');
  });

  it('hides the address row when pickupAddress is null', () => {
    const { queryByTestId } = renderScreen('Tomorrow at 9:00 AM', null);
    expect(queryByTestId('ride-scheduled-confirmation-address')).toBeNull();
  });

  it('navigates back to RiderTabs > RiderHome on "Got it"', () => {
    const { getByTestId } = renderScreen('Tomorrow at 9:00 AM', '123 Main');
    fireEvent.press(getByTestId('ride-scheduled-confirmation-done'));
    expect(mockNavigate).toHaveBeenCalledWith('RiderTabs', {
      screen: 'RiderHome',
    });
  });

  it('renders the reassurance line', () => {
    const { getByText } = renderScreen('Tomorrow at 9:00 AM', '123 Main');
    expect(
      getByText("We'll match you with a driver before your pickup time."),
    ).toBeTruthy();
  });
});
