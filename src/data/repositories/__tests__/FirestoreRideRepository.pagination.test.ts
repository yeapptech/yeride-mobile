/**
 * Phase 10 Turn 6 — pagination behavior on
 * `FirestoreRideRepository.listByPassenger` / `listByDriver`.
 *
 * Verifies:
 *   - First page with no cursor: returns up to `limit` rides + a
 *     `nextCursor` derived from the boundary doc.
 *   - Subsequent page with cursor: calls `startAfter(<iso string>)`.
 *   - End-of-list: when the returned page is shorter than `limit`,
 *     `nextCursor` is `null`.
 *   - Cursor advances by the RAW boundary doc, even when the optional
 *     `statuses` client-side filter shrinks the visible page.
 *   - Driver-side mirrors passenger-side.
 *
 * The pattern: capture Firestore method calls + return controlled
 * snapshots. The repository constructor instantiates
 * `CloudFunctionsService` (which calls `getFunctions(getApp())`); we
 * mock both modules to satisfy construction.
 */

type DocLike = { id: string; data: () => Record<string, unknown> };
type SnapLike = { size: number; forEach: (cb: (d: DocLike) => void) => void };

// `mock`-prefixed names are exempt from the jest-mock hoisting check so
// the factory below can use them. The captured-clauses array is also
// jest-safe under the same convention.
const mockCapturedClauses: unknown[] = [];

function mockMakeSnap(docs: DocLike[]): SnapLike {
  return {
    size: docs.length,
    forEach: (cb) => {
      docs.forEach(cb);
    },
  };
}

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn(() => ({ id: 'doc-id' })),
  collection: jest.fn(() => ({})),
  query: jest.fn((...args: unknown[]) => {
    // The first arg is the collection; the rest are the clauses.
    mockCapturedClauses.push(...args.slice(1));
    return { __captured: args };
  }),
  orderBy: jest.fn((field: string, dir: string) => ({
    __kind: 'orderBy',
    field,
    dir,
  })),
  where: jest.fn((field: string, op: string, value: unknown) => ({
    __kind: 'where',
    field,
    op,
    value,
  })),
  limit: jest.fn((n: number) => ({ __kind: 'limit', n })),
  startAfter: jest.fn((...vals: unknown[]) => ({
    __kind: 'startAfter',
    vals,
  })),
  getDoc: jest.fn(async () => ({ data: () => null, exists: () => false })),
  getDocs: jest.fn(async () => mockMakeSnap([])),
  setDoc: jest.fn(async () => undefined),
  onSnapshot: jest.fn(() => () => undefined),
}));

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(() => async () => ({ data: {} })),
}));

import { getDocs } from '@react-native-firebase/firestore';

import { RideListCursor } from '@domain/entities/RideListCursor';
import { UserId } from '@domain/entities/UserId';

import { FirestoreRideRepository } from '../FirestoreRideRepository';

function userId(s: string): UserId {
  const r = UserId.create(s);
  if (!r.ok) throw new Error('test setup userId');
  return r.value;
}

/**
 * Build a doc that survives `rideMapper.parseRideDoc` + entity
 * construction. Only the fields the schema requires are populated.
 */
