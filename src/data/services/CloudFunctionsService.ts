import { getApp } from '@react-native-firebase/app';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

import {
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('CloudFunctions');

const FUNCTIONS_REGION = 'us-east1';

/**
 * Adapter wrapping Firebase Cloud Functions callables. The legacy yeride
 * Cloud Functions live in `us-east1` — same region preserved here so the
 * rewrite hits the same deployed functions.
 *
 * Functions wrapped:
 *   - `completeTrip(tripId, odometerMeters)` — driver-side trip completion.
 *     The function recalculates the fare from actual odometer/elapsed time,
 *     applies app charges (booking, dispatch, pickup/dropoff bandwidth, maps
 *     API), kicks off the Stripe charge, and updates the trip doc to
 *     `payment_requested`. Returns the canonical fare breakdown.
 *
 *     **Wire-format translation**: the deployed Cloud Function reads
 *     `request.data.odometer` (legacy yeride parity), but the rewrite's
 *     domain layer carries `odometerMeters` (semantic / typed). We
 *     translate `odometerMeters` → `odometer` at this boundary so domain
 *     code keeps its semantics and the deployed function gets the field
 *     name it expects. Without this rename the function throws
 *     `invalid-argument: "odometer must be a non-negative number"`.
 *   - `cancelTrip(tripId, by, code, reasonText, odometerMeters)` — both
 *     rider-side and driver-side cancellation. The function validates the
 *     caller's authorization, computes any cancellation fee, writes the
 *     `trip.cancelReason` subdoc, flips status to `'cancelled'`, and
 *     refunds / charges as needed.
 *
 *     **Wire-format translation**: the deployed Cloud Function (legacy
 *     yeride parity) reads `request.data.reason` (not `code`). The
 *     domain-level `CancellationReason.code` is what the rewrite uses
 *     end-to-end; we translate `code` → `reason` at this boundary so
 *     domain code keeps its semantics and the deployed function gets the
 *     field name it expects. Without this rename the function throws
 *     `invalid-argument: "reason is required"`.
 *   - `tipDriver(tripId, tipAmount)` — Phase 6 turn 2. Rider-initiated tip
 *     after trip completion. The function authenticates the rider as the
 *     trip's passenger, validates trip status (must be `'completed'`),
 *     and routes the charge through the `direct-charge` Stripe path to
 *     the driver's Connect account. Server-idempotent on
 *     `(tripId, customerId)` via the trip doc's `payment.tipStatus`
 *     check, so a client retry after a network blip is safe.
 *
 *     `tipAmount` is in **dollars** (legacy contract) — `ProcessTip`
 *     converts from `Money` minor units at the use-case boundary.
 *
 * Error mapping (handles both bare codes from RNFirebase v24+ and
 * legacy `functions/`-prefixed codes for backward compatibility):
 *   - `unauthenticated`                     → AuthorizationError
 *   - `permission-denied`                   → AuthorizationError
 *   - `not-found`                           → NotFoundError
 *   - `invalid-argument`                    → ValidationError
 *   - `failed-precondition`                 → ValidationError
 *   - everything else (deadline-exceeded, unavailable, internal, network) →
 *     NetworkError
 *
 * The function-side errors carry a `details.code` that's our domain-level
 * code (e.g. 'trip_not_started_yet', 'driver_no_show_too_late'). We pull
 * that through into the DomainError where present so the presentation layer
 * can surface specific copy.
 */
export class CloudFunctionsService {
  private readonly functions = getFunctions(getApp(), FUNCTIONS_REGION);

  async completeTrip(args: {
    tripId: string;
    odometerMeters: number;
  }): Promise<
    Result<
      CompleteTripResult,
      NetworkError | AuthorizationError | NotFoundError | ValidationError
    >
  > {
    // Translate `odometerMeters` → `odometer` at the wire boundary. The
    // deployed Cloud Function (legacy yeride parity) reads
    // `request.data.odometer`; the rewrite's domain layer uses
    // `odometerMeters`. See the JSDoc on this class for the rationale.
    const payload = {
      tripId: args.tripId,
      odometer: args.odometerMeters,
    };
    return this.call<CompleteTripResult>('completeTrip', payload);
  }

  async cancelTrip(args: {
    tripId: string;
    by: 'rider' | 'driver';
    code: string;
    reasonText: string | null;
    odometerMeters: number | null;
  }): Promise<
    Result<
      CancelTripResult,
      NetworkError | AuthorizationError | NotFoundError | ValidationError
    >
  > {
    // Translate `code` → `reason` at the wire boundary. The deployed
    // Cloud Function (legacy yeride parity) reads `request.data.reason`;
    // the rewrite's domain layer uses `CancellationReason.code`. See
    // the JSDoc on this class for the rationale.
    const payload = {
      tripId: args.tripId,
      by: args.by,
      reason: args.code,
      reasonText: args.reasonText,
      odometerMeters: args.odometerMeters,
    };
    return this.call<CancelTripResult>('cancelTrip', payload);
  }

  /**
   * Tip a driver after a completed trip. The Cloud Function takes the tip
   * amount in DOLLARS (its API surface, not the rewrite's domain
   * representation). `ProcessTip` is the only caller and converts from
   * `Money.minorUnits` at its boundary, also enforcing the rewrite's $1
   * floor (stricter than the function's $0.50 floor).
   */
  async tipDriver(args: {
    tripId: string;
    tipAmountDollars: number;
  }): Promise<
    Result<
      TipDriverResult,
      NetworkError | AuthorizationError | NotFoundError | ValidationError
    >
  > {
    return this.call<TipDriverResult>('tipDriver', {
      tripId: args.tripId,
      tipAmount: args.tipAmountDollars,
    });
  }

  private async call<T>(
    name: string,
    payload: Record<string, unknown>,
  ): Promise<
    Result<
      T,
      NetworkError | AuthorizationError | NotFoundError | ValidationError
    >
  > {
    try {
      const callable = httpsCallable(this.functions, name);
      const response = await callable(payload);
      return Result.ok(response.data as T);
    } catch (e) {
      const mapped = mapFunctionsError(e, name);
      return Result.err(mapped);
    }
  }
}

/**
 * Result shapes returned by the deployed Cloud Functions. Kept as
 * adapter-private types — domain code never sees these directly; the
 * `RideRepository.requestPayment` / `cancel` methods only return the
 * updated `Ride`. The data layer reads back the trip doc after the
 * function call to materialize that.
 */
export interface CompleteTripResult {
  readonly fare: number;
  readonly appChargesTotal: number;
}

export interface CancelTripResult {
  readonly cancellationFee: number;
}

export interface TipDriverResult {
  readonly success: boolean;
  readonly paymentId: string;
}

/* ───── error mapping ───── */

function mapFunctionsError(
  e: unknown,
  op: string,
): NetworkError | AuthorizationError | NotFoundError | ValidationError {
  const rawCode =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : 'unknown';
  // Normalize: RNFirebase v24+ surfaces bare codes (`invalid-argument`),
  // older versions and the JS docs use the `functions/`-prefixed form
  // (`functions/invalid-argument`). Strip the prefix once so the switch
  // below stays readable and the matching is forward-compatible.
  const code = rawCode.startsWith('functions/')
    ? rawCode.slice('functions/'.length)
    : rawCode;
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : `Cloud Function ${op} failed`;
  const details =
    typeof e === 'object' && e !== null && 'details' in e
      ? (e as { details: unknown }).details
      : undefined;
  const domainCode =
    typeof details === 'object' &&
    details !== null &&
    'code' in details &&
    typeof (details as { code: unknown }).code === 'string'
      ? (details as { code: string }).code
      : `cf_${op}_${code.replace(/[/-]/g, '_')}`;

  logger.warn(`Cloud Function ${op} failed`, { code, domainCode });

  switch (code) {
    case 'unauthenticated':
    case 'permission-denied':
      return new AuthorizationError({
        code: domainCode,
        message,
        cause: e,
      });
    case 'not-found':
      return new NotFoundError({
        code: domainCode,
        message,
        resource: 'cloud_function_target',
        cause: e,
      });
    case 'invalid-argument':
    case 'failed-precondition':
      return new ValidationError({
        code: domainCode,
        message,
        cause: e,
      });
    default:
      return new NetworkError({
        code: domainCode,
        message,
        cause: e,
      });
  }
}
