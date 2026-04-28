import { RideServiceId } from '../RideServiceId';

describe('RideServiceId', () => {
  it('accepts lowercase alphanumeric slugs', () => {
    for (const value of ['economy', 'premium', 'xl', 'a1', 'aa']) {
      const r = RideServiceId.create(value);
      expect(r.ok).toBe(true);
    }
  });

  it('accepts internal hyphens', () => {
    const r = RideServiceId.create('comfort-plus');
    expect(r.ok).toBe(true);
  });

  it('accepts internal underscores (legacy stage data)', () => {
    // Real-Firebase boot 2026-04-28 surfaced `comfort_plus` in
    // serviceAreas/us-fl-south-florida/rideServices. The mapper used to
    // drop it on the floor — drivers there silently missed offers.
    const r = RideServiceId.create('comfort_plus');
    expect(r.ok).toBe(true);
  });

  it('rejects uppercase characters', () => {
    const r = RideServiceId.create('Economy');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_id_invalid_format');
  });

  it('rejects whitespace', () => {
    const r = RideServiceId.create('not valid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_id_invalid_format');
  });

  it('rejects leading or trailing separators', () => {
    for (const value of ['-economy', 'economy-', '_economy', 'economy_']) {
      const r = RideServiceId.create(value);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects too-short and too-long strings', () => {
    expect(RideServiceId.create('a').ok).toBe(false);
    expect(RideServiceId.create('a'.repeat(33)).ok).toBe(false);
  });
});
