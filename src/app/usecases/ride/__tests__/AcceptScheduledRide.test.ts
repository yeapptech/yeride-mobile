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

import { AcceptScheduledRide } from '../AcceptScheduledRide';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_CREATED = new Date('2026-04-27T12:00:00Z');
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

function makeScheduled(id: string): Ride {
  return unwrap(
    Ride.createScheduled({
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
      createdAt: T_CREATED,
      schedulePickupAt: new Date(T_CREATED.getTime() + 60 * 60_000),
    }),
  );
}

describe('AcceptScheduledRide', () => {
  it('flips a scheduled ride to scheduled_driver_accepted and stores the driver', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeScheduled('schedRide12345678901');
    await repo.create(ride);
    const sut = new AcceptScheduledRide(repo);
    const r = await sut.execute({ rideId: ride.id, driver: DRIVER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('scheduled_driver_accepted');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
    }
  });

  it('returns NotFoundError for an unknown ride', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new AcceptScheduledRide(repo);
    const r = await sut.execute({
      rideId: unwrap(RideId.create('nonexistent1234567890ab')),
      driver: DRIVER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('a second driver accepting an already-accepted scheduled ride loses with ConflictError', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeScheduled('schedRideTwice123456');
    await repo.create(ride);
    const sut = new AcceptScheduledRide(repo);
    await sut.execute({ rideId: ride.id, driver: DRIVER });
    const r2 = await sut.execute({ rideId: ride.id, driver: DRIVER });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.kind).toBe('conflict');
      expect(r2.error.code).toBe('ride_already_taken');
    }
  });
});
