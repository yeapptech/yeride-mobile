import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CancellationReason } from '@domain/entities/CancellationReason';
import { RideId } from '@domain/entities/RideId';
import {
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import { useCurrentLocation } from '@presentation/hooks';
import type { DriverStackScreenProps } from '@presentation/navigation/types';

import { AtPickupView } from '../components/AtPickupView';
import { EnRouteToPickupView } from '../components/EnRouteToPickupView';
import { useDriverMonitorViewModel } from '../view-models/useDriverMonitorViewModel';

/**
 * DriverMonitorScreen — full-bleed map + bottom-sheet status-router for
 * the driver's active trip.
 *
 * Turn 4a status-router map:
 *   - 'loading'                   → spinner (waiting on ride subscription).
 *   - 'en_route_to_pickup'        → `<EnRouteToPickupView>`.
 *   - 'at_pickup'                 → `<AtPickupView>`.
 *   - 'future_status_fallback'    → "More to come (Turn 4b)" placeholder
 *                                   for `started` / `payment_requested`
 *                                   / `payment_failed` / `completed`.
 *   - 'cancelled' / 'gone'        → quiet "wrapping up" — the VM resets
 *                                   to DriverHome immediately, so this
 *                                   is a one-frame fallback.
 *
 * Snap points 25 / 50 / 90 mirror the rider-side RideMonitor. The map
 * shows a fixed-size pool of children (always-mounted-children rule
 * from `<Map/>`); we drive visibility via props.
 *
 * Cancel-button stub (Turn 4a):
 *   The header cancel button on each early-status view pops a confirm
 *   `Alert.alert`. Confirm calls `vm.cancel(reason)` with a hard-coded
 *   driver-allowed code per status (`'changed_mind'` while en route;
 *   `'passenger_no_show'` once arrived). The full per-reason picker
 *   modal lands in Turn 4b.
 */
export default function DriverMonitorScreen({
  route,
}: DriverStackScreenProps<'DriverMonitor'>) {
  const { rideId: rideIdParam } = route.params;
  const rideIdR = RideId.create(rideIdParam);
  if (!rideIdR.ok) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base text-error">
          Invalid ride id. Please return home and try again.
        </Text>
      </SafeAreaView>
    );
  }
  return <DriverMonitorContent rideId={rideIdR.value} />;
}

