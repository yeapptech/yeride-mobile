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

import { ListRidesByPassenger } from '../ListRidesByPassenger';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const PASSENGER_A = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const PASSENGER_B = unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb'));

function makeAwaitingRide(args: {
  id: string;
  passengerId: UserId;
  createdAt: Date;
}): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(args.id)),
      passenger: unwrap(
        PassengerSnapshot.create({
          id: args.passengerId,
          name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
          email: unwrap(Email.create('ada@yeapp.tech')),
          phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
          pushToken: null,
          avatarUrl: null,
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
      createdAt: args.createdAt,
    }),
  );
}

function makeCancelledRide(args: {
  id: string;
  passengerId: UserId;
  createdAt: Date;
}): Ride {
  const awaiting = makeAwaitingRide(args);
  const reason = unwrap(
    CancellationReason.create({ code: 'changed_mind', reasonText: null }),
  );
  return unwrap(
    awaiting.cancel({
      reason,
      by: 'rider',
      at: new Date(args.createdAt.getTime() + 60_000),
      odometerMeters: null,
    }),
  );
}

describe('ListRidesByPassenger', () => {
  it('returns rides scoped to the passenger, newest first', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeAwaitingRide({
        id: 'oldA12345678901234567ab',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    repo.seed(
      makeAwaitingRide({
        id: 'newA12345678901234567ab',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );
    repo.seed(
      makeAwaitingRide({
        id: 'forB12345678901234567ab',
        passengerId: PASSENGER_B,
        createdAt: new Date('2026-04-15T00:00:00Z'),
      }),
    );
    const r = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(String(r.value[0]?.id)).toBe('newA12345678901234567ab');
      expect(String(r.value[1]?.id)).toBe('oldA12345678901234567ab');
    }
  });

  it('filters by status when supplied', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeAwaitingRide({
        id: 'awaitingA1234567890ab12',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-27T10:00:00Z'),
      }),
    );
    repo.seed(
      makeCancelledRide({
        id: 'cancelledA1234567890ab1',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-26T10:00:00Z'),
      }),
    );

    const onlyAwaiting = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
      statuses: ['awaiting_driver'],
    });
    expect(onlyAwaiting.ok).toBe(true);
    if (onlyAwaiting.ok) {
      expect(onlyAwaiting.value).toHaveLength(1);
      expect(String(onlyAwaiting.value[0]?.id)).toBe('awaitingA1234567890ab12');
    }

    const onlyCancelled = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
      statuses: ['cancelled'],
    });
    expect(onlyCancelled.ok).toBe(true);
    if (onlyCancelled.ok) {
      expect(onlyCancelled.value).toHaveLength(1);
      expect(String(onlyCancelled.value[0]?.id)).toBe(
        'cancelledA1234567890ab1',
      );
    }

    const noneCompleted = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
      statuses: ['completed'],
    });
    expect(noneCompleted.ok).toBe(true);
    if (noneCompleted.ok) {
      expect(noneCompleted.value).toHaveLength(0);
    }
  });

  it('respects the limit', async () => {
    const repo = new InMemoryRideRepository();
    repo.seed(
      makeAwaitingRide({
        id: 'aaa12345678901234567ab',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    repo.seed(
      makeAwaitingRide({
        id: 'bbb12345678901234567ab',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-15T00:00:00Z'),
      }),
    );
    repo.seed(
      makeAwaitingRide({
        id: 'ccc12345678901234567ab',
        passengerId: PASSENGER_A,
        createdAt: new Date('2026-04-27T00:00:00Z'),
      }),
    );
    const r = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
      limit: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(String(r.value[0]?.id)).toBe('ccc12345678901234567ab');
    }
  });

  it('returns an empty list for a passenger with no rides', async () => {
    const repo = new InMemoryRideRepository();
    const r = await new ListRidesByPassenger(repo).execute({
      passengerId: PASSENGER_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});
