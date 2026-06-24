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
import { PaymentFailure } from '@domain/entities/PaymentFailure';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { UserId } from '@domain/entities/UserId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

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
    stripeCustomerId: unwrap(StripeCustomerId.create('cus_riderabc')),
    defaultPaymentMethod: {
      id: unwrap(PaymentMethodId.create('pm_123')),
      type: 'card',
    },
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
      unwrap(
        freshRide().claimForDispatch({ driver: DRIVER, at: T_DISPATCH }),
      ).attachPickupDirections(makeRoute()),
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
        freshRide().claimForDispatch({ driver: DRIVER, at: T_DISPATCH }),
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
            freshRide().claimForDispatch({ driver: DRIVER, at: T_DISPATCH }),
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

// Phase 9 cleanup. Legacy yeride writes awaiting_driver trip docs in
// these shapes — confirmed against an actual on-disk doc
// (LdUV7hRhkDUuu6a5QdI1) that crashed schema validation against the
// rewrite's stricter DTOs. These tests pin the tolerant-read contract
// so a future cleanup doesn't accidentally re-tighten the schema and
// break the data co-existence rule.
describe('toDomain — legacy yeride awaiting_driver trip shape', () => {
  /**
   * Build a "legacy-style" awaiting_driver doc by hand. Doesn't reuse
   * `freshRide() + toDoc()` because we want explicit control over the
   * shape — the canonical writer wouldn't emit any of these legacy
   * structures.
   */
  function legacyAwaitingDriverDoc(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
      },
      // Legacy `TripContext` initialState writes `driver: {}`.
      driver: {},
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
      // Pickup with the legacy Google Places shape: lat/lng nested in
      // address.geometry.location, address itself is the full Place
      // details object.
      pickup: {
        address: {
          description: 'Sunrise Lakes',
          formatted_address: 'Sunrise Lakes, Sunrise, FL 33323, USA',
          name: 'Sunrise Lakes',
          place_id: 'ChIJ123pickup',
          types: ['neighborhood'],
          vicinity: 'Sunrise',
          geometry: {
            location: { lat: 26.1488, lng: -80.2737 },
          },
        },
      },
      dropoff: {
        address: {
          description: 'Cleary Blvd',
          formatted_address: 'Cleary Blvd, Plantation, FL, USA',
          name: 'Cleary Blvd',
          place_id: 'ChIJ123dropoff',
          types: ['route'],
          vicinity: 'Plantation',
          geometry: {
            location: { lat: 26.1224, lng: -80.2638 },
          },
        },
      },
      // Legacy top-level fields the DTO ignores (Zod default-strip).
      id: 'LdUV7hRhkDUuu6a5QdI1',
      isDriverAtPickup: false,
      isDriverAtDropoff: false,
      showPickupExitWarning: false,
      showDropoffExitWarning: false,
      schedulePickupAt: null,
      serviceArea: { id: 'broward', name: 'Broward County' },
      ...overrides,
    };
  }

  it('reads a real-world legacy awaiting_driver doc end-to-end', () => {
    // The doc shape that crashed in production (id LdUV7hRhkDUuu6a5QdI1).
    const doc = legacyAwaitingDriverDoc();
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('LdUV7hRhkDUuu6a5QdI1', parsed));
    expect(round.status).toBe('awaiting_driver');
    expect(round.driver).toBeNull();
    expect(round.pickup.location.latitude).toBeCloseTo(26.1488, 4);
    expect(round.pickup.location.longitude).toBeCloseTo(-80.2737, 4);
    expect(round.pickup.address).toBe('Sunrise Lakes, Sunrise, FL 33323, USA');
    expect(round.pickup.placeName).toBe('Sunrise Lakes');
    expect(round.dropoff.location.latitude).toBeCloseTo(26.1224, 4);
    expect(round.dropoff.location.longitude).toBeCloseTo(-80.2638, 4);
    expect(round.passenger.defaultPaymentMethod).toBeNull();
  });

  it('treats `driver: {}` (legacy initialState) as null', () => {
    const doc = legacyAwaitingDriverDoc({ driver: {} });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver).toBeNull();
  });

  it('treats `driver: {someField: ""}` with no real id as null', () => {
    // Defensive: occasionally legacy partially populates the driver
    // object (e.g. pushToken without id) — still no real driver info.
    const doc = legacyAwaitingDriverDoc({
      driver: { id: '', firstName: 'X' },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver).toBeNull();
  });

  it('extracts coords from address.geometry.location when top-level lat/lng absent', () => {
    const doc = legacyAwaitingDriverDoc();
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.pickup.location.latitude).toBeCloseTo(26.1488, 4);
    expect(round.pickup.location.longitude).toBeCloseTo(-80.2737, 4);
  });

  it('extracts coords from directions.startLocation when address has no geometry', () => {
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        // No top-level lat/lng. Address object without geometry.
        address: { formatted_address: 'A pickup address with no geometry' },
        directions: {
          startLocation: { latitude: 26.5, longitude: -80.5 },
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.pickup.location.latitude).toBeCloseTo(26.5, 4);
    expect(round.pickup.location.longitude).toBeCloseTo(-80.5, 4);
  });

  it('extracts address string from formatted_address (preferred)', () => {
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        address: {
          formatted_address: 'Preferred address',
          description: 'Should not be picked',
          name: 'Place Name',
          geometry: { location: { lat: 26.1, lng: -80.1 } },
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.pickup.address).toBe('Preferred address');
  });

  it('falls back to description when formatted_address is absent', () => {
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        address: {
          description: 'Description fallback',
          name: 'Place Name',
          geometry: { location: { lat: 26.1, lng: -80.1 } },
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.pickup.address).toBe('Description fallback');
  });

  it('surfaces address.name into placeName when explicit placeName absent', () => {
    const doc = legacyAwaitingDriverDoc();
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.pickup.placeName).toBe('Sunrise Lakes');
  });

  it('extracts `{id, type}` from passenger.defaultPaymentMethod legacy object form', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        // Legacy writes the FULL Stripe PaymentMethod object. Real Stripe
        // PM ids are `pm_` + 24 alphanumeric chars (no underscores in
        // body) — `PaymentMethodId.create` rejects ids with underscores
        // in the body.
        defaultPaymentMethod: {
          id: 'pm_legacyXYZ123',
          card: { brand: 'visa', last4: '4242' },
          type: 'card',
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(String(round.passenger.defaultPaymentMethod?.id)).toBe(
      'pm_legacyXYZ123',
    );
    expect(round.passenger.defaultPaymentMethod?.type).toBe('card');
  });

  it('falls back to null on a malformed defaultPaymentMethod.id without crashing the read', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        // Underscore in body — PaymentMethodId.create rejects.
        defaultPaymentMethod: { id: 'pm_legacy_xxx', type: 'card' },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.defaultPaymentMethod).toBeNull();
  });

  it('back-compat: synthesizes {id, type:"card"} from a bare-string defaultPaymentMethod', () => {
    // Rewrite pre-Phase-9-turn-4 wrote a bare id string. Reading those
    // legacy docs must still produce a usable PassengerSnapshot.
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        defaultPaymentMethod: 'pm_barestring',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(String(round.passenger.defaultPaymentMethod?.id)).toBe(
      'pm_barestring',
    );
    expect(round.passenger.defaultPaymentMethod?.type).toBe('card');
  });

  it('reads passenger.stripeCustomerId off a legacy doc that carries it', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        stripeCustomerId: 'cus_legacyrider',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(String(round.passenger.stripeCustomerId)).toBe('cus_legacyrider');
  });

  it('falls back to null on a malformed stripeCustomerId without crashing the read', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        // Missing the `cus_` prefix — StripeCustomerId.create rejects.
        stripeCustomerId: 'not-a-real-id',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.stripeCustomerId).toBeNull();
  });

  it('round-trips canonical {id, type} defaultPaymentMethod through toDoc + toDomain', () => {
    // Phase 9 turn 4 regression guard. The canonical write shape must
    // survive a full round-trip without information loss.
    const ride = freshRide();
    const doc = toDoc(ride);
    expect(doc.passenger.stripeCustomerId).toBe('cus_riderabc');
    expect(doc.passenger.defaultPaymentMethod).toEqual({
      id: 'pm_123',
      type: 'card',
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(String(round.passenger.stripeCustomerId)).toBe('cus_riderabc');
    expect(String(round.passenger.defaultPaymentMethod?.id)).toBe('pm_123');
    expect(round.passenger.defaultPaymentMethod?.type).toBe('card');
  });

  it('returns ValidationError when no source yields pickup coords', () => {
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        address: { formatted_address: 'Unresolvable address' },
        // No directions, no top-level lat/lng, no address.geometry.
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const r = toDomain('test-id', parsed);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_doc_missing_pickup_coords');
    }
  });

  it('skips the {0,0} placeholder when sourcing from directions', () => {
    // Routes API helpers in the rewrite write {0,0} for missing endpoints.
    // The mapper must not trust those — would silently locate the pickup
    // at the equator.
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        address: { formatted_address: 'Address with placeholder directions' },
        directions: {
          startLocation: { latitude: 0, longitude: 0 },
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const r = toDomain('test-id', parsed);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_doc_missing_pickup_coords');
    }
  });

  it('round-trips the canonical rewrite shape unaffected', () => {
    // Regression guard: the new tolerant readers must not change the
    // round-trip behaviour for docs the rewrite writes itself.
    const ride = freshRide();
    const doc = toDoc(ride);
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.passenger.email.value).toBe('ada@yeapp.tech');
    expect(round.pickup.address).toBe('Miami pickup');
    expect(round.pickup.location.latitude).toBeCloseTo(25.7617, 4);
    expect(round.dropoff.address).toBe('Fort Lauderdale dropoff');
  });

  // Legacy `GoogleMapsAPI.computeRoutes` stores route legs as
  // `{lat, lng}` (Google Maps JS SDK convention). The rewrite's Routes
  // API path uses `{latitude, longitude}`. Preprocessor normalises.
  it('accepts legacy `{lat, lng}` shape on directions endpoints', () => {
    const doc = legacyAwaitingDriverDoc({
      pickup: {
        latitude: 26.1488,
        longitude: -80.2737,
        address: 'Sunrise Lakes',
        directions: {
          distanceMeters: 5_000,
          durationSeconds: 600,
          // Legacy lat/lng shape — preprocessor maps to latitude/longitude.
          startLocation: { lat: 26.1488, lng: -80.2737 },
          endLocation: { lat: 26.1224, lng: -80.2638 },
          encodedPolyline: '_p~iF',
          tollInfo: null,
        },
      },
      dropoff: {
        latitude: 26.1224,
        longitude: -80.2638,
        address: 'Cleary Blvd',
        directions: {
          distanceMeters: 5_000,
          durationSeconds: 600,
          startLocation: { lat: 26.1488, lng: -80.2737 },
          endLocation: { lat: 26.1224, lng: -80.2638 },
          encodedPolyline: '_p~iF',
          tollInfo: null,
        },
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.dropoff.directions?.startLocation.latitude).toBeCloseTo(
      26.1488,
      4,
    );
    expect(round.dropoff.directions?.endLocation.longitude).toBeCloseTo(
      -80.2638,
      4,
    );
  });

  it('accepts `tollInfo: null` (no-tolls leg from legacy)', () => {
    const doc = legacyAwaitingDriverDoc({
      dropoff: {
        latitude: 26.1224,
        longitude: -80.2638,
        address: 'Cleary Blvd',
        directions: {
          distanceMeters: 5_000,
          durationSeconds: 600,
          tollInfo: null,
        },
      },
    });
    const r = parseRideDoc(doc);
    expect(r.ok).toBe(true);
  });

  it('accepts `routeToken: null` (legacy may write null instead of omit)', () => {
    const doc = legacyAwaitingDriverDoc({
      dropoff: {
        latitude: 26.1224,
        longitude: -80.2638,
        address: 'Cleary Blvd',
        directions: {
          distanceMeters: 5_000,
          durationSeconds: 600,
          routeToken: null,
        },
      },
    });
    const r = parseRideDoc(doc);
    expect(r.ok).toBe(true);
  });

  // Legacy yeride's UserProfile zod regex accepts country-code-less
  // phones; many historical docs have the raw 10-digit US form. The
  // rewrite's PhoneNumber.create requires E.164. The mapper normalises
  // at the boundary so the entity invariant stays strict for fresh
  // writes.
  it('normalises a 10-digit US passenger phone to E.164', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '9545551234',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.phoneNumber.value).toBe('+19545551234');
  });

  it('normalises a parens/dashes-formatted US passenger phone to E.164', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '(954) 555-1234',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.phoneNumber.value).toBe('+19545551234');
  });

  it('normalises an 11-digit "1xxxxxxxxxx" passenger phone to E.164', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '19545551234',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.phoneNumber.value).toBe('+19545551234');
  });

  it('passes through an already-E.164 passenger phone unchanged', () => {
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+447911123456',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.passenger.phoneNumber.value).toBe('+447911123456');
  });

  it('does not silently misclassify a non-NANP digit string', () => {
    // 9 digits is too short to be NANP; mapper should pass it through
    // and let PhoneNumber.create surface the failure instead of
    // prepending +1 and creating a wrong number.
    const doc = legacyAwaitingDriverDoc({
      passenger: {
        id: String(PASSENGER.id),
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '954555123',
      },
    });
    const parsed = unwrap(parseRideDoc(doc));
    const r = toDomain('test-id', parsed);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either phone_missing_country_code (passes through; no +) or
      // phone_too_short. Both are correct rejections — we just want to
      // confirm we didn't silently auto-prepend +1.
      expect(
        r.error.code === 'phone_missing_country_code' ||
          r.error.code === 'phone_too_short',
      ).toBe(true);
    }
  });

  // Phase 10 regression: legacy `dispatchDriver` embeds the vehicle
  // snapshot with `photos` as a `{front,back,left,right,interior}` object
  // (yeride `sanitizeVehiclePhotos`), not the canonical array. The DTO
  // must collapse it instead of failing schema validation — a failure
  // logs `ride_doc_invalid_schema` and drops the whole ride from
  // `listByDriver`.
  function driverWithVehiclePhotos(photos: unknown): Record<string, unknown> {
    return {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@yeapp.tech',
      phoneNumber: '+14155552222',
      stripeAccountId: 'acct_abc',
      vehicle: {
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'White',
        licensePlate: 'ABC1234',
        photos,
      },
    };
  }

  it('collapses a legacy `{front,back,…}` vehicle photos object to a string array', () => {
    const doc = legacyAwaitingDriverDoc({
      driver: driverWithVehiclePhotos({
        front: 'url-f',
        back: null,
        left: 'url-l',
        right: null,
        interior: null,
      }),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver?.vehicle?.photos).toEqual(['url-f', 'url-l']);
  });

  it('passes through a canonical array of vehicle photo URLs', () => {
    const doc = legacyAwaitingDriverDoc({
      driver: driverWithVehiclePhotos(['a', 'b']),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver?.vehicle?.photos).toEqual(['a', 'b']);
  });

  it('treats a missing vehicle photos field as an empty array', () => {
    const doc = legacyAwaitingDriverDoc({
      driver: driverWithVehiclePhotos(undefined),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver?.vehicle?.photos).toEqual([]);
  });

  it('treats an all-null legacy vehicle photos object as an empty array', () => {
    const doc = legacyAwaitingDriverDoc({
      driver: driverWithVehiclePhotos({
        front: null,
        back: null,
        left: null,
        right: null,
        interior: null,
      }),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.driver?.vehicle?.photos).toEqual([]);
  });
});

// Phase 8 turn 3 regression coverage. The deployed Cloud Function
// `cancelTrip` writes a flat shape: status='passenger_canceled' /
// 'driver_canceled' (snake_case), cancelReason as a top-level *string*,
// with sibling top-level canceledBy / canceledAt / cancelReasonText.
// The DTO must accept this and the mapper must fold it into the
// canonical domain `RideCancellation` with `status='cancelled'`.
describe('toDomain — legacy Cloud Function cancel shape', () => {
  function makeLegacyCanceledDoc(
    overrides: Record<string, unknown>,
  ): Record<string, unknown> {
    const ride = freshRide();
    const doc = toDoc(ride) as unknown as Record<string, unknown>;
    return { ...doc, ...overrides };
  }

  it('normalizes status `passenger_canceled` to canonical `cancelled`', () => {
    const ride = freshRide();
    const doc = makeLegacyCanceledDoc({
      status: 'passenger_canceled',
      cancelReason: 'changed_mind',
      canceledBy: 'rider',
      canceledAt: T_DISPATCH.toISOString(),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('cancelled');
    expect(round.cancellation?.by).toBe('rider');
    expect(round.cancellation?.reason.code).toBe('changed_mind');
    expect(round.cancellation?.at.toISOString()).toBe(T_DISPATCH.toISOString());
  });

  it('normalizes status `driver_canceled` to canonical `cancelled` with by=driver', () => {
    const ride = freshRide();
    const doc = makeLegacyCanceledDoc({
      status: 'driver_canceled',
      cancelReason: 'passenger_no_show',
      canceledBy: 'driver',
      canceledAt: T_DISPATCH.toISOString(),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('cancelled');
    expect(round.cancellation?.by).toBe('driver');
    expect(round.cancellation?.reason.code).toBe('passenger_no_show');
  });

  it('folds top-level `cancelReasonText` into the cancellation reason', () => {
    const ride = freshRide();
    const doc = makeLegacyCanceledDoc({
      status: 'driver_canceled',
      cancelReason: 'other',
      cancelReasonText: 'flat tire',
      canceledBy: 'driver',
      canceledAt: T_DISPATCH.toISOString(),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.cancellation?.reason.code).toBe('other');
    expect(round.cancellation?.reason.reasonText).toBe('flat tire');
  });

  it('infers `by` from status when `canceledBy` is absent', () => {
    const ride = freshRide();
    const doc = makeLegacyCanceledDoc({
      status: 'passenger_canceled',
      cancelReason: 'changed_mind',
      // No canceledBy field — older legacy writes may have omitted it.
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.cancellation?.by).toBe('rider');
  });

  it('synthesizes a minimal cancellation when status is set but cancelReason is missing', () => {
    const ride = freshRide();
    const doc = makeLegacyCanceledDoc({
      status: 'passenger_canceled',
      // No cancelReason at all (truncated/garbled cancel write)
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('cancelled');
    // Falls through to a stub `'changed_mind'` reason — better than
    // crashing the read on a malformed disk record.
    expect(round.cancellation?.reason.code).toBe('changed_mind');
    expect(round.cancellation?.by).toBe('rider');
  });

  it('still accepts the canonical nested `cancelReason` object', () => {
    // Ensures the union doesn't break the rewrite's direct-write path.
    const cancelled = unwrap(
      freshRide().cancel({
        reason: unwrap(
          CancellationReason.create({ code: 'changed_mind', reasonText: null }),
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
    expect(round.cancellation?.reason.code).toBe('changed_mind');
    expect(round.cancellation?.odometerMeters).toBe(0);
  });
});

// Phase 9 turn 4 smoke fix. After the driver taps Request Payment,
// the deployed pipeline transitions the trip doc through two
// additional wire statuses the rewrite enum doesn't have natively:
//
//   payment_requested → completed → payment_intent → closed
//                       ^Cloud Fn   ^processPayment   ^Stripe webhook
//
//   - 'payment_intent' is written by yeride-functions/lib/payments.js
//     after `processPayment` initiates the Stripe charge. The receipt
//     should still render — the charge is in flight and the rider is
//     waiting for it to settle. Maps to canonical 'payment_requested'.
//
//   - 'closed' is written by yeride-stripe-server/stripe/routes.js
//     after the Stripe `charge.succeeded` webhook fires. The trip is
//     finished and the fare cleared. Maps to canonical 'completed'.
//
// Without these normalizations the receipt screen briefly renders the
// 'completed' state, then `observeRide` catches the next snapshot,
// the schema's `status` enum rejects 'closed' (or 'payment_intent'),
// `toDomainOrCorrupt` returns Result.err, the live subscription emits
// null, and the receipt VM's post-mount `ride === null` branch
// renders "We couldn't find that receipt."
describe('toDomain — legacy Cloud Function payment-pipeline status shapes', () => {
  function makePipelineStatusDoc(
    status: string,
    extras: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const ride = freshRide();
    const doc = toDoc(ride) as unknown as Record<string, unknown>;
    return { ...doc, status, ...extras };
  }

  it("normalizes status 'payment_intent' to canonical 'payment_requested'", () => {
    const doc = makePipelineStatusDoc('payment_intent');
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('rideForPipelineStatus1', parsed));
    expect(round.status).toBe('payment_requested');
  });

  it("normalizes status 'closed' to canonical 'completed'", () => {
    const doc = makePipelineStatusDoc('closed', {
      closedAt: T_COMPLETE.toISOString(),
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('rideForPipelineStatus2', parsed));
    expect(round.status).toBe('completed');
  });

  it('accepts top-level `closedAt` without breaking the parse', () => {
    // The Stripe webhook writes `closedAt` alongside `status: 'closed'`.
    // Zod's default object mode would strip an unknown key silently,
    // but the schema declares it (mirroring the canceledAt pattern) so
    // `topLevelKeys` stays scannable for diagnostics.
    const doc = makePipelineStatusDoc('closed', {
      closedAt: T_COMPLETE.toISOString(),
    });
    const parsed = unwrap(parseRideDoc(doc));
    expect(parsed.status).toBe('closed');
    expect(parsed.closedAt).toBe(T_COMPLETE.toISOString());
  });

  it("still accepts the canonical 'completed' status without normalization", () => {
    // Regression guard: the new switch arm must not interfere with the
    // existing direct-write path the rewrite uses.
    const doc = makePipelineStatusDoc('completed');
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('rideForPipelineStatus3', parsed));
    expect(round.status).toBe('completed');
  });
});

/**
 * Phase 9 turn 11 — telemetry: 2 LOG.warn → LOG.error flips on the
 * malformed-id fallback paths in `passengerToDomain`. Mirror of the
 * userMapper telemetry pattern; same test scaffolding.
 */
describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 11)', () => {
  const SCOPE = 'YeRide:RideMapper';

  function minimalRideDoc(
    passengerOverrides: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      passenger: {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@yeapp.tech',
        phoneNumber: '+14155551111',
        ...passengerOverrides,
      },
      driver: {},
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
        address: {
          description: 'Sunrise',
          formatted_address: 'Sunrise, FL, USA',
          name: 'Sunrise',
          place_id: 'ChIJpickup',
          types: ['neighborhood'],
          vicinity: 'Sunrise',
          geometry: { location: { lat: 26.1488, lng: -80.2737 } },
        },
      },
      dropoff: {
        address: {
          description: 'Plantation',
          formatted_address: 'Plantation, FL, USA',
          name: 'Plantation',
          place_id: 'ChIJdropoff',
          types: ['route'],
          vicinity: 'Plantation',
          geometry: { location: { lat: 26.1224, lng: -80.2638 } },
        },
      },
    };
  }

  it('malformed passenger.stripeCustomerId → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const doc = minimalRideDoc({ stripeCustomerId: 'not-a-real-id' });
      const parsed = unwrap(parseRideDoc(doc));
      const r = toDomain('test-id', parsed);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith(
          'trip_doc_malformed_passenger_stripe_customer_id',
        ),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('malformed passenger.defaultPaymentMethod.id → recordError fires with constructed Error carrying the stable prefix', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const doc = minimalRideDoc({
        // Underscore in body — PaymentMethodId.create rejects.
        defaultPaymentMethod: { id: 'pm_legacy_xxx', type: 'card' },
      });
      const parsed = unwrap(parseRideDoc(doc));
      const r = toDomain('test-id', parsed);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith(
          'trip_doc_malformed_passenger_payment_method_id',
        ),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });
});

/* ─────────────────────────── schedulePickupAt ───────────────── */

// Phase 10 turn 7 — scheduled-rides field. Cloud Function
// `yeride-functions/handlers/trip-created.js:121` reads
// `tripData.schedulePickupAt.toDate()`, so the wire-format
// expectation is a Firestore Timestamp. The rewrite's DTO
// preprocesses Timestamp / ISO-string / null/missing into a
// `Date | null` for the domain mapper.
describe('schedulePickupAt — scheduled-ride field', () => {
  const SCHEDULED_AT = new Date('2026-04-27T13:00:00Z');

  function scheduledRide(): Ride {
    return unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create('aBcDeFgHiJkLmNoPqRsT')),
        passenger: PASSENGER,
        rideService: RIDE_SERVICE,
        pickup: PICKUP,
        dropoff: DROPOFF,
        createdAt: T_CREATED,
        schedulePickupAt: SCHEDULED_AT,
      }),
    );
  }

  it('round-trips a scheduled ride: toDoc emits a Date, parseRideDoc accepts it, toDomain restores the Date', () => {
    const ride = scheduledRide();
    const doc = toDoc(ride);
    expect(doc.schedulePickupAt).toBeInstanceOf(Date);
    expect((doc.schedulePickupAt as Date).toISOString()).toBe(
      SCHEDULED_AT.toISOString(),
    );
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('scheduled');
    expect(round.schedulePickupAt?.toISOString()).toBe(
      SCHEDULED_AT.toISOString(),
    );
  });

  it('toDoc OMITS schedulePickupAt for a non-scheduled (default null) ride', () => {
    const ride = freshRide();
    const doc = toDoc(ride);
    expect('schedulePickupAt' in doc).toBe(false);
  });

  it('parseRideDoc accepts a Firestore Timestamp duck-type and coerces to Date', () => {
    // Mimic the @react-native-firebase/firestore Timestamp class. Real
    // Timestamps carry both a `toDate()` method AND numeric
    // `seconds`/`nanoseconds` fields — the DTO preprocess requires
    // both to qualify, keeping the duck-type from matching an
    // unrelated `{toDate}` object.
    const timestampLike = {
      seconds: Math.floor(SCHEDULED_AT.getTime() / 1000),
      nanoseconds: 0,
      toDate: () => new Date(SCHEDULED_AT.getTime()),
    };
    const doc = {
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
      status: 'scheduled',
      createdDateTime: T_CREATED.toISOString(),
      pickup: { latitude: 25.7617, longitude: -80.1918, address: 'A' },
      dropoff: { latitude: 26.1224, longitude: -80.1373, address: 'B' },
      schedulePickupAt: timestampLike,
    };
    const parsed = unwrap(parseRideDoc(doc));
    expect(parsed.schedulePickupAt).toBeInstanceOf(Date);
    expect(parsed.schedulePickupAt?.toISOString()).toBe(
      SCHEDULED_AT.toISOString(),
    );
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.schedulePickupAt?.toISOString()).toBe(
      SCHEDULED_AT.toISOString(),
    );
  });

  it('parseRideDoc tolerates an ISO-string schedulePickupAt (defensive against backfills)', () => {
    const doc = {
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
      status: 'scheduled',
      createdDateTime: T_CREATED.toISOString(),
      pickup: { latitude: 25.7617, longitude: -80.1918, address: 'A' },
      dropoff: { latitude: 26.1224, longitude: -80.1373, address: 'B' },
      schedulePickupAt: SCHEDULED_AT.toISOString(),
    };
    const parsed = unwrap(parseRideDoc(doc));
    expect(parsed.schedulePickupAt?.toISOString()).toBe(
      SCHEDULED_AT.toISOString(),
    );
  });

  it('parseRideDoc treats missing schedulePickupAt as null at the domain boundary', () => {
    const doc = {
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
      pickup: { latitude: 25.7617, longitude: -80.1918, address: 'A' },
      dropoff: { latitude: 26.1224, longitude: -80.1373, address: 'B' },
    };
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.schedulePickupAt).toBeNull();
  });

  it('parseRideDoc accepts explicit null schedulePickupAt (legacy field-present-but-null)', () => {
    // The legacy yeride app initializes `schedulePickupAt: null` in
    // TripContext and persists that null on awaiting_driver trips. The
    // rewrite must read those docs without rejecting.
    const doc = {
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
      pickup: { latitude: 25.7617, longitude: -80.1918, address: 'A' },
      dropoff: { latitude: 26.1224, longitude: -80.1373, address: 'B' },
      schedulePickupAt: null,
    };
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain('test-id', parsed));
    expect(round.schedulePickupAt).toBeNull();
  });
});

/**
 * Phase 10 Turn 10.5 — paymentError DTO round-trip + mapper coverage.
 *
 * Legacy docs (and the Stripe-async-failure path on the rewrite)
 * don't write the field; reads must surface `paymentFailure: null`
 * without throwing. The synchronous-error path on the rewrite
 * Cloud Function writes `paymentError: {code, message, occurredAt}`
 * alongside the `status: 'payment_failed'` flip; reads must project
 * that into a `PaymentFailure` value object on the domain.
 */
describe('paymentError DTO ↔ domain (Phase 10 Turn 10.5)', () => {
  function baseDoc() {
    return {
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
      createdDateTime: T_CREATED.toISOString(),
      pickup: { latitude: 25.7617, longitude: -80.1918, address: 'A' },
      dropoff: { latitude: 26.1224, longitude: -80.1373, address: 'B' },
    };
  }

  it('legacy doc without paymentError reads as paymentFailure: null', () => {
    const doc = { ...baseDoc(), status: 'completed' as const };
    const parsed = unwrap(parseRideDoc(doc));
    const ride = unwrap(toDomain('legacy-id', parsed));
    expect(ride.paymentFailure).toBeNull();
  });

  it('new doc with paymentError reads as PaymentFailure value object', () => {
    const occurredAt = new Date('2026-05-26T15:00:00Z');
    const doc = {
      ...baseDoc(),
      status: 'payment_failed' as const,
      paymentError: {
        code: 'trip_missing_payment_method',
        message: 'passenger.defaultPaymentMethod.id is missing',
        occurredAt,
      },
    };
    const parsed = unwrap(parseRideDoc(doc));
    const ride = unwrap(toDomain('failed-id', parsed));
    expect(ride.paymentFailure).not.toBeNull();
    expect(ride.paymentFailure?.code).toBe('trip_missing_payment_method');
    expect(ride.paymentFailure?.message).toBe(
      'passenger.defaultPaymentMethod.id is missing',
    );
    expect(ride.paymentFailure?.occurredAt.getTime()).toBe(
      occurredAt.getTime(),
    );
    expect(ride.paymentFailure?.isKnown()).toBe(true);
  });

  it('accepts a Firestore Timestamp-shaped paymentError.occurredAt', () => {
    // Duck-typed Firestore Timestamp — `toDate()` + numeric `seconds`.
    const ts = {
      seconds: 1748275200, // 2026-05-26T16:00:00Z
      nanoseconds: 0,
      toDate: () => new Date(1748275200 * 1000),
    };
    const doc = {
      ...baseDoc(),
      status: 'payment_failed' as const,
      paymentError: {
        code: 'card_declined',
        message: 'Your card was declined.',
        occurredAt: ts,
      },
    };
    const parsed = unwrap(parseRideDoc(doc));
    const ride = unwrap(toDomain('failed-id', parsed));
    expect(ride.paymentFailure?.code).toBe('card_declined');
    expect(ride.paymentFailure?.occurredAt.getTime()).toBe(1748275200 * 1000);
  });

  it('accepts an unknown future code (forward compat)', () => {
    const doc = {
      ...baseDoc(),
      status: 'payment_failed' as const,
      paymentError: {
        code: 'future_server_code_not_in_catalog',
        message: 'something happened',
        occurredAt: new Date('2026-05-26T17:00:00Z'),
      },
    };
    const parsed = unwrap(parseRideDoc(doc));
    const ride = unwrap(toDomain('failed-id', parsed));
    expect(ride.paymentFailure?.code).toBe('future_server_code_not_in_catalog');
    expect(ride.paymentFailure?.isKnown()).toBe(false);
  });

  it('treats paymentError.occurredAt: null as paymentFailure: null', () => {
    // The DTO preprocess coerces a bad timestamp shape to null; the
    // mapper then degrades to null rather than fabricating a date.
    const doc = {
      ...baseDoc(),
      status: 'payment_failed' as const,
      paymentError: {
        code: 'card_declined',
        message: 'x',
        occurredAt: null,
      },
    };
    const parsed = unwrap(parseRideDoc(doc));
    const ride = unwrap(toDomain('failed-id', parsed));
    expect(ride.paymentFailure).toBeNull();
  });

  it('rejects paymentError with an empty code at parse time', () => {
    const doc = {
      ...baseDoc(),
      status: 'payment_failed' as const,
      paymentError: {
        code: '',
        message: 'x',
        occurredAt: new Date(),
      },
    };
    const parsed = parseRideDoc(doc);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('ride_doc_invalid_shape');
  });

  it('round-trips a ride with paymentFailure through toDoc → parse → toDomain', () => {
    // Construct a ride via fromProps (the entity doesn't expose a
    // synthetic transition to `payment_failed` from `completed`).
    const occurredAt = new Date('2026-05-26T18:00:00Z');
    const ride = freshRide();
    const r = PaymentFailure.create({
      code: 'expired_card',
      message: 'Your card expired.',
      occurredAt,
    });
    if (!r.ok) throw new Error('test setup: PaymentFailure.create failed');
    const failed = unwrap(
      Ride.fromProps({
        id: ride.id,
        status: 'payment_failed',
        passenger: ride.passenger,
        driver: ride.driver,
        rideService: ride.rideService,
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        createdAt: ride.createdAt,
        pickupTiming: ride.pickupTiming,
        dropoffTiming: ride.dropoffTiming,
        cancellation: null,
        routePreference: ride.routePreference,
        schedulePickupAt: null,
        paymentFailure: r.value,
      }),
    );
    const doc = toDoc(failed);
    expect(doc.paymentError).toEqual({
      code: 'expired_card',
      message: 'Your card expired.',
      occurredAt,
    });
    const parsed = unwrap(parseRideDoc(doc));
    const round = unwrap(toDomain(String(ride.id), parsed));
    expect(round.status).toBe('payment_failed');
    expect(round.paymentFailure?.code).toBe('expired_card');
    expect(round.paymentFailure?.message).toBe('Your card expired.');
    expect(round.paymentFailure?.occurredAt.getTime()).toBe(
      occurredAt.getTime(),
    );
  });

  it('omits paymentError on toDoc when ride has no paymentFailure', () => {
    const ride = freshRide();
    const doc = toDoc(ride);
    expect('paymentError' in doc).toBe(false);
  });
});
