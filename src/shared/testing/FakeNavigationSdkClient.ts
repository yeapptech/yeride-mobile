import type {
  NavArrivalEvent,
  NavigationListenerSetters,
  NavInitError,
  NavRouteStatus,
  NavSetDestinationsArgs,
  NavTermsResult,
} from '@data/services/NavigationSdkClient';
import type { AuthorizationError, NetworkError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

/**
 * One push into the adapter. Records the controller + listeners pair so
 * connector-hook tests can verify mount-push (controller non-null) +
 * unmount-clear (controller null).
 *
 * The controller is typed as `unknown` to keep the fake compatible
 * with the real adapter's `setController` signature (which takes a
 * concrete SDK `NavigationController`). The fake doesn't actually
 * USE the controller — its public methods (`init`, `setDestinations`,
 * …) work without one — so we don't bother modelling the SDK's
 * surface here.
 */
export interface FakeSetControllerCall {
  readonly controller: unknown;
  readonly listeners: NavigationListenerSetters | null;
}

/**
 * Programmable in-memory `NavigationSdkClient` stand-in. Mirrors the real
 * adapter's surface 1:1 so view-model and use-case tests can exercise the
 * navigation pipeline without touching the SDK or its React-hook-tied
 * controller.
 *
 * The fake intentionally does NOT actually USE a connected controller —
 * its public methods (`init`, `setDestinations`, …) work without one.
 * Phase 8 turn 2 added a `setController()` no-op spy so the
 * `useNavigationSdkConnector` hook's mount-push / unmount-clear
 * behaviour is testable. The recorded calls live on
 * `spies.setControllerCalls`.
 *
 * Pattern matches `FakeBackgroundGeolocationClient` /
 * `FakeStripeServerService`:
 *
 *   - `seed*` helpers prime return values for the next read.
 *   - `emit*` helpers synchronously fire events into the registered
 *     subscribers (with the same `(waypointKey, isFinal)` dedup as the
 *     real adapter).
 *   - `failNext({method, error})` makes the next call to `method`
 *     return `Result.err(error)`, one-shot.
 *   - `spies` exposes a read-only call history.
 *   - `reset()` wipes seed + spy + listener registry state.
 */

export type FakeNavigationSdkMethod =
  | 'init'
  | 'showTermsAndConditionsDialog'
  | 'setDestinations'
  | 'startGuidance'
  | 'stopGuidance'
  | 'cleanup';

export interface FakeNavigationSdkSpies {
  readonly initCalls: number;
  readonly showTermsCalls: number;
  readonly setDestinationsCalls: ReadonlyArray<NavSetDestinationsArgs>;
  readonly startGuidanceCalls: number;
  readonly stopGuidanceCalls: number;
  readonly cleanupCalls: number;
  readonly subscribeArrivalCalls: number;
  readonly arrivalDisposes: number;
  /**
   * Each `setController(args)` push from the connector hook (Phase 8
   * turn 2). Index 0 is the mount-push (controller non-null), index 1
   * is the unmount-clear (controller null) on a happy lifecycle.
   */
  readonly setControllerCalls: ReadonlyArray<FakeSetControllerCall>;
}

type AnyFakeError = NetworkError | AuthorizationError;

export class FakeNavigationSdkClient {
  private initialized = false;
  private guiding = false;

  /** Seeded outcome for the next `setDestinations` call. */
  private routeStatus: NavRouteStatus = 'ok';

  /** Seeded outcome for the next `showTermsAndConditionsDialog` call. */
  private termsAccepted = true;

  /**
   * Currently-active destinations passed to the most-recent successful
   * `setDestinations` call. `null` until set; reset by `cleanup()`.
   */
  private activeDestinations: NavSetDestinationsArgs | null = null;

  private arrivalCallbacks = new Set<(event: NavArrivalEvent) => void>();

  /** Dedup key — same scheme as the real adapter. */
  private lastArrivalKey: string | null = null;

  private nextFailures = new Map<FakeNavigationSdkMethod, AnyFakeError>();

  private readonly _spies = {
    initCalls: 0,
    showTermsCalls: 0,
    setDestinationsCalls: [] as NavSetDestinationsArgs[],
    startGuidanceCalls: 0,
    stopGuidanceCalls: 0,
    cleanupCalls: 0,
    subscribeArrivalCalls: 0,
    arrivalDisposes: 0,
    setControllerCalls: [] as FakeSetControllerCall[],
  };

  get spies(): FakeNavigationSdkSpies {
    return this._spies;
  }

  /* ───── Seed helpers ───── */

  /**
   * Set what `showTermsAndConditionsDialog` will return next. Defaults
   * to accepted so happy-path tests don't have to seed.
   */
  seedTermsAccepted(accepted: boolean): void {
    this.termsAccepted = accepted;
  }

  /**
   * Set what `setDestinations` will return on its next call. Defaults
   * to `'ok'`. Tests of the no-route-found / network-error UX seed the
   * appropriate status here.
   */
  seedRouteStatus(status: NavRouteStatus): void {
    this.routeStatus = status;
  }

  /**
   * Prime the next call to `method` to return `Result.err(error)`.
   * One-shot: subsequent calls behave normally.
   */
  failNext(args: {
    method: FakeNavigationSdkMethod;
    error: AnyFakeError;
  }): void {
    this.nextFailures.set(args.method, args.error);
  }

  /** Wipe seed + spy + subscriber state. */
  reset(): void {
    this.initialized = false;
    this.guiding = false;
    this.routeStatus = 'ok';
    this.termsAccepted = true;
    this.activeDestinations = null;
    this.arrivalCallbacks.clear();
    this.lastArrivalKey = null;
    this.nextFailures.clear();
    this._spies.initCalls = 0;
    this._spies.showTermsCalls = 0;
    this._spies.setDestinationsCalls.length = 0;
    this._spies.startGuidanceCalls = 0;
    this._spies.stopGuidanceCalls = 0;
    this._spies.cleanupCalls = 0;
    this._spies.subscribeArrivalCalls = 0;
    this._spies.arrivalDisposes = 0;
    this._spies.setControllerCalls.length = 0;
  }

  /* ───── Emit helpers ───── */

  /**
   * Fire a single deduped arrival event into every subscriber. Mirrors
   * the real adapter's `(waypointKey, isFinal)` dedup so consecutive
   * identical fires collapse to one callback.
   */
  emitArrival(event: NavArrivalEvent): void {
    const wpKey =
      event.placeId ??
      (event.coords
        ? `${String(event.coords.latitude)},${String(event.coords.longitude)}`
        : (event.title ?? ''));
    const key = `${wpKey}:${String(event.isFinalDestination)}`;
    if (key === this.lastArrivalKey) return;
    this.lastArrivalKey = key;
    for (const cb of [...this.arrivalCallbacks]) cb(event);
  }

  /**
   * Drive the SDK's "fires twice on the boundary" reality without
   * writing the same `emitArrival(...)` call multiple times in tests.
   */
  emitMultiFireArrival(event: NavArrivalEvent, count: number): void {
    for (let i = 0; i < count; i += 1) this.emitArrival(event);
  }

  /* ───── Public adapter surface ───── */

  /**
   * No-op stand-in for the real adapter's controller-injection seam.
   * The fake's behaviour does not depend on a connected controller —
   * `init` / `setDestinations` / etc. all work without one. This method
   * exists solely so `useNavigationSdkConnector` can push the SDK
   * controller into "the adapter" in tests, and we can verify the
   * mount-push / unmount-clear pair via `spies.setControllerCalls`.
   *
   * Parameter shape relaxed to `unknown` for the controller so the
   * union-typed `Container.navigationSdk` (real adapter | fake) keeps
   * `setController` callable from the connector hook without an
   * intersection-typed parameter (the real adapter's NavigationController
   * has a richer public surface than the fake needs to model).
   */
  setController(args: {
    controller: unknown;
    listeners: NavigationListenerSetters | null;
  }): void {
    this._spies.setControllerCalls.push({
      controller: args.controller,
      listeners: args.listeners,
    });
  }

  async init(): Promise<Result<true, NavInitError>> {
    this._spies.initCalls += 1;
    const failure = this.takeFailure('init');
    if (failure) return Result.err(failure);
    this.initialized = true;
    return Result.ok(true);
  }

  async showTermsAndConditionsDialog(): Promise<
    Result<NavTermsResult, NetworkError>
  > {
    this._spies.showTermsCalls += 1;
    const failure = this.takeFailure('showTermsAndConditionsDialog');
    if (failure) return Result.err(failure as NetworkError);
    return Result.ok({ accepted: this.termsAccepted });
  }

  async setDestinations(
    args: NavSetDestinationsArgs,
  ): Promise<Result<NavRouteStatus, NetworkError>> {
    this._spies.setDestinationsCalls.push(args);
    const failure = this.takeFailure('setDestinations');
    if (failure) return Result.err(failure as NetworkError);
    if (this.routeStatus === 'ok') {
      this.activeDestinations = args;
    }
    return Result.ok(this.routeStatus);
  }

  async startGuidance(): Promise<Result<true, NetworkError>> {
    this._spies.startGuidanceCalls += 1;
    const failure = this.takeFailure('startGuidance');
    if (failure) return Result.err(failure as NetworkError);
    this.guiding = true;
    return Result.ok(true);
  }

  async stopGuidance(): Promise<Result<true, NetworkError>> {
    this._spies.stopGuidanceCalls += 1;
    const failure = this.takeFailure('stopGuidance');
    if (failure) return Result.err(failure as NetworkError);
    this.guiding = false;
    return Result.ok(true);
  }

  async cleanup(): Promise<Result<true, NetworkError>> {
    this._spies.cleanupCalls += 1;
    const failure = this.takeFailure('cleanup');
    if (failure) {
      // Even on failure, tear down the in-memory state — mirrors the
      // real adapter's "best-effort cleanup, don't strand the session"
      // behaviour.
      this.arrivalCallbacks.clear();
      this.lastArrivalKey = null;
      this.activeDestinations = null;
      this.guiding = false;
      return Result.err(failure as NetworkError);
    }
    this.arrivalCallbacks.clear();
    this.lastArrivalKey = null;
    this.activeDestinations = null;
    this.guiding = false;
    return Result.ok(true);
  }

  subscribeToArrival(callback: (event: NavArrivalEvent) => void): () => void {
    this._spies.subscribeArrivalCalls += 1;
    this.arrivalCallbacks.add(callback);
    return () => {
      this._spies.arrivalDisposes += 1;
      this.arrivalCallbacks.delete(callback);
      if (this.arrivalCallbacks.size === 0) this.lastArrivalKey = null;
    };
  }

  /* ───── Read-only test introspection ───── */

  /**
   * Most-recent successful `setDestinations` args, or null if no call
   * has succeeded since the last `cleanup()` / `reset()`. Lets tests
   * assert the right route + waypoint set landed on the SDK.
   */
  getActiveDestinations(): NavSetDestinationsArgs | null {
    return this.activeDestinations;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isGuiding(): boolean {
    return this.guiding;
  }

  getArrivalSubscriberCount(): number {
    return this.arrivalCallbacks.size;
  }

  /* ───── Internals ───── */

  private takeFailure(method: FakeNavigationSdkMethod): AnyFakeError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}

/**
 * Re-exported type aliases so test files can `import type` without
 * crossing into the data layer.
 */
export type {
  NavArrivalEvent,
  NavInitError,
  NavRouteStatus,
  NavSetDestinationsArgs,
  NavTermsResult,
};
