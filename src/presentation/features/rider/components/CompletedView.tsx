import { Pressable, Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import { FareCalculator } from '@domain/services';
import { FareEstimate } from '@presentation/components/route';
import { BottomSheetHeader } from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `completed` and `payment_requested`.
 *
 * Phase 3 turn 3.4b ships a read-only fare summary: total fare, distance,
 * duration, "Charged to •••• 4242" placeholder, and a "View receipt" CTA
 * that pushes RideReceipt. The view-model auto-redirects to RideReceipt
 * on `completed`, so in practice the rider only sees this view for the
 * brief moment between `payment_requested` and `completed` (the Stripe
 * webhook's flip).
 *
 * The fare we display here is computed client-side via `FareCalculator`
 * against the recorded odometer + duration. The authoritative final fare
 * lives on the `payments` subcollection (written by the `completeTrip`
 * Cloud Function); the receipt screen reads that. Same formula either
 * way — the client-computed value matches up to rounding.
 *
 * Tip selector and retry-charge controls are visible-but-disabled stubs
 * labelled "Phase 6". Their layout reserves the space so the screen
 * doesn't visibly redraw when Phase 6 lands.
 */
interface CompletedViewProps {
  readonly ride: Ride;
  readonly onViewReceipt: () => void;
}

export function CompletedView({ ride, onViewReceipt }: CompletedViewProps) {
  const fare = computeFare(ride);
  const distanceMeters = computeDistanceMeters(ride);
  const durationSeconds = computeDurationSeconds(ride);

  return (
    <View>
      <BottomSheetHeader
        title={
          ride.status === 'completed' ? 'Trip complete' : 'Charging your card'
        }
        subtitle={
          ride.status === 'completed'
            ? 'Thanks for riding with YeRide.'
            : "We're confirming the payment with your bank."
        }
      />

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Fare</Text>
        <View className="mt-1 flex-row items-baseline gap-2">
          <FareEstimate fare={fare} />
          <Text className="text-xs text-muted-foreground">
            {formatDistance(distanceMeters)} · {formatDuration(durationSeconds)}
          </Text>
        </View>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Payment</Text>
        <Text className="mt-0.5 text-sm text-foreground">
          Charged to your default card.
        </Text>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          Card details land in Phase 6 alongside the Stripe wallet.
        </Text>
      </View>

      {/* Tip selector — disabled stub for Phase 6. The space is
          reserved so the layout doesn't reflow when the real selector
          lands. */}
      <View className="border-t border-border px-4 py-3 opacity-50">
        <Text className="text-xs uppercase text-muted-foreground">
          Tip your driver
        </Text>
        <View className="mt-2 flex-row gap-2">
          {['$1', '$2', '$5', 'Custom'].map((label) => (
            <View
              key={label}
              className="rounded-full border border-border px-3 py-1.5"
            >
              <Text className="text-sm text-muted-foreground">{label}</Text>
            </View>
          ))}
        </View>
        <Text className="mt-2 text-xs text-muted-foreground">
          Tipping lands in Phase 6.
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Pressable
          onPress={onViewReceipt}
          accessibilityRole="button"
          className="items-center rounded-xl bg-primary px-4 py-3"
          testID="completed-view-receipt"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            View receipt
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function computeFare(ride: Ride): Money | null {
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

function computeDistanceMeters(ride: Ride): number {
  // Difference between dropoff odometer and pickup odometer = trip
  // distance. Falls back to the route's planned distance when odometer
  // readings aren't yet captured.
  const start = ride.pickupTiming.odometerMeters;
  const end = ride.dropoffTiming.odometerMeters;
  if (start !== null && end !== null && end >= start) {
    return end - start;
  }
  return ride.dropoff.directions?.distanceMeters ?? 0;
}

function computeDurationSeconds(ride: Ride): number {
  // Wall-clock from pickup-completed to dropoff-completed. Falls back
  // to the route's planned duration when timing isn't captured.
  const start = ride.pickupTiming.completedAt;
  const end = ride.dropoffTiming.completedAt;
  if (start && end && end.getTime() >= start.getTime()) {
    return Math.round((end.getTime() - start.getTime()) / 1000);
  }
  return ride.dropoff.directions?.durationSeconds ?? 0;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes)} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours)} hr ${String(mins)}m`;
}
