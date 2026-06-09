import { CancellationReason } from '@domain/entities/CancellationReason';
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
import { RideListCursor } from '@domain/entities/RideListCursor';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';

import { InMemoryRideRepository } from '../InMemoryRideRepository';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const BAY_AREA = unwrap(Coordinates.create(37.7749, -122.4194));

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

const PREMIUM = unwrap(
  RideServiceSnapshot.create({
    id: unwrap(RideServiceId.create('premium')),
    name: 'Premium',
    baseFare: usd(5),
    minimumFare: usd(10),
    cancelationFee: usd(5),
    costPerKm: usd(2.5),
    costPerMinute: usd(0.5),
    seatCapacity: 4,
  }),
);

function makeRide(args: {
  id: string;
  pickup: Coordinates;
  service?: RideServiceSnapshot;
  passenger?: PassengerSnapshot;
  createdAt?: Date;
}): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(args.id)),
      passenger: args.passenger ?? PASSENGER,
      rideService: args.service ?? ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: args.pickup,
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
      createdAt: args.createdAt ?? new Date(),
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

describe('InMemoryRideRepository.create', () => {
  it('stores a new ride and emits to observers', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });

    const observed: (Ride | null)[] = [];
    repo.observeById(ride.id, (r) => {
      observed.push(r);
    });
    expect(observed).toEqual([null]); // initial null

    const r = await repo.create(ride);
    expect(r.ok).toBe(true);
    expect(observed).toHaveLength(2);
    expect(observed[1]?.status).toBe('awaiting_driver');
    expect(repo.spies.create).toBe(1);
  });

  it('refuses to overwrite an existing ride', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);
    const r = await repo.create(ride);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conflict');
  });
});

describe('InMemoryRideRepository.update', () => {
  it('replaces the existing ride and notifies observers', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);

    const observed: (Ride | null)[] = [];
    repo.observeById(ride.id, (r) => {
      observed.push(r);
    });
    const dispatched = unwrap(
      ride.dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: new Date(),
      }),
    );
    const r = await repo.update(dispatched);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('dispatched');
    // observed: initial awaiting_driver, then dispatched
    expect(observed[observed.length - 1]?.status).toBe('dispatched');
  });

  it('errors when updating a missing ride', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    const r = await repo.update(ride);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });
});

