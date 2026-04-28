import { parseTripEventDoc, toDomain } from '../tripEventMapper';

describe('parseTripEventDoc', () => {
  it('accepts a typical event with extras', () => {
    const r = parseTripEventDoc({
      type: 'dispatch',
      event: 'Driver accepted',
      extras: { tripId: 'abc123', source: 'driver_app' },
      createdAt: '2026-04-27T12:01:00.000Z',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('dispatch');
      expect(r.value.extras['tripId']).toBe('abc123');
    }
  });

  it('defaults extras to an empty object', () => {
    const r = parseTripEventDoc({
      type: 'completed',
      event: 'Trip completed',
      createdAt: '2026-04-27T12:30:00.000Z',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.extras).toEqual({});
  });

  it('rejects empty type or event', () => {
    expect(
      parseTripEventDoc({
        type: '',
        event: 'x',
        createdAt: '2026-04-27T00:00:00Z',
      }).ok,
    ).toBe(false);
    expect(
      parseTripEventDoc({
        type: 'x',
        event: '',
        createdAt: '2026-04-27T00:00:00Z',
      }).ok,
    ).toBe(false);
  });
});

describe('toDomain', () => {
  it('builds the TripEvent value', () => {
    const docR = parseTripEventDoc({
      type: 'dispatch',
      event: 'Driver accepted',
      createdAt: '2026-04-27T12:01:00.000Z',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('2026-04-27T12:01:00.000Z', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe('2026-04-27T12:01:00.000Z');
      expect(r.value.createdAt.getUTCMinutes()).toBe(1);
    }
  });

  it('errors on a malformed createdAt', () => {
    const docR = parseTripEventDoc({
      type: 'x',
      event: 'y',
      createdAt: 'not-a-date',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('id', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_event_invalid_created_at');
  });
});
