import { create } from 'zustand';

import type {
  BgGeofenceEvent,
  BgLocationEvent,
  BgPermissionStatus,
} from '@data/services/BackgroundGeolocationClient';
import type { Coordinates } from '@domain/entities/Coordinates';

/**
 * Transient mirror of the SDK's location + geofence streams.
 *
 * The Phase 7 turn 1 adapter (`BackgroundGeolocationClient`) and its fake
 * (`FakeBackgroundGeolocationClient`) emit `BgLocationEvent` and
 * `BgGeofenceEvent`s at runtime. `useGpsLifecycle` (turn 2) is the one
 * place that subscribes to those streams; it pushes the latest values
 * into this store so view-models can read GPS state via cheap selector
 * hooks without each one mounting its own SDK subscription.
 *
 * Why Zustand and not TanStack Query:
 *   - GPS values aren't fetched server state — they're a continuous push
 *     from a side-effecting library. TanStack Query's request/response
 *     shape doesn't fit.
 *   - The same split is already used by `useGeofenceUiStore` (banner
 *     visibility), `useDriverStatusStore` (online/offline mirror), and
 *     `useChatUiStore`. CLAUDE.md's "Zustand vs. TanStack Query — split
 *     of concerns" rule.
 *
 * Mounting rule:
 *   - `useGpsLifecycle` is the ONLY writer. Screens and view-models READ
 *     via the selector hooks at the bottom of this file. Don't call
 *     `setLocation` / `setGeofenceEvent` from anywhere else.
 *   - On sign-out, `AppContent` calls `reset()` so the next session
 *     starts with a clean slate.
 *
 * Field shapes deliberately decompose the SDK's event types so the
 * common selectors (`useGpsCurrentLocation`, `useGpsCurrentOdometer`)
 * stay primitive — view-models that just want a `Coordinates` shouldn't
 * have to dig into a wrapping `BgLocationEvent`.
 */

interface GpsState {
  readonly permissionStatus: BgPermissionStatus;
  readonly currentLocation: Coordinates | null;
  /** Metres per second, or `null` when the SDK hasn't established a fix. */
  readonly currentSpeed: number | null;
  /** Cumulative session distance in metres. Resets when the SDK does. */
  readonly currentOdometerMeters: number;
  /**
   * Latest geofence transition event. Cleared by `reset()` only — the
   * banner UI in `useRideMonitorViewModel` (Turn 3) reads this to drive
   * `useGeofenceUiStore.pickupExitWarningVisible`.
   */
  readonly lastGeofenceEvent: BgGeofenceEvent | null;
  /**
   * Derived from the most recent geofence transition: `true` after an
   * ENTER, `false` after an EXIT or after the geofence was deregistered
   * (call `setIsInsidePickupGeofence(false)` from the lifecycle hook on
   * deregistration so the flag doesn't survive a trip-end). Defaults
   * `false` so a brand-new session before the first ENTER doesn't
   * pretend the user is in the pickup area.
   */
  readonly isInsidePickupGeofence: boolean;

  /**
   * Push the OS-granted authorization level. Called once per
   * `enabled` transition by `useGpsLifecycle`. Does not flip the
   * lifecycle on its own; the hook's effects gate `start()` on this
   * value's read.
   */
  setPermissionStatus: (status: BgPermissionStatus) => void;

  /**
   * Adopt a fresh `BgLocationEvent` from the SDK. Decomposes into
   * `currentLocation` + `currentSpeed` + `currentOdometerMeters`.
   */
  setLocation: (event: BgLocationEvent) => void;

  /**
   * Adopt a fresh `BgGeofenceEvent` from the SDK. Updates
   * `lastGeofenceEvent` AND derives `isInsidePickupGeofence` from the
   * action: ENTER → true, EXIT → false. Geofences for non-`'pickup'`
   * identifiers (none in Phase 7) update `lastGeofenceEvent` only.
   */
  setGeofenceEvent: (event: BgGeofenceEvent) => void;

  /**
   * Manually set the inside-pickup-geofence flag. Used by
   * `useGpsLifecycle` to clear the flag when the geofence is
   * deregistered (e.g. ride moves out of `'dispatched'`) — without a
   * fresh EXIT event we'd otherwise carry a stale `true`.
   */
  setIsInsidePickupGeofence: (value: boolean) => void;

  /**
   * Wipe every field back to defaults. Called by `AppContent` on
   * sign-out so the next sign-in starts fresh.
   */
  reset: () => void;
}

const INITIAL = {
  permissionStatus: 'undetermined' as BgPermissionStatus,
  currentLocation: null,
  currentSpeed: null,
  currentOdometerMeters: 0,
  lastGeofenceEvent: null,
  isInsidePickupGeofence: false,
} as const;

export const useGpsStore = create<GpsState>((set) => ({
  ...INITIAL,

  setPermissionStatus: (status) => set({ permissionStatus: status }),

  setLocation: (event) =>
    set({
      currentLocation: event.coords,
      currentSpeed: event.speed,
      currentOdometerMeters: event.odometerMeters,
    }),

  setGeofenceEvent: (event) => {
    if (event.identifier === 'pickup') {
      set({
        lastGeofenceEvent: event,
        isInsidePickupGeofence: event.action === 'ENTER',
      });
      return;
    }
    set({ lastGeofenceEvent: event });
  },

  setIsInsidePickupGeofence: (value) => set({ isInsidePickupGeofence: value }),

  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useGpsPermissionStatus = (): BgPermissionStatus =>
  useGpsStore((s) => s.permissionStatus);

export const useGpsCurrentLocation = (): Coordinates | null =>
  useGpsStore((s) => s.currentLocation);

export const useGpsCurrentSpeed = (): number | null =>
  useGpsStore((s) => s.currentSpeed);

export const useGpsCurrentOdometer = (): number =>
  useGpsStore((s) => s.currentOdometerMeters);

export const useGpsLastGeofenceEvent = (): BgGeofenceEvent | null =>
  useGpsStore((s) => s.lastGeofenceEvent);

export const useGpsIsInsidePickupGeofence = (): boolean =>
  useGpsStore((s) => s.isInsidePickupGeofence);
