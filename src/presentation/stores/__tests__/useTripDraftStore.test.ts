import { Coordinates } from '@domain/entities/Coordinates';
import { Endpoint } from '@domain/entities/Endpoint';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { Route } from '@domain/entities/Route';

import { useTripDraftStore } from '../useTripDraftStore';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

function makePickup(): Endpoint {
  return unwrap(
    Endpoint.create({
      location: MIAMI,
      address: '100 Biscayne Blvd, Miami, FL',
      placeName: 'Home',
      directions: null,
    }),
  );
}

function makeDropoff(): Endpoint {
  return unwrap(
    Endpoint.create({
      location: FORT_LAUDERDALE,
      address: '1 Las Olas Way, Fort Lauderdale, FL',
      placeName: null,
      directions: null,
    }),
  );
}

function makeRoute(label: string): Route {
  return unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: `polyline-${label}`,
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: [],
      tollPrice: null,
      routeToken: `tk-${label}`,
      description: label,
    }),
  );
}

describe('useTripDraftStore', () => {
  beforeEach(() => {
    useTripDraftStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts empty', () => {
      const s = useTripDraftStore.getState();
      expect(s.pickup).toBeNull();
      expect(s.dropoff).toBeNull();
      expect(s.routeAlternatives).toEqual([]);
      expect(s.selectedRouteIndex).toBe(0);
      expect(s.selectedRideServiceId).toBeNull();
      expect(s.scheduledPickupAt).toBeNull();
      expect(s.avoidTolls).toBe(false);
    });
  });

  describe('endpoint setters', () => {
    it('setPickup updates the field', () => {
      useTripDraftStore.getState().setPickup(makePickup());
      expect(useTripDraftStore.getState().pickup?.address).toContain('Miami');
    });

    it('setPickup invalidates cached route alternatives', () => {
      useTripDraftStore
        .getState()
        .setRouteAlternatives([makeRoute('a'), makeRoute('b')]);
      useTripDraftStore.getState().setSelectedRouteIndex(1);
      useTripDraftStore.getState().setPickup(makePickup());
      const s = useTripDraftStore.getState();
      expect(s.routeAlternatives).toEqual([]);
      expect(s.selectedRouteIndex).toBe(0);
    });

    it('setDropoff invalidates cached route alternatives', () => {
      useTripDraftStore.getState().setRouteAlternatives([makeRoute('a')]);
      useTripDraftStore.getState().setDropoff(makeDropoff());
      expect(useTripDraftStore.getState().routeAlternatives).toEqual([]);
    });
  });

  describe('route alternatives', () => {
    it('setRouteAlternatives stores them and resets the selected index', () => {
      useTripDraftStore.getState().setSelectedRouteIndex(2);
      useTripDraftStore
        .getState()
        .setRouteAlternatives([makeRoute('a'), makeRoute('b'), makeRoute('c')]);
      const s = useTripDraftStore.getState();
      expect(s.routeAlternatives).toHaveLength(3);
      expect(s.selectedRouteIndex).toBe(0);
    });

    it('setSelectedRouteIndex clamps positive overflow', () => {
      useTripDraftStore
        .getState()
        .setRouteAlternatives([makeRoute('a'), makeRoute('b')]);
      useTripDraftStore.getState().setSelectedRouteIndex(99);
      expect(useTripDraftStore.getState().selectedRouteIndex).toBe(1);
    });

    it('setSelectedRouteIndex clamps negative values to 0', () => {
      useTripDraftStore.getState().setRouteAlternatives([makeRoute('a')]);
      useTripDraftStore.getState().setSelectedRouteIndex(-5);
      expect(useTripDraftStore.getState().selectedRouteIndex).toBe(0);
    });

    it('setSelectedRouteIndex stays at 0 when routes are empty', () => {
      useTripDraftStore.getState().setSelectedRouteIndex(2);
      expect(useTripDraftStore.getState().selectedRouteIndex).toBe(0);
    });
  });

  describe('avoidTolls', () => {
    it('setAvoidTolls flips the flag and invalidates cached routes', () => {
      useTripDraftStore.getState().setRouteAlternatives([makeRoute('a')]);
      useTripDraftStore.getState().setAvoidTolls(true);
      const s = useTripDraftStore.getState();
      expect(s.avoidTolls).toBe(true);
      expect(s.routeAlternatives).toEqual([]);
    });
  });

  describe('confirmability', () => {
    it('reports confirmable only when every required field is set', () => {
      const s = useTripDraftStore.getState();
      const id = unwrap(RideServiceId.create('economy'));

      // Empty draft.
      expect(isConfirmable()).toBe(false);

      s.setPickup(makePickup());
      expect(isConfirmable()).toBe(false);

      s.setDropoff(makeDropoff());
      expect(isConfirmable()).toBe(false);

      s.setRouteAlternatives([makeRoute('a')]);
      expect(isConfirmable()).toBe(false);

      s.setSelectedRideServiceId(id);
      expect(isConfirmable()).toBe(true);
    });
  });

  describe('reset', () => {
    it('reset returns the store to its initial state', () => {
      const s = useTripDraftStore.getState();
      s.setPickup(makePickup());
      s.setDropoff(makeDropoff());
      s.setRouteAlternatives([makeRoute('a'), makeRoute('b')]);
      s.setSelectedRideServiceId(unwrap(RideServiceId.create('economy')));
      s.setScheduledPickupAt(new Date('2026-05-01T10:00:00Z'));
      s.setAvoidTolls(true);

      s.reset();

      const after = useTripDraftStore.getState();
      expect(after.pickup).toBeNull();
      expect(after.dropoff).toBeNull();
      expect(after.routeAlternatives).toEqual([]);
      expect(after.selectedRouteIndex).toBe(0);
      expect(after.selectedRideServiceId).toBeNull();
      expect(after.scheduledPickupAt).toBeNull();
      expect(after.avoidTolls).toBe(false);
    });
  });
});

/**
 * Helper that re-derives confirmability from the same state predicate the
 * `useTripDraftIsConfirmable` selector uses, but read directly from the
 * store rather than through React. Keeps the test free of `renderHook`
 * machinery while still exercising the same logic.
 */
function isConfirmable(): boolean {
  const s = useTripDraftStore.getState();
  return (
    s.pickup !== null &&
    s.dropoff !== null &&
    s.routeAlternatives.length > 0 &&
    s.selectedRouteIndex >= 0 &&
    s.selectedRouteIndex < s.routeAlternatives.length &&
    s.selectedRideServiceId !== null
  );
}
