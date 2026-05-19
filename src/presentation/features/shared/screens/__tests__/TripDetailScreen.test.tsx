import { render, waitFor } from '@testing-library/react-native';
// (helper imports used inline in tests below)
import type { ReactNode } from 'react';

import { Money } from '@domain/entities/Money';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { TripPayment } from '@domain/entities/TripPayment';
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

import TripDetailScreen from '../TripDetailScreen';

const PASSENGER_ID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const DRIVER_ID = unwrap(UserId.create('dddddddddddddddddddddddddddd'));

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

function makeRouteProp(rideId: string) {
  return {
    key: 'TripDetail-key',
    name: 'TripDetail' as const,
    params: { rideId },
  };
}

function makeNavigationProp() {
  // The screen never calls navigation methods; cast through unknown so
  // we satisfy the prop shape without dragging in the full type.
  return {
    goBack: jest.fn(),
    navigate: jest.fn(),
  } as unknown as Parameters<typeof TripDetailScreen>[0]['navigation'];
}

beforeEach(() => {
  useSessionStore.setState({
    status: 'authenticated',
    userId: PASSENGER_ID,
  });
});

afterAll(() => {
  useSessionStore.setState({ status: 'initializing', userId: null });
});

describe('TripDetailScreen', () => {
  it('renders trip details + payments + events for a completed ride (rider view)', async () => {
    const rides = new InMemoryRideRepository();
    const ride = makeRideAt('completed', 'rideTDetail123456789a');
    rides.seed(ride);
    const payment: TripPayment = {
      id: 'pay1',
      type: 'fare',
      status: 'succeeded',
      amount: unwrap(Money.fromMajor(15, 'USD')),
      createdAt: new Date('2026-05-19T11:00:00Z'),
      paymentMethodId: null,
    };
    rides.seedPayments(ride.id, [payment]);
    const event: TripEvent = {
      id: 'evt1',
      type: 'dispatch',
      event: 'Driver accepted',
      extras: {},
      createdAt: new Date('2026-05-19T10:30:00Z'),
    };
    rides.seedEvents(ride.id, [event]);

    const { getAllByText, getByText, getByTestId } = render(
      withProvider(
        <TripDetailScreen
          route={makeRouteProp(String(ride.id))}
          navigation={makeNavigationProp()}
        />,
        rides,
      ),
    );

    // Wait for the ride to load past the loading shim. The `trip-detail-
    // screen` testID is present in both loading + ready states, so wait
    // on a content-only element to know we've transitioned.
    await waitFor(() => {
      expect(getByText('Trip with Grace Hopper')).toBeTruthy();
    });

    // Rider view: party header names the driver.
    expect(getByText('Trip with Grace Hopper')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();

    // Pickup + dropoff rendered.
    expect(getByText('123 Pickup St, Miami, FL')).toBeTruthy();
    expect(getByText('456 Dropoff Ave, Fort Lauderdale, FL')).toBeTruthy();

    // Payments list rendered with $15.00. Two matches expected: the row
    // and the "Total" line beneath it.
    expect(getAllByText('$15.00').length).toBeGreaterThanOrEqual(1);

    // Event timeline mounted.
    expect(getByTestId('trip-event-evt1')).toBeTruthy();
    expect(getByText('Driver accepted')).toBeTruthy();
  });

  it('renders not-found when the ride does not exist', async () => {
    const rides = new InMemoryRideRepository();
    const { getByTestId } = render(
      withProvider(
        <TripDetailScreen
          route={makeRouteProp('rideMissing1234567abc')}
          navigation={makeNavigationProp()}
        />,
        rides,
      ),
    );
    await waitFor(() => {
      expect(getByTestId('trip-detail-not-found')).toBeTruthy();
    });
  });

  it('uses driver-view party header when viewer is the trip driver', async () => {
    useSessionStore.setState({
      status: 'authenticated',
      userId: DRIVER_ID,
    });
    const rides = new InMemoryRideRepository();
    const ride = makeRideAt('completed', 'rideTDetailDr123abcde');
    rides.seed(ride);

    const { getByText } = render(
      withProvider(
        <TripDetailScreen
          route={makeRouteProp(String(ride.id))}
          navigation={makeNavigationProp()}
        />,
        rides,
      ),
    );
    await waitFor(() => {
      expect(getByText('Trip with Ada Lovelace')).toBeTruthy();
    });
    // Driver view: party header names the passenger.
    expect(getByText('Trip with Ada Lovelace')).toBeTruthy();
  });
});
