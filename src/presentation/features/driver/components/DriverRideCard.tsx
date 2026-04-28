import { Pressable, Text, View } from 'react-native';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';

/**
 * Single ride-card the driver sees in the DriverHome bottom panel when a
 * rider has requested a ride nearby. Tapping pushes `DriverDispatch` with
 * the rideId — Turn 2 lands on a placeholder; Turn 3 wires the real
 * accept/decline use cases.
 *
 * Distance from the driver is computed via Coordinates' Haversine helper
 * — same math the legacy app uses to label cards "0.8 mi away".
 *
 * Fare displayed is derived from `ride.dropoff.directions` (the rider's
 * planned distance + duration to the dropoff), since the rider already
 * has it on the doc. No client-side fare estimation here — the rider
 * paid for it; the driver just sees the displayed numbers.
 */
export interface DriverRideCardProps {
  readonly ride: Ride;
  readonly driverLocation: Coordinates | null;
  readonly onPress: (rideId: string) => void;
}

export function DriverRideCard({
  ride,
  driverLocation,
  onPress,
}: DriverRideCardProps) {
  const distanceFromDriverText = driverLocation
    ? formatMilesAway(
        driverLocation.distanceTo(ride.pickup.location), // meters
      )
    : null;

  const directionsText = ride.dropoff.directions
    ? `${ride.dropoff.directions.distanceText} · ${ride.dropoff.directions.durationText}`
    : null;

  return (
    <Pressable
      onPress={() => onPress(String(ride.id))}
      accessibilityRole="button"
      accessibilityLabel={`Ride request from ${ride.pickup.address ?? 'pickup'}`}
      testID={`driver-ride-card-${String(ride.id)}`}
      className="mb-2 rounded-xl bg-card p-3 shadow"
    >
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground">
          {ride.rideService.name}
        </Text>
        {distanceFromDriverText && (
          <Text className="text-xs text-muted-foreground">
            {distanceFromDriverText}
          </Text>
        )}
      </View>
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {ride.pickup.placeName ?? ride.pickup.address ?? 'Pickup'}
      </Text>
      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
        → {ride.dropoff.placeName ?? ride.dropoff.address ?? 'Dropoff'}
      </Text>
      {directionsText && (
        <Text className="mt-1 text-xs text-muted-foreground">
          {directionsText}
        </Text>
      )}
    </Pressable>
  );
}

function formatMilesAway(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return 'Right here';
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}
