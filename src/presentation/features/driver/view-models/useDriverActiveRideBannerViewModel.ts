import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

import type { RideStatus } from '@domain/entities/RideStatus';
import type { UseActiveRideBannerViewModel } from '@presentation/features/rider/view-models/useRiderActiveRideBannerViewModel';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import { useInProgressDriverRideQuery } from '@presentation/queries';
import { useCurrentUserId } from '@presentation/stores';

/** Driver-facing status copy for the active-ride banner. */
export function driverBannerLabel(status: RideStatus): string {
  switch (status) {
    case 'scheduled_driver_accepted':
      return 'Pickup scheduled';
    case 'dispatched':
      return 'Heading to pickup';
    case 'started':
      return 'Trip in progress';
    case 'payment_requested':
      return 'Awaiting payment';
    case 'payment_failed':
      return 'Payment issue';
    default:
      return 'Active ride';
  }
}

export function useDriverActiveRideBannerViewModel(): UseActiveRideBannerViewModel {
  const navigation = useNavigation<DriverStackNavigation>();
  const driverId = useCurrentUserId();
  const { data: ride } = useInProgressDriverRideQuery(driverId);

  const onReturn = useCallback(() => {
    if (ride) {
      navigation.navigate('DriverMonitor', { rideId: String(ride.id) });
    }
  }, [ride, navigation]);

  return {
    visible: ride != null,
    statusLabel: ride ? driverBannerLabel(ride.status) : '',
    onReturn,
  };
}
