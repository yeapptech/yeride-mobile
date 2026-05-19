import {
  NavigationSessionStatus,
  RouteStatus,
  TravelMode,
  type ArrivalEvent as SdkArrivalEvent,
  type NavigationController,
  type SetDestinationsOptions,
  type TimeAndDistance as SdkTimeAndDistance,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk';

import { Coordinates } from '@domain/entities/Coordinates';
import { AuthorizationError, NetworkError } from '@domain/errors';
import type {
  NavArrivalEvent,
  NavInitError,
  NavigationListenerSetters,
  NavigationService,
  NavRouteStatus,
  NavSetDestinationsArgs,
  NavTermsResult,
  NavTimeAndDistance,
  NavWaypoint,
} from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('NavigationSdk');

/**
 * Single seam between the rewrite and `@googlemaps/react-native-navigation-sdk`
 * (Phase 8 turn 1).
 *
 * Why an adapter instead of importing the SDK directly:
 *
 *   - The SDK's primary surface is a React hook (`useNavigationController`)
 *     that returns a `NavigationController` plus a bag of setter functions
 *     (`setOnArrival`, …). Wrapping it in a domain-shaped facade keeps the
 *     SDK's lifecycle out of every view-model and lets the rest of the
 *     codebase (`useDriverNavigationViewModel` in Turn 2) consume a stable
 *     async + Result-returning API.
 *
 *   - The SDK throws on transient failures (network, terms-not-accepted at
 *     startGuidance time, etc.); we catch at this boundary and map to
 *     `NetworkError` / `AuthorizationError` so the use cases stay in the
 *     project's "no expected throws" pattern.
 *
 *   - `NavigationSessionStatus` (returned by `init()`) and `RouteStatus`
 *     (returned by `setDestinations()`) are string enums with multiple
 *     non-OK values that aren't infrastructure errors so much as domain
 *     outcomes (e.g. NO_ROUTE_FOUND ≠ network problem). The adapter
 *     translates them into our own tagged unions and surfaces them via
 *     `Result.ok` (per Phase 8 kickoff decision 2).
 *
 * Controller injection seam:
 *
 *   The SDK's `useNavigationController` hook is React-tied, but our
 *   adapter is plain class-based. The presentation-layer glue
 *   (Turn 2 — a small connector hook mounted by `DriverNavigationScreen`)
 *   calls `useNavigationController` and pushes the result into this adapter
 *   via `setController({controller, listeners})`. On unmount, the connector
 *   calls `setController({controller: null, listeners: null})`.
 *
 *   Methods invoked while no controller is connected return
 *   `Result.err(NetworkError({code: 'navigation_sdk_not_connected'}))` so
 *   misuse is loud rather than silent.
 *
 * Listener pattern (subscribeToArrival):
 *
 *   The SDK's `setOnArrival` is a single-slot setter — calling it twice
 *   replaces the callback. Our `subscribeToArrival` exposes a
 *   multi-subscriber facade by:
 *     1. Holding a `Set<callback>` of all subscribers.
 *     2. Registering ONE underlying SDK listener when the first subscriber
 *        joins, fanning the event out to every subscriber.
 *     3. Clearing the SDK listener (`setOnArrival(null)`) when the last
 *        subscriber leaves.
 *
 *   Listener-level dedup (mirrors `BackgroundGeolocationClient`) collapses
 *   duplicate fires by `(timestampMs, isFinal)` — the SDK can emit twice
 *   on iOS/Android boundary transitions.
 */

/* ───── Adapter ───── */

/**
 * Internal SDK-typed counterpart to the domain
 * `NavigationListenerSetters` (which uses `(event: unknown) => void`
 * for the callback so the domain layer doesn't import SDK types).
 *
 * The adapter narrows the listener bag passed via `setController` to
 * this shape so internal calls like `this.listeners.setOnArrival(this.handleArrival)`
 * typecheck cleanly against the SDK's `SdkArrivalEvent` callback
 * signature.
 */
type SdkNavigationListenerSetters = {
  setOnArrival: (callback: ((event: SdkArrivalEvent) => void) | null) => void;
  /**
   * Phase 10 turn 5 — SDK-typed counterpart to the domain
   * `NavigationListenerSetters.setOnRemainingTimeOrDistanceChanged`.
   * Same single-slot-setter shape as `setOnArrival`; the adapter
   * holds a multi-subscriber facade on top.
   */
  setOnRemainingTimeOrDistanceChanged: (
    callback: ((event: SdkTimeAndDistance) => void) | null,
  ) => void;
};

export class NavigationSdkClient implements NavigationService {
  /**
   * The currently-connected SDK controller, set by `setController`. Null
   * when no `<NavigationProvider/>`-rooted component is mounted (i.e. the
   * driver isn't on a navigation surface).
   */
  private controller: NavigationController | null = null;

  /**
   * The subset of the SDK's listener-setters bag we register listeners
   * against. Held alongside the controller so we can re-apply the
   * underlying SDK listener if the controller changes mid-subscription
   * (e.g. React re-render). Typed with the SDK-narrow shape (not the
   * domain `NavigationListenerSetters`) so internal calls keep their
   * `SdkArrivalEvent` type info.
   */
  private listeners: SdkNavigationListenerSetters | null = null;

  /** Multi-subscriber facade over the SDK's single-slot setOnArrival. */
  private arrivalCallbacks = new Set<(event: NavArrivalEvent) => void>();

  /** Most-recent arrival dedup key. Cleared on `cleanup()` / disconnect. */
  private lastArrivalKey: string | null = null;

  /** True once we've registered our internal handler with `setOnArrival`. */
  private sdkArrivalListenerActive = false;

  /**
   * Phase 10 turn 5 — multi-subscriber facade over the SDK's
   * single-slot `setOnRemainingTimeOrDistanceChanged`. Mirrors the
   * arrival listener pattern: register ONE internal handler against
   * the SDK on first subscribe, fan out to all subscribers, clear
   * the SDK listener when the last subscriber leaves.
   */
  private timeDistanceCallbacks = new Set<
    (event: NavTimeAndDistance) => void
  >();

  /**
   * Most-recent time/distance dedup key (`${meters}:${seconds}`).
   * The SDK fires repeatedly with identical values during standstill;
   * the dedup keeps subscriber traffic proportional to actual change
   * (matches legacy `distanceTrackingService` behaviour). Cleared on
   * `cleanup()` / disconnect / last unsubscribe.
   */
  private lastTimeDistanceKey: string | null = null;

  /** True once we've registered our internal handler with the SDK. */
  private sdkTimeDistanceListenerActive = false;

  /**
   * Connect the SDK's NavigationController + listener setters to this
   * adapter. Pass `controller: null` + `listeners: null` to disconnect
   * on the consumer's unmount.
   *
   * If callers re-connect with subscribers already registered (component
   * re-mount with persistent subscriptions), the underlying SDK listener
   * is re-applied to the new controller.
   */
  setController(args: {
    controller: unknown;
    listeners: NavigationListenerSetters | null;
  }): void {
    // Narrow the domain-relaxed types to the SDK shapes the adapter
    // works against internally. The connector hook
    // (`useNavigationSdkConnector`) pushes the SDK's
    // `useNavigation()` return value through here verbatim, so
    // structurally these casts are exact.
    const newController = args.controller as NavigationController | null;
    const newListeners = args.listeners as SdkNavigationListenerSetters | null;

    // Clear the SDK listener on the OLD controller before swapping —
    // otherwise the old controller will keep firing into our handler if
    // the SDK retains the reference.
    if (
      this.sdkArrivalListenerActive &&
      this.listeners &&
      this.listeners !== newListeners
    ) {
      this.listeners.setOnArrival(null);
      this.sdkArrivalListenerActive = false;
    }
    // Phase 10 turn 5 — mirror the arrival listener swap for the
    // time/distance listener.
    if (
      this.sdkTimeDistanceListenerActive &&
      this.listeners &&
      this.listeners !== newListeners
    ) {
      this.listeners.setOnRemainingTimeOrDistanceChanged(null);
      this.sdkTimeDistanceListenerActive = false;
    }

    this.controller = newController;
    this.listeners = newListeners;

    // Re-register on the new listener bag if we still have subscribers.
    if (
      this.controller &&
      this.listeners &&
      this.arrivalCallbacks.size > 0 &&
      !this.sdkArrivalListenerActive
    ) {
      this.listeners.setOnArrival(this.handleArrival);
      this.sdkArrivalListenerActive = true;
    }
    // Phase 10 turn 5 — same for the time/distance listener.
    if (
      this.controller &&
      this.listeners &&
      this.timeDistanceCallbacks.size > 0 &&
      !this.sdkTimeDistanceListenerActive
    ) {
      this.listeners.setOnRemainingTimeOrDistanceChanged(
        this.handleTimeAndDistance,
      );
      this.sdkTimeDistanceListenerActive = true;
    }
  }

  /**
   * Initialize the navigation session. Maps the SDK's
   * `NavigationSessionStatus` to a domain-shaped Result.
   *
   *   - `OK` → `Result.ok(true)`
   *   - `TERMS_NOT_ACCEPTED` → `Result.err(AuthorizationError({code:
   *     'navigation_terms_not_accepted'}))` so the VM's `terms_pending`
   *     arm can fire.
   *   - `NOT_AUTHORIZED` → `AuthorizationError({code:
   *     'navigation_api_not_authorized'})` — Cloud Console hasn't
   *     enabled the Navigation SDK API for this project.
   *   - `LOCATION_PERMISSION_MISSING` → `AuthorizationError({code:
   *     'navigation_location_permission_missing'})`.
   *   - `NETWORK_ERROR` → `NetworkError({code:
   *     'navigation_init_network_error'})`.
   *   - `UNKNOWN_ERROR` and any other status → `NetworkError({code:
   *     'navigation_init_unknown_error'})`.
   */
  async init(): Promise<Result<true, NavInitError>> {
    if (!this.controller) {
      return Result.err(
        new NetworkError({
          code: 'navigation_sdk_not_connected',
          message:
            'NavigationSdkClient.init called without a connected controller',
        }),
      );
    }
    try {
      const status = await this.controller.init();
      return mapInitStatus(status);
    } catch (e) {
      logger.error('init threw', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_init_failed',
          message: 'Navigation SDK init threw',
          cause: e,
        }),
      );
    }
  }

  /**
   * Show the SDK's terms-and-conditions dialog. Returns
   * `Result.ok({accepted})` for both paths. `accepted: false` means the
   * user explicitly tapped Cancel; the caller should NOT progress to
   * `init()` until the user accepts.
   *
   * SDK throws → `NetworkError`. Calling this with no controller is the
   * same misuse signal as the other methods.
   */
  async showTermsAndConditionsDialog(): Promise<
    Result<NavTermsResult, NetworkError>
  > {
    if (!this.controller) {
      return Result.err(
        new NetworkError({
          code: 'navigation_sdk_not_connected',
          message:
            'NavigationSdkClient.showTermsAndConditionsDialog called without a connected controller',
        }),
      );
    }
    try {
      const accepted = await this.controller.showTermsAndConditionsDialog();
      return Result.ok({ accepted });
    } catch (e) {
      logger.error('showTermsAndConditionsDialog threw', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_terms_dialog_failed',
          message: 'Could not show terms & conditions dialog',
          cause: e,
        }),
      );
    }
  }

  /**
   * Set destinations + return the SDK's `RouteStatus` mapped to our
   * tagged union. Per kickoff decision 2, non-OK statuses come back as
   * `Result.ok(<status>)` because they're domain outcomes (the caller
   * branches on which one to surface — a "no route found" UX differs
   * from a "network down" UX).
   *
   * SDK throws → `Result.err(NetworkError)` (the throw indicates the
   * call itself failed, not that the route calculation reported a
   * domain error code).
   */
  async setDestinations(
    args: NavSetDestinationsArgs,
  ): Promise<Result<NavRouteStatus, NetworkError>> {
    if (!this.controller) {
      return Result.err(
        new NetworkError({
          code: 'navigation_sdk_not_connected',
          message:
            'NavigationSdkClient.setDestinations called without a connected controller',
        }),
      );
    }
    if (args.waypoints.length === 0) {
      return Result.err(
        new NetworkError({
          code: 'navigation_setdestinations_empty_waypoints',
          message: 'setDestinations called with no waypoints',
        }),
      );
    }
    const sdkWaypoints: Waypoint[] = args.waypoints.map(toSdkWaypoint);
    const sdkOptions = buildSetDestinationsOptions(args);
    try {
      const status = await this.controller.setDestinations(
        sdkWaypoints,
        sdkOptions,
      );
      return Result.ok(mapRouteStatus(status));
    } catch (e) {
      logger.error('setDestinations threw', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_setdestinations_failed',
          message: 'Could not set destinations',
          cause: e,
        }),
      );
    }
  }

  async startGuidance(): Promise<Result<true, NetworkError>> {
    if (!this.controller) {
      return Result.err(
        new NetworkError({
          code: 'navigation_sdk_not_connected',
          message:
            'NavigationSdkClient.startGuidance called without a connected controller',
        }),
      );
    }
    try {
      await this.controller.startGuidance();
      return Result.ok(true);
    } catch (e) {
      logger.error('startGuidance threw', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_start_guidance_failed',
          message: 'Could not start guidance',
          cause: e,
        }),
      );
    }
  }

  /**
   * Idempotent — calling stopGuidance without an active session is a
   * no-op on the SDK side. We catch the throw defensively just in case.
   */
  async stopGuidance(): Promise<Result<true, NetworkError>> {
    if (!this.controller) {
      // No controller = nothing to stop. Treat as success rather than
      // surfacing a misuse error: callers may invoke this in cleanup
      // paths after the controller has already been disconnected.
      return Result.ok(true);
    }
    try {
      await this.controller.stopGuidance();
      return Result.ok(true);
    } catch (e) {
      // Phase 9 turn 15 — flipped from LOG.warn to LOG.error so the
      // rawMeta channel fans this out to `recordError`. A teardown
      // failure indicates a stale-controller bug (e.g. SDK internal
      // state racing with React Navigation's screen unmount); making
      // it visible to Crashlytics surfaces real bugs that would
      // otherwise be masked by the next session boot. The standalone
      // path's caller still sees the wrapped `NetworkError` via the
      // returned Result.err — flipping the breadcrumb here adds
      // telemetry coverage for the cleanup-internal call site (L428)
      // where no Result-channel telemetry exists. `e` is already a
      // real `Error` from the rejected SDK Promise, so reference
      // identity flows directly through the rawMeta channel without
      // a constructed-Error wrapper. VM-side teardown logs at
      // `useDriverNavigationViewModel.ts` L296 stay at `LOG.warn`
      // (which doesn't fan out to recordError), so flipping here
      // does NOT create a duplicate Crashlytics report today —
      // the adapter↔VM duplicate-noise tradeoff Turn 9 documented
      // doesn't apply.
      logger.error('stopGuidance threw — swallowing', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_stop_guidance_failed',
          message: 'Could not stop guidance',
          cause: e,
        }),
      );
    }
  }

  /**
   * Release SDK resources. Calls `stopGuidance` first (defensively,
   * tolerating throws from either step) then `cleanup()` on the
   * controller. Clears all subscribers and dedup state.
   *
   * Idempotent; safe to call after disconnect (returns Result.ok).
   */
  async cleanup(): Promise<Result<true, NetworkError>> {
    // Tear down our internal subscriber registry first, regardless of
    // whether we have a live controller. This prevents leaks if the
    // consumer disconnected the controller before calling cleanup.
    this.arrivalCallbacks.clear();
    this.lastArrivalKey = null;
    if (this.sdkArrivalListenerActive && this.listeners) {
      try {
        this.listeners.setOnArrival(null);
      } catch (e) {
        // Phase 9 turn 15 — flipped from LOG.warn to LOG.error so the
        // rawMeta channel fans this out to `recordError`. The
        // listener-removal failure is intentionally NOT propagated up
        // (the surrounding `cleanup()` continues to teardown the
        // controller below); without telemetry the only signal of a
        // failed listener-detach is leaked SDK state on the next
        // session boot. `e` is already a real `Error` from the
        // rejected SDK call, so reference identity flows directly
        // through the rawMeta channel.
        logger.error('cleanup: setOnArrival(null) threw — swallowing', e);
      }
      this.sdkArrivalListenerActive = false;
    }
    // Phase 10 turn 5 — symmetric teardown for the time/distance
    // listener. Same swallow-but-LOG.error pattern.
    this.timeDistanceCallbacks.clear();
    this.lastTimeDistanceKey = null;
    if (this.sdkTimeDistanceListenerActive && this.listeners) {
      try {
        this.listeners.setOnRemainingTimeOrDistanceChanged(null);
      } catch (e) {
        logger.error(
          'cleanup: setOnRemainingTimeOrDistanceChanged(null) threw — swallowing',
          e,
        );
      }
      this.sdkTimeDistanceListenerActive = false;
    }

    if (!this.controller) {
      return Result.ok(true);
    }
    // stopGuidance first; if the SDK throws here we still want to try
    // cleanup() so the failure on stop doesn't strand the session.
    try {
      await this.controller.stopGuidance();
    } catch (e) {
      // Phase 9 turn 15 — flipped from LOG.warn to LOG.error so the
      // rawMeta channel fans this out to `recordError`. This is the
      // cleanup-internal stopGuidance call: the failure is
      // intentionally swallowed (we continue to `controller.cleanup()`
      // below so a hung stop doesn't strand the session), so this LOG
      // is the ONLY telemetry channel — there is no Result.err for the
      // caller to inspect. `e` is already a real `Error` from the
      // rejected SDK Promise; reference identity flows through rawMeta
      // directly. The post-Result-err catch on
      // `controller.cleanup()` (L434) already logs at error and is the
      // sibling site for the second leg of teardown.
      logger.error('cleanup: stopGuidance threw — continuing to cleanup', e);
    }
    try {
      await this.controller.cleanup();
      return Result.ok(true);
    } catch (e) {
      logger.error('cleanup: controller.cleanup() threw', e);
      return Result.err(
        new NetworkError({
          code: 'navigation_cleanup_failed',
          message: 'Could not clean up navigation session',
          cause: e,
        }),
      );
    }
  }

  /**
   * Subscribe to arrival events. Multiple callers register against ONE
   * underlying SDK listener; the SDK fires once per arrival but we
   * dedup `(timestampMs, isFinal)` defensively in case the
   * listener is double-applied across re-renders. Returns a synchronous
   * disposer; removing the LAST subscriber clears the SDK listener so
   * the SDK doesn't keep firing into the void.
   *
   * If no controller is connected at the time of subscription, the
   * subscriber is recorded and the SDK listener is registered on the
   * next `setController(controller)` call. This lets the consumer
   * subscribe before the navigation screen mounts (Turn 2 will use this).
   */
  subscribeToArrival(callback: (event: NavArrivalEvent) => void): () => void {
    this.arrivalCallbacks.add(callback);
    if (!this.sdkArrivalListenerActive && this.listeners && this.controller) {
      this.listeners.setOnArrival(this.handleArrival);
      this.sdkArrivalListenerActive = true;
    }
    return () => {
      this.arrivalCallbacks.delete(callback);
      if (
        this.arrivalCallbacks.size === 0 &&
        this.sdkArrivalListenerActive &&
        this.listeners
      ) {
        this.listeners.setOnArrival(null);
        this.sdkArrivalListenerActive = false;
        this.lastArrivalKey = null;
      }
    };
  }

  /**
   * Phase 10 turn 5 — subscribe to live time/distance telemetry. The
   * SDK fires `setOnRemainingTimeOrDistanceChanged` once per meaningful
   * change (and repeatedly during standstill with identical values —
   * the dedup below collapses those). Multi-subscriber facade is
   * identical in shape to `subscribeToArrival`: register ONE internal
   * handler against the SDK on first subscriber, fan out to N, clear
   * the SDK listener on last unsubscribe.
   *
   * If no controller is connected at the time of subscription, the
   * subscriber is recorded and the SDK listener is registered on the
   * next `setController(controller)` call.
   */
  subscribeToTimeAndDistance(
    callback: (event: NavTimeAndDistance) => void,
  ): () => void {
    this.timeDistanceCallbacks.add(callback);
    if (
      !this.sdkTimeDistanceListenerActive &&
      this.listeners &&
      this.controller
    ) {
      this.listeners.setOnRemainingTimeOrDistanceChanged(
        this.handleTimeAndDistance,
      );
      this.sdkTimeDistanceListenerActive = true;
    }
    return () => {
      this.timeDistanceCallbacks.delete(callback);
      if (
        this.timeDistanceCallbacks.size === 0 &&
        this.sdkTimeDistanceListenerActive &&
        this.listeners
      ) {
        this.listeners.setOnRemainingTimeOrDistanceChanged(null);
        this.sdkTimeDistanceListenerActive = false;
        this.lastTimeDistanceKey = null;
      }
    };
  }

  /* ───── Internal handlers ───── */

  private handleArrival = (event: SdkArrivalEvent): void => {
    const ts = Date.now();
    const isFinal = event.isFinalDestination ?? false;
    // Use placeId ?? coords ?? title to make the dedup key sensitive to
    // which waypoint arrived — back-to-back arrivals at different
    // waypoints (multi-stop trip; rare in YeRide today) shouldn't dedup.
    const wp = event.waypoint;
    const wpKey =
      wp.placeId ??
      (wp.position
        ? `${String(wp.position.lat)},${String(wp.position.lng)}`
        : (wp.title ?? ''));
    const key = `${wpKey}:${String(isFinal)}`;
    if (key === this.lastArrivalKey) return;
    this.lastArrivalKey = key;

    let coords: Coordinates | null = null;
    if (wp.position) {
      const c = Coordinates.create(wp.position.lat, wp.position.lng);
      coords = c.ok ? c.value : null;
    }
    const domainEvent: NavArrivalEvent = {
      title: wp.title ?? null,
      coords,
      placeId: wp.placeId ?? null,
      isFinalDestination: isFinal,
      timestampMs: ts,
    };
    for (const cb of [...this.arrivalCallbacks]) {
      try {
        cb(domainEvent);
      } catch (e) {
        // Phase 9 turn 12 — flipped from LOG.warn to LOG.error so the
        // rawMeta channel fans this out to `recordError`. A throwing
        // arrival subscriber is a domain-side bug (the registered
        // hook/VM callback threw inside the SDK fan-out); making it
        // visible to Crashlytics is the whole point. `e` here is
        // already a real `Error` from the synchronously-throwing
        // subscriber, so no constructed-Error wrapper is needed —
        // reference identity flows directly through to `recordError`
        // via `extractError(rawMeta ?? meta)`. Mirrors Turn 9's
        // BackgroundGeolocationClient L502/L547 flips verbatim. The
        // fan-out resilience invariant (one bad subscriber doesn't
        // take down the others) is preserved by the surrounding
        // for-loop's `try/catch`; the new telemetry just makes the
        // bug visible.
        logger.error('handleArrival: subscriber threw', e);
      }
    }
  };

  /**
   * Phase 10 turn 5 — translate SDK `TimeAndDistance` to the domain
   * shape and fan out to subscribers (deduped). SDK can fire with
   * negative `meters` / `seconds` when the destination is behind the
   * driver (rare, but possible during reroute) — coerced to 0.
   */
  private handleTimeAndDistance = (event: SdkTimeAndDistance): void => {
    const remainingMeters =
      Number.isFinite(event.meters) && event.meters > 0 ? event.meters : 0;
    const remainingSeconds =
      Number.isFinite(event.seconds) && event.seconds > 0 ? event.seconds : 0;
    const key = `${String(remainingMeters)}:${String(remainingSeconds)}`;
    if (key === this.lastTimeDistanceKey) return;
    this.lastTimeDistanceKey = key;

    const domainEvent: NavTimeAndDistance = {
      remainingMeters,
      remainingSeconds,
      timestampMs: Date.now(),
    };
    for (const cb of [...this.timeDistanceCallbacks]) {
      try {
        cb(domainEvent);
      } catch (e) {
        // Mirrors handleArrival's fan-out resilience + Crashlytics
        // visibility tradeoff. A throwing subscriber is a domain-side
        // bug worth a non-fatal report. The surrounding `try/catch`
        // keeps the other subscribers receiving the event.
        logger.error('handleTimeAndDistance: subscriber threw', e);
      }
    }
  };
}

