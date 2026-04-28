import { Coordinates } from '@domain/entities/Coordinates';
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
import type { TripEvent } from '@domain/entities/TripEvent';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { ObserveTripEvents } from '../ObserveTripEvents';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('rideAbcDef1234567890ab'));

function seedRide(repo: InMemoryRideRepository): void {
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
  const ride = unwrap(
    Ride.create({
      id: RIDE_ID,
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
      createdAt: new Date(),
    }),
  );
  repo.seed(ride);
}

const E1: TripEvent = {
  id: '2026-04-27T12:00:00Z',
  type: 'created',
  event: 'Trip requested',
  extras: {},
  createdAt: new Date('2026-04-27T12:00:00Z'),
};
const E2: TripEvent = {
  id: '2026-04-27T12:01:00Z',
  type: 'dispatch',
  event: 'Driver accepted',
  extras: {},
  createdAt: new Date('2026-04-27T12:01:00Z'),
};

describe('ObserveTripEvents', () => {
  it('emits the seeded events synchronously on subscribe', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    repo.seedEvents(RIDE_ID, [E1, E2]);
    const sut = new ObserveTripEvents(repo);

    const received: (readonly TripEvent[])[] = [];
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: (events) => received.push(events),
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
    expect(received[0]?.[0]?.type).toBe('created');
    expect(received[0]?.[1]?.type).toBe('dispatch');

    unsubscribe();
  });

  it('emits an empty array when there are no events', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    const sut = new ObserveTripEvents(repo);

    let snapshot: readonly TripEvent[] | null = null;
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: (events) => {
        snapshot = events;
      },
    });

    expect(snapshot).toEqual([]);
    unsubscribe();
  });

  it('returns a synchronous unsubscribe that stops further callbacks', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    repo.seedEvents(RIDE_ID, [E1]);
    const sut = new ObserveTripEvents(repo);

    let calls = 0;
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: () => {
        calls += 1;
      },
    });
    expect(calls).toBe(1);

    unsubscribe();
    // Re-seeding events should not push to the unsubscribed callback.
    repo.seedEvents(RIDE_ID, [E1, E2]);
    expect(calls).toBe(1);
  });
});
