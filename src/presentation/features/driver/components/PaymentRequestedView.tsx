import { ActivityIndicator, Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import { FareCalculator } from '@domain/services';
import { FareEstimate } from '@presentation/components/route';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * Brief intermediate state during server status `payment_requested`. The
 * `completeTrip` Cloud Function has flipped the trip into this state and
 * kicked off the Stripe charge; we're now waiting for the Stripe webhook
 * to flip the ride to `completed` (success) or `payment_failed` (decline).
 *
 * The Stripe webhook may take multiple seconds. The driver may sit on this
 * screen for a beat — that's expected. Don't time-bomb it; the live
 * `ObserveRide` subscription delivers the new snapshot when the webhook
 * fires.
 *
 * No CTAs in this state — the trip is in flight server-side and the driver
 * has nothing to act on. Cancel is intentionally NOT exposed: the trip has
 * already terminated server-side from the entity's perspective; cancelling
 * would either no-op or create an inconsistent state.
 */
interface PaymentRequestedViewProps {
  readonly ride: Ride;
  /** Phase 10 turn 8 — chat button on the driver-side
   *  payment_requested view. The Stripe webhook may take several
   *  seconds; the driver may want to message the rider mid-wait. */
  readonly onPressChat?: () => void;
  readonly hasUnread?: boolean;
}

export function PaymentRequestedView({
  ride,
  onPressChat,
  hasUnread,
}: PaymentRequestedViewProps) {
  const fare = computeRunningFare(ride);

  return (
    <View>
      <BottomSheetHeader
        title="Awaiting payment confirmation…"
        subtitle="We're confirming the charge with the rider's bank."
        trailing={
          onPressChat !== undefined ? (
            <HeaderIconButton
              label={hasUnread ? 'Open chat (unread)' : 'Open chat'}
              onPress={onPressChat}
              testID="payment-requested-chat"
            >
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground">
                  Chat
                </Text>
                {hasUnread && (
                  <View
                    className="ml-1 h-2 w-2 rounded-full bg-primary"
                    accessibilityLabel="Unread messages"
                    testID="payment-requested-chat-unread"
                  />
                )}
              </View>
            </HeaderIconButton>
          ) : undefined
        }
      />

      <View className="items-center px-4 py-6">
        <ActivityIndicator size="large" />
        <Text className="mt-3 text-sm text-muted-foreground">
          This usually takes a few seconds.
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">
          Running fare
        </Text>
        <View className="mt-1">
          <FareEstimate fare={fare} />
        </View>
        <Text className="mt-1 text-xs text-muted-foreground">
          Final amount confirmed once the charge settles.
        </Text>
      </View>
    </View>
  );
}

/**
 * Compute the running fare from the recorded odometer + duration when
 * available, falling back to the planned dropoff route. Mirrors the
 * fallback logic in the rider's `CompletedView`.
 */
function computeRunningFare(ride: Ride): Money | null {
  const distanceMeters = computeDistanceMeters(ride);
  const durationSeconds = computeDurationSeconds(ride);
  if (distanceMeters === null || durationSeconds === null) return null;
  const r = FareCalculator.estimate({
    rideService: ride.rideService,
    distanceMeters,
    durationSeconds,
  });
  return r.ok ? r.value : null;
}

function computeDistanceMeters(ride: Ride): number | null {
  const start = ride.pickupTiming.odometerMeters;
  const end = ride.dropoffTiming.odometerMeters;
  if (start !== null && end !== null && end >= start) {
    return end - start;
  }
  return ride.dropoff.directions?.distanceMeters ?? null;
}

function computeDurationSeconds(ride: Ride): number | null {
  const start = ride.pickupTiming.completedAt;
  const end = ride.dropoffTiming.completedAt;
  if (start && end && end.getTime() >= start.getTime()) {
    return Math.round((end.getTime() - start.getTime()) / 1000);
  }
  return ride.dropoff.directions?.durationSeconds ?? null;
}
