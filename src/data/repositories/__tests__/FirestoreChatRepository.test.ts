/**
 * FirestoreChatRepository test suite — mocks `@react-native-firebase/firestore`
 * at the module boundary and verifies adapter behavior end-to-end.
 *
 * Mock surface mirrors `FirestoreRideRepository.test.ts`. The
 * `mockState` captures the most-recent `onSnapshot` callback and the
 * args passed to `setDoc` / `updateDoc` so individual tests can drive
 * stream emissions and assert canonical write shapes.
 */
type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type SnapshotForEach = (cb: (d: SnapshotDoc) => void) => void;
type CollectionSnapshot = {
  empty: boolean;
  docs: SnapshotDoc[];
  forEach: SnapshotForEach;
};
type SnapshotCallback = (snap: CollectionSnapshot) => void;
type SnapshotErrorCallback = (e: unknown) => void;

interface CapturedWrite {
  ref: { __kind: 'doc'; path: string[]; id: string };
  data: Record<string, unknown>;
}

interface MockState {
  capturedSnapCb: SnapshotCallback | null;
  capturedSnapErrCb: SnapshotErrorCallback | null;
  setDocCalls: CapturedWrite[];
  updateDocCalls: CapturedWrite[];
  setDocShouldThrow: { code: string; message: string } | null;
  updateDocShouldThrow: { code: string; message: string } | null;
  /** Counter used to mint deterministic doc ids when the repo calls
   *  `doc(subcoll)` without args. */
  nextAutoId: number;
}

const mockState: MockState = {
  capturedSnapCb: null,
  capturedSnapErrCb: null,
  setDocCalls: [],
  updateDocCalls: [],
  setDocShouldThrow: null,
  updateDocShouldThrow: null,
  nextAutoId: 0,
};

const SERVER_TIMESTAMP_SENTINEL = '__SERVER_TIMESTAMP__';

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({ __kind: 'firestore' })),
  collection: jest.fn((_db: unknown, ...path: string[]) => ({
    __kind: 'collection' as const,
    path,
  })),
  doc: jest.fn((arg: unknown, ...rest: unknown[]) => {
    if (
      typeof arg === 'object' &&
      arg !== null &&
      (arg as { __kind?: string }).__kind === 'collection'
    ) {
      const coll = arg as { path: string[] };
      // No id provided — mint a Firestore-style auto-id.
      if (rest.length === 0) {
        mockState.nextAutoId += 1;
        const id = `autoid_${String(mockState.nextAutoId).padStart(8, '0')}`;
        return { __kind: 'doc' as const, path: coll.path, id };
      }
      return {
        __kind: 'doc' as const,
        path: coll.path,
        id: String(rest[0]),
      };
    }
    // `doc(firestore, ...path)` form for the parent-trip ref.
    return {
      __kind: 'doc' as const,
      path: rest.slice(0, -1).map(String),
      id: String(rest[rest.length - 1]),
    };
  }),
  query: jest.fn((coll: unknown, ..._mods: unknown[]) => ({
    __kind: 'query' as const,
    coll,
  })),
  orderBy: jest.fn((field: string, dir: string) => ({
    __kind: 'orderBy' as const,
    field,
    dir,
  })),
  limit: jest.fn((n: number) => ({ __kind: 'limit' as const, n })),
  onSnapshot: jest.fn(
    (_q: unknown, onNext: SnapshotCallback, onErr?: SnapshotErrorCallback) => {
      mockState.capturedSnapCb = onNext;
      mockState.capturedSnapErrCb = onErr ?? null;
      return () => {
        mockState.capturedSnapCb = null;
        mockState.capturedSnapErrCb = null;
      };
    },
  ),
  setDoc: jest.fn(async (ref: unknown, data: unknown) => {
    if (mockState.setDocShouldThrow !== null) {
      const err = new Error(mockState.setDocShouldThrow.message);
      (err as Error & { code?: string }).code =
        mockState.setDocShouldThrow.code;
      throw err;
    }
    mockState.setDocCalls.push({
      ref: ref as CapturedWrite['ref'],
      data: data as Record<string, unknown>,
    });
  }),
  updateDoc: jest.fn(async (ref: unknown, data: unknown) => {
    if (mockState.updateDocShouldThrow !== null) {
      const err = new Error(mockState.updateDocShouldThrow.message);
      (err as Error & { code?: string }).code =
        mockState.updateDocShouldThrow.code;
      throw err;
    }
    mockState.updateDocCalls.push({
      ref: ref as CapturedWrite['ref'],
      data: data as Record<string, unknown>,
    });
  }),
  serverTimestamp: jest.fn(() => SERVER_TIMESTAMP_SENTINEL),
}));

