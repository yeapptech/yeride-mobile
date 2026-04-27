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
});