function DriverMonitorContent({ rideId }: { rideId: RideId }) {
  const currentLocation = useCurrentLocation();
  const vm = useDriverMonitorViewModel({
    rideId,
    driverLocation: currentLocation.coordinates,
  });

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['25%', '50%', '90%'], []);

  const handleEnRouteCancel = useCallback(() => {
    confirmCancelWithCode({
      code: 'changed_mind',
      message:
        'Cancelling will release the rider back to the queue. Are you sure?',
      cancel: vm.cancel,
    });
  }, [vm.cancel]);

  const handleAtPickupCancel = useCallback(() => {
    confirmCancelWithCode({
      code: 'passenger_no_show',
      message:
        'Mark this ride as a passenger no-show? The rider will be charged the cancellation fee.',
      cancel: vm.cancel,
    });
  }, [vm.cancel]);

  // ── Map slots ──────────────────────────────────────────────────
  const ride = vm.ride;
  const initialRegion = ride
    ? {
        latitude: ride.pickup.location.latitude,
        longitude: ride.pickup.location.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : currentLocation.coordinates
      ? {
          latitude: currentLocation.coordinates.latitude,
          longitude: currentLocation.coordinates.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }
      : null;

  const pickupMarker: MapMarkerProps | null = ride
    ? {
        coordinates: ride.pickup.location,
        title: ride.pickup.placeName ?? ride.pickup.address ?? 'Pickup',
      }
    : null;

  // Dropoff pin: visible from dispatch onward so the driver can see where
  // they're headed once the trip starts. Hidden until the ride doc is in.
  const dropoffMarker: MapMarkerProps | null = ride
    ? {
        coordinates: ride.dropoff.location,
        title: ride.dropoff.placeName ?? ride.dropoff.address ?? 'Dropoff',
      }
    : null;

  const driverMarker: MapMarkerProps | null = currentLocation.coordinates
    ? { coordinates: currentLocation.coordinates, title: 'You' }
    : null;

  // Driver → pickup polyline while the trip is dispatched. Once Turn 4b
  // lands `StartedView`, we'll swap the green pickup-route polyline for
  // the gold pickup → dropoff `selectedRoute` from `ride.dropoff`.
  const pickupMapRoute: MapRoute | null =
    ride?.status === 'dispatched' && ride.pickup.directions
      ? {
          id: ride.pickup.directions.routeToken || 'pickup',
          encodedPolyline: ride.pickup.directions.encodedPolyline,
        }
      : null;

  return (
    <View className="flex-1 bg-background">
      <Map
        initialRegion={initialRegion}
        pickup={pickupMarker}
        dropoff={dropoffMarker}
        driver={driverMarker}
        selectedRoute={null}
        pickupRoute={pickupMapRoute}
        alternativeRoutes={[]}
      />

      <BottomSheet
        ref={sheetRef}
        index={1}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
      >
        <BottomSheetView style={{ flex: 1 }}>
          {ride === null || vm.status === 'loading' ? (
            <View className="flex-1 items-center justify-center px-4 py-8">
              <ActivityIndicator size="large" />
              <Text className="mt-3 text-sm text-muted-foreground">
                Loading your trip…
              </Text>
            </View>
          ) : vm.status === 'en_route_to_pickup' ? (
            <EnRouteToPickupView
              ride={ride}
              onArrived={vm.onArriveAtPickup}
              onPressCancel={handleEnRouteCancel}
              cancelDisabled={vm.isCancelling}
            />
          ) : vm.status === 'at_pickup' ? (
            <AtPickupView
              ride={ride}
              onStartRide={vm.onStartRide}
              onBackToEnRoute={vm.onBackToEnRoute}
              onPressCancel={handleAtPickupCancel}
              cancelDisabled={vm.isCancelling}
            />
          ) : vm.status === 'future_status_fallback' ? (
            <View className="px-4 py-6">
              <Text className="text-base font-semibold text-foreground">
                Trip in progress
              </Text>
              <Text className="mt-1 text-sm text-muted-foreground">
                Started / payment / completion views land in Turn 4b.
              </Text>
            </View>
          ) : (
            // 'cancelled' / 'gone' — VM redirects so this is a single
            // frame at most. Quiet message instead of a spinner so we
            // don't imply the screen is still doing work.
            <View className="px-4 py-6">
              <Text className="text-sm text-muted-foreground">
                Wrapping up…
              </Text>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

/**
 * Helper for the Turn 4a cancel stub: pops `Alert.alert` to confirm,
 * then constructs the `CancellationReason` and calls the VM's `cancel`.
 *
 * `'changed_mind'` is in the common (either-party) set, valid during
 * en-route. `'passenger_no_show'` is driver-only and the natural code
 * for the at-pickup intermediate state. The full picker UI in Turn 4b
 * will let the driver pick from the entire driver-allowed set; this
 * helper exists only so 4a can ship a working cancel without the
 * picker.
 */
function confirmCancelWithCode(args: {
  code: 'changed_mind' | 'passenger_no_show';
  message: string;
  cancel: (cancelArgs: { reason: CancellationReason }) => Promise<boolean>;
}): void {
  Alert.alert('Cancel ride?', args.message, [
    { text: 'Keep ride', style: 'cancel' },
    {
      text: 'Cancel ride',
      style: 'destructive',
      onPress: () => {
        const reasonR = CancellationReason.create({
          code: args.code,
          reasonText: null,
        });
        if (!reasonR.ok) {
          // Both hard-coded codes are in the driver-allowed set with
          // `reasonText: null`, so this branch is unreachable in
          // practice. The alert just exits silently if it ever fires.
          return;
        }
        void args.cancel({ reason: reasonR.value });
      },
    },
  ]);
}