describe('InMemoryRideRepository.subscribeAvailableRides', () => {
  it('matches awaiting_driver rides within radius and matching service', async () => {
    const repo = new InMemoryRideRepository();
    const inRange = makeRide({ id: 'tripInRange1234567890ab', pickup: MIAMI });
    await repo.create(inRange);

    const distant = makeRide({
      id: 'tripDistant9876543210xy',
      pickup: BAY_AREA,
    });
    await repo.create(distant);

    const wrongService = makeRide({
      id: 'tripWrongService123456ab',
      pickup: MIAMI,
      service: PREMIUM,
    });
    await repo.create(wrongService);

    const calls: readonly Ride[][] = [];
    const driverId = unwrap(UserId.create('cccccccccccccccccccccccccccc'));
    const driverInMiami = unwrap(Coordinates.create(25.78, -80.19));
    repo.subscribeAvailableRides({
      driverId,
      services: [unwrap(RideServiceId.create('economy'))],
      driverLocation: driverInMiami,
      callback: (rides) => {
        (calls as Ride[][]).push([...rides]);
      },
    });

    const initial = calls[0]!;
    const ids = initial.map((r) => String(r.id));
    expect(ids).toContain('tripInRange1234567890ab');
    expect(ids).not.toContain('tripDistant9876543210xy');
    expect(ids).not.toContain('tripWrongService123456ab');
  });

  it('re-emits when a new matching ride is created', async () => {
    const repo = new InMemoryRideRepository();
    const driverId = unwrap(UserId.create('cccccccccccccccccccccccccccc'));
    const calls: readonly Ride[][] = [];
    repo.subscribeAvailableRides({
      driverId,
      services: [unwrap(RideServiceId.create('economy'))],
      driverLocation: MIAMI,
      callback: (rides) => {
        (calls as Ride[][]).push([...rides]);
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([]); // no rides yet

    await repo.create(
      makeRide({ id: 'tripIdNew1234567890abcd', pickup: MIAMI }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveLength(1);
  });

  it('drops a ride from the available list once it dispatches', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);
    const driverId = unwrap(UserId.create('cccccccccccccccccccccccccccc'));
    const calls: readonly Ride[][] = [];
    repo.subscribeAvailableRides({
      driverId,
      services: [unwrap(RideServiceId.create('economy'))],
      driverLocation: MIAMI,
      callback: (rides) => {
        (calls as Ride[][]).push([...rides]);
      },
    });
    expect(calls[0]).toHaveLength(1); // initial: ride is available

    const dispatched = unwrap(
      ride.dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: new Date(),
      }),
    );
    await repo.update(dispatched);
    expect(calls[calls.length - 1]).toHaveLength(0); // no longer available
  });
});

describe('InMemoryRideRepository.cancel', () => {
  it('updates status and captures spy args', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);

    const reason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    const r = await repo.cancel({
      rideId: ride.id,
      by: 'rider',
      reason,
      odometerMeters: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('cancelled');
    expect(repo.spies.cancel).toBe(1);
    expect(repo.spies.lastCancelArgs?.by).toBe('rider');
  });

  it('forwards the mocked cancel error', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);
    repo.mockCancelResult(
      new NetworkError({
        code: 'cancel_request_failed',
        message: 'simulated',
      }),
    );
    const r = await repo.cancel({
      rideId: ride.id,
      by: 'rider',
      reason: unwrap(
        CancellationReason.create({ code: 'changed_mind', reasonText: null }),
      ),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});

describe('InMemoryRideRepository.subscribeEvents/Payments', () => {
  it('emits seeded events on subscribe', () => {
    const repo = new InMemoryRideRepository();
    const id = unwrap(RideId.create('tripIdAbcDef1234567890'));
    repo.seedEvents(id, [
      {
        id: '2026-04-27T00:00:00.000Z',
        type: 'create',
        event: 'Trip created',
        extras: {},
        createdAt: new Date('2026-04-27T00:00:00Z'),
      },
    ]);
    let received: readonly { id: string }[] = [];
    repo.subscribeEvents({
      rideId: id,
      callback: (events) => {
        received = events;
      },
    });
    expect(received).toHaveLength(1);
  });

  it('emits seeded payments newest-first on subscribe', () => {
    const repo = new InMemoryRideRepository();
    const id = unwrap(RideId.create('tripIdAbcDef1234567890'));
    repo.seedPayments(id, [
      {
        id: 'old',
        type: 'fare',
        amount: usd(10),
        status: 'succeeded',
        createdAt: new Date('2026-04-27T00:00:00Z'),
        paymentMethodId: null,
      },
      {
        id: 'new',
        type: 'tip',
        amount: usd(2),
        status: 'succeeded',
        createdAt: new Date('2026-04-27T00:05:00Z'),
        paymentMethodId: null,
      },
    ]);
    let received: readonly { id: string }[] = [];
    repo.subscribePayments({
      rideId: id,
      callback: (payments) => {
        received = payments;
      },
    });
    expect(received.map((p) => p.id)).toEqual(['new', 'old']);
  });
});

describe('InMemoryRideRepository.listByPassenger', () => {
  it('filters by passenger and returns most-recent first', async () => {
    const repo = new InMemoryRideRepository();
    const a = makeRide({
      id: 'tripA12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T10:00:00Z'),
    });
    const b = makeRide({
      id: 'tripB12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T11:00:00Z'),
    });
    await repo.create(a);
    await repo.create(b);
    const r = await repo.listByPassenger({ passengerId: PASSENGER.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rides).toHaveLength(2);
      expect(String(r.value.rides[0]!.id)).toBe('tripB12345678901234567890');
      // Without a limit, nextCursor is always null (no page boundary).
      expect(r.value.nextCursor).toBeNull();
    }
  });

  it('honours the statuses filter', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripIdAbcDef1234567890', pickup: MIAMI });
    await repo.create(ride);
    const r = await repo.listByPassenger({
      passengerId: PASSENGER.id,
      statuses: ['completed'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rides).toEqual([]);
      expect(r.value.nextCursor).toBeNull();
    }
  });

  it('paginates: first page returns cursor, second page resumes after it', async () => {
    const repo = new InMemoryRideRepository();
    const a = makeRide({
      id: 'tripA12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T10:00:00Z'),
    });
    const b = makeRide({
      id: 'tripB12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T11:00:00Z'),
    });
    const c = makeRide({
      id: 'tripC12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T12:00:00Z'),
    });
    await repo.create(a);
    await repo.create(b);
    await repo.create(c);

    const page1 = await repo.listByPassenger({
      passengerId: PASSENGER.id,
      limit: 2,
    });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.rides.map((r) => String(r.id))).toEqual([
      'tripC12345678901234567890',
      'tripB12345678901234567890',
    ]);
    expect(page1.value.nextCursor).not.toBeNull();
    if (page1.value.nextCursor === null) return;

    const page2 = await repo.listByPassenger({
      passengerId: PASSENGER.id,
      limit: 2,
      cursor: page1.value.nextCursor,
    });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.rides.map((r) => String(r.id))).toEqual([
      'tripA12345678901234567890',
    ]);
    expect(page2.value.nextCursor).toBeNull();
  });

  it('tie-skip: cursor whose createdAt equals other rides drops every tie-mate (mirrors Firestore single-field startAfter)', async () => {
    // Three rides, two of them sharing the exact same createdAt
    // millisecond. Real Firestore `startAfter(<iso>)` on a desc order
    // skips ALL rows whose `createdDateTime` equals the cursor value —
    // not just the boundary row. The fake must mirror that or it
    // hides a real-world divergence (see `RideListCursor` docstring
    // for the rationale).
    const repo = new InMemoryRideRepository();
    const tie1 = makeRide({
      id: 'tripTIE1234567890123ab',
      pickup: MIAMI,
      createdAt: new Date('2026-05-19T11:00:00.000Z'),
    });
    const tie2 = makeRide({
      id: 'tripTIE2234567890123ab',
      pickup: MIAMI,
      createdAt: new Date('2026-05-19T11:00:00.000Z'),
    });
    const older = makeRide({
      id: 'tripOLDER123456789012',
      pickup: MIAMI,
      createdAt: new Date('2026-05-19T10:00:00.000Z'),
    });
    await repo.create(tie1);
    await repo.create(tie2);
    await repo.create(older);

    // Build a cursor pointing at one of the tie-mates. With tie-skip
    // semantics the next page should NOT include the OTHER tie-mate —
    // it must jump past both to the older row.
    const cursorR = RideListCursor.create({
      createdAtMillis: tie1.createdAt.getTime(),
      docId: String(tie1.id),
    });
    expect(cursorR.ok).toBe(true);
    if (!cursorR.ok) return;

    const page = await repo.listByPassenger({
      passengerId: PASSENGER.id,
      limit: 5,
      cursor: cursorR.value,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.rides.map((r) => String(r.id))).toEqual([
      'tripOLDER123456789012',
    ]);
    expect(page.value.nextCursor).toBeNull();
  });
});

