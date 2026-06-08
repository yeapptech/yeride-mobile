import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import {
  useInProgressRidesSubscription,
  useScheduledRidesSubscription,
} from '@presentation/queries';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const usd = (m: number) => unwrap(Money.fromMajor(m, 'USD'));
const PID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const LAUD = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: PID,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);
const ECONOMY = unwrap(
  RideServiceSnapshot.create({
    id: unwrap(RideServiceId.create('economy')),
    name: 'Economy',
    baseFare: usd(2.5),
    minimumFare: usd(5),
    cancelationFee: usd(2),
    costPerKm: usd(1.25),
    costPerMinute: usd(0.2),
    seatCapacity: 4,
  }),
);
function endpoints() {
  return {
    pickup: unwrap(
      Endpoint.create({
        location: MIAMI,
        address: 'pickup',
        placeName: null,
        directions: null,
      }),
    ),
    dropoff: unwrap(
      Endpoint.create({
        location: LAUD,
        address: 'dropoff',
        placeName: null,
        directions: null,
      }),
    ),
  };
}
function makeAwaiting(id: string): Ride {
  const { pickup, dropoff } = endpoints();
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup,
      dropoff,
      createdAt: new Date(),
    }),
  );
}
function makeScheduled(id: string, minutesAhead: number): Ride {
  const { pickup, dropoff } = endpoints();
  const createdAt = new Date('2026-04-27T12:00:00Z');
  return unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup,
      dropoff,
      createdAt,
      schedulePickupAt: new Date(createdAt.getTime() + minutesAhead * 60_000),
    }),
  );
}
const DID = unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
const DRIVER = unwrap(
  DriverSnapshot.create({
    id: DID,
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_abc',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'White',
        licensePlate: 'ABC1234',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);
function makeRoute(): Route {
  return unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: MIAMI,
      endLocation: LAUD,
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
}
function wrapper(rides: InMemoryRideRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={rides}>{children}</TestContainerProvider>
  );
}

describe('useInProgressRidesSubscription', () => {
  it('returns the rider LIVE rides; empty for a null user', async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeAwaiting('subLive1234567890ab12'));

    const { result } = renderHook(
      () => useInProgressRidesSubscription(PID, 'rider'),
      { wrapper: wrapper(rides) },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    const { result: nullResult } = renderHook(
      () => useInProgressRidesSubscription(null, 'rider'),
      { wrapper: wrapper(rides) },
    );
    expect(nullResult.current).toEqual([]);
  });

  it('returns a dispatched ride for the driver role', async () => {
    const rides = new InMemoryRideRepository();
    const awaiting = makeAwaiting('driverRoleSub12345ab');
    await rides.create(awaiting);
    const dispatched = unwrap(
      awaiting.dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: new Date(),
      }),
    );
    await rides.update(dispatched);

    const { result } = renderHook(
      () => useInProgressRidesSubscription(DID, 'driver'),
      { wrapper: wrapper(rides) },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]?.status).toBe('dispatched');
  });
});

describe('useScheduledRidesSubscription', () => {
  it('returns scheduled rides sorted next-soonest-first', async () => {
    const rides = new InMemoryRideRepository();
    await rides.create(makeScheduled('subSchedLater12345ab', 120));
    await rides.create(makeScheduled('subSchedSooner1234ab', 30));

    const { result } = renderHook(() => useScheduledRidesSubscription(PID), {
      wrapper: wrapper(rides),
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(String(result.current[0]?.id)).toBe('subSchedSooner1234ab');
  });
});
