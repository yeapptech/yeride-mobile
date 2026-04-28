/**
 * Decode a Google Maps encoded polyline string into a list of lat/lng pairs.
 *
 * Inlined here (rather than depending on `@mapbox/polyline`) because the
 * algorithm is short, pure, and we want zero runtime dependencies behind
 * the Map component.
 *
 * Algorithm reference:
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * The encoding represents each lat/lng delta as a signed integer in
 * 1e-5 units (≈1m precision), zigzag-encoded to keep small magnitudes
 * compact, then base-64-style chunked into ASCII characters in [0x3f, 0x7f].
 *
 * Returns `[]` for empty / malformed input rather than throwing — the Map
 * component renders empty `coordinates` as "hidden polyline" anyway, so
 * tolerating bad input keeps the UI from crashing on a transient bad
 * response from the Routes API.
 */
export interface DecodedPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export function decodePolyline(encoded: string): DecodedPoint[] {
  if (!encoded) return [];
  const points: DecodedPoint[] = [];
  const len = encoded.length;
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      const ch = encoded.charCodeAt(index++);
      b = ch - 63;
      // Malformed input — bail rather than loop forever.
      if (Number.isNaN(b) || index > len + 1) return points;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      const ch = encoded.charCodeAt(index++);
      b = ch - 63;
      if (Number.isNaN(b) || index > len + 1) return points;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}
