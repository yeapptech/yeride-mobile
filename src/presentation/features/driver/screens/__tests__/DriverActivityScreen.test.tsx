import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { UserId } from '@domain/entities/UserId';
import {
  makeRideAt,
  unwrap,
} from '@presentation/components/trip/__tests__/_rideFixture';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  FakeCrashReportingService,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

import DriverActivityScreen from '../DriverActivityScreen';

const DRIVER_ID = unwrap(UserId.create('dddddddddddddddddddddddddddd'));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
  }),
}));

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
  useSessionStore.setState({
    status: 'authenticated',
    userId: DRIVER_ID,
  });
});

afterAll(() => {
  useSessionStore.setState({ status: 'initializing', userId: null });
});

describe('DriverActivityScreen', () => {
  it('renders the empty state when the driver has no accepted rides', async () => {
    const { getByTestId } = render(withProvider(<DriverActivityScreen />));
    await waitFor(() => {
      expect(getByTestId('driver-activity-empty')).toBeTruthy();
    });
  });

  it('renders TripCards for dispatched rides', async () => {
    const rides = new InMemoryRideRepository();
    const dispatched = makeRideAt('dispatched', 'rideDA12345678901abc');
    rides.seed(dispatched);

    const { getByTestId } = render(
      withProvider(<DriverActivityScreen />, rides),
    );
    await waitFor(() => {
      expect(getByTestId(`trip-card-${String(dispatched.id)}`)).toBeTruthy();
    });
  });

  it('mounts the DevToolsSection footer', async () => {
    const { getByTestId } = render(withProvider(<DriverActivityScreen />));
    await waitFor(() => {
      expect(getByTestId('driver-activity-empty')).toBeTruthy();
    });
    expect(getByTestId('dev-tools-section')).toBeTruthy();
  });

  it('tapping a completed ride navigates to TripDetail', async () => {
    const rides = new InMemoryRideRepository();
    const completed = makeRideAt('completed', 'rideDAC12345678901ab');
    rides.seed(completed);

    const { getByTestId } = render(
      withProvider(<DriverActivityScreen />, rides),
    );
    await waitFor(() => {
      expect(getByTestId(`trip-card-${String(completed.id)}`)).toBeTruthy();
    });
    fireEvent.press(getByTestId(`trip-card-${String(completed.id)}`));
    expect(mockNavigate).toHaveBeenCalledWith('TripDetail', {
      rideId: 'rideDAC12345678901ab',
    });
  });

  it('tapping a non-terminal ride navigates to DriverMonitor', async () => {
    const rides = new InMemoryRideRepository();
    const dispatched = makeRideAt('dispatched', 'rideDAD12345678901ab');
    rides.seed(dispatched);

    const { getByTestId } = render(
      withProvider(<DriverActivityScreen />, rides),
    );
    await waitFor(() => {
      expect(getByTestId(`trip-card-${String(dispatched.id)}`)).toBeTruthy();
    });
    fireEvent.press(getByTestId(`trip-card-${String(dispatched.id)}`));
    expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
      rideId: 'rideDAD12345678901ab',
    });
  });
});
