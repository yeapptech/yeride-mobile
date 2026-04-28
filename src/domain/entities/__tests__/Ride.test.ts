import { CancellationReason } from '../CancellationReason';
import { Coordinates } from '../Coordinates';
import { DriverSnapshot, VehicleSnapshot } from '../DriverSnapshot';
import { Email } from '../Email';
import { Endpoint } from '../Endpoint';
import { Money } from '../Money';
import { PassengerSnapshot } from '../PassengerSnapshot';
import { PersonName } from '../PersonName';
import { PhoneNumber } from '../PhoneNumber';
import { Ride } from '../Ride';
import { RideId } from '../RideId';
import { RideServiceId } from '../RideServiceId';
import { RideServiceSnapshot } from '../RideServiceSnapshot';
import { Route } from '../Route';
import { UserId } from '../UserId';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number) {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const T0 = new Date('2026-04-27T12:00:00Z');
const T_DISPATCH = new Date('2026-04-27T12:01:00Z');
const T_PICKUP = new Date('2026-04-27T12:10:00Z');
const T_COMPLETE = new Date('2026-04-27T12:30:00Z');

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

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
      tollPrice: null,
      routeToken: 'tk',
      description: 'via I-95',
    }),
  );
}

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
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

function freshRide() {
  const r = Ride.create({
    id: unwrap(RideId.create('aBcDeFgHiJkLmNoPqRsT')),
    passenger: PASSENGER,
    rideService: RIDE_SERVICE,
    pickup: PICKUP,
    dropoff: DROPOFF,
    createdAt: T0,
  });
  return unwrap(r);
}

describe('Ride.create', () => {
  it('starts in awaiting_driver with no driver and clean timing', () => {
    const ride = freshRide();
    expect(ride.status).toBe('awaiting_driver');
    expect(ride.driver).toBeNull();
    expect(ride.pickupTiming.startedAt).toBeNull();
    expect(ride.dropoffTiming.completedAt).toBeNull();
    expect(ride.cancellation).toBeNull();
  });
});

describe('Ride.dispatch', () => {
  it('flips status to dispatched and records driver + pickup directions + start time', () => {
    const r = freshRide().dispatch({
      driver: DRIVER,
      pickupDirections: makeRoute(),
      at: T_DISPATCH,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('dispatched');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
      expect(r.value.pickup.directions).not.toBeNull();
      expect(r.value.pickupTiming.startedAt).toEqual(T_DISPATCH);
    }
  });

  it('rejects dispatch on a non-awaiting_driver ride', () => {
    const dispatched = unwrap(
      freshRide().dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const r = dispatched.dispatch({
      driver: DRIVER,
      pickupDirections: makeRoute(),
      at: T_DISPATCH,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });
});

describe('Ride.start', () => {
  it('flips dispatched → started and computes elapsed seconds from dispatch', () => {
    const dispatched = unwrap(
      freshRide().dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const r = dispatched.start({ odometerMeters: 1_500, at: T_PICKUP });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('started');
      expect(r.value.pickupTiming.completedAt).toEqual(T_PICKUP);
      expect(r.value.pickupTiming.odometerMeters).toBe(1_500);
      expect(r.value.pickupTiming.elapsedSeconds).toBe(540); // 9 min
      expect(r.value.dropoffTiming.startedAt).toEqual(T_PICKUP);
    }
  });

  it('rejects start before dispatch', () => {
    const r = freshRide().start({ odometerMeters: 1_000, at: T_PICKUP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });

  it('rejects negative odometer', () => {
    const dispatched = unwrap(
      freshRide().dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const r = dispatched.start({ odometerMeters: -1, at: T_PICKUP });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_invalid_odometer');
  });
});

describe('Ride.requestPayment', () => {
  it('flips started → payment_requested and records dropoff completion', () => {
    const started = unwrap(
      unwrap(
        freshRide().dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: T_DISPATCH,
        }),
      ).start({ odometerMeters: 1_500, at: T_PICKUP }),
    );
    const r = started.requestPayment({
      odometerMeters: 7_500,
      at: T_COMPLETE,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('payment_requested');
      expect(r.value.dropoffTiming.completedAt).toEqual(T_COMPLETE);
      expect(r.value.dropoffTiming.odometerMeters).toBe(7_500);
    }
  });

  it('rejects requestPayment from awaiting_driver', () => {
    const r = freshRide().requestPayment({
      odometerMeters: 7_500,
      at: T_COMPLETE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });

  it('rejects an odometer that decreased from pickup-complete', () => {
    const started = unwrap(
      unwrap(
        freshRide().dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: T_DISPATCH,
        }),
      ).start({ odometerMeters: 5_000, at: T_PICKUP }),
    );
    const r = started.requestPayment({
      odometerMeters: 4_000,
      at: T_COMPLETE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_odometer_decreased');
  });
});

describe('Ride.markCompleted', () => {
  it('flips payment_requested → completed', () => {
    const requested = unwrap(
      unwrap(
        unwrap(
          freshRide().dispatch({
            driver: DRIVER,
            pickupDirections: makeRoute(),
            at: T_DISPATCH,
          }),
        ).start({ odometerMeters: 1_500, at: T_PICKUP }),
      ).requestPayment({ odometerMeters: 7_500, at: T_COMPLETE }),
    );
    const r = requested.markCompleted();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('completed');
  });

  it('rejects markCompleted from any non-payment_requested status', () => {
    const r = freshRide().markCompleted();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });
});

describe('Ride.markPaymentFailed', () => {
  it('flips payment_requested → payment_failed', () => {
    const requested = unwrap(
      unwrap(
        unwrap(
          freshRide().dispatch({
            driver: DRIVER,
            pickupDirections: makeRoute(),
            at: T_DISPATCH,
          }),
        ).start({ odometerMeters: 1_500, at: T_PICKUP }),
      ).requestPayment({ odometerMeters: 7_500, at: T_COMPLETE }),
    );
    const r = requested.markPaymentFailed();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('payment_failed');
  });
});

describe('Ride.cancel', () => {
  function reasonFor(code: 'changed_mind' | 'driver_no_show') {
    return unwrap(CancellationReason.create({ code, reasonText: null }));
  }

  it('cancels from awaiting_driver', () => {
    const r = freshRide().cancel({
      reason: reasonFor('changed_mind'),
      by: 'rider',
      at: T_DISPATCH,
      odometerMeters: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('cancelled');
      expect(r.value.cancellation?.by).toBe('rider');
      expect(r.value.cancellation?.reason.code).toBe('changed_mind');
    }
  });

  it('cancels from dispatched', () => {
    const dispatched = unwrap(
      freshRide().dispatch({
        driver: DRIVER,
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const r = dispatched.cancel({
      reason: reasonFor('driver_no_show'),
      by: 'rider',
      at: T_PICKUP,
      odometerMeters: 0,
    });
    expect(r.ok).toBe(true);
  });

  it('refuses to cancel a completed ride', () => {
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
    const r = completed.cancel({
      reason: reasonFor('changed_mind'),
      by: 'rider',
      at: T_COMPLETE,
      odometerMeters: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });

  it('refuses to cancel an already-cancelled ride', () => {
    const cancelled = unwrap(
      freshRide().cancel({
        reason: reasonFor('changed_mind'),
        by: 'rider',
        at: T_DISPATCH,
        odometerMeters: null,
      }),
    );
    const r = cancelled.cancel({
      reason: reasonFor('changed_mind'),
      by: 'driver',
      at: T_DISPATCH,
      odometerMeters: null,
    });
    expect(r.ok).toBe(false);
  });
});
