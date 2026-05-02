import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Endpoint } from '@domain/entities/Endpoint';
import type { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import type { RideId } from '@domain/entities/RideId';
import type { RideService } from '@domain/entities/RideService';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { Route } from '@domain/entities/Route';
import type { DomainError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  useCurrentUserQuery,
  useCreateRideMutation,
} from '@presentation/queries';
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
  /** True while `confirm()` is in flight (CreateRide pending). */
  readonly isSubmitting: boolean;
  /** Last submission error, surfaced as a friendly string. */
  readonly submitError: string | null;
  /**
   * Build a Ride from the trip-draft state, mint an id via the repo, and
   * persist via `useCreateRideMutation`. Resolves to the new RideId on
   * success or `null` if the draft was incomplete / submission failed
   * (the error is exposed via `submitError`). The screen navigates to
   * RideMonitor on success.
   */
  confirm: () => Promise<RideId | null>;
}

const COMPUTE_DEBOUNCE_MS = 300;

export function useRouteSelectViewModel(): UseRouteSelectViewModel {
  const useCases = useUseCases();
  const navigation = useNavigation<RiderStackNavigation>();

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

  const currentUserQuery = useCurrentUserQuery();
  const createRideMutation = useCreateRideMutation();
  const reset = useTripDraftStore((s) => s.reset);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const confirm = useCallback(async (): Promise<RideId | null> => {
    setSubmitError(null);
    if (!canConfirm) return null;
    if (!pickup || !dropoff || !selectedRoute || !selectedRideServiceId) {
      // canConfirm narrows these but TS can't see across closures.
      return null;
    }

    const user = currentUserQuery.data;
    if (!user) {
      setSubmitError('Your profile is still loading — try again in a moment.');
      return null;
    }
    if (!user.phone) {
      setSubmitError(
        'Add a phone number on your profile so the driver can reach you.',
      );
      return null;
    }

    // Known schema gap (deferred to Phase 6 / Phase 9 polish): the
    // deployed Cloud Functions (`completeTrip`, `cancelTrip`,
    // `tipDriver` via `processPaymentForTrip` →
    // `validateTripDataForPayment`) read two passenger fields that this
    // snapshot doesn't yet carry in the right shape:
    //
    //   - `passenger.stripeCustomerId`         — server-side validator
    //     requires it; `PassengerSnapshot` doesn't include it (yet).
    //   - `passenger.defaultPaymentMethod.{id,type}` — the function
    //     reads it as an OBJECT (cash check + Stripe `paymentMethodId`),
    //     but this snapshot writes it as a bare id string.
    //
    // Without these, server-side payment processing fails with
    // `HttpsError("internal", "Missing required payment data: …")`,
    // which the client maps to NetworkError → "Connection trouble" copy.
    // See the legacy `yeride/src/context/UserContext.js` `getPassenger`
    // for the legacy wire shape we need to match.
    //
    // Until that domain change lands, log loudly at trip creation when
    // the fields are unresolvable so the gap is visible in logs (and in
    // dev consoles) BEFORE the rider hits the payment surface.
    if (user.role === 'rider') {
      if (user.stripeCustomerId === null) {
        logger.warn(
          'confirm: rider has no stripeCustomerId — server-side payment ' +
            'processing will fail (tipDriver, completeTrip, cancelTrip). ' +
            'Domain fix pending: PassengerSnapshot needs stripeCustomerId.',
          { userId: String(user.id) },
        );
      }
      if (user.defaultPaymentMethodId === null) {
        logger.warn(
          'confirm: rider has no default payment method — server-side ' +
            'payment processing will fail. Rider should add a card before ' +
            'requesting a trip.',
          { userId: String(user.id) },
        );
      } else {
        // Even with an id we know the wire format is wrong: the function
        // reads `defaultPaymentMethod.type` and `.id`, not a bare string.
        // Keep a single warn at trip-creation rather than once per
        // server call so the gap is visible without spamming.
        logger.warn(
          'confirm: defaultPaymentMethod is being written as a bare id ' +
            'string but the deployed Cloud Function expects an object ' +
            '{id, type, ...}. Domain fix pending: PassengerSnapshot + ' +
            'RideDoc passenger schema.',
          { userId: String(user.id) },
        );
      }
    }

    const passengerR = PassengerSnapshot.create({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phone,
      // Phase 9 turn 2 sub-turn 2a: bake the rider's current push token
      // into the trip snapshot so the deployed
      // `yeride-functions/handlers/trip-event-created.js` can address
      // notifications via `tripData.passenger.pushToken` (driver
      // dispatched / arrived / payment events). `null` until the
      // `RegisterPushToken` use case (sub-turn 2b) writes the token to
      // the user doc; at that point new trip creates start picking it up
      // here. Existing in-flight trips don't see the token retroactively
      // — the legacy app has the same limitation (snapshot is captured
      // at creation, not resolved live).
      pushToken: user.pushToken !== null ? String(user.pushToken) : null,
      avatarUrl: user.avatarUrl,
      // Phase 6 turn 2: bake the rider's default payment method id into
      // the trip snapshot so the server-side `completeTrip` Cloud
      // Function knows which card to charge. `String(...)` strips the
      // brand for the legacy wire-format storage.
      //
      // KNOWN GAP: the deployed Cloud Function actually reads this as
      // an object with `.id` and `.type` (cash detection + Stripe call).
      // See the warn block above. Domain fix tracked for the next
      // Phase 6 polish turn.
      defaultPaymentMethod:
        user.role === 'rider' && user.defaultPaymentMethodId !== null
          ? String(user.defaultPaymentMethodId)
          : null,
    });
    if (!passengerR.ok) {
      logger.error('confirm: passenger snapshot failed', passengerR.error);
      setSubmitError('Could not build your trip — try again.');
      return null;
    }

    const tier = services.find((s) => s.id === selectedRideServiceId);
    if (!tier) {
      setSubmitError('Selected ride service is no longer available.');
      return null;
    }
    const tierR = RideServiceSnapshot.create({
      id: tier.id,
      name: tier.name,
      baseFare: tier.baseFare,
      minimumFare: tier.minimumFare,
      cancelationFee: tier.cancelationFee,
      costPerKm: tier.costPerKm,
      costPerMinute: tier.costPerMinute,
      seatCapacity: tier.seatCapacity,
    });
    if (!tierR.ok) {
      logger.error('confirm: ride-service snapshot failed', tierR.error);
      setSubmitError('Could not build your trip — try again.');
      return null;
    }

    // Bake the selected route's directions into the dropoff endpoint so
    // the trip carries the route the rider chose, and so the driver's UI
    // can replay it via `routeToken` at dispatch time.
    try {
      const ride = await createRideMutation.mutateAsync({
        passenger: passengerR.value,
        rideService: tierR.value,
        // `withDirections` returns a fresh Endpoint with the selected
        // route attached; pickup directions (driver → pickup) are unset
        // until dispatch.
        pickup,
        dropoff: dropoff.withDirections(selectedRoute),
        createdAt: new Date(),
        routePreference: {
          avoidTolls,
          selectedRouteSummary: selectedRoute.description || null,
          routeToken: selectedRoute.routeToken,
        },
      });
      reset();
      logger.info('confirm: ride created', { rideId: String(ride.id) });
      return ride.id;
    } catch (e: unknown) {
      logger.error('confirm: createRide failed', e);
      setSubmitError(
        e instanceof Error
          ? e.message
          : 'Could not start your ride — please try again.',
      );
      return null;
    }
  }, [
    canConfirm,
    pickup,
    dropoff,
    selectedRoute,
    selectedRideServiceId,
    services,
    avoidTolls,
    currentUserQuery.data,
    createRideMutation,
    reset,
  ]);

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
    isSubmitting: createRideMutation.isPending,
    submitError,
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
