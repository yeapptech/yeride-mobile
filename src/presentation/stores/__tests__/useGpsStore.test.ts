import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import type { BgGeofenceEvent, BgLocationEvent } from '@domain/services';

import { useGpsStore } from '../useGpsStore';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const RIDE_A = unwrap(RideId.create('ride_aaaaaaaaaaaa'));

function locationEvent(
  coords: Coordinates,
  overrides?: Partial<BgLocationEvent>,
): BgLocationEvent {
  return {
    coords,
    speed: 12.5,
    odometerMeters: 1500,
    timestampMs: 1_700_000_000_000,
    isMoving: true,
    ...overrides,
  };
}

function geofenceEvent(overrides?: Partial<BgGeofenceEvent>): BgGeofenceEvent {
  return {
    identifier: 'pickup',
    action: 'ENTER',
    rideId: RIDE_A,
    coords: MIAMI,
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('useGpsStore', () => {
  beforeEach(() => {
    useGpsStore.getState().reset();
  });

  it('starts with sensible defaults', () => {
    const s = useGpsStore.getState();
    expect(s.permissionStatus).toBe('undetermined');
    expect(s.currentLocation).toBeNull();
    expect(s.currentSpeed).toBeNull();
    expect(s.currentOdometerMeters).toBe(0);
    expect(s.lastGeofenceEvent).toBeNull();
    expect(s.isInsidePickupGeofence).toBe(false);
  });

  it('setPermissionStatus stores the granted level without touching anything else', () => {
    useGpsStore.getState().setPermissionStatus('always');
    const s = useGpsStore.getState();
    expect(s.permissionStatus).toBe('always');
    expect(s.currentLocation).toBeNull();
    expect(s.currentOdometerMeters).toBe(0);
  });

  it('setLocation decomposes a BgLocationEvent into coords + speed + odometer', () => {
    useGpsStore.getState().setLocation(locationEvent(MIAMI));
    const s = useGpsStore.getState();
    expect(s.currentLocation).toBe(MIAMI);
    expect(s.currentSpeed).toBe(12.5);
    expect(s.currentOdometerMeters).toBe(1500);
  });

  it('setLocation accepts a null speed (SDK indoors / no fix)', () => {
    useGpsStore
      .getState()
      .setLocation(locationEvent(MIAMI, { speed: null, odometerMeters: 0 }));
    const s = useGpsStore.getState();
    expect(s.currentLocation).toBe(MIAMI);
    expect(s.currentSpeed).toBeNull();
    expect(s.currentOdometerMeters).toBe(0);
  });

  it('setLocation overwrites the previous reading', () => {
    useGpsStore.getState().setLocation(locationEvent(MIAMI));
    useGpsStore
      .getState()
      .setLocation(
        locationEvent(FORT_LAUDERDALE, { speed: 0, odometerMeters: 5000 }),
      );
    const s = useGpsStore.getState();
    expect(s.currentLocation).toBe(FORT_LAUDERDALE);
    expect(s.currentSpeed).toBe(0);
    expect(s.currentOdometerMeters).toBe(5000);
  });

  it('setGeofenceEvent on a pickup ENTER flips isInsidePickupGeofence true', () => {
    const ev = geofenceEvent({ action: 'ENTER' });
    useGpsStore.getState().setGeofenceEvent(ev);
    const s = useGpsStore.getState();
    expect(s.lastGeofenceEvent).toBe(ev);
    expect(s.isInsidePickupGeofence).toBe(true);
  });

  it('setGeofenceEvent on a pickup EXIT flips isInsidePickupGeofence false', () => {
    useGpsStore.getState().setGeofenceEvent(geofenceEvent({ action: 'ENTER' }));
    const ev = geofenceEvent({ action: 'EXIT' });
    useGpsStore.getState().setGeofenceEvent(ev);
    const s = useGpsStore.getState();
    expect(s.lastGeofenceEvent).toBe(ev);
    expect(s.isInsidePickupGeofence).toBe(false);
  });

  it('setGeofenceEvent for a non-pickup identifier records the event but does not flip the inside flag', () => {
    useGpsStore.getState().setIsInsidePickupGeofence(true);
    const ev = geofenceEvent({ identifier: 'dropoff', action: 'ENTER' });
    useGpsStore.getState().setGeofenceEvent(ev);
    const s = useGpsStore.getState();
    expect(s.lastGeofenceEvent).toBe(ev);
    // Carried over from the manual set; non-pickup events don't touch it.
    expect(s.isInsidePickupGeofence).toBe(true);
  });

  it('setIsInsidePickupGeofence supports manual deregistration cleanup', () => {
    useGpsStore.getState().setGeofenceEvent(geofenceEvent({ action: 'ENTER' }));
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(true);
    useGpsStore.getState().setIsInsidePickupGeofence(false);
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(false);
    // The lastGeofenceEvent is preserved — the lifecycle hook clears the
    // inside flag without invalidating the audit trail.
    expect(useGpsStore.getState().lastGeofenceEvent).not.toBeNull();
  });

  it('reset wipes every field back to defaults', () => {
    useGpsStore.getState().setPermissionStatus('always');
    useGpsStore.getState().setLocation(locationEvent(MIAMI));
    useGpsStore.getState().setGeofenceEvent(geofenceEvent({ action: 'ENTER' }));
    useGpsStore.getState().reset();
    const s = useGpsStore.getState();
    expect(s.permissionStatus).toBe('undetermined');
    expect(s.currentLocation).toBeNull();
    expect(s.currentSpeed).toBeNull();
    expect(s.currentOdometerMeters).toBe(0);
    expect(s.lastGeofenceEvent).toBeNull();
    expect(s.isInsidePickupGeofence).toBe(false);
  });

  it('notifies subscribers on each change', () => {
    const calls: Array<Coordinates | null> = [];
    const unsubscribe = useGpsStore.subscribe((s) => {
      calls.push(s.currentLocation);
    });
    useGpsStore.getState().setLocation(locationEvent(MIAMI));
    useGpsStore.getState().setLocation(locationEvent(FORT_LAUDERDALE));
    useGpsStore.getState().reset();
    unsubscribe();
    expect(calls).toEqual([MIAMI, FORT_LAUDERDALE, null]);
  });
});
