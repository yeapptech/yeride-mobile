import type { Coordinates } from '../entities/Coordinates';
import type { AuthorizationError, NetworkError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over `@googlemaps/react-native-navigation-sdk`. The data
 * layer's `NavigationSdkClient` (Phase 8 turn 1) speaks the SDK directly;
 * the domain interface keeps presentation
 * (`useNavigationSdkConnector`, `useDriverNavigationViewModel`) free of
 * SDK imports.
 *
 * Why an adapter instead of importing the SDK directly:
 *
 *   - The SDK's primary surface is a React hook
 *     (`useNavigationController`) that returns a `NavigationController`
 *     plus a bag of setter functions (`setOnArrival`, …). Wrapping it
 *     in a domain-shaped facade keeps the SDK's lifecycle out of every
 *     view-model and lets the rest of the codebase
 *     (`useDriverNavigationViewModel`) consume a stable async +
 *     Result-returning API.
 *
 *   - The SDK throws on transient failures (network,
 *     terms-not-accepted at startGuidance time, etc.); the
 *     implementation catches at the boundary and maps to
 *     `NetworkError` / `AuthorizationError` so use cases stay in the
 *     project's "no expected throws" pattern.
 *
 *   - `NavigationSessionStatus` (returned by the SDK's `init()`) and
 *     `RouteStatus` (returned by `setDestinations()`) are string enums
 *     with multiple non-OK values that aren't infrastructure errors so
 *     much as domain outcomes (e.g. NO_ROUTE_FOUND ≠ network problem).
 *     The adapter translates them into the tagged unions defined here
 *     (`NavRouteStatus`, `NavInitError`).
 *
 * Controller injection seam:
 *
 *   The SDK's `useNavigationController` hook is React-tied, but the
 *   adapter is plain class-based. The presentation-layer connector
 *   (`useNavigationSdkConnector`, mounted by `DriverMonitorScreen`)
 *   calls `useNavigation()` and pushes the result into the adapter via
 *   `setController({controller, listeners})`. On unmount, the
 *   connector calls `setController({controller: null, listeners:
 *   null})`.
 *
 *   `controller` is typed as `unknown` here — the connector and the
 *   adapter both know the SDK's `NavigationController` shape, but the
 *   domain layer doesn't import SDK types. The adapter narrows
 *   internally with a cast.
 *
 *   Methods invoked while no controller is connected return
 *   `Result.err(NetworkError({code: 'navigation_sdk_not_connected'}))`
 *   so misuse is loud rather than silent.
 *
 * Listener pattern (subscribeToArrival):
 *
 *   The SDK's `setOnArrival` is a single-slot setter — calling it
 *   twice replaces the callback. The adapter exposes a
 *   multi-subscriber facade by holding a `Set<callback>` of all
 *   subscribers and registering ONE underlying SDK listener that fans
 *   out to every subscriber. Listener-level dedup collapses duplicate
 *   fires by `(waypointKey, isFinal)`.
 */

/* ───── Domain-shaped types exported to the rest of the codebase ───── */

/**
 * Mapped from the SDK's `RouteStatus` enum (string values like 'OK',
 * 'NO_ROUTE_FOUND', 'NETWORK_ERROR', …). Kept as a string-tagged union
 * so callers can branch on each case without importing the SDK enum.
 */
export type NavRouteStatus =
  | 'ok'
  | 'no_route_found'
  | 'network_error'
  | 'quota_check_failed'
  | 'route_canceled'
  | 'location_disabled'
  | 'location_unknown'
  | 'waypoint_error'
  | 'invalid_place_id'
  | 'duplicate_waypoints_error'
  | 'unknown';

/**
 * One-shot result of `init()`. Successful init resolves
 * `Result.ok(true)`; non-OK SDK statuses get mapped to
 * `AuthorizationError` (terms / API key / permission) or
 * `NetworkError` (transport).
 */
export type NavInitError = AuthorizationError | NetworkError;

/**
 * The arrival event domain shape. Coordinates are derived from the
 * waypoint's `position` if present, else `null` (SDK allows place-id-
 * only waypoints).
 */
export interface NavArrivalEvent {
  readonly title: string | null;
  readonly coords: Coordinates | null;
  readonly placeId: string | null;
  readonly isFinalDestination: boolean;
  /** Adapter-stamped event time; the SDK doesn't surface a server timestamp. */
  readonly timestampMs: number;
}

/**
 * Phase 10 turn 5 — live ETA telemetry from the SDK's
 * `setOnRemainingTimeOrDistanceChanged` callback. The SDK's
 * `TimeAndDistance` carries `meters: number` + `seconds: number` (both
 * may be negative when the destination is behind the driver — coerced
 * to 0 at the adapter boundary). The adapter stamps `timestampMs`
 * because the SDK doesn't surface a server timestamp.
 *
 * Domain consumers (rider VM, driver write path) treat these as the
 * authoritative live ETA. The driver-side write path throttles per
 * the legacy `distanceTrackingService` constants (30s min interval /
 * 50m min movement / 60s data staleness; NavSdk-fresh window 15s).
 */
export interface NavTimeAndDistance {
  /** Metres remaining to the next destination waypoint. Non-negative. */
  readonly remainingMeters: number;
  /** Seconds remaining to the next destination waypoint. Non-negative. */
  readonly remainingSeconds: number;
  /** Adapter-stamped event time. */
  readonly timestampMs: number;
}

/**
 * Domain shape of a single waypoint for `setDestinations`. Either
 * `placeId` or `coords` must be provided (matches the SDK's
 * `Waypoint` shape but in domain primitives).
 */
export interface NavWaypoint {
  readonly title?: string;
  readonly coords?: Coordinates;
  readonly placeId?: string;
  /** Forwarded to the SDK; defaults to right-side-of-road bias on Android. */
  readonly preferSameSideOfRoad?: boolean;
}

/**
 * Args to `setDestinations`. `routeToken` (rider-selected route from
 * the Routes API) wins over `routingOptions` when both are provided —
 * matches the SDK's `routeTokenOptions` vs. `routingOptions` mutual
 * exclusion.
 */
export interface NavSetDestinationsArgs {
  readonly waypoints: readonly NavWaypoint[];
  readonly routeToken?: string;
  readonly avoidTolls?: boolean;
  readonly avoidFerries?: boolean;
  readonly avoidHighways?: boolean;
}

export interface NavTermsResult {
  readonly accepted: boolean;
}

/**
 * The subset of `NavigationListenerSetters` the adapter consumes.
 *
 * The callback parameter is typed as `unknown` so the domain layer
 * doesn't import the SDK's `ArrivalEvent` type. The connector hook
 * passes the SDK's listener-setters bag through to the adapter, which
 * narrows internally — function-parameter contravariance makes this
 * structurally sound (the SDK's narrower-typed callback is assignable
 * to the unknown-typed slot).
 *
 * Method-syntax declaration (no property-form arrow) keeps the type
 * checker bivariant on the inner callback, which is necessary for
 * the adapter's internal `(event: SdkArrivalEvent) => void` handler
 * to be assignable.
 */
export interface NavigationListenerSetters {
  setOnArrival(callback: ((event: unknown) => void) | null): void;
  /**
   * Phase 10 turn 5 — single-slot setter for the SDK's
   * `setOnRemainingTimeOrDistanceChanged`. The adapter narrows
   * internally; same `unknown`-typed-callback pattern as `setOnArrival`
   * so the domain layer doesn't import the SDK's `TimeAndDistance`
   * type. Method-syntax declaration keeps the type checker bivariant
   * on the inner callback (necessary for the adapter's internal
   * SDK-typed handler to be assignable).
   */
  setOnRemainingTimeOrDistanceChanged(
    callback: ((event: unknown) => void) | null,
  ): void;
}

/**
 * Domain interface for the Google Navigation SDK seam. The data-layer
 * `NavigationSdkClient` and the in-memory `FakeNavigationSdkClient`
 * both `implements` this interface, so `Container.navigationSdk` is
 * typed as `NavigationService` (no `Real | Fake` union leakage into
 * the presentation layer).
 */
export interface NavigationService {
  /**
   * Connect the SDK's NavigationController + listener setters. Pass
   * `controller: null` + `listeners: null` to disconnect on the
   * consumer's unmount.
   *
   * `controller` is `unknown` so the domain layer doesn't import the
   * SDK's `NavigationController` type. The data-layer adapter narrows
   * internally with a cast; the fake ignores the controller entirely
   * (its public methods don't depend on a connected one).
   */
  setController(args: {
    controller: unknown;
    listeners: NavigationListenerSetters | null;
  }): void;

  /**
   * Initialize the navigation session. Maps the SDK's
   * `NavigationSessionStatus` to a domain-shaped Result:
   *
   *   - `OK` → `Result.ok(true)`
   *   - `TERMS_NOT_ACCEPTED` → `Result.err(AuthorizationError({code:
   *     'navigation_terms_not_accepted'}))`
   *   - `NOT_AUTHORIZED` → `AuthorizationError({code:
   *     'navigation_api_not_authorized'})`
   *   - `LOCATION_PERMISSION_MISSING` → `AuthorizationError({code:
   *     'navigation_location_permission_missing'})`
   *   - `NETWORK_ERROR` → `NetworkError({code:
   *     'navigation_init_network_error'})`
   *   - `UNKNOWN_ERROR` and any other status → `NetworkError({code:
   *     'navigation_init_unknown_error'})`
   */
  init(): Promise<Result<true, NavInitError>>;

  /**
   * Show the SDK's terms-and-conditions dialog. Returns
   * `Result.ok({accepted})` for both paths. `accepted: false` means
   * the user explicitly tapped Cancel; the caller should NOT progress
   * to `init()` until the user accepts.
   */
  showTermsAndConditionsDialog(): Promise<Result<NavTermsResult, NetworkError>>;

  /**
   * Set destinations + return the SDK's `RouteStatus` mapped to the
   * domain-shaped tagged union. Per Phase 8 kickoff decision 2,
   * non-OK statuses come back as `Result.ok(<status>)` because they're
   * domain outcomes (the caller branches on which one to surface — a
   * "no route found" UX differs from a "network down" UX).
   *
   * SDK throws → `Result.err(NetworkError)` (the throw indicates the
   * call itself failed, not that the route calculation reported a
   * domain error code).
   */
  setDestinations(
    args: NavSetDestinationsArgs,
  ): Promise<Result<NavRouteStatus, NetworkError>>;

  /** Begin turn-by-turn guidance against the previously-set destinations. */
  startGuidance(): Promise<Result<true, NetworkError>>;

  /**
   * Idempotent — calling without an active session is a no-op. The
   * adapter catches SDK throws defensively just in case.
   */
  stopGuidance(): Promise<Result<true, NetworkError>>;

  /**
   * Release SDK resources. Calls `stopGuidance` first (defensively,
   * tolerating throws from either step) then `cleanup()` on the
   * controller. Clears all subscribers and dedup state.
   *
   * Idempotent; safe to call after disconnect (returns Result.ok).
   */
  cleanup(): Promise<Result<true, NetworkError>>;

  /**
   * Subscribe to arrival events. Multiple callers register against
   * ONE underlying SDK listener; the implementation dedups
   * `(waypointKey, isFinal)` defensively in case the listener is
   * double-applied across re-renders. Returns a synchronous disposer.
   *
   * If no controller is connected at the time of subscription, the
   * subscriber is recorded and the SDK listener is registered on the
   * next `setController(controller)` call. This lets the consumer
   * subscribe before the navigation screen mounts.
   */
  subscribeToArrival(callback: (event: NavArrivalEvent) => void): () => void;

  /**
   * Phase 10 turn 5 — subscribe to live time/distance telemetry from
   * the SDK's `setOnRemainingTimeOrDistanceChanged`. Multiple callers
   * register against ONE underlying SDK listener; the adapter dedups
   * by `(remainingMeters, remainingSeconds)` because the SDK can fire
   * repeatedly with identical values during standstill (mirrors the
   * `subscribeToArrival` multi-subscriber + dedup pattern).
   *
   * Same pre-connection-subscribe semantics as `subscribeToArrival`:
   * if no controller is connected at the time of subscription, the
   * subscriber is recorded and the SDK listener is registered on the
   * next `setController(controller)` call. Returns a synchronous
   * disposer.
   */
  subscribeToTimeAndDistance(
    callback: (event: NavTimeAndDistance) => void,
  ): () => void;
}
