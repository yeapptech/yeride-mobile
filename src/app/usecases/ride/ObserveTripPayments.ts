import type { RideId } from '@domain/entities/RideId';
import type { TripPayment } from '@domain/entities/TripPayment';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to a ride's payment subcollection
 * (`trips/{tripId}/payments/{paymentId}`). Subscription-shaped — same
 * pattern as `ObserveRide` and `ObserveTripEvents`. Payments emit
 * sorted by `createdAt` descending so the receipt screen renders the
 * newest entry first.
 *
 *   const unsubscribe = observeTripPayments.execute({
 *     rideId,
 *     callback: (payments) => { ... },
 *   });
 *   // later:
 *   unsubscribe();
 *
 * Used by `useRideReceiptViewModel` to drive the live fare-and-tip
 * breakdown on RideReceipt. Read-only on the client — payment rows are
 * written by the Stripe webhook + the `completeTrip` / `tipDriver`
 * Cloud Functions; client writes are rejected by Firestore rules.
 */
export class ObserveTripPayments {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    rideId: RideId;
    callback: (payments: readonly TripPayment[]) => void;
  }): () => void {
    return this.repo.subscribePayments(args);
  }
}
