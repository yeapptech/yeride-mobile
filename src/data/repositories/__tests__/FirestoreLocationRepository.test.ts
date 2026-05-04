/**
 * Phase 9 turn 11 — telemetry tests for the 4 LOG.warn → LOG.error
 * flips in FirestoreLocationRepository (subscribeToLocation schema /
 * entity / stream / getLastKnown). Pattern mirrors the mapper-level
 * tests; the per-file `jest.mock` of `@react-native-firebase/firestore`
 * provides programmable doc / snapshot / error fixtures so the repo's
 * internal callbacks can be exercised in-process.
 *
 * The mock is intentionally narrow: only the SDK functions the repo
 * imports (`doc`, `getDoc`, `getFirestore`, `onSnapshot`, `setDoc`)
 * are stubbed. Tests inject the desired snapshot / error via the
 * `__nextSnapshot` / `__nextStreamError` / `__nextGetDocSnapshot` /
 * `__nextGetDocThrow` test seams.
 */
type SnapshotData = Record<string, unknown> | null;

type SnapshotCallback = (snap: { data: () => SnapshotData }) => void;
type ErrorCallback = (e: unknown) => void;

interface MockState {
  nextSnapshot: SnapshotData;
  nextStreamError: unknown | null;
  nextGetDocSnapshot: SnapshotData;
  nextGetDocThrow: unknown | null;
  capturedSnapCb: SnapshotCallback | null;
  capturedErrorCb: ErrorCallback | null;
  emit: (snap?: SnapshotData) => void;
  emitError: (e: unknown) => void;
}

const mockState: MockState = {
  nextSnapshot: null,
  nextStreamError: null,
  nextGetDocSnapshot: null,
  nextGetDocThrow: null,
  capturedSnapCb: null,
  capturedErrorCb: null,
  emit: (snap) => {
    if (mockState.capturedSnapCb) {
      mockState.capturedSnapCb({ data: () => snap ?? null });
    }
  },
  emitError: (e) => {
    if (mockState.capturedErrorCb) mockState.capturedErrorCb(e);
  },
};

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(async () => {
    if (mockState.nextGetDocThrow !== null) {
      const err = mockState.nextGetDocThrow;
      mockState.nextGetDocThrow = null;
      throw err;
    }
    const data = mockState.nextGetDocSnapshot;
    mockState.nextGetDocSnapshot = null;
    return { data: () => data };
  }),
  setDoc: jest.fn(async () => undefined),
  onSnapshot: jest.fn(
    (
      _ref: unknown,
      onNext: SnapshotCallback,
      onError: ErrorCallback | undefined,
    ) => {
      mockState.capturedSnapCb = onNext;
      mockState.capturedErrorCb = onError ?? null;
      // Synchronously emit the initial snapshot if one was queued.
      if (mockState.nextSnapshot !== null) {
        const data = mockState.nextSnapshot;
        mockState.nextSnapshot = null;
        onNext({ data: () => data });
      }
      return () => {
        mockState.capturedSnapCb = null;
        mockState.capturedErrorCb = null;
      };
    },
  ),
}));

import { UserId } from '@domain/entities/UserId';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import { FirestoreLocationRepository } from '../FirestoreLocationRepository';

function uid(): UserId {
  const r = UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

beforeEach(() => {
  mockState.nextSnapshot = null;
  mockState.nextStreamError = null;
  mockState.nextGetDocSnapshot = null;
  mockState.nextGetDocThrow = null;
  mockState.capturedSnapCb = null;
  mockState.capturedErrorCb = null;
});

describe('FirestoreLocationRepository — telemetry recordError fan-out (Phase 9 turn 11)', () => {
  const SCOPE = 'YeRide:FirestoreLocation';

  it('subscribeToLocation: malformed schema doc → recordError fires with constructed Error', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreLocationRepository();
      const cb = jest.fn();
      const dispose = repo.subscribeToLocation({ userId: uid(), callback: cb });

      // Emit a snapshot whose data fails the schema parse. The
      // userLocationMapper expects a `coords` block + `timestamp`;
      // empty object fails.
      mockState.emit({ totally: 'wrong' });

      expect(cb).toHaveBeenCalledWith(null);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('location_doc_invalid_schema'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);

      dispose();
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('subscribeToLocation: schema-passes-but-entity-fails (bad updatedAt) → recordError fires with constructed Error', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreLocationRepository();
      const cb = jest.fn();
      const dispose = repo.subscribeToLocation({ userId: uid(), callback: cb });

      // updatedAt is `string.min(1)` at the schema layer (passes), then
      // `Date.parse` returns NaN on unparseable strings (fails entity).
      mockState.emit({
        latitude: 25.7617,
        longitude: -80.1918,
        updatedAt: 'not-a-real-date',
      });

      expect(cb).toHaveBeenCalledWith(null);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) =>
        rec.error.message.startsWith('location_doc_invalid_entity'),
      );
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);

      dispose();
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('subscribeToLocation: stream error → recordError fires with the SDK Error reference', () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreLocationRepository();
      const cb = jest.fn();
      const dispose = repo.subscribeToLocation({ userId: uid(), callback: cb });

      // SDK emits a stream error with a code like 'permission-denied'.
      const streamErr = Object.assign(new Error('stream lost'), {
        code: 'unavailable',
      });
      mockState.emitError(streamErr);

      expect(cb).toHaveBeenCalledWith(null);

      const recorded = fakeCrash.getRecordedErrors();
      // Reference identity — `e` is passed through directly to LOG.error.
      const found = recorded.find((rec) => rec.error === streamErr);
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);

      dispose();
    } finally {
      LOG.removeTransport(transport);
    }
  });

  it('getLastKnown: SDK throw → recordError fires with the SDK Error reference', async () => {
    const fakeCrash = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fakeCrash);
    LOG.addTransport(transport);
    try {
      const repo = new FirestoreLocationRepository();
      const sdkErr = Object.assign(new Error('read failed'), {
        code: 'permission-denied',
      });
      mockState.nextGetDocThrow = sdkErr;

      const r = await repo.getLastKnown(uid());
      expect(r.ok).toBe(false);

      const recorded = fakeCrash.getRecordedErrors();
      const found = recorded.find((rec) => rec.error === sdkErr);
      expect(found).toBeDefined();
      expect(found?.name).toBe(SCOPE);
    } finally {
      LOG.removeTransport(transport);
    }
  });
});