/* ───── SDK ↔ domain mappers ───── */

function toSdkWaypoint(w: NavWaypoint): Waypoint {
  const out: Waypoint = {};
  if (w.title !== undefined) out.title = w.title;
  if (w.placeId !== undefined) out.placeId = w.placeId;
  if (w.coords) {
    out.position = { lat: w.coords.latitude, lng: w.coords.longitude };
  }
  if (w.preferSameSideOfRoad !== undefined) {
    out.preferSameSideOfRoad = w.preferSameSideOfRoad;
  }
  return out;
}

function buildSetDestinationsOptions(
  args: NavSetDestinationsArgs,
): SetDestinationsOptions {
  // Per SDK: routingOptions and routeTokenOptions are mutually exclusive;
  // routeToken wins when supplied (rider's route preference from
  // RoutesService). Display options stay constant for now — matches
  // legacy DriverNavigation behaviour.
  if (args.routeToken !== undefined) {
    return {
      routeTokenOptions: {
        routeToken: args.routeToken,
        travelMode: TravelMode.DRIVING,
      },
      displayOptions: { showDestinationMarkers: true },
    };
  }
  const routingOptions: SetDestinationsOptions['routingOptions'] = {
    travelMode: TravelMode.DRIVING,
    avoidFerries: args.avoidFerries ?? true,
    avoidTolls: args.avoidTolls ?? false,
  };
  if (args.avoidHighways !== undefined) {
    routingOptions.avoidHighways = args.avoidHighways;
  }
  return {
    routingOptions,
    displayOptions: { showDestinationMarkers: true },
  };
}

