/**
 * Phase 9 turn 11 — telemetry tests for the 4 LOG.warn → LOG.error
 * flips in FirestoreServiceAreaRepository (listAll schema/entity skip,
 * listRideServices schema/entity skip). Per-file `jest.mock` of
 * `@react-native-firebase/firestore` provides programmable
 * snapshot-iteration fixtures via `mockState.nextDocs`.
 */
type DocFixture = { id: string; data: () => Record<string, unknown> };

interface MockState {
  nextDocs: DocFixture[];
}

const mockState: MockState = {
  nextDocs: [],
};

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  getDoc: jest.fn(async () => ({ data: () => null })),
  getDocs: jest.fn(async () => {
    const docs = mockState.nextDocs.slice();
    mockState.nextDocs = [];
    return {
      forEach: (cb: (d: DocFixture) => void) => {
        for (const d of docs) cb(d);
      },
    };
  }),
}));

import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import { FirestoreServiceAreaRepository } from '../FirestoreServiceAreaRepository';

beforeEach(() => {
  mockState.nextDocs = [];
});

describe('FirestoreServiceAreaRepository — telemetry recordError fan-out (Phase 9 turn 11)', () => {
  const SCOPE = 'YeRide:FirestoreServiceArea';

  it('listAll: doc fails schema validation, recordError fires with constructed Error carrying the stable prefix', async () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreServiceAreaRepository();
      mockState.nextDocs = [
        {
          id: 'broken-area',
          data: () => ({ totally: 'wrong' }),
        },
      ];
      const r = await repo.listAll();
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.length).toBe(0);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('service_area_doc_invalid_schema'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('listAll: doc fails entity construction, recordError fires with constructed Error', async () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreServiceAreaRepository();
      // Schema passes (all fields valid + in range), but the doc id
      // 'A' fails ServiceAreaId.create's length + format constraints
      // (min 3 chars, lowercase + hyphens). Drives the entity-
      // construction failure path in serviceAreaMapper.toDomain.
      mockState.nextDocs = [
        {
          id: 'A',
          data: () => ({
            identifier: 'broken-area',
            latitude: 25.7617,
            longitude: -80.1918,
            radius: 1000,
          }),
        },
      ];
      const r = await repo.listAll();
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('service_area_doc_invalid_entity'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('listRideServices: doc fails schema validation, recordError fires with constructed Error', async () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreServiceAreaRepository();
      const areaIdR = ServiceAreaId.create('test-area');
      if (!areaIdR.ok) throw new Error('test setup');
      mockState.nextDocs = [
        {
          id: 'broken-service',
          data: () => ({ id: 'economy' }),
        },
      ];
      const r = await repo.listRideServices(areaIdR.value);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.length).toBe(0);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('ride_service_doc_invalid_schema'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('listRideServices: doc fails entity construction (no seat field), recordError fires with constructed Error', async () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreServiceAreaRepository();
      const areaIdR = ServiceAreaId.create('test-area');
      if (!areaIdR.ok) throw new Error('test setup');
      // Schema-valid doc but neither `seat` nor `seatCapacity` set —
      // rideServiceMapper.toDomain rejects with
      // ride_service_doc_missing_seats. Drives the entity-fail path.
      mockState.nextDocs = [
        {
          id: 'svc-no-seat',
          data: () => ({
            id: 'economy',
            name: 'Economy',
            baseFare: 2.5,
            minimumFare: 5,
            cancelationFee: 2,
            costPerKm: 1.25,
            costPerMinute: 0.2,
          }),
        },
      ];
      const r = await repo.listRideServices(areaIdR.value);
      expect(r.ok).toBe(true);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('ride_service_doc_invalid_entity'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });
});