describe('InMemoryRideRepository.listByDriver', () => {
  it('returns rides this driver has accepted, most-recent first', async () => {
    const repo = new InMemoryRideRepository();
    const a = makeRide({
      id: 'tripA12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T10:00:00Z'),
    });
    const b = makeRide({
      id: 'tripB12345678901234567890',
      pickup: MIAMI,
      createdAt: new Date('2026-04-27T11:00:00Z'),
    });
    await repo.create(a);
    await repo.create(b);
    // Dispatch both to the same driver. The repo's update path is what
    // persists the new driver field — same as production flow.
    await repo.update(
      unwrap(
        a.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    await repo.update(
      unwrap(
        b.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    const r = await repo.listByDriver({ driverId: DRIVER.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rides).toHaveLength(2);
      expect(String(r.value.rides[0]!.id)).toBe('tripB12345678901234567890');
      expect(r.value.nextCursor).toBeNull();
    }
  });

  it('excludes rides with no driver yet (awaiting_driver)', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripUndispatchedAbc12', pickup: MIAMI });
    await repo.create(ride);
    const r = await repo.listByDriver({ driverId: DRIVER.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rides).toEqual([]);
      expect(r.value.nextCursor).toBeNull();
    }
  });

  it('honours the statuses filter', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeRide({ id: 'tripStatusFilter1234', pickup: MIAMI });
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
    // The dispatched ride is in 'dispatched' status; filtering for
    // 'completed' should return nothing.
    const r = await repo.listByDriver({
      driverId: DRIVER.id,
      statuses: ['completed'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rides).toEqual([]);
      expect(r.value.nextCursor).toBeNull();
    }
  });
});

describe('InMemoryRideRepository — observeScheduledRidesByPassenger', () => {
  function makeScheduledRide(args: {
    id: string;
    passenger?: PassengerSnapshot;
    createdAt?: Date;
    schedulePickupAt?: Date;
  }): Ride {
    const createdAt = args.createdAt ?? new Date('2026-04-27T12:00:00Z');
    return unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create(args.id)),
        passenger: args.passenger ?? PASSENGER,
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
        createdAt,
        schedulePickupAt:
          args.schedulePickupAt ?? new Date(createdAt.getTime() + 30 * 60_000),
      }),
    );
  }

  it('emits initial empty list when no scheduled rides match', async () => {
    const repo = new InMemoryRideRepository();
    const seen: readonly Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => {
        (seen as Ride[][]).push([...rs]);
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([]);
    unsub();
  });

  it('delivers scheduled-status rides scoped to the passenger', async () => {
    const repo = new InMemoryRideRepository();
    const scheduled = makeScheduledRide({ id: 'AAAAAAAAAAAAAAAAAAAA' });
    await repo.create(scheduled);

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    // Initial emit captures the pre-existing scheduled ride.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('scheduled');
    unsub();
  });

  it('does NOT deliver awaiting_driver or completed rides', async () => {
    const repo = new InMemoryRideRepository();
    const awaiting = makeRide({ id: 'BBBBBBBBBBBBBBBBBBBB', pickup: MIAMI });
    await repo.create(awaiting);

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);
    unsub();
  });

  it('re-emits when a new scheduled ride is created', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);

    await repo.create(makeScheduledRide({ id: 'CCCCCCCCCCCCCCCCCCCC' }));
    expect(seen[1]).toHaveLength(1);
    expect(seen[1]?.[0]?.status).toBe('scheduled');
    unsub();
  });

  it('isolates passengers: rider A does not see rider B scheduled rides', async () => {
    const repo = new InMemoryRideRepository();
    const otherPassenger = unwrap(
      PassengerSnapshot.create({
        id: unwrap(UserId.create('cccccccccccccccccccccccccccc')),
        name: unwrap(PersonName.create({ first: 'Edsger', last: 'Dijkstra' })),
        email: unwrap(Email.create('edsger@yeapp.tech')),
        phoneNumber: unwrap(PhoneNumber.create('+14155553333')),
        pushToken: null,
        avatarUrl: null,
        stripeCustomerId: null,
        defaultPaymentMethod: null,
      }),
    );
    await repo.create(
      makeScheduledRide({
        id: 'DDDDDDDDDDDDDDDDDDDD',
        passenger: otherPassenger,
      }),
    );

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeScheduledRide({ id: 'EEEEEEEEEEEEEEEEEEEE' }));
    // Only the initial empty emit, no follow-up.
    expect(seen).toHaveLength(1);
  });

  it('drops a scheduled ride from the set once it transitions out (cancel)', async () => {
    const repo = new InMemoryRideRepository();
    const scheduled = makeScheduledRide({ id: 'FFFFFFFFFFFFFFFFFFFF' });
    await repo.create(scheduled);

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toHaveLength(1);

    // Cancel transitions the ride to 'cancelled' — out of the scheduled set.
    const cancelReason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    const cancelled = await repo.cancel({
      rideId: scheduled.id,
      by: 'rider',
      reason: cancelReason,
    });
    expect(cancelled.ok).toBe(true);
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });
});

