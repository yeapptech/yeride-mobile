import type {
  NavArrivalEvent,
  NavInitError,
  NavRouteStatus,
  NavSetDestinationsArgs,
  NavTermsResult,
} from '@data/services/NavigationSdkClient';
import type { AuthorizationError, NetworkError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `NavigationSdkClient` stand-in. Mirrors the real
 * adapter's surface 1:1 so view-model and use-case tests can exercise the
 * navigation pipeline without touching the SDK or its React-hook-tied
 * controller.
 *
 * The fake intentionally does NOT model the controller-injection seam —
 * Turn 2's presentation glue is what's responsible for connecting the
 * SDK controller. Tests of the fake exercise the same async + Result
 * surface the real adapter exposes.
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
