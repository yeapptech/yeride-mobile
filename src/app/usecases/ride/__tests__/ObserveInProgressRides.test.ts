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

import { ObserveInProgressRides } from '../ObserveInProgressRides';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);
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

function makeAwaiting(id: string): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
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

describe('ObserveInProgressRides', () => {
  it('rider role delivers the passenger LIVE rides', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeAwaiting('AAAAAAAAAAAAAAAAAAAA'));

    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('awaiting_driver');
    unsub();
  });

  it('driver role delivers only dispatched-to-this-driver rides', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeAwaiting('BBBBBBBBBBBBBBBBBBBB');
    await repo.create(ride);
    await repo.update(
      unwrap(
        ride.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );

    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: DRIVER.id,
      role: 'driver',
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(latest[0]?.status).toBe('dispatched');
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeAwaiting('CCCCCCCCCCCCCCCCCCCC'));
    expect(seen).toHaveLength(1);
  });
});