describe('InMemoryRideRepository — observeInProgressRidesByPassenger', () => {
  it('delivers LIVE passenger rides and excludes scheduled/terminal', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeRide({ id: 'liveAwaiting12345678', pickup: MIAMI }));

    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('awaiting_driver');
    unsub();
  });

  it('re-emits when a ride is created, and drops it on terminal', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);

    const ride = makeRide({ id: 'liveCreate1234567890', pickup: MIAMI });
    await repo.create(ride);
    expect(seen[seen.length - 1]).toHaveLength(1);

    const cancelled = await repo.cancel({
      rideId: ride.id,
      by: 'rider',
      reason: unwrap(
        CancellationReason.create({ code: 'changed_mind', reasonText: null }),
      ),
    });
    expect(cancelled.ok).toBe(true);
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeRide({ id: 'liveAfterUnsub123456', pickup: MIAMI }));
    expect(seen).toHaveLength(1);
  });
});

describe('InMemoryRideRepository — observeInProgressRidesByDriver', () => {
  it('delivers dispatched rides for the driver, excludes awaiting/other driver', async () => {
    const repo = new InMemoryRideRepository();
    // awaiting (no driver) — must NOT appear
    await repo.create(makeRide({ id: 'drvAwaiting123456789', pickup: MIAMI }));
    // dispatched to DRIVER — must appear
    const toDispatch = makeRide({ id: 'drvDispatched12345ab', pickup: MIAMI });
    await repo.create(toDispatch);
    await repo.update(
      unwrap(
        toDispatch.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );

    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(String(latest[0]?.id)).toBe('drvDispatched12345ab');
    expect(latest[0]?.status).toBe('dispatched');
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    const ride = makeRide({ id: 'drvAfterUnsub1234567', pickup: MIAMI });
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
    expect(seen).toHaveLength(1);
  });

  it('re-emits when a ride becomes dispatched to this driver', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);

    const ride = makeRide({ id: 'drvReemit12345678901', pickup: MIAMI });
    await repo.create(ride); // awaiting_driver — not a driver-LIVE status yet
    expect(seen[seen.length - 1]).toEqual([]);

    await repo.update(
      unwrap(
        ride.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(latest[0]?.status).toBe('dispatched');
    unsub();
  });
});

describe('InMemoryRideRepository — observeScheduledRidesByDriver', () => {
  function makeAcceptedScheduled(id: string): Ride {
    const scheduled = unwrap(
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
        createdAt: new Date('2026-04-27T12:00:00Z'),
        schedulePickupAt: new Date('2026-04-27T13:00:00Z'),
      }),
    );
    return unwrap(scheduled.acceptSchedule({ driver: DRIVER }));
  }

  it('delivers the driver-scoped scheduled_driver_accepted rides on subscribe', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeAcceptedScheduled('drvSched1234567890ab'));
    // A pure scheduled ride (no driver) must NOT appear for the driver.
    await repo.create(
      unwrap(
        Ride.createScheduled({
          id: unwrap(RideId.create('drvSchedPlain12345ab')),
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
          createdAt: new Date('2026-04-27T12:00:00Z'),
          schedulePickupAt: new Date('2026-04-27T13:00:00Z'),
        }),
      ),
    );

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(String(latest[0]?.id)).toBe('drvSched1234567890ab');
    expect(latest[0]?.status).toBe('scheduled_driver_accepted');
    unsub();
  });

  it('re-emits when the driver begins a ride (drops out of the set)', async () => {
    const repo = new InMemoryRideRepository();
    const accepted = makeAcceptedScheduled('drvSchedBegin12345ab');
    await repo.create(accepted);

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[seen.length - 1]).toHaveLength(1);

    await repo.update(
      unwrap(
        accepted.beginScheduledRide({
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeAcceptedScheduled('drvSchedAfterUnsub01'));
    expect(seen).toHaveLength(1); // only the initial empty emit
  });
});
