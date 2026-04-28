import { create } from 'zustand';

/**
 * Client/UI state for the driver experience.
 *
 *   - 'offline'      — driver is signed in but not advertising. The
 *                      ListAvailableRides subscription is NOT live.
 *   - 'online_idle'  — driver is online and waiting. ListAvailableRides
 *                      subscription is live; foreground GPS is on (Turn 2
 *                      wires this).
 *   - 'dispatched'   — driver accepted a ride and is en route to pickup.
 *                      Set by the DriverMonitor view-model from the live
 *                      Ride status (Turn 3+).
 *   - 'on_trip'      — passenger is in the car. Same wiring as 'dispatched'.
 *
 * Why this is a Zustand store and not derived from server state:
 *   - 'offline' / 'online_idle' is a pure client choice. The driver chooses
 *     to advertise, and the UI immediately reflects that choice without
 *     waiting on Firestore.
 *   - 'dispatched' / 'on_trip' ARE derived from `Ride.status` server-side,
 *     but we mirror them here so the home screen, the GPS lifecycle, and
 *     the tab styling can read a single client-side value rather than
 *     re-deriving from the in-progress ride query at every read site.
 *     The mirror is set by the DriverMonitor view-model in later turns;
 *     Turn 1 only exercises offline ↔ online_idle.
 *
 * `activeVehicleId` is a UI choice — which vehicle the driver is
 * advertising right now. Phase 5 introduces a `VehicleId` branded type and
 * a vehicle-selection screen; for Turn 1 this is a plain string slot (the
 * Turn 2 view-model will seed it from `user.services.ride` if present).
 *
 * State writes go through named action methods so misuse is hard.
 * `reset()` is called on sign-out by AppContent (parity with the rider
 * stores).
 */

export type DriverMode = 'offline' | 'online_idle' | 'dispatched' | 'on_trip';

interface DriverStatusState {
  readonly mode: DriverMode;
  readonly activeVehicleId: string | null;

  /** Flip from 'offline' to 'online_idle' with the chosen vehicle. */
  goOnline: (vehicleId: string) => void;

  /** Flip back to 'offline'. Clears the active vehicle. */
  goOffline: () => void;

  /**
   * Set the mode directly. Used by the DriverMonitor view-model in later
   * turns to mirror ride-status into 'dispatched' / 'on_trip'. Does NOT
   * touch activeVehicleId — once a driver is on a trip, the vehicle is
   * locked in.
   */
  setMode: (mode: DriverMode) => void;

  /** Reset to defaults — used on sign-out. */
  reset: () => void;
}

const INITIAL = {
  mode: 'offline' as DriverMode,
  activeVehicleId: null,
} as const;

export const useDriverStatusStore = create<DriverStatusState>((set) => ({
  ...INITIAL,

  goOnline: (vehicleId) =>
    set({ mode: 'online_idle', activeVehicleId: vehicleId }),

  goOffline: () => set({ mode: 'offline', activeVehicleId: null }),

  setMode: (mode) => set({ mode }),

  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useDriverMode = (): DriverMode =>
  useDriverStatusStore((s) => s.mode);

export const useActiveVehicleId = (): string | null =>
  useDriverStatusStore((s) => s.activeVehicleId);

export const useIsDriverOnline = (): boolean =>
  useDriverStatusStore((s) => s.mode !== 'offline');
