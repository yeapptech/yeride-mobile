import { create } from 'zustand';

import type { Endpoint } from '@domain/entities/Endpoint';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { Route } from '@domain/entities/Route';

/**
 * In-flight ride request before `CreateRide` runs.
 *
 * The legacy app held this in `TripContext` mixed in with the live trip
 * mirror; the rewrite splits the two:
 *
 *   - This store: rider's draft (pickup, dropoff, route alternatives,
 *     selected alternative index, selected ride-service tier, optional
 *     scheduled pickup time). Local UI state, not yet persisted.
 *   - TanStack Query: live trip from Firestore once `CreateRide` succeeds.
 *
 * The draft lifecycle:
 *
 *   reset                                                        ─┐
 *     ↓                                                            │
 *   setPickup / setDropoff   (RouteSearch screen)                  │
 *     ↓                                                            │  cleared by
 *   setRouteAlternatives + setSelectedRouteIndex                   │  reset() at
 *     ↓                                                            │  navigate-away
 *   setSelectedRideServiceId + setScheduledPickupAt                │  or after
 *     ↓                                                            │  CreateRide
 *   "Confirm" tap → CreateRide → reset() → navigate to RideMonitor─┘
 *
 * `routeAlternatives` is denormalized here rather than fetched on demand:
 * the RouteSelect screen wants to render polylines for every option
 * simultaneously and the user might toggle quickly between them.
 */

interface TripDraftState {
  readonly pickup: Endpoint | null;
  readonly dropoff: Endpoint | null;
  readonly routeAlternatives: readonly Route[];
  readonly selectedRouteIndex: number;
  readonly selectedRideServiceId: RideServiceId | null;
  /**
   * `null` for "now" rides (default). Set by `ScheduleDatetimePicker` for a
   * future-dated pickup. Phase 3 leaves the UI for this gated behind a
   * feature flag — the field exists so Phase 5 can flip the flag without
   * a store migration.
   */
  readonly scheduledPickupAt: Date | null;
  /**
   * Rider preference: avoid toll roads when computing routes. Defaults
   * to false so the toll-free path is one explicit toggle away. Wired to
   * the toll badge on RouteSelect.
   */
  readonly avoidTolls: boolean;

  setPickup: (endpoint: Endpoint | null) => void;
  setDropoff: (endpoint: Endpoint | null) => void;
  setRouteAlternatives: (routes: readonly Route[]) => void;
  setSelectedRouteIndex: (index: number) => void;
  setSelectedRideServiceId: (id: RideServiceId | null) => void;
  setScheduledPickupAt: (at: Date | null) => void;
  setAvoidTolls: (avoid: boolean) => void;
  /** Clear every field. Called on Confirm-success and on navigate-away. */
  reset: () => void;
}

const INITIAL: Pick<
  TripDraftState,
  | 'pickup'
  | 'dropoff'
  | 'routeAlternatives'
  | 'selectedRouteIndex'
  | 'selectedRideServiceId'
  | 'scheduledPickupAt'
  | 'avoidTolls'
> = {
  pickup: null,
  dropoff: null,
  routeAlternatives: [],
  selectedRouteIndex: 0,
  selectedRideServiceId: null,
  scheduledPickupAt: null,
  avoidTolls: false,
};

export const useTripDraftStore = create<TripDraftState>((set) => ({
  ...INITIAL,

  setPickup: (pickup) =>
    set({
      pickup,
      // Changing pickup invalidates any cached route alternatives.
      routeAlternatives: [],
      selectedRouteIndex: 0,
    }),

  setDropoff: (dropoff) =>
    set({
      dropoff,
      // Same — alternatives are pickup×dropoff specific.
      routeAlternatives: [],
      selectedRouteIndex: 0,
    }),

  setRouteAlternatives: (routes) =>
    set({
      routeAlternatives: routes,
      // Reset to the first alternative whenever the list refreshes.
      selectedRouteIndex: 0,
    }),

  setSelectedRouteIndex: (selectedRouteIndex) =>
    set((state) => {
      // Defensive clamp — a stale UI tap should not crash the screen.
      if (state.routeAlternatives.length === 0) {
        return { selectedRouteIndex: 0 };
      }
      const clamped = Math.max(
        0,
        Math.min(selectedRouteIndex, state.routeAlternatives.length - 1),
      );
      return { selectedRouteIndex: clamped };
    }),

  setSelectedRideServiceId: (selectedRideServiceId) =>
    set({ selectedRideServiceId }),

  setScheduledPickupAt: (scheduledPickupAt) => set({ scheduledPickupAt }),

  setAvoidTolls: (avoidTolls) =>
    set({
      avoidTolls,
      // Toll preference change → re-fetch alternatives, so dump the cache.
      routeAlternatives: [],
      selectedRouteIndex: 0,
    }),

  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useTripDraftPickup = (): Endpoint | null =>
  useTripDraftStore((s) => s.pickup);

export const useTripDraftDropoff = (): Endpoint | null =>
  useTripDraftStore((s) => s.dropoff);

export const useTripDraftRoutes = (): readonly Route[] =>
  useTripDraftStore((s) => s.routeAlternatives);

export const useTripDraftSelectedRoute = (): Route | null =>
  useTripDraftStore((s) => s.routeAlternatives[s.selectedRouteIndex] ?? null);

export const useTripDraftSelectedRouteIndex = (): number =>
  useTripDraftStore((s) => s.selectedRouteIndex);

export const useTripDraftRideServiceId = (): RideServiceId | null =>
  useTripDraftStore((s) => s.selectedRideServiceId);

export const useTripDraftScheduledAt = (): Date | null =>
  useTripDraftStore((s) => s.scheduledPickupAt);

export const useTripDraftAvoidTolls = (): boolean =>
  useTripDraftStore((s) => s.avoidTolls);

/**
 * True only when the draft has every field needed to call `CreateRide`.
 * Drives the Confirm button enabled-state on RouteSelect.
 */
export const useTripDraftIsConfirmable = (): boolean =>
  useTripDraftStore(
    (s) =>
      s.pickup !== null &&
      s.dropoff !== null &&
      s.routeAlternatives.length > 0 &&
      s.selectedRouteIndex >= 0 &&
      s.selectedRouteIndex < s.routeAlternatives.length &&
      s.selectedRideServiceId !== null,
  );
