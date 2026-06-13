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
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { ObserveScheduledRides } from '../ObserveScheduledRides';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_CREATED = new Date('2026-04-27T12:00:00Z');

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

function makeAcceptedByDriver(id: string): Ride {
  return unwrap(makeScheduled(id, 30).acceptSchedule({ driver: DRIVER }));
}

function makeScheduled(id: string, scheduledMinutesAhead: number): Ride {
  return unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: T_CREATED,
      schedulePickupAt: new Date(
        T_CREATED.getTime() + scheduledMinutesAhead * 60_000,
      ),
    }),
  );
}

function makeAwaiting(id: string): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: T_CREATED,
    }),
  );
}

describe('ObserveScheduledRides', () => {
  it('delivers the passenger-scoped scheduled rides on initial subscribe', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeScheduled('AAAAAAAAAAAAAAAAAAAA', 30));
    await repo.create(makeScheduled('BBBBBBBBBBBBBBBBBBBB', 60));
    await repo.create(makeAwaiting('CCCCCCCCCCCCCCCCCCCC'));

    const sut = new ObserveScheduledRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen).toHaveLength(1);
    // Both scheduled rides land; the awaiting_driver ride does not.
    expect(seen[0]).toHaveLength(2);
    for (const r of seen[0] ?? []) {
      expect(['scheduled', 'scheduled_driver_accepted']).toContain(r.status);
    }
    unsub();
  });

  it('re-emits when a new scheduled ride is created', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new ObserveScheduledRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);

    await repo.create(makeScheduled('DDDDDDDDDDDDDDDDDDDD', 30));
    expect(seen[seen.length - 1]?.length).toBe(1);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new ObserveScheduledRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeScheduled('EEEEEEEEEEEEEEEEEEEE', 30));
    expect(seen).toHaveLength(1); // Only the initial empty emit.
  });

  it('delivers the driver-scoped accepted scheduled rides for role=driver', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeAcceptedByDriver('FFFFFFFFFFFFFFFFFFFF'));
    await repo.create(makeScheduled('GGGGGGGGGGGGGGGGGGGG', 60)); // no driver

    const sut = new ObserveScheduledRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: DRIVER.id,
      role: 'driver',
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('scheduled_driver_accepted');
    unsub();
  });
});