function mapRouteStatus(status: RouteStatus): NavRouteStatus {
  switch (status) {
    case RouteStatus.OK:
      return 'ok';
    case RouteStatus.NO_ROUTE_FOUND:
      return 'no_route_found';
    case RouteStatus.NETWORK_ERROR:
      return 'network_error';
    case RouteStatus.QUOTA_CHECK_FAILED:
      return 'quota_check_failed';
    case RouteStatus.ROUTE_CANCELED:
      return 'route_canceled';
    case RouteStatus.LOCATION_DISABLED:
      return 'location_disabled';
    case RouteStatus.LOCATION_UNKNOWN:
      return 'location_unknown';
    case RouteStatus.WAYPOINT_ERROR:
      return 'waypoint_error';
    case RouteStatus.INVALID_PLACE_ID:
      return 'invalid_place_id';
    case RouteStatus.DUPLICATE_WAYPOINTS_ERROR:
      return 'duplicate_waypoints_error';
    case RouteStatus.UNKNOWN:
      return 'unknown';
    default:
      // Forward-compat: unknown SDK enum value (older device, newer SDK
      // upgrade with new statuses) — surface as 'unknown' rather than
      // throwing.
      return 'unknown';
  }
}

function mapInitStatus(
  status: NavigationSessionStatus,
): Result<true, NavInitError> {
  switch (status) {
    case NavigationSessionStatus.OK:
      return Result.ok(true);
    case NavigationSessionStatus.TERMS_NOT_ACCEPTED:
      return Result.err(
        new AuthorizationError({
          code: 'navigation_terms_not_accepted',
          message: 'Navigation terms have not been accepted',
        }),
      );
    case NavigationSessionStatus.NOT_AUTHORIZED:
      return Result.err(
        new AuthorizationError({
          code: 'navigation_api_not_authorized',
          message:
            'Navigation SDK is not authorized for this API key — enable Navigation SDK in Cloud Console',
        }),
      );
    case NavigationSessionStatus.LOCATION_PERMISSION_MISSING:
      return Result.err(
        new AuthorizationError({
          code: 'navigation_location_permission_missing',
          message: 'Location permission is required for navigation',
        }),
      );
    case NavigationSessionStatus.NETWORK_ERROR:
      return Result.err(
        new NetworkError({
          code: 'navigation_init_network_error',
          message: 'Network error during Navigation SDK init',
        }),
      );
    case NavigationSessionStatus.UNKNOWN_ERROR:
    default:
      return Result.err(
        new NetworkError({
          code: 'navigation_init_unknown_error',
          message: `Navigation SDK init returned status: ${String(status)}`,
        }),
      );
  }
}
