import { create } from 'zustand';

import type { RideService } from '@domain/entities/RideService';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';

/**
 * Session-scoped cache for the service-area catalog.
 *
 * Why a Zustand store and not TanStack Query: the catalog is global static
 * config (one fetch per session), and downstream features want a reactive
 * `activeAreaId` they can flip when the user moves into or out of a region.
 * Wrapping that in a Query key felt heavier than is warranted; the store
 * is a small, explicit slice.
 *
 * Status flow:
 *   - 'idle'    — boot state, before any fetch
 *   - 'loading' — fetch in flight
 *   - 'ready'   — fetch succeeded, areas populated (may still be empty)
 *   - 'error'   — fetch failed; the UI can offer retry
 *
 * `activeAreaId` is set independently — typically by a presentation-layer
 * effect that resolves the user's location against the cached areas via the
 * `ResolveActiveServiceArea` use case. The store doesn't fetch the active
 * area's ride-services automatically; the caller decides when to populate
 * `services` (so a tab switch doesn't refetch).
 */

export type ServiceAreaStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ServiceAreaState {
  readonly status: ServiceAreaStatus;
  readonly areas: readonly ServiceArea[];
  readonly activeAreaId: ServiceAreaId | null;
  /** Ride-service catalog for the currently-active area. */
  readonly services: readonly RideService[];
  readonly error: Error | null;

  /** Switch to 'loading' (clears prior error but keeps any cached areas). */
  setLoading: () => void;

  /** Move to 'ready' with the given areas. Clears active area + services. */
  setReady: (areas: readonly ServiceArea[]) => void;

  /** Move to 'error' with the given error; keeps prior areas for resilience. */
  setError: (error: Error) => void;

  /** Set the active service area (or clear it with null). */
  setActiveArea: (areaId: ServiceAreaId | null) => void;

  /** Set the ride-service catalog for the active area. */
  setServices: (services: readonly RideService[]) => void;

  /** Reset to idle — used by tests + sign-out flow. */
  reset: () => void;
}

const INITIAL: Pick<
  ServiceAreaState,
  'status' | 'areas' | 'activeAreaId' | 'services' | 'error'
> = {
  status: 'idle',
  areas: [],
  activeAreaId: null,
  services: [],
  error: null,
};

export const useServiceAreaStore = create<ServiceAreaState>((set) => ({
  ...INITIAL,

  setLoading: () => set({ status: 'loading', error: null }),

  setReady: (areas) =>
    set({
      status: 'ready',
      areas,
      activeAreaId: null,
      services: [],
      error: null,
    }),

  setError: (error) => set({ status: 'error', error }),

  setActiveArea: (activeAreaId) => set({ activeAreaId, services: [] }),

  setServices: (services) => set({ services }),

  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useServiceAreaStatus = (): ServiceAreaStatus =>
  useServiceAreaStore((s) => s.status);

export const useServiceAreas = (): readonly ServiceArea[] =>
  useServiceAreaStore((s) => s.areas);

export const useActiveServiceArea = (): ServiceArea | null =>
  useServiceAreaStore((s) => {
    if (!s.activeAreaId) return null;
    return s.areas.find((a) => a.id === s.activeAreaId) ?? null;
  });

export const useRideServices = (): readonly RideService[] =>
  useServiceAreaStore((s) => s.services);
