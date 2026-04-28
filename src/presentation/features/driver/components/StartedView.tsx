import { Alert, Pressable, Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import { FareCalculator } from '@domain/services';
import { FareEstimate } from '@presentation/components/route';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for the driver while server status is `started`. The rider
 * is in the car, the trip is in motion, and the driver is heading to the
 * dropoff. Bottom-sheet content:
 *
 *   - Header with ETA-to-dropoff (pulled from `ride.dropoff.directions`,
 *     set at trip-create time by the rider's RouteSelect view-model) +
 *     a destructive cancel button.
 *   - Sanitized passenger card: first name + last initial only — same
 *     PII boundary as `EnRouteToPickupView` / `AtPickupView`.
 *   - Dropoff endpoint card.
 *   - Estimated fare row (pre-final, computed via `FareCalculator.estimate`
 *     against the planned dropoff directions). Authoritative final fare
 *     is computed server-side by the `completeTrip` Cloud Function once
 *     "Request payment" fires; this row is for driver visibility only.
 *   - Primary CTA "Request payment" → an `Alert.alert` confirm prompt;
 *     on confirm, calls `onRequestPayment()`. Loading prop disables it.
 *
 * Why a plain `Pressable` + `Alert.alert` instead of the legacy SwipeButton
 * confirm: Phase 7 is the natural home for the swipe-to-confirm UX, where
 * the dropoff geofence will gate the swipe (drivers shouldn't be able to
 * end a trip from across town). For Turn 4b we ship a working completion
 * path with a destructive-confirm alert so the screen is functionally
 * complete without pulling in an extra native dep.
 *
 * Why no Navigate-to-dropoff button here: Google Navigation SDK lands in
 * Phase 8.
 */
interface StartedViewProps {
  readonly ride: Ride;
  readonly onPressCancel: () => void;
  readonly onRequestPayment: () => void;
  readonly cancelDisabled?: boolean;
  readonly requestPaymentDisabled?: boolean;
}

export function StartedView({
  ride,
  onPressCancel,
  onRequestPayment,
  cancelDisabled,
  requestPaymentDisabled,
}: StartedViewProps) {
  const directions = ride.dropoff.directions;
  const eta = directions ? formatEta(directions.durationSeconds) : null;
  const distance = directions ? directions.distanceText : null;
  const passenger = ride.passenger;
  const fare = computeFare(ride);

  const handleRequestPayment = (): void => {
    if (requestPaymentDisabled) return;
    Alert.alert(
      'Request payment?',
      'This ends the trip and charges the rider. Make sure the rider has been dropped off.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Request payment',
          style: 'destructive',
          onPress: onRequestPayment,
        },
      ],
    );
  };

  return (
    <View>
      <BottomSheetHeader
        title={eta ? `Arriving in ${eta}` : 'On the way'}
        subtitle={distance ? `${distance} to dropoff` : undefined}
        trailing={
          <HeaderIconButton
            label="Cancel ride"
            tone="destructive"
            onPress={onPressCancel}
            disabled={cancelDisabled}
            testID="started-cancel"
          >
            <Text className="text-sm font-semibold text-error">Cancel</Text>
          </HeaderIconButton>
        }
      />

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">
          Passenger
        </Text>
        <Text className="mt-0.5 text-base font-semibold text-foreground">
          {passenger.name.first} {passenger.name.last.charAt(0)}.
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">Dropoff</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.dropoff.placeName ?? ride.dropoff.address}
        </Text>
      </View>

      <View className="border-t border-border px-4 py-3">
        <Text className="text-xs uppercase text-muted-foreground">
          Estimated fare
        </Text>
        <View className="mt-1">
          <FareEstimate fare={fare} />
        </View>
        <Text className="mt-1 text-xs text-muted-foreground">
          Final fare is computed when you request payment.
        </Text>
      </View>

      <View className="px-4 pt-4">
        <Pressable
          onPress={handleRequestPayment}
          disabled={requestPaymentDisabled}
          accessibilityRole="button"
          accessibilityLabel="Request payment"
          accessibilityState={{ disabled: requestPaymentDisabled }}
          className={`items-center rounded-xl px-4 py-4 ${
            requestPaymentDisabled ? 'bg-primary/60' : 'bg-primary'
          }`}
          testID="started-request-payment"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Request payment
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Compute a pre-final fare estimate for display only. Uses the route's
 * planned distance/duration since odometer readings won't exist until
 * Phase 7 wires real GPS-derived odometer.
 */
function computeFare(ride: Ride): Money | null {
  const directions = ride.dropoff.directions;
  if (!directions) return null;
  const r = FareCalculator.estimate({
    rideService: ride.rideService,
    distanceMeters: directions.distanceMeters,
    durationSeconds: directions.durationSeconds,
  });
  return r.ok ? r.value : null;
}

function formatEta(durationSeconds: number): string {
  if (durationSeconds < 60) return '< 1 min';
  const totalMinutes = Math.round(durationSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes)} min${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours)} hr ${String(mins)}m`;
}
