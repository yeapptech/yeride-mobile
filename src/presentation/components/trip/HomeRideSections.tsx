import { Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';

import { TripCard } from './TripCard';

/**
 * The In-progress + Scheduled ride sections shown inside the rider/driver
 * Home bottom sheet. Pure/presentational: the Home view-models supply the
 * lists + the tap handler. Renders nothing when both lists are empty so
 * Home stays clean when there's nothing active (matches legacy
 * `InProgressTrips` / `ScheduledTrips` returning null on empty).
 *
 * The driver passes `scheduledRides={[]}` in Phase 1 (drivers can't accept
 * scheduled rides yet), so the Scheduled section never renders for drivers.
 */
export interface HomeRideSectionsProps {
  readonly inProgressRides: readonly Ride[];
  readonly scheduledRides: readonly Ride[];
  readonly viewerRole: 'rider' | 'driver';
  readonly onSelectRide: (ride: Ride) => void;
}

export function HomeRideSections({
  inProgressRides,
  scheduledRides,
  viewerRole,
  onSelectRide,
}: HomeRideSectionsProps) {
  if (inProgressRides.length === 0 && scheduledRides.length === 0) {
    return null;
  }
  return (
    <View testID="home-ride-sections">
      {inProgressRides.length > 0 && (
        <View testID="home-in-progress-section" className="mt-3">
          <Text className="mb-2 text-sm font-semibold text-foreground">
            In progress
          </Text>
          {inProgressRides.map((ride) => (
            <TripCard
              key={String(ride.id)}
              ride={ride}
              viewerRole={viewerRole}
              onPress={onSelectRide}
            />
          ))}
        </View>
      )}
      {scheduledRides.length > 0 && (
        <View testID="home-scheduled-section" className="mt-3">
          <Text className="mb-2 text-sm font-semibold text-foreground">
            Scheduled
          </Text>
          {scheduledRides.map((ride) => (
            <TripCard
              key={String(ride.id)}
              ride={ride}
              viewerRole={viewerRole}
              onPress={onSelectRide}
            />
          ))}
        </View>
      )}
    </View>
  );
}
