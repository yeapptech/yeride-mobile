import { Pressable, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import {
  BottomSheetHeader,
  HeaderIconButton,
} from '@presentation/components/trip/BottomSheetHeader';

/**
 * UI-only intermediate state during server status `dispatched`. The
 * driver has tapped "Arrived at pickup" on `EnRouteToPickupView`; the
 * ride is still `dispatched` server-side until they tap "Start ride"
 * here, which transitions to `started` (handler stubbed in Turn 4a;
 * full mutation lands in Turn 4b).
 *
 * Why this is UI-only and not a server status: legacy yeride doesn't
 * have an "at pickup" status either. Arrival is a client-side affordance
 * — the trip lifecycle stays `dispatched` until the actual pickup
 * happens. Phase 7's geofence-driven "passenger pickup zone entered"
 * event will auto-flip this; until then it's manual.
 *
 * The cancel button uses a driver-only code (`'passenger_no_show'`) for
 * Turn 4a. The full per-reason picker modal lands in Turn 4b alongside
 * the late-status views.
 */
interface AtPickupViewProps {
  readonly ride: Ride;
  readonly onStartRide: () => void;
  readonly onPressCancel: () => void;
  readonly onBackToEnRoute: () => void;
  readonly cancelDisabled?: boolean;
  readonly startDisabled?: boolean;
}

export function AtPickupView({
  ride,
  onStartRide,
  onPressCancel,
  onBackToEnRoute,
  cancelDisabled,
  startDisabled,
}: AtPickupViewProps) {
  const passenger = ride.passenger;

  return (
    <View>
      <BottomSheetHeader
        title="Pick up your passenger"
        subtitle={`Tap "Start ride" once ${passenger.name.first} is in the car.`}
        trailing={
          <HeaderIconButton
            label="Cancel ride"
            tone="destructive"
            onPress={onPressCancel}
            disabled={cancelDisabled}
            testID="at-pickup-cancel"
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
        <Text className="text-xs uppercase text-muted-foreground">Pickup</Text>
        <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
          {ride.pickup.placeName ?? ride.pickup.address}
        </Text>
      </View>

      <View className="px-4 pt-4">
        <Pressable
          onPress={onStartRide}
          disabled={startDisabled}
          accessibilityRole="button"
          accessibilityLabel="Start ride"
          accessibilityState={{ disabled: startDisabled }}
          className={`items-center rounded-xl px-4 py-4 ${
            startDisabled ? 'bg-primary/60' : 'bg-primary'
          }`}
          testID="at-pickup-start"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Start ride
          </Text>
        </Pressable>
      </View>

      <View className="items-center px-4 pb-4 pt-2">
        <Pressable
          onPress={onBackToEnRoute}
          accessibilityRole="button"
          accessibilityLabel="Back to en route"
          testID="at-pickup-back"
        >
          <Text className="text-sm font-medium text-muted-foreground underline">
            Not quite there yet — go back
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
