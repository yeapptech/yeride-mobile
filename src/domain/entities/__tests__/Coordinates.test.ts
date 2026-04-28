import { Coordinates } from '../Coordinates';

describe('Coordinates', () => {
  it('accepts valid lat/lng', () => {
    const r = Coordinates.create(37.4275, -122.1697);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.latitude).toBe(37.4275);
      expect(r.value.longitude).toBe(-122.1697);
    }
  });

  it('accepts the boundary values', () => {
    expect(Coordinates.create(90, 180).ok).toBe(true);
    expect(Coordinates.create(-90, -180).ok).toBe(true);
    expect(Coordinates.create(0, 0).ok).toBe(true);
  });

  it('rejects latitudes above 90', () => {
    const r = Coordinates.create(90.0001, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_lat_out_of_range');
  });

  it('rejects latitudes below -90', () => {
    const r = Coordinates.create(-90.0001, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_lat_out_of_range');
  });

  it('rejects longitudes above 180', () => {
    const r = Coordinates.create(0, 180.0001);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_lng_out_of_range');
  });

  it('rejects longitudes below -180', () => {
    const r = Coordinates.create(0, -180.0001);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_lng_out_of_range');
  });

  it('rejects NaN', () => {
    const r = Coordinates.create(Number.NaN, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_not_finite');
  });

  it('rejects Infinity', () => {
    const r = Coordinates.create(0, Number.POSITIVE_INFINITY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('coordinates_not_finite');
  });

  it('compares by value', () => {
    const a = Coordinates.create(1, 2);
    const b = Coordinates.create(1, 2);
    const c = Coordinates.create(1, 3);
    if (a.ok && b.ok && c.ok) {
      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.equals(c.value)).toBe(false);
    }
  });

  it('serializes to a stable string', () => {
    const r = Coordinates.create(37.42751234, -122.16971234);
    if (r.ok) expect(r.value.toString()).toBe('37.427512,-122.169712');
  });

  describe('distanceTo', () => {
    function unwrap(lat: number, lng: number): Coordinates {
      const r = Coordinates.create(lat, lng);
      if (!r.ok) throw r.error;
      return r.value;
    }

    it('returns zero for the same point', () => {
      const p = unwrap(25.7617, -80.1918); // Miami
      expect(p.distanceTo(p)).toBe(0);
    });

    it('is symmetric', () => {
      const a = unwrap(25.7617, -80.1918); // Miami
      const b = unwrap(37.7749, -122.4194); // San Francisco
      expect(a.distanceTo(b)).toBeCloseTo(b.distanceTo(a), 5);
    });

    it('matches a known reference: Miami → San Francisco ≈ 4.18M m', () => {
      const miami = unwrap(25.7617, -80.1918);
      const sf = unwrap(37.7749, -122.4194);
      const d = miami.distanceTo(sf);
      // Reference: ~4180 km. Allow 1% tolerance for the spherical-earth
      // approximation (which understates true geodesic distance by ~0.3%).
      expect(d).toBeGreaterThan(4_140_000);
      expect(d).toBeLessThan(4_220_000);
    });

    it('returns ~half the earth circumference for antipodes', () => {
      const a = unwrap(0, 0);
      const b = unwrap(0, 180);
      // Half-circumference at the equator ≈ 20_015 km.
      expect(a.distanceTo(b)).toBeGreaterThan(20_000_000);
      expect(a.distanceTo(b)).toBeLessThan(20_030_000);
    });

    it('handles short distances (1 degree of latitude ≈ 111 km)', () => {
      const a = unwrap(25, 0);
      const b = unwrap(26, 0);
      expect(a.distanceTo(b)).toBeGreaterThan(110_000);
      expect(a.distanceTo(b)).toBeLessThan(112_000);
    });
  });
});
