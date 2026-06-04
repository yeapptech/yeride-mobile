import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

import type { RideStatus } from '@domain/entities/RideStatus';
import type { ActiveRideBannerViewModel } from '@presentation/components/trip/ActiveRideBanner';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useInProgressRideQuery } from '@presentation/queries';
import { useCurrentUserId } from '@presentation/stores';

/** Rider-facing status copy for the active-ride banner. */
export function riderBannerLabel(status: RideStatus): string {
  switch (status) {
    case 'awaiting_driver':
      return 'Finding your driver';
    case 'scheduled_driver_accepted':
      return 'Driver assigned';
    case 'dispatched':
      return 'Driver on the way';
    case 'started':
      return 'On your trip';
    case 'payment_requested':
      return 'Wrapping up';
    case 'payment_failed':
      return 'Payment issue — tap to resolve';
    default:
      return 'Ride in progress';
  }
}

export function useRiderActiveRideBannerViewModel(): ActiveRideBannerViewModel {
  const navigation = useNavigation<RiderStackNavigation>();
  const userId = useCurrentUserId();
  const { data: ride } = useInProgressRideQuery(userId);

  const onReturn = useCallback(() => {
    if (ride) {
      navigation.navigate('RideMonitor', { rideId: String(ride.id) });
    }
  }, [ride, navigation]);

  return {
    visible: ride != null,
    statusLabel: ride ? riderBannerLabel(ride.status) : '',
    onReturn,
  };
}
