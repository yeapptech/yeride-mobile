import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Endpoint } from '@domain/entities/Endpoint';
import type { Money } from '@domain/entities/Money';
import type { RideService } from '@domain/entities/RideService';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { Route } from '@domain/entities/Route';
import type { DomainError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import type { MainStackNavigation } from '@presentation/navigation/types';
import { useActiveServiceArea, useTripDraftStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RouteSelectVM');

/**
 * View-model for `RouteSelectScreen`.
 *
 * Responsibilities:
 *
 *   1. Pull pickup + dropoff from `useTripDraftStore`. If either is
 *      missing, the screen redirects back to RouteSearch (handled in the
 *      view-model via `redirectIfNoEndpoints`).
 *
 *   2. Resolve the active service area's `RideService` catalog via
 *      `useUseCases().listRideServices`. Cached in `useServiceAreaStore`
 *      via the active-area lookup, but we re-fetch here defensively in
 *      case the user navigated directly.
 *
 *   3. Compute route alternatives via `useUseCases().computeRoutes`.
 *      One fetch on mount, plus a debounced refetch when pickup,
 *      dropoff, or `avoidTolls` changes.
 *
 *   4. Compute fares per (route × ride-service) — derived synchronously
 *      from the selected route + each tier in the catalog. Stored in a
 *      `Map<RideServiceId, Money | null>` keyed by id stringified.
 *
 *   5. Expose tap handlers that write `selectedRouteIndex` and
 *      `selectedRideServiceId` back to `useTripDraftStore`. The actual
 *      `CreateRide` invocation is wired in turn 3.3.
 *
 * The view-model does NOT own the screen's navigation back to RiderHome
 * after Confirm — that's the screen's job (it knows which surface called
 * it). Turn 3.2 stops at "selection captured in the trip-draft store"
 * because RiderHome doesn't exist yet.
 */

export type RouteSelectStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseRouteSelectViewModel {
  readonly status: RouteSelectStatus;
  readonly error: string | null;
  readonly pickup: Endpoint | null;
  readonly dropoff: Endpoint | null;
  readonly routes: readonly Route[];
  readonly selectedRouteIndex: number;
  readonly selectedRoute: Route | null;
  readonly services: readonly RideService[];
  readonly selectedRideServiceId: RideServiceId | null;
  readonly fareById: ReadonlyMap<string, Money | null>;
  readonly avoidTolls: boolean;
  readonly canConfirm: boolean;

  selectRoute: (index: number) => void;
  selectRideService: (id: RideServiceId) => void;
  setAvoidTolls: (avoid: boolean) => void;
  retry: () => void;
  /**
   * Phase 3 turn 2 stub: marks the draft as ready for `CreateRide`.
   * Returns `true` if the selection was complete; the screen handles
   * navigation. Turn 3.3 wires the real RiderHome → confirm flow.
   */
  confirm: () => boolean;
}

const COMPUTE_DEBOUNCE_MS = 300;

export function useRouteSelectViewModel(): UseRouteSelectViewModel {
  const useCases = useUseCases();
  const navigation = useNavigation<MainStackNavigation>();

  const pickup = useTripDraftStore((s) => s.pickup);
  const dropoff = useTripDraftStore((s) => s.dropoff);
  const routes = useTripDraftStore((s) => s.routeAlternatives);
  const selectedRouteIndex = useTripDraftStore((s) => s.selectedRouteIndex);
  const selectedRideServiceId = useTripDraftStore(
    (s) => s.selectedRideServiceId,
  );
  const avoidTolls = useTripDraftStore((s) => s.avoidTolls);
  const setRouteAlternatives = useTripDraftStore((s) => s.setRouteAlternatives);
  const setSelectedRouteIndex = useTripDraftStore(
    (s) => s.setSelectedRouteIndex,
  );
  const setSelectedRideServiceId = useTripDraftStore(
    (s) => s.setSelectedRideServiceId,
  );
  const setAvoidTollsStore = useTripDraftStore((s) => s.setAvoidTolls);

  const activeArea = useActiveServiceArea();

  const [status, setStatus] = useState<RouteSelectStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<readonly RideService[]>([]);

  // Debounce + cancellation token for ComputeRoutes — RouteSearch back-and-
  // forth or rapid avoidTolls toggles shouldn't spam the API.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const redirectIfNoEndpoints = useCallback(() => {
    if (!pickup || !dropoff) {
      logger.debug('redirectIfNoEndpoints: missing endpoint, going back');
      navigation.navigate('RouteSearch');
      return true;
    }
    return false;
  }, [pickup, dropoff, navigation]);

  // Mount-time check: if a user lands here without endpoints, bounce back.
  useEffect(() => {
    redirectIfNoEndpoints();
    // We deliberately depend only on the redirect check; navigation is
    // stable from React Navigation's perspective.
  }, [redirectIfNoEndpoints]);

  // Load ride-service catalog for the active area.
  useEffect(() => {
    let cancelled = false;
    if (!activeArea) {
      setServices([]);
      return;
    }
    void (async () => {
      const r = await useCases.listRideServices.execute(activeArea.id);
      if (cancelled) return;
      if (!r.ok) {
        logger.error('listRideServices failed', r.error);
        setError(formatError(r.error));
        return;
      }
      setServices(r.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeArea, useCases]);

  // ComputeRoutes: kick off + debounce on pickup/dropoff/avoidTolls.
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const reqId = ++requestIdRef.current;
    setStatus('loading');
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        const r = await useCases.computeRoutes.execute({
          origin: { coordinates: pickup.location },
          destination: { coordinates: dropoff.location },
          options: { alternatives: true, tolls: !avoidTolls },
        });
        // Discard stale responses.
        if (reqId !== requestIdRef.current) return;
        if (!r.ok) {
          logger.error('computeRoutes failed', r.error);
          setStatus('error');
          setError(formatError(r.error));
          setRouteAlternatives([]);
          return;
        }
        setRouteAlternatives(r.value);
        setStatus('ready');
        setError(null);
      })();
    }, COMPUTE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [pickup, dropoff, avoidTolls, useCases, setRouteAlternatives]);

  // Compute fare per ride-service tier for the currently selected route.
  const fareById = useMemo<ReadonlyMap<string, Money | null>>(() => {
    const out = new Map<string, Money | null>();
    const route = routes[selectedRouteIndex];
    if (!route) return out;
    for (const service of services) {
      const r = useCases.estimateFare.execute({ route, rideService: service });
      out.set(String(service.id), r.ok ? r.value : null);
    }
    return out;
  }, [routes, selectedRouteIndex, services, useCases]);

  const selectedRoute = routes[selectedRouteIndex] ?? null;

  const canConfirm =
    pickup !== null &&
    dropoff !== null &&
    routes.length > 0 &&
    selectedRoute !== null &&
    selectedRideServiceId !== null;

  const selectRoute = useCallback(
    (index: number) => setSelectedRouteIndex(index),
    [setSelectedRouteIndex],
  );

  const selectRideService = useCallback(
    (id: RideServiceId) => setSelectedRideServiceId(id),
    [setSelectedRideServiceId],
  );

  const setAvoidTolls = useCallback(
    (avoid: boolean) => setAvoidTollsStore(avoid),
    [setAvoidTollsStore],
  );

  const retry = useCallback(() => {
    // Bump the request id to invalidate any in-flight stale; the effect
    // will re-fire because we touch a ref-driven flag indirectly.
    requestIdRef.current += 1;
    setStatus('loading');
    setError(null);
    if (!pickup || !dropoff) return;
    void (async () => {
      const r = await useCases.computeRoutes.execute({
        origin: { coordinates: pickup.location },
        destination: { coordinates: dropoff.location },
        options: { alternatives: true, tolls: !avoidTolls },
      });
      if (!r.ok) {
        setStatus('error');
        setError(formatError(r.error));
        setRouteAlternatives([]);
        return;
      }
      setRouteAlternatives(r.value);
      setStatus('ready');
    })();
  }, [pickup, dropoff, avoidTolls, useCases, setRouteAlternatives]);

  const confirm = useCallback((): boolean => {
    if (!canConfirm) return false;
    // Phase 3 turn 2 stops here. Turn 3.3 will navigate to RideMonitor
    // after calling CreateRide; the trip-draft state is already where it
    // needs to be for that to work.
    logger.info('confirm: trip draft ready for CreateRide', {
      selectedRouteIndex,
      selectedRideServiceId: String(selectedRideServiceId),
    });
    return true;
  }, [canConfirm, selectedRouteIndex, selectedRideServiceId]);

  return {
    status,
    error,
    pickup,
    dropoff,
    routes,
    selectedRouteIndex,
    selectedRoute,
    services,
    selectedRideServiceId,
    fareById,
    avoidTolls,
    canConfirm,
    selectRoute,
    selectRideService,
    setAvoidTolls,
    retry,
    confirm,
  };
}

function formatError(e: DomainError): string {
  switch (e.kind) {
    case 'network':
      return 'Network problem — check your connection and try again.';
    case 'not_found':
      return "We couldn't find a drivable route between those points.";
    case 'validation':
      return e.message;
    default:
      return 'Something went wrong while planning your route.';
  }
}
