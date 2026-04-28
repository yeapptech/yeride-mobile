import { create } from 'zustand';

/**
 * UI-only state for the geofence exit-warning banner shown in
 * `RideMonitor` (rider) and `DriverMonitor` (driver, Phase 4).
 *
 * Why this is its own store:
 *   - The legacy `TripContext` mixed banner state with the live trip mirror.
 *     Splitting them lets the trip mirror live in TanStack Query (server
 *     state) and the banner stay in Zustand (pure UI state, dismissible
 *     by the user, no persistence).
 *   - The banner is sticky-until-dismissed: it can be set true by the
 *     view-model when `EvaluateExitWarning` returns `'exited'`, and stays
 *     until the user taps Dismiss OR the geofence evaluator returns
 *     `'inside'` again.
 *
 * Phase 3 scope:
 *   - `pickupExitWarningVisible` is the rider's "you've left the pickup
 *     area" banner.
 *   - `dropoffExitWarningVisible` is reserved for symmetry but not yet
 *     wired to a setter caller in Phase 3 (the rider sits in the car
 *     during the dropoff portion; the driver banner lands in Phase 4).
 *
 * State writes go through named action methods so the surface is
 * inspectable; the action returning the dismissed state is convenient for
 * the modal-style alert pattern in DispatchedView.
 */

interface GeofenceUiState {
  readonly pickupExitWarningVisible: boolean;
  readonly dropoffExitWarningVisible: boolean;

  showPickupExitWarning: () => void;
  dismissPickupExitWarning: () => void;
  showDropoffExitWarning: () => void;
  dismissDropoffExitWarning: () => void;
  /** Reset to defaults — used on sign-out and trip-end. */
  reset: () => void;
}

const INITIAL = {
  pickupExitWarningVisible: false,
  dropoffExitWarningVisible: false,
} as const;

export const useGeofenceUiStore = create<GeofenceUiState>((set) => ({
  ...INITIAL,

  showPickupExitWarning: () => set({ pickupExitWarningVisible: true }),
  dismissPickupExitWarning: () => set({ pickupExitWarningVisible: false }),
  showDropoffExitWarning: () => set({ dropoffExitWarningVisible: true }),
  dismissDropoffExitWarning: () => set({ dropoffExitWarningVisible: false }),

  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const usePickupExitWarningVisible = (): boolean =>
  useGeofenceUiStore((s) => s.pickupExitWarningVisible);

export const useDropoffExitWarningVisible = (): boolean =>
  useGeofenceUiStore((s) => s.dropoffExitWarningVisible);
