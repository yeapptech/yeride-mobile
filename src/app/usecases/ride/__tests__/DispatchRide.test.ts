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
import { InMemoryRideRepository } from '@shared/testing';

import { DispatchRide } from '../DispatchRide';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_DISPATCH = new Date('2026-04-27T12:01:00Z');
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

const DRIVER = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
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

function makeRide(): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      defaultPaymentMethod: null,
    }),
  );
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create('tripIdAbcDef1234567890')),
      passenger,
      rideService: unwrap(
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
      ),
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

function makeRoute(): Route {
  return unwrap(
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
}

describe('DispatchRide', () => {
  it('flips status to dispatched and stores driver + pickup directions', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide();
    await repo.create(ride);
    const sut = new DispatchRide(repo, () => T_DISPATCH);
    const r = await sut.execute({
      rideId: ride.id,
      driver: DRIVER,
      pickupDirections: makeRoute(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('dispatched');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
      expect(r.value.pickup.directions?.routeToken).toBe('tk');
      expect(r.value.pickupTiming.startedAt).toEqual(T_DISPATCH);
    }
  });

  it('returns NotFoundError for an unknown ride', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new DispatchRide(repo, () => T_DISPATCH);
    const r = await sut.execute({
      rideId: unwrap(RideId.create('nonexistent1234567890ab')),
      driver: DRIVER,
      pickupDirections: makeRoute(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('refuses to dispatch a ride that has already been dispatched', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide();
    await repo.create(ride);
    const sut = new DispatchRide(repo, () => T_DISPATCH);
    await sut.execute({
      rideId: ride.id,
      driver: DRIVER,
      pickupDirections: makeRoute(),
    });
    const r2 = await sut.execute({
      rideId: ride.id,
      driver: DRIVER,
      pickupDirections: makeRoute(),
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('ride_illegal_transition');
  });
});