import { PersonName } from '@domain/entities/PersonName';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';

import { FirestoreChatRepository } from '../FirestoreChatRepository';

function rideId(): RideId {
  const r = RideId.create('ride-test-chat-1');
  if (!r.ok) throw new Error('test setup: RideId.create failed');
  return r.value;
}

function userId(): UserId {
  const r = UserId.create('a'.repeat(28));
  if (!r.ok) throw new Error('test setup: UserId.create failed');
  return r.value;
}

function personName(): PersonName {
  const r = PersonName.create({ first: 'Ada', last: 'Lovelace' });
  if (!r.ok) throw new Error('test setup: PersonName.create failed');
  return r.value;
}

function fakeTimestamp(ms: number) {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toDate: () => new Date(ms),
  };
}

beforeEach(() => {
  mockState.capturedSnapCb = null;
  mockState.capturedSnapErrCb = null;
  mockState.setDocCalls.length = 0;
  mockState.updateDocCalls.length = 0;
  mockState.setDocShouldThrow = null;
  mockState.updateDocShouldThrow = null;
  mockState.nextAutoId = 0;
});

describe('FirestoreChatRepository.observeMessages', () => {
  it('emits a list of ChatMessage entities in snapshot order', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    const dispose = repo.observeMessages({ rideId: rideId(), callback: cb });

    // Build two well-formed message docs (the mock onSnapshot.forEach
    // iterates whatever we hand it).
    const docs: SnapshotDoc[] = [
      {
        id: 'msg_one_____',
        data: () => ({
          text: 'second',
          senderId: 'a'.repeat(28),
          createdAt: fakeTimestamp(1_700_000_002_000),
          user: { _id: 'a'.repeat(28), name: 'Ada' },
        }),
      },
      {
        id: 'msg_two_____',
        data: () => ({
          text: 'first',
          senderId: 'a'.repeat(28),
          createdAt: fakeTimestamp(1_700_000_001_000),
          user: { _id: 'a'.repeat(28), name: 'Ada' },
        }),
      },
    ];
    mockState.capturedSnapCb?.({
      empty: false,
      docs,
      forEach: (fn) => docs.forEach(fn),
    });

    expect(cb).toHaveBeenCalledTimes(1);
    const emitted = cb.mock.calls[0]?.[0] as Array<{ text: string }>;
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.text).toBe('second');
    expect(emitted[1]?.text).toBe('first');

    dispose();
    expect(mockState.capturedSnapCb).toBe(null);
  });

  it('skips malformed docs without poisoning the stream', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });

    const docs: SnapshotDoc[] = [
      {
        id: 'msg_good____',
        data: () => ({
          text: 'good',
          senderId: 'a'.repeat(28),
          createdAt: fakeTimestamp(1_700_000_000_000),
          user: { _id: 'a'.repeat(28), name: 'Ada' },
        }),
      },
      {
        id: 'msg_bad_____',
        data: () => ({ no_text_here: true }), // schema fail
      },
    ];
    mockState.capturedSnapCb?.({
      empty: false,
      docs,
      forEach: (fn) => docs.forEach(fn),
    });

    const emitted = cb.mock.calls[0]?.[0] as Array<{ text: string }>;
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.text).toBe('good');
  });

  it('emits an empty list on stream error', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });

    mockState.capturedSnapErrCb?.(new Error('network'));
    expect(cb).toHaveBeenCalledWith([]);
  });
});

