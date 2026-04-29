import type {
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Domain seam for the server-side payment callables (Cloud Functions /
 * equivalent). Phase 6 turn 2 only needs `tipDriver` here; the existing
 * `completeTrip` / `cancelTrip` callables are already hidden behind
 * `RideRepository.requestPayment` / `cancel` (which delegate to the same
 * underlying transport).
 *
 * Why a domain service rather than a repository: tipping is an
 * orchestration call (charge + driver notification + TripPayment write
 * happen server-side) — there's no aggregate to mutate locally. Modeling
 * it as a repository method would require a fake to mutate Ride state in
 * a way that doesn't match what the real callable does (the trip-doc
 * write happens via webhook, not callable response). The service shape
 * is honest about that.
 *
 * The data layer's `CloudFunctionsService` (and the test
 * `FakeCloudFunctionsService`) both implement this interface.
 */
export interface PaymentCallableService {
  /**
   * Process a tip on a completed trip.
   *
   * Server-side `(tripId, customerId)`-idempotent, so a client retry
   * after a network blip is safe — the second call returns the original
   * result.
   *
   * `tipAmountDollars` is in DOLLARS (the Cloud Function's API surface).
   * Callers (`ProcessTip`) convert from `Money` minor units at this
   * boundary.
   */
  tipDriver(args: {
    tripId: string;
    tipAmountDollars: number;
  }): Promise<
    Result<
      { success: boolean; paymentId: string },
      NetworkError | AuthorizationError | NotFoundError | ValidationError
    >
  >;
}
