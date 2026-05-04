import { CancellationReason } from '@domain/entities/CancellationReason';
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

import { CancelRideByRider } from '../CancelRideByRider';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

function makeRide(): Ride {
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

describe('CancelRideByRider', () => {
  it('routes a rider-allowed reason through the repo as by:rider', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide();
    await repo.create(ride);
    const sut = new CancelRideByRider(repo);
    const reason = unwrap(
      CancellationReason.create({
        code: 'driver_no_show',
        reasonText: null,
      }),
    );
    const r = await sut.execute({ rideId: ride.id, reason });
    expect(r.ok).toBe(true);
    expect(repo.spies.lastCancelArgs?.by).toBe('rider');
    expect(repo.spies.lastCancelArgs?.reason.code).toBe('driver_no_show');
  });

  it('rejects a driver-only reason with a ValidationError', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide();
    await repo.create(ride);
    const sut = new CancelRideByRider(repo);
    const reason = unwrap(
      CancellationReason.create({
        code: 'passenger_no_show',
        reasonText: null,
      }),
    );
    const r = await sut.execute({ rideId: ride.id, reason });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('cancellation_reason_not_rider_allowed');
    }
    // Repo cancel was NOT invoked.
    expect(repo.spies.cancel).toBe(0);
  });
});
