import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { UserId } from '@domain/entities/UserId';
import {
  makeAwaitingRide,
  makeRideAt,
  unwrap,
} from '@presentation/components/trip/__tests__/_rideFixture';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  FakeCrashReportingService,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

import ActivityScreen from '../ActivityScreen';

const PASSENGER_ID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

// react-native-toast-message is mounted indirectly by DevToolsSection
// in some builds; stub it so jest doesn't choke on native references.
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: () => null,
}));

function withProvider(
  children: ReactNode,
  rides: InMemoryRideRepository = new InMemoryRideRepository(),
) {
  return (
    <TestContainerProvider
      rides={rides}
      crashReporting={new FakeCrashReportingService()}
    >
      {children}
    </TestContainerProvider>
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  // Seed the session store so `useCurrentUserId()` resolves the
  // passenger before the activity VM runs.
  useSessionStore.setState({
    status: 'authenticated',
    userId: PASSENGER_ID,
  });
});

afterAll(() => {
  useSessionStore.setState({ status: 'initializing', userId: null });
});

describe('ActivityScreen', () => {
  it('renders the empty state when the passenger has no rides', async () => {
    const { getByTestId } = render(withProvider(<ActivityScreen />));
    await waitFor(() => {
      expect(getByTestId('activity-empty')).toBeTruthy();
    });
  });

  it('renders one TripCard per ride after data loads', async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(
      makeAwaitingRide({
        id: 'rideOne12345678901abcd',
        passengerId: String(PASSENGER_ID),
      }),
    );
    rides.seed(
      makeAwaitingRide({
        id: 'rideTwo12345678901abcd',
        passengerId: String(PASSENGER_ID),
        createdAt: new Date('2026-05-01T00:00:00Z'),
      }),
    );

    const { getByTestId } = render(withProvider(<ActivityScreen />, rides));
    await waitFor(() => {
      expect(getByTestId('trip-card-rideOne12345678901abcd')).toBeTruthy();
    });
    expect(getByTestId('trip-card-rideTwo12345678901abcd')).toBeTruthy();
  });

  it('mounts the DevToolsSection footer', async () => {
    const { getByTestId } = render(withProvider(<ActivityScreen />));
    await waitFor(() => {
      expect(getByTestId('activity-empty')).toBeTruthy();
    });
    expect(getByTestId('dev-tools-section')).toBeTruthy();
  });

  it('tapping a completed ride navigates to TripDetail', async () => {
    const rides = new InMemoryRideRepository();
    const completed = makeRideAt('completed', 'rideAct123456789abcde');
    rides.seed(completed);

    const { getByTestId } = render(withProvider(<ActivityScreen />, rides));
    await waitFor(() => {
      expect(getByTestId(`trip-card-${String(completed.id)}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`trip-card-${String(completed.id)}`));

    expect(mockNavigate).toHaveBeenCalledWith('TripDetail', {
      rideId: 'rideAct123456789abcde',
    });
  });

  it('tapping an active ride navigates to RideMonitor', async () => {
    const rides = new InMemoryRideRepository();
    const awaiting = makeAwaitingRide({
      id: 'rideActLiv123456789ab',
      passengerId: String(PASSENGER_ID),
    });
    rides.seed(awaiting);

    const { getByTestId } = render(withProvider(<ActivityScreen />, rides));
    await waitFor(() => {
      expect(getByTestId(`trip-card-${String(awaiting.id)}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`trip-card-${String(awaiting.id)}`));

    expect(mockNavigate).toHaveBeenCalledWith('RideMonitor', {
      rideId: 'rideActLiv123456789ab',
    });
  });

  it('renders Load more when there are more pages', async () => {
    const rides = new InMemoryRideRepository();
    // Page size 10; 11 rides → cursor returned.
    for (let i = 0; i < 11; i++) {
      rides.seed(
        makeAwaitingRide({
          id: `rideMany${String(i).padStart(2, '0')}xx12345`,
          passengerId: String(PASSENGER_ID),
          createdAt: new Date(2026, 0, 1, 0, 0, i),
        }),
      );
    }

    const { getByTestId } = render(withProvider(<ActivityScreen />, rides));
    await waitFor(() => {
      expect(getByTestId('activity-load-more')).toBeTruthy();
    });
  });
});
