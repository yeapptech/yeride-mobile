/**
 * Local Ride fixture for Activity / TripDetail-related component +
 * view-model tests. Avoids copying the 50-line `Ride.create(...)` setup
 * across every new test file.
 *
 * Kept inside the components folder rather than `@shared/testing` because
 * (a) it's presentation-test-only — not a domain fake the DI container
 * wires — and (b) the existing rewrite tests favor file-local fixtures
 * (see `GetRideById.test.ts`, `ListRidesByPassenger.test.ts`, etc.). One
 * shared fixture is enough; pushing it deeper would invite reuse from
 * places that don't need this exact shape.
 */
import { CancellationReason } from '@domain/entities/CancellationReason';
import { Coordinates } from '@domain/entities/Coordinates';
import { DriverSnapshot } from '@domain/entities/DriverSnapshot';
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
import type { RideStatus } from '@domain/entities/RideStatus';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';

export function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!r.ok) {
    throw new Error(`unwrap failed: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

function usd(m: number): Money {
  return unwrap(Money.fromMajor(m, 'USD'));
}

export function makePassenger(
  idStr = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
): PassengerSnapshot {
  return unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create(idStr)),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
}

export function makeDriver(
  idStr = 'dddddddddddddddddddddddddddd',
): DriverSnapshot {
  return unwrap(
    DriverSnapshot.create({
      id: unwrap(UserId.create(idStr)),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('grace@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      pushToken: null,
      avatarUrl: null,
      stripeAccountId: 'acct_test_xyz',
      vehicle: null,
    }),
  );
}

export function makeRideService(): RideServiceSnapshot {
  return unwrap(
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
}

export function makeAwaitingRide(args: {
  id: string;
  passengerId?: string;
  createdAt?: Date;
  pickup?: string;
  dropoff?: string;
}): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(args.id)),
      passenger: makePassenger(args.passengerId),
      rideService: makeRideService(),
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: args.pickup ?? '123 Pickup St, Miami, FL',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: args.dropoff ?? '456 Dropoff Ave, Fort Lauderdale, FL',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: args.createdAt ?? new Date('2026-05-19T10:00:00Z'),
    }),
  );
}

export function makeRoute(): Route {
  return unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: unwrap(Coordinates.create(25.7617, -80.1918)),
      endLocation: unwrap(Coordinates.create(26.1224, -80.1373)),
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
}

/**
 * Build a ride with a specific terminal/active status — does the
 * legal sequence of transitions to get there. The returned Ride
 * matches the legacy-domain status set.
 */
export function makeRideAt(
  status: RideStatus,
  id = 'rideAbcDef1234567890ab',
): Ride {
  const r = makeAwaitingRide({ id });
  if (status === 'awaiting_driver') return r;

  const dispatched = unwrap(
    r.dispatch({
      driver: makeDriver(),
      pickupDirections: makeRoute(),
      at: new Date(r.createdAt.getTime() + 60_000),
    }),
  );
  if (status === 'dispatched') return dispatched;

  if (status === 'cancelled') {
    return unwrap(
      dispatched.cancel({
        reason: unwrap(
          CancellationReason.create({ code: 'changed_mind', reasonText: null }),
        ),
        by: 'rider',
        at: new Date(r.createdAt.getTime() + 120_000),
        odometerMeters: null,
      }),
    );
  }

  const started = unwrap(
    dispatched.start({
      odometerMeters: 1000,
      at: new Date(r.createdAt.getTime() + 180_000),
    }),
  );
  if (status === 'started') return started;

  const requested = unwrap(
    started.requestPayment({
      odometerMeters: 1500,
      at: new Date(r.createdAt.getTime() + 1800_000),
    }),
  );
  if (status === 'payment_requested') return requested;
  if (status === 'payment_failed') {
    // The Ride entity doesn't expose a synthetic transition to
    // payment_failed (it's set server-side); rebuild via fromProps so the
    // component tests can render the right pill. Read each getter
    // (`props` itself is private).
    return unwrap(
      Ride.fromProps({
        id: requested.id,
        status: 'payment_failed',
        passenger: requested.passenger,
        driver: requested.driver,
        rideService: requested.rideService,
        pickup: requested.pickup,
        dropoff: requested.dropoff,
        createdAt: requested.createdAt,
        pickupTiming: requested.pickupTiming,
        dropoffTiming: requested.dropoffTiming,
        cancellation: requested.cancellation,
        routePreference: requested.routePreference,
        schedulePickupAt: requested.schedulePickupAt,
        paymentFailure: requested.paymentFailure,
      }),
    );
  }

  return unwrap(requested.markCompleted());
}
