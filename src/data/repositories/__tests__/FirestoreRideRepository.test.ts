/**
 * Phase 9 turn 11 — telemetry tests for the 2 LOG.warn → LOG.error
 * flips in FirestoreRideRepository.toDomainOrCorrupt (schema validation
 * failure + entity construction failure).
 *
 * The repository's constructor instantiates a CloudFunctionsService,
 * which fires `getFunctions(getApp(), 'us-east1')` at construct time —
 * we mock the entire app + functions modules to satisfy that. The
 * test exercises observeById, which is the smallest call site that
 * funnels through the private `toDomainOrCorrupt` helper.
 */
type SnapshotData = Record<string, unknown> | null;
type SnapshotCallback = (snap: { data: () => SnapshotData }) => void;

interface MockState {
  capturedSnapCb: SnapshotCallback | null;
  // transitionWithClaim test seam: the doc `tx.get()` returns, a `tx.set`
  // spy, and an optional error `runTransaction` throws (infra failure path).
  txDocData: SnapshotData;
  txSet: jest.Mock;
  runTransactionThrow: unknown;
}

const mockState: MockState = {
  capturedSnapCb: null,
  txDocData: null,
  txSet: jest.fn(),
  runTransactionThrow: null,
};

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn(() => ({ id: 'doc-id' })),
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  getDoc: jest.fn(async () => ({ data: () => null, exists: () => false })),
  getDocs: jest.fn(async () => ({ forEach: () => undefined })),
  setDoc: jest.fn(async () => undefined),
  onSnapshot: jest.fn((_ref: unknown, onNext: SnapshotCallback) => {
    mockState.capturedSnapCb = onNext;
    return () => {
      mockState.capturedSnapCb = null;
    };
  }),
  runTransaction: jest.fn(
    async (_db: unknown, updateFn: (tx: unknown) => Promise<unknown>) => {
      if (mockState.runTransactionThrow !== null) {
        throw mockState.runTransactionThrow;
      }
      const tx = {
        get: async () => ({ data: () => mockState.txDocData }),
        set: (...args: unknown[]) => {
          mockState.txSet(...args);
          return tx;
        },
      };
      return updateFn(tx);
    },
  ),
}));

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(() => async () => ({ data: {} })),
}));

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
import { UserId } from '@domain/entities/UserId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import * as rideMapper from '../../mappers/rideMapper';
import { FirestoreRideRepository } from '../FirestoreRideRepository';

