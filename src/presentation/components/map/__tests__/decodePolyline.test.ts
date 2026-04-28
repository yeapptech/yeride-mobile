import { decodePolyline } from '../decodePolyline';

describe('decodePolyline', () => {
  it('returns an empty list for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('decodes Google\'s canonical example "_p~iF~ps|U_ulLnnqC_mqNvxq`@"', () => {
    // From Google's polyline encoding docs:
    //   (38.5, -120.2)  → start
    //   (40.7, -120.95)
    //   (43.252, -126.453)
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(points).toHaveLength(3);
    expect(points[0]?.latitude).toBeCloseTo(38.5, 5);
    expect(points[0]?.longitude).toBeCloseTo(-120.2, 5);
    expect(points[1]?.latitude).toBeCloseTo(40.7, 5);
    expect(points[1]?.longitude).toBeCloseTo(-120.95, 5);
    expect(points[2]?.latitude).toBeCloseTo(43.252, 5);
    expect(points[2]?.longitude).toBeCloseTo(-126.453, 5);
  });

  it('decodes a single point', () => {
    // (0, 0) encodes as "??" — but the first char must be at least '?'+1=0x40,
    // so a real single-point encoding for (0.00001, 0) is "AA":
    //   delta lat=1 (zigzag) → encode 1<<1=2 → '2'+63=A=0x41
    //   delta lng=0 → encode 0 → '?'+63=A wait, 0 → '?' (0x3f).
    // Just round-trip via the canonical example's prefix instead.
    const points = decodePolyline('_p~iF~ps|U');
    expect(points).toHaveLength(1);
    expect(points[0]?.latitude).toBeCloseTo(38.5, 5);
    expect(points[0]?.longitude).toBeCloseTo(-120.2, 5);
  });

  it('returns the points decoded so far on malformed input rather than throwing', () => {
    // Truncate one of Google's example pairs mid-character. Should yield the
    // valid prefix without throwing.
    const r = decodePolyline('_p~iF~ps|U_ulL');
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});
