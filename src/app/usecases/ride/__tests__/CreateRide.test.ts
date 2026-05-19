import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { CreateRide } from '../CreateRide';

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

const RIDE_SERVICE = unwrap(
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

const PICKUP = unwrap(
  Endpoint.create({
    location: unwrap(Coordinates.create(25.7617, -80.1918)),
    address: 'pickup',
    placeName: null,
    directions: null,
  }),
);

const DROPOFF = unwrap(
  Endpoint.create({
    location: unwrap(Coordinates.create(26.1224, -80.1373)),
    address: 'dropoff',
    placeName: null,
    directions: null,
  }),
);

describe('CreateRide', () => {
  it('creates an awaiting_driver ride when scheduledPickupAt is absent', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new CreateRide(repo);
    const r = await sut.execute({
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('awaiting_driver');
      expect(r.value.schedulePickupAt).toBeNull();
    }
    expect(repo.spies.create).toBe(1);
  });

  it('creates an awaiting_driver ride when scheduledPickupAt is null (legacy default)', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new CreateRide(repo);
    const r = await sut.execute({
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
      scheduledPickupAt: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('awaiting_driver');
      expect(r.value.schedulePickupAt).toBeNull();
    }
  });

  it('routes through Ride.createScheduled when scheduledPickupAt is provided', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new CreateRide(repo);
    const futurePickup = new Date(T_CREATED.getTime() + 30 * 60_000);
    const r = await sut.execute({
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
      scheduledPickupAt: futurePickup,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('scheduled');
      expect(r.value.schedulePickupAt?.toISOString()).toBe(
        futurePickup.toISOString(),
      );
    }
  });

  it('surfaces ValidationError when scheduledPickupAt is too soon (< 15 min)', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new CreateRide(repo);
    const tooSoon = new Date(T_CREATED.getTime() + 5 * 60_000);
    const r = await sut.execute({
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
      scheduledPickupAt: tooSoon,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_invalid_schedule');
    }
    expect(repo.spies.create).toBe(0);
  });

  it('persists the scheduled ride via repo.create', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new CreateRide(repo);
    const futurePickup = new Date(T_CREATED.getTime() + 30 * 60_000);
    const r = await sut.execute({
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
      scheduledPickupAt: futurePickup,
    });
    expect(r.ok).toBe(true);
    expect(repo.spies.create).toBe(1);
  });
});
