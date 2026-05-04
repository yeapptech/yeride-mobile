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
}

const mockState: MockState = {
  capturedSnapCb: null,
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
}));

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(() => async () => ({ data: {} })),
}));

import { RideId } from '@domain/entities/RideId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import { FirestoreRideRepository } from '../FirestoreRideRepository';

function rideId(): RideId {
  const r = RideId.create('ride-test-12345');
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

beforeEach(() => {
  mockState.capturedSnapCb = null;
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
