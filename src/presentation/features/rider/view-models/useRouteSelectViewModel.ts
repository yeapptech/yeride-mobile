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
import { formatScheduleDateTime } from '@shared/datetime/formatScheduleDateTime';
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
   * Scheduled-pickup state — when set, the next `confirm()` produces a
   * `'scheduled'` ride and the screen navigates to
   * RideScheduledConfirmation instead of RideMonitor.
   *
   *   - `scheduledPickupAt`: the rider-picked future pickup datetime, or
   *     `null` when no schedule (default "now" ride).
   *   - `setScheduledPickupAt`: pass `null` to clear, a `Date` to set
   *     (the picker invokes this on schedule).
   *   - `formattedSchedulePickupAt`: pre-rendered display string for the
   *     RouteSelect schedule row + RideScheduledConfirmation; `null`
   *     mirrors `scheduledPickupAt === null`.
   *
   * Phase 10 turn 7.
   */
  readonly scheduledPickupAt: Date | null;
  readonly formattedSchedulePickupAt: string | null;
  setScheduledPickupAt: (at: Date | null) => void;
  /**
   * Build a Ride from the trip-draft state, mint an id via the repo, and
   * persist via `useCreateRideMutation`. Resolves to `null` if the
   * draft was incomplete / submission failed (error via
   * `submitError`).
   *
   * On success the tagged return shape lets the screen pick the
   * navigation target: `isScheduled: true` →
   * RideScheduledConfirmation; `false` → RideMonitor (legacy parity).
   * Phase 10 turn 7 Decision 5 (a).
   *
   * `formattedSchedulePickupAt` and `pickupAddress` are populated on
   * the scheduled branch (and only on the scheduled branch) so the
   * screen can navigate to the confirmation surface using a typed
   * return value rather than reading off the view-model after
   * `reset()` has cleared the trip-draft store. Both are non-null
   * on success when `isScheduled === true`.
   */
  confirm: () => Promise<
    | {
        rideId: RideId;
        isScheduled: false;
      }
    | {
        rideId: RideId;
        isScheduled: true;
        formattedSchedulePickupAt: string;
        pickupAddress: string | null;
      }
    | null
  >;
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
  const scheduledPickupAt = useTripDraftStore((s) => s.scheduledPickupAt);
  const setScheduledPickupAtStore = useTripDraftStore(
    (s) => s.setScheduledPickupAt,
  );

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

  const confirm = useCallback(async (): Promise<
    | {
        rideId: RideId;
        isScheduled: false;
      }
    | {
        rideId: RideId;
        isScheduled: true;
        formattedSchedulePickupAt: string;
        pickupAddress: string | null;
      }
    | null
  > => {
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

    // Phase 10 turn 10: hard-block trip creation when the rider has no
    // default payment method. Without one, the server-side
    // `processPaymentForTrip` calls `/direct-charge` with
    // `paymentMethodId: undefined` and yeride-stripe-server returns 400.
    // The failure surfaces to the rider as an opaque
    // `cf_<op>_internal` NetworkError on `completeTrip` / `tipDriver`,
    // long after they've taken the ride. Better to fail at the only
    // moment where they can actually fix it. Earlier (Phase 9 turn 4)
    // this was a soft `LOG.warn` for "legacy permissive UX" parity —
    // production observation showed it was just hiding a class of
    // payment failures the rider couldn't diagnose.
    if (user.role === 'rider' && user.defaultPaymentMethodId === null) {
      logger.warn('confirm: blocked — rider has no default payment method', {
        userId: String(user.id),
      });
      setSubmitError(
        'Add a payment method before requesting a trip — open Wallet to add a card.',
      );
      return null;
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
      // Phase 9 turn 4: bake BOTH the rider's Stripe customer id and the
      // default payment method (as an `{id, type}` object) into the trip
      // snapshot. The deployed `processPaymentForTrip` validator reads
      // `passenger.stripeCustomerId` and `passenger.defaultPaymentMethod
      // .{id,type}` directly off the trip doc; without them, fare /
      // cancellation-fee / tip charges all fail. `type: 'card'` is the
      // only branch the rewrite produces today (cash rides aren't
      // supported yet); legacy yeride writes either.
      stripeCustomerId: user.role === 'rider' ? user.stripeCustomerId : null,
      defaultPaymentMethod:
        user.role === 'rider' && user.defaultPaymentMethodId !== null
          ? { id: user.defaultPaymentMethodId, type: 'card' as const }
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
    //
    // Capture the schedule-display strings + pickup address BEFORE the
    // mutation completes — `reset()` clears the trip-draft store on
    // success and the view-model's memoised formatters then resolve to
    // null. Returning these in the result lets the screen navigate
    // without depending on stale-closure semantics over `vm.*`.
    const isScheduled = scheduledPickupAt !== null;
    const formattedSchedulePickupAtSnapshot = isScheduled
      ? formatScheduleDateTime(scheduledPickupAt)
      : null;
    const pickupAddressSnapshot = pickup.address;
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
        // When the rider picked a future pickup time, the CreateRide
        // use case routes through `Ride.createScheduled` (status =
        // 'scheduled', schedulePickupAt populated). When null the
        // legacy default path produces an `awaiting_driver` ride.
        scheduledPickupAt,
      });
      reset();
      logger.info('confirm: ride created', {
        rideId: String(ride.id),
        isScheduled,
      });
      if (isScheduled && formattedSchedulePickupAtSnapshot !== null) {
        return {
          rideId: ride.id,
          isScheduled: true,
          formattedSchedulePickupAt: formattedSchedulePickupAtSnapshot,
          pickupAddress: pickupAddressSnapshot,
        };
      }
      return { rideId: ride.id, isScheduled: false };
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
    scheduledPickupAt,
  ]);

  const setScheduledPickupAt = useCallback(
    (at: Date | null) => setScheduledPickupAtStore(at),
    [setScheduledPickupAtStore],
  );

  const formattedSchedulePickupAt = useMemo<string | null>(
    () =>
      scheduledPickupAt !== null
        ? formatScheduleDateTime(scheduledPickupAt)
        : null,
    [scheduledPickupAt],
  );

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
    scheduledPickupAt,
    formattedSchedulePickupAt,
    setScheduledPickupAt,
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
