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

import { ListRidesByDriver } from '../ListRidesByDriver';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const DRIVER_A = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('driverAxxxxxxxxxxxxxxxxxxxxx')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_a',
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

const DRIVER_B = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('driverBxxxxxxxxxxxxxxxxxxxxx')),
    name: unwrap(PersonName.create({ first: 'Alan', last: 'Turing' })),
    email: unwrap(Email.create('alan@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155553333')),
    stripeAccountId: 'acct_b',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Honda',
        model: 'Civic',
        year: 2025,
        color: 'Blue',
        licensePlate: 'XYZ7890',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('passengerxxxxxxxxxxxxxxxxxxx')),
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

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

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

function makeAwaitingRide(args: { id: string; createdAt: Date }): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(args.id)),
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
      createdAt: args.createdAt,
    }),
  );
}

function makeDispatchedRide(args: {
  id: string;
  driver: DriverSnapshot;
  createdAt: Date;
}): Ride {
  const awaiting = makeAwaitingRide({ id: args.id, createdAt: args.createdAt });
  return unwrap(
    awaiting.dispatch({
      driver: args.driver,
      pickupDirections: makeRoute(),
      at: new Date(args.createdAt.getTime() + 60_000),
    }),
  );
}

describe('ListRidesByDriver', () => {
  it('returns rides this driver has accepted, newest first', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeDispatchedRide({
        id: 'oldA12345678901234567ab',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    repo.seed(
      makeDispatchedRide({
        id: 'newA12345678901234567ab',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );
    repo.seed(
      makeDispatchedRide({
        id: 'forB12345678901234567ab',
        driver: DRIVER_B,
        createdAt: new Date('2026-04-15T00:00:00Z'),
      }),
    );

    const r = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(String(r.value[0]?.id)).toBe('newA12345678901234567ab');
      expect(String(r.value[1]?.id)).toBe('oldA12345678901234567ab');
    }
  });

  it('excludes awaiting_driver rides (no driver yet)', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeAwaitingRide({
        id: 'awaiting123456789012abc',
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );
    const r = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it('filters by status when supplied', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeDispatchedRide({
        id: 'dispatchedDriverA1234ab',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );

    const onlyDispatched = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
      statuses: ['dispatched'],
    });
    expect(onlyDispatched.ok).toBe(true);
    if (onlyDispatched.ok) {
      expect(onlyDispatched.value).toHaveLength(1);
    }

    const onlyCompleted = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
      statuses: ['completed'],
    });
    expect(onlyCompleted.ok).toBe(true);
    if (onlyCompleted.ok) expect(onlyCompleted.value).toHaveLength(0);
  });

  it('respects the limit', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeDispatchedRide({
        id: 'aaa1234567890123456abc',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    repo.seed(
      makeDispatchedRide({
        id: 'bbb1234567890123456abc',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-15T00:00:00Z'),
      }),
    );
    repo.seed(
      makeDispatchedRide({
        id: 'ccc1234567890123456abc',
        driver: DRIVER_A,
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );

    const r = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
      limit: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(String(r.value[0]?.id)).toBe('ccc1234567890123456abc');
    }
  });

  it('returns an empty list for a driver with no rides', async () => {
    const repo = new InMemoryRideRepository();
    const r = await new ListRidesByDriver(repo).execute({
      driverId: DRIVER_A.id,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});
