import { RideId } from '../RideId';

describe('RideId', () => {
  it('accepts a typical Firestore-doc auto-id (20 chars alphanumeric)', () => {
    const r = RideId.create('aBcDeFgHiJkLmNoPqRsT');
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('aBcDeFgHiJkLmNoPqRsT');
  });

  it('accepts an id with hyphens and underscores', () => {
    expect(RideId.create('trip_2026-04-27_abc').ok).toBe(true);
  });

  it('rejects too-short input', () => {
    const r = RideId.create('short');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_id_invalid_length');
  });

  it('rejects too-long input', () => {
    const r = RideId.create('x'.repeat(65));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_id_invalid_length');
  });

  it('rejects whitespace and slashes', () => {
    expect(RideId.create('has space').ok).toBe(false);
    expect(RideId.create('has/slash').ok).toBe(false);
  });
});
