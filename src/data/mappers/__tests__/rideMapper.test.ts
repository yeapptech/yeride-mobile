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
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';

import { parseRideDoc, toDoc, toDomain } from '../rideMapper';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_CREATED = new Date('2026-04-27T12:00:00Z');
const T_DISPATCH = new Date('2026-04-27T12:01:00Z');
const T_PICKUP = new Date('2026-04-27T12:10:00Z');
const T_COMPLETE = new Date('2026-04-27T12:30:00Z');

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: 'ExponentPushToken[abc]',
    avatarUrl: null,
    defaultPaymentMethod: 'pm_123',
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
      routeLabels: ['DEFAULT_ROUTE'],
      tollPrice: usd(1.5),
      routeToken: 'tk-abc',
      description: 'via I-95',
    }),
  );
}

const PICKUP = unwrap(
  Endpoint.create({
    location: MIAMI,
    address: 'Miami pickup',
    placeName: 'Home',
    directions: null,
  }),
);
const DROPOFF = unwrap(
  Endpoint.create({
    location: FORT_LAUDERDALE,
    address: 'Fort Lauderdale dropoff',
    placeName: null,
    directions: makeRoute(),
  }),
);

function freshRide(): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create('aBcDeFgHiJkLmNoPqRsT')),
      passenger: PASSENGER,
      rideService: RIDE_SERVICE,
      pickup: PICKUP,
      dropoff: DROPOFF,
      createdAt: T_CREATED,
      routePreference: {
        avoidTolls: false,
        selectedRouteSummary: 'via I-95',
        routeToken: 'tk-abc',
      },
    }),
  );
}

describe('parseRideDoc', () => {
  it('accepts a minimal awaiting_driver legacy doc', () => {
    const r = parseRideDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
      },
      rideService: {
        id: 'economy',
        name: 'Economy',
        baseFare: 2.5,
        minimumFare: 5,
        cancelationFee: 2,
        costPerKm: 1.25,
        costPerMinute: 0.2,
        seat: 4,
      },
      status: 'awaiting_driver',
      createdDateTime: T_CREATED.toISOString(),
      pickup: {
        latitude: 25.7617,
        longitude: -80.1918,
        address: 'Miami pickup',
      },
      dropoff: {
        latitude: 26.1224,
        longitude: -80.1373,
        address: 'Fort Lauderdale dropoff',
      },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a doc with an unknown status', () => {
    const r = parseRideDoc({
      passenger: {
        id: '1',
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        phoneNumber: '+1',
      },
      rideService: {
        id: 'x',
        name: 'X',
        baseFare: 0,
        minimumFare: 0,
        cancelationFee: 0,
        costPerKm: 0,
        costPerMinute: 0,
        seat: 1,
      },
      status: 'in_flight',
      createdDateTime: T_CREATED.toISOString(),
      pickup: {
        latitude: 0,
        longitude: 0,
        address: 'a',
      },
      dropoff: {
        latitude: 0,
        longitude: 0,
        address: 'a',
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_doc_invalid_shape');
  });
});

describe('domain → doc → domain round-trip', () => {
  it('preserves a fresh awaiting_driver ride', () => {
    const ride = freshRide();
    const doc = toDoc(ride);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('awaiting_driver');
    expect(String(round.id)).toBe(String(ride.id));
    expect(round.passenger.email.value).toBe('ada@yeapp.tech');
    expect(round.driver).toBeNull();
    expect(round.rideService.baseFare.format()).toBe('$2.50');
    expect(round.dropoff.directions?.routeToken).toBe('tk-abc');
    expect(round.dropoff.directions?.tollPrice?.format()).toBe('$1.50');
    expect(round.routePreference?.routeToken).toBe('tk-abc');
  });

  it('preserves a dispatched ride with driver + pickup directions', () => {
    const dispatched = unwrap(
      freshRide().dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const doc = toDoc(dispatched);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(dispatched.id), parsed));
    expect(round.status).toBe('dispatched');
    expect(round.driver?.stripeAccountId).toBe('acct_abc');
    expect(round.driver?.vehicle?.licensePlate).toBe('ABC1234');
    expect(round.pickup.directions?.routeToken).toBe('tk-abc');
    expect(round.pickupTiming.startedAt?.toISOString()).toBe(
      T_DISPATCH.toISOString(),
    );
  });

  it('preserves a started ride with pickup odometer + elapsed time', () => {
    const started = unwrap(
      unwrap(
        freshRide().dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: T_DISPATCH,
        }),
      ).start({ odometerMeters: 1_500, at: T_PICKUP }),
    );
    const doc = toDoc(started);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(started.id), parsed));
    expect(round.status).toBe('started');
    expect(round.pickupTiming.odometerMeters).toBe(1_500);
    expect(round.pickupTiming.elapsedSeconds).toBe(540);
    expect(round.dropoffTiming.startedAt?.toISOString()).toBe(
      T_PICKUP.toISOString(),
    );
  });

  it('preserves a completed ride with dropoff odometer', () => {
    const completed = unwrap(
      unwrap(
        unwrap(
          unwrap(
            freshRide().dispatch({
              driver: DRIVER,
              pickupDirections: makeRoute(),
              at: T_DISPATCH,
            }),
          ).start({ odometerMeters: 1_500, at: T_PICKUP }),
        ).requestPayment({ odometerMeters: 7_500, at: T_COMPLETE }),
      ).markCompleted(),
    );
    const doc = toDoc(completed);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(completed.id), parsed));
    expect(round.status).toBe('completed');
    expect(round.dropoffTiming.odometerMeters).toBe(7_500);
    expect(round.dropoffTiming.completedAt?.toISOString()).toBe(
      T_COMPLETE.toISOString(),
    );
  });

  it('preserves a cancelled ride with reason + odometer', () => {
    const cancelled = unwrap(
      freshRide().cancel({
        reason: unwrap(
          CancellationReason.create({
            code: 'driver_no_show',
            reasonText: null,
          }),
        ),
        by: 'rider',
        at: T_DISPATCH,
        odometerMeters: 0,
      }),
    );
    const doc = toDoc(cancelled);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(cancelled.id), parsed));
    expect(round.status).toBe('cancelled');
    expect(round.cancellation?.by).toBe('rider');
    expect(round.cancellation?.reason.code).toBe('driver_no_show');
    expect(round.cancellation?.odometerMeters).toBe(0);
  });
});

describe('toDomain — legacy field shape tolerance', () => {
  it('accepts a legacy doc with `seat` (no `seatCapacity`)', () => {
    const ride = freshRide();
    const doc = toDoc(ride);
    // Mimic an old write: drop seatCapacity.
    delete (doc.rideService as { seatCapacity?: unknown }).seatCapacity;
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.rideService.seatCapacity).toBe(4);
  });

  it('treats missing pickup/dropoff directions as null', () => {
    const ride = freshRide();
    const doc = toDoc(ride);
    doc.pickup.directions = null;
    doc.dropoff.directions = null;
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.pickup.directions).toBeNull();
    expect(round.dropoff.directions).toBeNull();
  });
});
