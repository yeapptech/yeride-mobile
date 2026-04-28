import { Coordinates } from '@domain/entities/Coordinates';

import {
  EvaluateExitWarning,
  GEOFENCE_RADIUS_METERS,
} from '../EvaluateExitWarning';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const PICKUP = unwrap(Coordinates.create(25.7617, -80.1918));

/**
 * Move a coordinate north by ~`meters`. Useful for synthesizing test
 * fixtures at known distances. ~111,320 m per degree of latitude near the
 * equator; we use a large constant to keep the math cheap and avoid
 * round-trips to `distanceTo`.
 */
function metersNorth(origin: Coordinates, meters: number): Coordinates {
  const dLat = meters / 111_320;
  return unwrap(Coordinates.create(origin.latitude + dLat, origin.longitude));
}

describe('EvaluateExitWarning', () => {
  describe('default radius (legacy parity, 200m)', () => {
    it('returns "inside" when current === anchor', () => {
      const r = new EvaluateExitWarning().execute({
        current: PICKUP,
        anchor: PICKUP,
      });
      expect(r.signal).toBe('inside');
      expect(r.distanceMeters).toBeCloseTo(0, 1);
      expect(r.radiusMeters).toBe(GEOFENCE_RADIUS_METERS);
    });

    it('returns "inside" at 100m from anchor', () => {
      const r = new EvaluateExitWarning().execute({
        current: metersNorth(PICKUP, 100),
        anchor: PICKUP,
      });
      expect(r.signal).toBe('inside');
      expect(r.distanceMeters).toBeGreaterThan(95);
      expect(r.distanceMeters).toBeLessThan(105);
    });

    it('returns "inside" at exactly the radius boundary', () => {
      const r = new EvaluateExitWarning().execute({
        current: metersNorth(PICKUP, GEOFENCE_RADIUS_METERS),
        anchor: PICKUP,
      });
      expect(r.signal).toBe('inside');
    });

    it('returns "exited" beyond the radius', () => {
      const r = new EvaluateExitWarning().execute({
        current: metersNorth(PICKUP, GEOFENCE_RADIUS_METERS + 50),
        anchor: PICKUP,
      });
      expect(r.signal).toBe('exited');
      expect(r.distanceMeters).toBeGreaterThan(GEOFENCE_RADIUS_METERS);
    });

    it('returns "exited" far beyond the radius', () => {
      const r = new EvaluateExitWarning().execute({
        current: metersNorth(PICKUP, 5_000),
        anchor: PICKUP,
      });
      expect(r.signal).toBe('exited');
    });
  });

  describe('caller-supplied radius', () => {
    it('respects an explicit radius (e.g. 50m for a tighter geofence)', () => {
      const sut = new EvaluateExitWarning();
      const inside = sut.execute({
        current: metersNorth(PICKUP, 30),
        anchor: PICKUP,
        radiusMeters: 50,
      });
      expect(inside.signal).toBe('inside');

      const outside = sut.execute({
        current: metersNorth(PICKUP, 80),
        anchor: PICKUP,
        radiusMeters: 50,
      });
      expect(outside.signal).toBe('exited');
    });

    it('clamps a zero radius to 1m', () => {
      const r = new EvaluateExitWarning().execute({
        current: metersNorth(PICKUP, 5),
        anchor: PICKUP,
        radiusMeters: 0,
      });
      expect(r.radiusMeters).toBe(1);
      expect(r.signal).toBe('exited');
    });

    it('clamps a negative radius to 1m', () => {
      const r = new EvaluateExitWarning().execute({
        current: PICKUP,
        anchor: PICKUP,
        radiusMeters: -100,
      });
      expect(r.radiusMeters).toBe(1);
    });
  });

  describe('purity', () => {
    it('is referentially transparent — same inputs always yield same output', () => {
      const sut = new EvaluateExitWarning();
      const a = sut.execute({
        current: metersNorth(PICKUP, 150),
        anchor: PICKUP,
      });
      const b = sut.execute({
        current: metersNorth(PICKUP, 150),
        anchor: PICKUP,
      });
      expect(a).toEqual(b);
    });

    it('is symmetric in current/anchor for distance computation', () => {
      const sut = new EvaluateExitWarning();
      const far = metersNorth(PICKUP, 250);
      const a = sut.execute({ current: PICKUP, anchor: far });
      const b = sut.execute({ current: far, anchor: PICKUP });
      expect(a.distanceMeters).toBeCloseTo(b.distanceMeters, 6);
      expect(a.signal).toBe(b.signal);
    });
  });
});