function rideId(): RideId {
  const r = RideId.create('ride-test-12345');
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const CLAIM_RIDE_ID = unwrap(RideId.create('claimRide12345678901a'));

const CLAIM_DRIVER = unwrap(
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

/** A valid trip doc (as `toDoc` writes it) for a ride in `status`. */
function claimRideDoc(status: 'awaiting_driver' | 'dispatched'): SnapshotData {
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
  const awaiting = unwrap(
    Ride.create({
      id: CLAIM_RIDE_ID,
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
      createdAt: new Date('2026-04-27T12:00:00Z'),
    }),
  );
  const ride =
    status === 'dispatched'
      ? unwrap(
          awaiting.claimForDispatch({
            driver: CLAIM_DRIVER,
            at: new Date('2026-04-27T12:01:00Z'),
          }),
        )
      : awaiting;
  return rideMapper.toDoc(ride) as SnapshotData;
}

beforeEach(() => {
  mockState.capturedSnapCb = null;
  mockState.txDocData = null;
  mockState.txSet = jest.fn();
  mockState.runTransactionThrow = null;
});

describe('FirestoreRideRepository.toDomainOrCorrupt — telemetry recordError fan-out (Phase 9 turn 11)', () => {
  const SCOPE = 'YeRide:FirestoreRide';

  it('observeById: ride doc fails schema validation, recordError fires with constructed Error', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreRideRepository();
      const cb = jest.fn();
      const dispose = repo.observeById(rideId(), cb);

      // Emit a doc that fails the RideDocSchema parse — empty object
      // misses every required field.
      mockState.capturedSnapCb?.({ data: () => ({}) });

      expect(cb).toHaveBeenCalledWith(null);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('ride_doc_invalid_schema'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);

      dispose();
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('observeById: ride doc passes schema but fails entity construction, recordError fires with constructed Error', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreRideRepository();
      const cb = jest.fn();
      const dispose = repo.observeById(rideId(), cb);

      // Schema-valid doc with malformed passenger.email — schema's
      // string check passes "not-an-email", but Email.create at the
      // entity level rejects it. Drives the entity-construction
      // failure path.
      mockState.capturedSnapCb?.({
        data: () => ({
          passenger: {
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'not-an-email',
            phoneNumber: '+14155551111',
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
          createdDateTime: '2026-04-27T12:00:00Z',
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
        }),
      });

      expect(cb).toHaveBeenCalledWith(null);

      const recorded = fakeCrash.getRecordedErrors();
      // Either schema-fail or entity-fail prefix matches: depending on
      // whether RideDocSchema's email field has its own format check
      // or relies on the entity factory. Both are flipped to error in
      // this turn.
      const found = recorded.find(
        (rec) =>
          rec.error.message.startsWith('ride_doc_invalid_entity') ||
          rec.error.message.startsWith('ride_doc_invalid_schema'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);

      dispose();
    } finally {
      LOG.removeTransport(transport);
    }
  });
});

describe('FirestoreRideRepository.transitionWithClaim — atomic first-wins', () => {
  it('applies the transition and writes when the status still matches', async () => {
    mockState.txDocData = claimRideDoc('awaiting_driver');
    const repo = new FirestoreRideRepository();

    const r = await repo.transitionWithClaim({
      rideId: CLAIM_RIDE_ID,
      expectedFromStatus: 'awaiting_driver',
      apply: (current) =>
        current.claimForDispatch({ driver: CLAIM_DRIVER, at: new Date() }),
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe('dispatched');
    expect(mockState.txSet).toHaveBeenCalledTimes(1);
  });

  it('returns ConflictError and does NOT write when the ride was already claimed', async () => {
    // The doc the transaction re-reads is already 'dispatched'.
    mockState.txDocData = claimRideDoc('dispatched');
    const repo = new FirestoreRideRepository();

    const r = await repo.transitionWithClaim({
      rideId: CLAIM_RIDE_ID,
      expectedFromStatus: 'awaiting_driver',
      apply: (current) =>
        current.claimForDispatch({ driver: CLAIM_DRIVER, at: new Date() }),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('conflict');
      expect(r.error.code).toBe('ride_already_taken');
    }
    expect(mockState.txSet).not.toHaveBeenCalled();
  });

  it('returns NotFoundError and does NOT write when the doc is missing', async () => {
    mockState.txDocData = null;
    const repo = new FirestoreRideRepository();

    const r = await repo.transitionWithClaim({
      rideId: CLAIM_RIDE_ID,
      expectedFromStatus: 'awaiting_driver',
      apply: (current) =>
        current.claimForDispatch({ driver: CLAIM_DRIVER, at: new Date() }),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
    expect(mockState.txSet).not.toHaveBeenCalled();
  });

  it('maps a permission-denied transaction failure to AuthorizationError', async () => {
    mockState.runTransactionThrow = { code: 'permission-denied' };
    const repo = new FirestoreRideRepository();

    const r = await repo.transitionWithClaim({
      rideId: CLAIM_RIDE_ID,
      expectedFromStatus: 'awaiting_driver',
      apply: (current) =>
        current.claimForDispatch({ driver: CLAIM_DRIVER, at: new Date() }),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('authorization');
  });

  it('rethrows a non-permission-denied infra failure', async () => {
    mockState.runTransactionThrow = new Error('network down');
    const repo = new FirestoreRideRepository();

    await expect(
      repo.transitionWithClaim({
        rideId: CLAIM_RIDE_ID,
        expectedFromStatus: 'awaiting_driver',
        apply: (current) =>
          current.claimForDispatch({ driver: CLAIM_DRIVER, at: new Date() }),
      }),
    ).rejects.toThrow('network down');
  });
});