function buildValidDoc(
  id: string,
  createdDateTime: string,
  overrides: Partial<{
    passengerId: string;
    driverId: string;
    status: string;
  }> = {},
): DocLike {
  const passengerId = overrides.passengerId ?? 'pppppppppppppppppppppppppppp';
  const driverId = overrides.driverId ?? 'dddddddddddddddddddddddddddd';
  const status = overrides.status ?? 'completed';
  return {
    id,
    data: () => ({
      passenger: {
        id: passengerId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+14155551111',
      },
      driver: {
        id: driverId,
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        phoneNumber: '+14155552222',
        stripeAccountId: 'acct_test_xyz',
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
      status,
      createdDateTime,
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
  };
}

function captured(): unknown[] {
  return [...mockCapturedClauses];
}

function clauseOfKind(kind: string): Record<string, unknown> | undefined {
  return captured().find(
    (c): c is Record<string, unknown> =>
      typeof c === 'object' &&
      c !== null &&
      '__kind' in c &&
      (c as { __kind: string }).__kind === kind,
  );
}

beforeEach(() => {
  mockCapturedClauses.length = 0;
  jest.clearAllMocks();
});

describe('FirestoreRideRepository.listByPassenger — pagination', () => {
  it('first page (no cursor) returns rides + nextCursor when size === limit', async () => {
    const docs = [
      buildValidDoc('ride001', '2026-05-19T10:00:00.000Z'),
      buildValidDoc('ride002', '2026-05-19T09:00:00.000Z'),
    ];
    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap(docs));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
      limit: 2,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rides).toHaveLength(2);
    expect(r.value.nextCursor).not.toBeNull();
    if (r.value.nextCursor !== null) {
      const decoded = RideListCursor.decode(r.value.nextCursor);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value.docId).toBe('ride002');
        expect(decoded.value.createdAtMillis).toBe(
          Date.parse('2026-05-19T09:00:00.000Z'),
        );
      }
    }

    // No startAfter clause on first page.
    expect(clauseOfKind('startAfter')).toBeUndefined();
  });

  it('end-of-list (returned size < limit) returns null nextCursor', async () => {
    const docs = [buildValidDoc('ride001', '2026-05-19T10:00:00.000Z')];
    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap(docs));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
      limit: 5,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rides).toHaveLength(1);
    expect(r.value.nextCursor).toBeNull();
  });

  it('second page with cursor calls startAfter with the cursor ISO string', async () => {
    const cursorR = RideListCursor.create({
      createdAtMillis: Date.parse('2026-05-19T09:00:00.000Z'),
      docId: 'ride002',
    });
    if (!cursorR.ok) throw new Error('test setup cursor');

    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap([]));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
      limit: 10,
      cursor: cursorR.value,
    });

    expect(r.ok).toBe(true);

    const sa = clauseOfKind('startAfter');
    expect(sa).toBeDefined();
    expect((sa as { vals: unknown[] }).vals).toEqual([
      '2026-05-19T09:00:00.000Z',
    ]);
  });

  it('applies the status filter client-side but advances cursor on raw boundary', async () => {
    // Two docs: ride1 = completed, ride2 = cancelled. statuses filter
    // = ['completed'] keeps ride1 only, but the cursor must advance
    // past ride2 (the raw last doc).
    const docs = [
      buildValidDoc('ride001', '2026-05-19T10:00:00.000Z', {
        status: 'completed',
      }),
      buildValidDoc('ride002', '2026-05-19T09:00:00.000Z', {
        // legacy `passenger_canceled` normalizes to domain 'cancelled'
        status: 'cancelled',
      }),
    ];
    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap(docs));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
      statuses: ['completed'],
      limit: 2,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rides).toHaveLength(1);
    if (r.value.nextCursor !== null) {
      const decoded = RideListCursor.decode(r.value.nextCursor);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        // Cursor encodes ride2 (the boundary), not ride1.
        expect(decoded.value.docId).toBe('ride002');
      }
    }
  });

  it('omits the limit clause when no limit is provided', async () => {
    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap([]));
    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
    });
    expect(r.ok).toBe(true);
    expect(clauseOfKind('limit')).toBeUndefined();
    // No-limit reads always emit a null nextCursor — there's no
    // boundary to encode.
    if (r.ok) {
      expect(r.value.nextCursor).toBeNull();
    }
  });

  it('surfaces a NetworkError when Firestore throws', async () => {
    (getDocs as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const repo = new FirestoreRideRepository();
    const r = await repo.listByPassenger({
      passengerId: userId('pppppppppppppppppppppppppppp'),
      limit: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_list_failed');
    }
  });
});

describe('FirestoreRideRepository.listByDriver — pagination', () => {
  it('first page returns rides + nextCursor when size === limit', async () => {
    const docs = [
      buildValidDoc('ride001', '2026-05-19T10:00:00.000Z'),
      buildValidDoc('ride002', '2026-05-19T09:00:00.000Z'),
    ];
    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap(docs));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByDriver({
      driverId: userId('dddddddddddddddddddddddddddd'),
      limit: 2,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rides).toHaveLength(2);
    expect(r.value.nextCursor).not.toBeNull();
    if (r.value.nextCursor !== null) {
      const decoded = RideListCursor.decode(r.value.nextCursor);
      if (decoded.ok) {
        expect(decoded.value.docId).toBe('ride002');
      }
    }
  });

  it('second page with cursor calls startAfter', async () => {
    const cursorR = RideListCursor.create({
      createdAtMillis: Date.parse('2026-05-19T08:00:00.000Z'),
      docId: 'ride003',
    });
    if (!cursorR.ok) throw new Error('test setup cursor');

    (getDocs as jest.Mock).mockResolvedValueOnce(mockMakeSnap([]));

    const repo = new FirestoreRideRepository();
    const r = await repo.listByDriver({
      driverId: userId('dddddddddddddddddddddddddddd'),
      limit: 10,
      cursor: cursorR.value,
    });

    expect(r.ok).toBe(true);
    const sa = clauseOfKind('startAfter');
    expect(sa).toBeDefined();
    expect((sa as { vals: unknown[] }).vals).toEqual([
      '2026-05-19T08:00:00.000Z',
    ]);
  });

  it('surfaces a NetworkError when Firestore throws', async () => {
    (getDocs as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const repo = new FirestoreRideRepository();
    const r = await repo.listByDriver({
      driverId: userId('dddddddddddddddddddddddddddd'),
      limit: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_list_failed');
    }
  });
});
