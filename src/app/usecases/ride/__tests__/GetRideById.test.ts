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
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { GetRideById } from '../GetRideById';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

function makeRide(): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create('rideAbcDef1234567890ab')),
      passenger: unwrap(
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
      ),
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
}

describe('GetRideById', () => {
  it('returns the ride when it exists', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide();
    repo.seed(ride);
    const r = await new GetRideById(repo).execute(ride.id);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.id).toBe(ride.id);
  });

  it('returns NotFoundError when the ride does not exist', async () => {
    const repo = new InMemoryRideRepository();
    const r = await new GetRideById(repo).execute(
      unwrap(RideId.create('nonexistentRideId12345')),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not_found');
      expect(r.error.code).toBe('ride_not_found');
    }
  });
});
