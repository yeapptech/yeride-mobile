import { Text, View } from 'react-native';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';

import { DriverRideCard } from './DriverRideCard';

/**
 * Stack of incoming-ride cards rendered in DriverHome's bottom panel
 * when the driver is online. Empty-state copy when no rides are
 * waiting — matches the legacy "Waiting for rides…" affordance.
 *
 * Phase 4 turn 3 may swap this for a `BottomSheet` if the card stack
 * grows tall enough to need scroll-handle UX. Turn 2 keeps it as a
 * plain stack — riders rarely have more than 2-3 active requests
 * within the geo radius at a time.
 */
export interface DriverRideCardStackProps {
  readonly rides: readonly Ride[];
  readonly driverLocation: Coordinates | null;
  readonly onSelectRide: (rideId: string) => void;
}

export function DriverRideCardStack({
  rides,
  driverLocation,
  onSelectRide,
}: DriverRideCardStackProps) {
  if (rides.length === 0) {
    return (
      <View className="rounded-xl bg-card p-4">
        <Text className="text-center text-sm font-medium text-foreground">
          Waiting for rides…
        </Text>
        <Text className="mt-1 text-center text-xs text-muted-foreground">
          You're online. New requests in your area will show up here.
        </Text>
      </View>
    );
  }

  return (
    <View>
      {rides.map((ride) => (
        <DriverRideCard
          key={String(ride.id)}
          ride={ride}
          driverLocation={driverLocation}
          onPress={onSelectRide}
        />
      ))}
    </View>
  );
}
