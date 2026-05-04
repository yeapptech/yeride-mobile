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
import type { TripPayment } from '@domain/entities/TripPayment';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { ObserveTripPayments } from '../ObserveTripPayments';

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
      stripeCustomerId: null,
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

const FARE: TripPayment = {
  id: 'pay-1',
  type: 'fare',
  amount: usd(18),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T11:00:00Z'),
};
const TIP: TripPayment = {
  id: 'pay-2',
  type: 'tip',
  amount: usd(2),
  status: 'succeeded',
  createdAt: new Date('2026-04-28T11:01:00Z'),
};

describe('ObserveTripPayments', () => {
  it('emits the seeded payments synchronously on subscribe', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    repo.seedPayments(RIDE_ID, [FARE, TIP]);
    const sut = new ObserveTripPayments(repo);

    const received: (readonly TripPayment[])[] = [];
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: (payments) => received.push(payments),
    });

    expect(received).toHaveLength(1);
    // `subscribePayments` sorts newest-first per the contract.
    expect(received[0]?.[0]?.type).toBe('tip');
    expect(received[0]?.[1]?.type).toBe('fare');

    unsubscribe();
  });

  it('emits an empty array when there are no payments', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    const sut = new ObserveTripPayments(repo);

    let snapshot: readonly TripPayment[] | null = null;
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: (payments) => {
        snapshot = payments;
      },
    });

    expect(snapshot).toEqual([]);
    unsubscribe();
  });

  it('returns a synchronous unsubscribe', () => {
    const repo = new InMemoryRideRepository();
    seedRide(repo);
    const sut = new ObserveTripPayments(repo);
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: () => {},
    });
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });
});