describe('FirestoreChatRepository.observeLatestMessage', () => {
  it('emits null when the subcollection is empty', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    repo.observeLatestMessage({ rideId: rideId(), callback: cb });

    mockState.capturedSnapCb?.({
      empty: true,
      docs: [],
      forEach: () => undefined,
    });
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('emits the most-recent message on hit', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    repo.observeLatestMessage({ rideId: rideId(), callback: cb });

    const latest: SnapshotDoc = {
      id: 'msg_latest__',
      data: () => ({
        text: 'newest',
        senderId: 'a'.repeat(28),
        createdAt: fakeTimestamp(1_700_000_999_000),
        user: { _id: 'a'.repeat(28), name: 'Ada' },
      }),
    };
    mockState.capturedSnapCb?.({
      empty: false,
      docs: [latest],
      forEach: (fn) => fn(latest),
    });
    const emitted = cb.mock.calls[0]?.[0] as { text: string } | null;
    expect(emitted?.text).toBe('newest');
  });

  it('emits null on stream error', () => {
    const repo = new FirestoreChatRepository();
    const cb = jest.fn();
    repo.observeLatestMessage({ rideId: rideId(), callback: cb });
    mockState.capturedSnapErrCb?.(new Error('network'));
    expect(cb).toHaveBeenCalledWith(null);
  });
});

describe('FirestoreChatRepository.send', () => {
  it('writes the canonical legacy wire shape with serverTimestamp sentinel', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: personName() },
      text: 'On my way.',
    });
    expect(r.ok).toBe(true);
    expect(mockState.setDocCalls).toHaveLength(1);
    const { data } = mockState.setDocCalls[0]!;
    expect(data).toEqual(
      expect.objectContaining({
        _id: expect.stringMatching(/^autoid_/),
        text: 'On my way.',
        senderId: 'a'.repeat(28),
        createdAt: SERVER_TIMESTAMP_SENTINEL,
        user: { _id: 'a'.repeat(28), name: 'Ada Lovelace' },
      }),
    );
  });

  it('rejects empty text with ValidationError before calling setDoc', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: personName() },
      text: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
    expect(mockState.setDocCalls).toHaveLength(0);
  });

  it('rejects overlong text with ValidationError before calling setDoc', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: personName() },
      text: 'x'.repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_text_too_long');
    expect(mockState.setDocCalls).toHaveLength(0);
  });

  it('wraps network failures as NetworkError', async () => {
    mockState.setDocShouldThrow = { code: 'unavailable', message: 'offline' };
    const repo = new FirestoreChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: personName() },
      text: 'hi',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_send_failed');
  });

  it('returns a ChatMessage carrying the same id that was written', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: personName() },
      text: 'hi',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const writtenId = (mockState.setDocCalls[0]?.data as { _id?: string })._id;
    expect(String(r.value.id)).toBe(writtenId);
  });
});

describe('FirestoreChatRepository.markMessagesRead', () => {
  it('writes lastSeenByRiderAt with serverTimestamp for rider role', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.markMessagesRead({ rideId: rideId(), role: 'rider' });
    expect(r.ok).toBe(true);
    expect(mockState.updateDocCalls).toHaveLength(1);
    expect(mockState.updateDocCalls[0]?.data).toEqual({
      lastSeenByRiderAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it('writes lastSeenByDriverAt with serverTimestamp for driver role', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.markMessagesRead({ rideId: rideId(), role: 'driver' });
    expect(r.ok).toBe(true);
    expect(mockState.updateDocCalls[0]?.data).toEqual({
      lastSeenByDriverAt: SERVER_TIMESTAMP_SENTINEL,
    });
  });

  it('rejects invalid role with chat_invalid_role ValidationError', async () => {
    const repo = new FirestoreChatRepository();
    const r = await repo.markMessagesRead({
      rideId: rideId(),
      role: 'admin' as unknown as 'rider',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_invalid_role');
    expect(mockState.updateDocCalls).toHaveLength(0);
  });

  it('wraps network failures as NetworkError', async () => {
    mockState.updateDocShouldThrow = {
      code: 'unavailable',
      message: 'offline',
    };
    const repo = new FirestoreChatRepository();
    const r = await repo.markMessagesRead({ rideId: rideId(), role: 'rider' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_mark_read_failed');
  });
});
