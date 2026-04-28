import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import type { UserId } from '@domain/entities/UserId';

/**
 * Centralized TanStack Query key factory.
 *
 * Every query key in the app comes from this file. Two reasons:
 *
 *   1. Type safety — keys are typed tuples, so `queryClient.invalidateQueries({ queryKey: queryKeys.ride.byId(rideId) })`
 *      cannot drift out of sync with the actual `useQuery` callsite. A
 *      misspelled string at one site stops invalidating; this file makes
 *      that impossible.
 *
 *   2. Hierarchy — TanStack Query treats keys as prefixes, so
 *      `queryKeys.ride.all()` invalidates everything under it, while
 *      `queryKeys.ride.byId(id)` invalidates only that one. Encoding the
 *      hierarchy in a factory keeps the prefix structure explicit.
 *
 * Convention: every leaf returns a `readonly` tuple so TS narrows it to a
 * tuple type rather than a generic array. Use `as const` only on the leaf
 * literal — TanStack accepts arrays, so `readonly unknown[]` typing flows
 * through without `as` casts at consumption sites.
 *
 * Naming: top-level domains are scoped after the entity they serve
 * (`ride`, `user`, `serviceArea`, `route`, `location`, `tripEvent`,
 * `payment`). Each scope exposes:
 *   - `all()` — root prefix, useful for sweeping invalidation
 *   - `lists()` / `list(filters)` — collection-shaped queries
 *   - `byId(id)` / `details(id)` — single-resource queries
 */

export const queryKeys = {
  // ─── User profile ─────────────────────────────────────────────
  user: {
    all: () => ['user'] as const,
    current: () => ['user', 'current'] as const,
    byId: (userId: UserId) => ['user', 'byId', String(userId)] as const,
  },

  // ─── Service-area catalog ─────────────────────────────────────
  serviceArea: {
    all: () => ['serviceArea'] as const,
    list: () => ['serviceArea', 'list'] as const,
    byId: (areaId: ServiceAreaId) =>
      ['serviceArea', 'byId', String(areaId)] as const,
    /** Active area resolved from a coordinates pair. */
    activeForLocation: (lat: number, lng: number) =>
      ['serviceArea', 'activeForLocation', lat, lng] as const,
    /** Ride services within an area. */
    rideServices: (areaId: ServiceAreaId) =>
      ['serviceArea', 'rideServices', String(areaId)] as const,
  },

  // ─── Rides ─────────────────────────────────────────────────────
  ride: {
    all: () => ['ride'] as const,
    /** One ride by id (one-shot read; subscriptions go through the hook). */
    byId: (rideId: RideId) => ['ride', 'byId', String(rideId)] as const,
    /**
     * Passenger-scoped lists. Status filter is part of the key so the cache
     * can hold "in-progress" and "history" separately for the same user.
     */
    listByPassenger: (
      passengerId: UserId,
      statuses: readonly RideStatus[] | undefined,
    ) =>
      [
        'ride',
        'listByPassenger',
        String(passengerId),
        statuses ? [...statuses].sort() : null,
      ] as const,
    /** Convenience prefix for "any list keyed on this passenger". */
    listsForPassenger: (passengerId: UserId) =>
      ['ride', 'listByPassenger', String(passengerId)] as const,
    /** Audit-event subcollection. */
    events: (rideId: RideId) => ['ride', 'events', String(rideId)] as const,
    /** Receipt subcollection. */
    payments: (rideId: RideId) => ['ride', 'payments', String(rideId)] as const,
  },

  // ─── Route alternatives (Google Routes API) ───────────────────
  route: {
    all: () => ['route'] as const,
    /**
     * Alternatives keyed on the rounded lat/lng pair + tolls preference.
     * Rounded to 5 decimals (~1m) so trivial GPS jitter doesn't generate
     * a fresh fetch every render.
     */
    alternatives: (args: {
      readonly originLat: number;
      readonly originLng: number;
      readonly destLat: number;
      readonly destLng: number;
      readonly avoidTolls: boolean;
    }) =>
      [
        'route',
        'alternatives',
        round5(args.originLat),
        round5(args.originLng),
        round5(args.destLat),
        round5(args.destLng),
        args.avoidTolls,
      ] as const,
  },

  // ─── User location (one-shot reads; live tracking uses the hook) ──
  location: {
    all: () => ['location'] as const,
    byUser: (userId: UserId) => ['location', 'byUser', String(userId)] as const,
  },
} as const;

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
