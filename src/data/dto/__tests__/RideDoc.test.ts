import { RideDocSchema } from '../RideDoc';

/**
 * Phase 10 turn 8 — targeted tests for the `lastSeenByRiderAt` /
 * `lastSeenByDriverAt` accepters added to `RideDocSchema`. These two
 * fields are written by legacy yeride's `markMessagesRead` and by the
 * rewrite's `FirestoreChatRepository.markMessagesRead`. The schema
 * needs to accept the on-disk Firestore Timestamp shape (so reads of
 * trip docs with the fields populated don't fail) without forcing the
 * mapper to project them into the domain `Ride` entity — the chat
 * unread dot derives from the local `useChatUiStore.lastReadAt`
 * mirror, not from the trip-doc field.
 *
 * The base ride-doc body is filled out enough to satisfy the schema's
 * required-field set; only the `lastSeenBy*` fields are exercised.
 *
 * Note: the schema test runs against the field accepters directly, not
 * against the full mapper (which has stricter entity-construction
 * rules). Mapper-level coverage lives in `rideMapper.test.ts`.
 */

function baseDoc(): Record<string, unknown> {
  return {
    passenger: {
      id: 'a'.repeat(28),
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phoneNumber: '+14155551111',
      defaultPaymentMethod: null,
    },
    driver: null,
    rideService: {
      id: 'svc1',
      name: 'standard',
      baseFare: 1,
      minimumFare: 1,
      cancelationFee: 1,
      costPerKm: 1,
      costPerMinute: 1,
      seatCapacity: 4,
    },
    status: 'awaiting_driver',
    createdDateTime: '2026-05-19T12:00:00.000Z',
    pickup: { latitude: 40, longitude: -75 },
    dropoff: { latitude: 41, longitude: -74 },
  };
}

describe('RideDocSchema — lastSeenByRiderAt / lastSeenByDriverAt accepters', () => {
  it('accepts a doc with neither field set (legacy / pre-chat trips)', () => {
    const r = RideDocSchema.safeParse(baseDoc());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lastSeenByRiderAt).toBeUndefined();
      expect(r.data.lastSeenByDriverAt).toBeUndefined();
    }
  });

  it('coerces a Firestore Timestamp lastSeenByRiderAt to a Date', () => {
    const fakeTs = {
      seconds: 1_700_000_000,
      nanoseconds: 0,
      toDate: () => new Date(1_700_000_000_000),
    };
    const r = RideDocSchema.safeParse({
      ...baseDoc(),
      lastSeenByRiderAt: fakeTs,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lastSeenByRiderAt).toBeInstanceOf(Date);
      expect((r.data.lastSeenByRiderAt as Date).getTime()).toBe(
        1_700_000_000_000,
      );
    }
  });

  it('coerces a Firestore Timestamp lastSeenByDriverAt to a Date', () => {
    const fakeTs = {
      seconds: 1_700_000_000,
      nanoseconds: 0,
      toDate: () => new Date(1_700_000_000_000),
    };
    const r = RideDocSchema.safeParse({
      ...baseDoc(),
      lastSeenByDriverAt: fakeTs,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lastSeenByDriverAt).toBeInstanceOf(Date);
    }
  });

  it('accepts a null lastSeenByRiderAt (explicit clear)', () => {
    const r = RideDocSchema.safeParse({
      ...baseDoc(),
      lastSeenByRiderAt: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lastSeenByRiderAt).toBe(null);
  });

  it('accepts an ISO-string lastSeenByDriverAt (defensive)', () => {
    const r = RideDocSchema.safeParse({
      ...baseDoc(),
      lastSeenByDriverAt: '2026-05-19T13:00:00.000Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lastSeenByDriverAt).toBeInstanceOf(Date);
    }
  });

  it('coerces a NaN-Date to null for the lastSeenBy* fields', () => {
    const r = RideDocSchema.safeParse({
      ...baseDoc(),
      lastSeenByRiderAt: new Date('not a date'),
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lastSeenByRiderAt).toBe(null);
  });
});
