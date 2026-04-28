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
 *   - `cancelTrip(tripId, by, code, reasonText, odometerMeters)` — both
 *     rider-side and driver-side cancellation. The function validates the
 *     caller's authorization, computes any cancellation fee, writes the
 *     `trip.cancelReason` subdoc, flips status to `'cancelled'`, and
 *     refunds / charges as needed.
 *
 * Error mapping:
 *   - `functions/unauthenticated`           → AuthorizationError
 *   - `functions/permission-denied`         → AuthorizationError
 *   - `functions/not-found`                 → NotFoundError
 *   - `functions/invalid-argument`          → ValidationError
 *   - `functions/failed-precondition`       → ValidationError
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
    return this.call<CompleteTripResult>('completeTrip', args);
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
    return this.call<CancelTripResult>('cancelTrip', args);
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

/* ───── error mapping ───── */

function mapFunctionsError(
  e: unknown,
  op: string,
): NetworkError | AuthorizationError | NotFoundError | ValidationError {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : 'unknown';
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
    case 'functions/unauthenticated':
    case 'functions/permission-denied':
      return new AuthorizationError({
        code: domainCode,
        message,
        cause: e,
      });
    case 'functions/not-found':
      return new NotFoundError({
        code: domainCode,
        message,
        resource: 'cloud_function_target',
        cause: e,
      });
    case 'functions/invalid-argument':
    case 'functions/failed-precondition':
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
