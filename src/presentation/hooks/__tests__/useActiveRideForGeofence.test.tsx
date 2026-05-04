import { act, renderHook, waitFor } from '@testing-library/react-native';
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
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { StripeAccountId } from '@domain/entities/StripeAccountId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { makeDriver, makeRider, type User } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import { useActiveRideForGeofence } from '../useActiveRideForGeofence';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const RIDE_ID = unwrap(RideId.create('rideForGeofence12345aa'));
const RIDER_UID = unwrap(UserId.create('riderxxxxxxxxxxxxxxxxxxxxxxx'));
const DRIVER_UID = unwrap(UserId.create('driverxxxxxxxxxxxxxxxxxxxxxx'));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: RIDER_UID,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);

const DRIVER_SNAPSHOT = unwrap(
  DriverSnapshot.create({
    id: DRIVER_UID,
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_d',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Honda',
        model: 'Civic',
        year: 2025,
        color: 'Blue',
        licensePlate: 'XYZ',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);

const ECONOMY_SNAPSHOT = unwrap(
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

function makeAwaitingRide(): Ride {
  return unwrap(
    Ride.create({
      id: RIDE_ID,
      passenger: PASSENGER,
      rideService: ECONOMY_SNAPSHOT,
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
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}

function makeDispatchedRide(): Ride {
  const awaiting = makeAwaitingRide();
  const route = unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
  return unwrap(
    awaiting.dispatch({
      driver: DRIVER_SNAPSHOT,
      pickupDirections: route,
      at: new Date(),
    }),
  );
}

function makeStartedRide(): Ride {
  const dispatched = makeDispatchedRide();
  return unwrap(
    dispatched.start({
      odometerMeters: 1_500,
      at: new Date(),
    }),
  );
}

function makeRiderUser(): User {
  return makeRider({
    id: RIDER_UID,
    email: unwrap(Email.create('ada@yeapp.tech')),
    emailVerified: true,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    phone: unwrap(PhoneNumber.create('+14155551111')),
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeCustomerId: unwrap(StripeCustomerId.create('cus_rider')),
    defaultPaymentMethodId: unwrap(PaymentMethodId.create('pm_card')),
  });
}

function makeDriverUser(): User {
  return makeDriver({
    id: DRIVER_UID,
    email: unwrap(Email.create('grace@yeapp.tech')),
    emailVerified: true,
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    phone: unwrap(PhoneNumber.create('+14155552222')),
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeAccountId: unwrap(StripeAccountId.create('acct_driver')),
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
  });
}

describe('useActiveRideForGeofence', () => {
  function renderWith(ridesRepo: InMemoryRideRepository, user: User | null) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestContainerProvider rides={ridesRepo}>
        {children}
      </TestContainerProvider>
    );
    return renderHook(() => useActiveRideForGeofence(user), { wrapper });
  }

  it('returns null when no user is signed in', async () => {
    const rides = new InMemoryRideRepository();
    const { result } = renderWith(rides, null);
    expect(result.current).toBeNull();
  });

  it("returns null when the rider's active ride is still 'awaiting_driver'", async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeAwaitingRide());
    const { result } = renderWith(rides, makeRiderUser());
    // Allow the query + subscription to settle.
    await waitFor(() => undefined);
    expect(result.current).toBeNull();
  });

  it("returns {rideId, pickupCoords} for a rider on a 'dispatched' ride", async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeDispatchedRide());
    const { result } = renderWith(rides, makeRiderUser());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.rideId).toEqual(RIDE_ID);
    expect(result.current?.pickupCoords).toBe(MIAMI);
  });

  it("returns {rideId, pickupCoords} for a driver on a 'dispatched' ride", async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeDispatchedRide());
    const { result } = renderWith(rides, makeDriverUser());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current?.rideId).toEqual(RIDE_ID);
    expect(result.current?.pickupCoords).toBe(MIAMI);
  });

  it("flips to null when the live ride transitions out of 'dispatched'", async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeDispatchedRide());
    const { result } = renderWith(rides, makeRiderUser());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    // Server-side flip to 'started' — the live observeRide subscription
    // should pick it up.
    await act(async () => {
      const updR = await rides.update(makeStartedRide());
      if (!updR.ok) throw updR.error;
    });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it('returns null for a started ride from the start (no flicker through dispatched)', async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeStartedRide());
    const { result } = renderWith(rides, makeRiderUser());
    await waitFor(() => undefined);
    expect(result.current).toBeNull();
  });
});
