import type {
  CancelTripResult,
  CompleteTripResult,
  TipDriverResult,
} from '@data/services/CloudFunctionsService';
import type {
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `CloudFunctionsService` stand-in. Mirrors the
 * shape of the real adapter (`completeTrip`, `cancelTrip`, `tipDriver`)
 * with seed/spy/failNext seams so use-case tests don't have to reach
 * for `httpsCallable` mocks.
 *
 * Default behavior:
 *   - `completeTrip`  — returns `{ fare: 0, appChargesTotal: 0 }`. Rides
 *                        live in `InMemoryRideRepository.requestPayment`,
 *                        which short-circuits the real callable; only
 *                        Phase 6 use cases that DON'T touch a ride repo
 *                        actually exercise this fake's completeTrip.
 *   - `cancelTrip`    — returns `{ cancellationFee: 0 }`.
 *   - `tipDriver`     — returns the seeded result (default
 *                        `{ success: true, paymentId: 'pi_fake_tip' }`).
 *
 * Failure injection: `failNext({ method, error })` primes the next call
 * to `method` to return `Result.err(error)`. One-shot.
 */

export type CloudFunctionsMethod = 'completeTrip' | 'cancelTrip' | 'tipDriver';

type AnyCloudFunctionsError =
  | NetworkError
  | AuthorizationError
  | NotFoundError
  | ValidationError;

export interface FakeCloudFunctionsSpies {
  readonly completeTripCalls: ReadonlyArray<{
    tripId: string;
    odometerMeters: number;
  }>;
  readonly cancelTripCalls: ReadonlyArray<{
    tripId: string;
    by: 'rider' | 'driver';
    code: string;
    reasonText: string | null;
    odometerMeters: number | null;
  }>;
  readonly tipDriverCalls: ReadonlyArray<{
    tripId: string;
    tipAmountDollars: number;
  }>;
}

export class FakeCloudFunctionsService {
  private completeTripResult: CompleteTripResult = {
    fare: 0,
    appChargesTotal: 0,
  };
  private cancelTripResult: CancelTripResult = { cancellationFee: 0 };
  private tipDriverResultByTripId = new Map<string, TipDriverResult>();
  private defaultTipDriverResult: TipDriverResult = {
    success: true,
    paymentId: 'pi_fake_tip',
  };
  private nextFailures = new Map<
    CloudFunctionsMethod,
    AnyCloudFunctionsError
  >();

  private readonly _spies = {
    completeTripCalls: [] as Array<{ tripId: string; odometerMeters: number }>,
    cancelTripCalls: [] as Array<{
      tripId: string;
      by: 'rider' | 'driver';
      code: string;
      reasonText: string | null;
      odometerMeters: number | null;
    }>,
    tipDriverCalls: [] as Array<{
      tripId: string;
      tipAmountDollars: number;
    }>,
  };

  get spies(): FakeCloudFunctionsSpies {
    return this._spies;
  }

  // ─── seed helpers ──────────────────────────────────────────

  seedCompleteTrip(result: CompleteTripResult): void {
    this.completeTripResult = result;
  }

  seedCancelTrip(result: CancelTripResult): void {
    this.cancelTripResult = result;
  }

  /**
   * Per-trip tip result. Falls back to the default
   * `{success: true, paymentId: 'pi_fake_tip'}` when no per-trip seed is
   * present.
   */
  seedTipDriverResult(args: { tripId: string; result: TipDriverResult }): void {
    this.tipDriverResultByTripId.set(args.tripId, args.result);
  }

  failNext(args: {
    method: CloudFunctionsMethod;
    error: AnyCloudFunctionsError;
  }): void {
    this.nextFailures.set(args.method, args.error);
  }

  reset(): void {
    this.completeTripResult = { fare: 0, appChargesTotal: 0 };
    this.cancelTripResult = { cancellationFee: 0 };
    this.tipDriverResultByTripId.clear();
    this.defaultTipDriverResult = {
      success: true,
      paymentId: 'pi_fake_tip',
    };
    this.nextFailures.clear();
    this._spies.completeTripCalls.length = 0;
    this._spies.cancelTripCalls.length = 0;
    this._spies.tipDriverCalls.length = 0;
  }

  // ─── methods ───────────────────────────────────────────────

  async completeTrip(args: {
    tripId: string;
    odometerMeters: number;
  }): Promise<Result<CompleteTripResult, AnyCloudFunctionsError>> {
    this._spies.completeTripCalls.push(args);
    const failure = this.takeFailure('completeTrip');
    if (failure) return Result.err(failure);
    return Result.ok(this.completeTripResult);
  }

  async cancelTrip(args: {
    tripId: string;
    by: 'rider' | 'driver';
    code: string;
    reasonText: string | null;
    odometerMeters: number | null;
  }): Promise<Result<CancelTripResult, AnyCloudFunctionsError>> {
    this._spies.cancelTripCalls.push(args);
    const failure = this.takeFailure('cancelTrip');
    if (failure) return Result.err(failure);
    return Result.ok(this.cancelTripResult);
  }

  async tipDriver(args: {
    tripId: string;
    tipAmountDollars: number;
  }): Promise<Result<TipDriverResult, AnyCloudFunctionsError>> {
    this._spies.tipDriverCalls.push(args);
    const failure = this.takeFailure('tipDriver');
    if (failure) return Result.err(failure);
    return Result.ok(
      this.tipDriverResultByTripId.get(args.tripId) ??
        this.defaultTipDriverResult,
    );
  }

  private takeFailure(
    method: CloudFunctionsMethod,
  ): AnyCloudFunctionsError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}
