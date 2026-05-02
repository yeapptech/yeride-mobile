import { RideId } from '@domain/entities/RideId';
import { ValidationError } from '@domain/errors';
import type { NavigationIntent, NotificationResponse } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Pure-function use case: take a `NotificationResponse` (the SDK's
 * normalized tap event) and return the screen the app should open.
 *
 * Routing table (mirrors the deployed Cloud Functions in
 * `yeride-functions/handlers/`):
 *
 *   data.type                          → NavigationIntent.target  | requires
 *   ─────────────────────────────────── ─────────────────────────  ──────────
 *   awaiting_driver, scheduled         → driver_dispatch          | tripId
 *   driver_dispatched                  → rider_ride_monitor       | tripId
 *   driver_pickup_arrived              → rider_ride_monitor       | tripId
 *   payment_failed                     → rider_ride_monitor       | tripId
 *   scheduled_driver_accepted          → rider_ride_monitor       | tripId
 *   pickup_reminder                    → rider_ride_monitor       | tripId
 *   payment_succeeded                  → rider_ride_receipt       | tripId
 *   tip_succeeded                      → driver_earnings          | (none)
 *   anything else                      → unknown                  | (none)
 *
 * The `'unknown'` arm is the default for any payload that doesn't match
 * a known type — surfaces as a no-op tap (the calling hook simply
 * doesn't navigate) rather than crashing the app on a Cloud-Function
 * payload the rewrite doesn't yet recognize. Forward-compatible by
 * design.
 *
 * Validation:
 *   - `data.type` must be a non-empty string. Missing / non-string →
 *     `ValidationError(notification_payload_missing_type)`.
 *   - For types that require a `tripId`, `data.tripId` must be a string
 *     that passes `RideId.create`. Missing / malformed →
 *     `ValidationError` with the corresponding code from `RideId.create`.
 *
 * The use case is **synchronous** because no IO is involved (no repo
 * read, no SDK call). Callers don't need to `await`; the hook
 * `useNotificationResponseHandler` invokes it in a synchronous tap-
 * handler chain.
 */
export class HandleNotificationResponse {
  execute(
    response: NotificationResponse,
  ): Result<NavigationIntent, ValidationError> {
    const data = response.data;
    const rawType = data['type'];
    if (typeof rawType !== 'string' || rawType.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'notification_payload_missing_type',
          message:
            'Notification payload is missing a `type` field — cannot route',
          field: 'data.type',
        }),
      );
    }

    // Types that require a tripId — the wide majority. Build the RideId
    // once up-front so each branch can use it.
    const needsRideId =
      rawType === 'awaiting_driver' ||
      rawType === 'scheduled' ||
      rawType === 'driver_dispatched' ||
      rawType === 'driver_pickup_arrived' ||
      rawType === 'payment_failed' ||
      rawType === 'scheduled_driver_accepted' ||
      rawType === 'pickup_reminder' ||
      rawType === 'payment_succeeded';

    // Branches that need a tripId resolve it inside the switch arm so
    // the `RideId` is in scope without a non-null assertion. The
    // `tip_succeeded` and unknown arms don't need the id at all.
    const resolveRideId = (): Result<RideId, ValidationError> => {
      const rawTripId = data['tripId'];
      if (typeof rawTripId !== 'string') {
        return Result.err(
          new ValidationError({
            code: 'notification_payload_missing_trip_id',
            message: `Notification payload of type "${rawType}" is missing a string \`tripId\``,
            field: 'data.tripId',
          }),
        );
      }
      return RideId.create(rawTripId);
    };

    if (!needsRideId) {
      // Only branches that don't need a tripId — `tip_succeeded` +
      // unknown. Resolve before the rideId branches to keep the
      // happy-path tight.
      if (rawType === 'tip_succeeded') {
        // Driver Earnings tab is the surface a driver visits to see new
        // tips — open it on tap. The Cloud Function payload includes the
        // tipAmount + tripId, but the Earnings tab doesn't take params,
        // so we don't surface them through the intent.
        return Result.ok({ target: 'driver_earnings' });
      }
      // Unknown type — forward-compat. A new Cloud Function payload
      // type that the rewrite doesn't recognize yet should land here;
      // the hook treats `'unknown'` as a no-op rather than crashing.
      return Result.ok({ target: 'unknown' });
    }

    const idR = resolveRideId();
    if (!idR.ok) return idR;
    const rideId = idR.value;

    switch (rawType) {
      case 'awaiting_driver':
      case 'scheduled':
        return Result.ok({ target: 'driver_dispatch', rideId });

      case 'driver_dispatched':
      case 'driver_pickup_arrived':
      case 'payment_failed':
      case 'scheduled_driver_accepted':
      case 'pickup_reminder':
        return Result.ok({ target: 'rider_ride_monitor', rideId });

      case 'payment_succeeded':
        return Result.ok({ target: 'rider_ride_receipt', rideId });

      default:
        // `needsRideId` is true → the switch above is exhaustive.
        // Unreachable; satisfies TS's narrowing.
        return Result.ok({ target: 'unknown' });
    }
  }
}
