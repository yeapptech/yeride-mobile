import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import { RideId } from '@domain/entities/RideId';
import {
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import { CancelReasonSheet } from '@presentation/components/trip/CancelReasonSheet';
import type { RiderStackScreenProps } from '@presentation/navigation/types';

import { AwaitingDriverView } from '../components/AwaitingDriverView';
import { DispatchedView } from '../components/DispatchedView';
import { useRideMonitorViewModel } from '../view-models/useRideMonitorViewModel';

/**
 * RideMonitorScreen — top half map + bottom-half `@gorhom/bottom-sheet`
 * with a status-router that picks the right view for `ride.status`.
 *
 * Phase 3 turn 3.4a wires:
 *   - `awaiting_driver` → `AwaitingDriverView`
 *   - `dispatched`      → `DispatchedView`
 *   - other statuses    → fallback "next view lands in turn 3.4b"
 *
 * Turn 3.4b adds StartedView / CompletedView / PaymentFailedView and
 * the chat-stub toast.
 *
 * The bottom-sheet snap points pick three positions:
 *   - 25% (just the header peeking)
 *   - 50% (header + primary content)
 *   - 90% (full content + scroll)
 *
 * Map gestures pass through to the underlying MapView when the sheet is
 * at its lowest snap. `@gorhom/bottom-sheet` handles the hand-off between
 * pan-to-resize and map-drag automatically as long as the sheet is
 * mounted as a sibling (not a child) of the map.
 */
export default function RideMonitorScreen({
  route,
}: RiderStackScreenProps<'RideMonitor'>) {
  const rideIdR = RideId.create(route.params.rideId);
  if (!rideIdR.ok) {
    // Unreachable in practice — RouteSelect mints valid ids — but
    // surface a friendly error if a deep link delivers a bad id.
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base text-error">
          Invalid ride id. Please return home and try again.
        </Text>
      </SafeAreaView>
    );
  }
  return <RideMonitorContent rideId={rideIdR.value} />;
}

function RideMonitorContent({ rideId }: { rideId: RideId }) {
  const vm = useRideMonitorViewModel({ rideId });

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['25%', '50%', '90%'], []);

  const [cancelOpen, setCancelOpen] = useState(false);
  const openCancel = useCallback(() => setCancelOpen(true), []);
  const closeCancel = useCallback(() => setCancelOpen(false), []);

  const handleCancel = useCallback(
    async (reason: CancellationReason): Promise<void> => {
      const ok = await vm.cancel({ reason });
      if (ok) closeCancel();
    },
    [vm, closeCancel],
  );

  // Map markers / polylines derived from the live ride. Always pass
  // null/empty when a piece is missing — the shared Map's always-mounted-
  // children rule treats those as "hidden".
  const ride = vm.ride;
  const initialRegion = ride
    ? {
        latitude: ride.pickup.location.latitude,
        longitude: ride.pickup.location.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : null;

  const pickupMarker: MapMarkerProps | null = ride
    ? { coordinates: ride.pickup.location, title: 'Pickup' }
    : null;
  const dropoffMarker: MapMarkerProps | null = ride
    ? { coordinates: ride.dropoff.location, title: 'Dropoff' }
    : null;
  // Driver location pin lands when GPS lifecycle is wired in Phase 4 —
  // the live `users/{driverId}.location` subscription will feed it.
  const driverMarker: MapMarkerProps | null = null;

  const selectedRouteForMap: MapRoute | null = ride?.dropoff.directions
    ? {
        id: ride.dropoff.directions.routeToken || 'selected',
        encodedPolyline: ride.dropoff.directions.encodedPolyline,
      }
    : null;

  const pickupRouteForMap: MapRoute | null =
    ride?.status === 'dispatched' && ride.pickup.directions
      ? {
          id: ride.pickup.directions.routeToken || 'pickup-route',
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
        selectedRoute={selectedRouteForMap}
        pickupRoute={pickupRouteForMap}
        alternativeRoutes={[]}
      />

      <BottomSheet
        ref={sheetRef}
        index={1}
        snapPoints={snapPoints}
        // Disable the close-on-backdrop-tap default so the sheet stays
        // anchored even when the rider taps the map.
        enablePanDownToClose={false}
        // Keyboard behaviour matters for the cancel-reason "Other" text
        // box. The sheet manages keyboard avoidance natively.
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
      >
        <BottomSheetView style={{ flex: 1 }}>
          {ride === null ? (
            <View className="flex-1 items-center justify-center px-4 py-8">
              <ActivityIndicator size="large" />
              <Text className="mt-3 text-sm text-muted-foreground">
                Loading your ride…
              </Text>
            </View>
          ) : ride.status === 'awaiting_driver' ? (
            <AwaitingDriverView
              ride={ride}
              onPressCancel={openCancel}
              cancelDisabled={vm.isCancelling}
            />
          ) : ride.status === 'dispatched' ? (
            <DispatchedView
              ride={ride}
              onPressCancel={openCancel}
              onPressChat={onChatStub}
              cancelDisabled={vm.isCancelling}
            />
          ) : (
            <FutureStatusFallback status={ride.status} />
          )}
        </BottomSheetView>
      </BottomSheet>

      <CancelReasonSheet
        visible={cancelOpen}
        isSubmitting={vm.isCancelling}
        errorMessage={vm.cancelError}
        onClose={closeCancel}
        onConfirm={handleCancel}
      />
    </View>
  );
}

/**
 * Placeholder copy for statuses whose status views land in turn 3.4b.
 * Keeps the screen functional during a partial roll-out (e.g. a beta
 * tester whose ride raced ahead of the rider client's deploy).
 */
function FutureStatusFallback({ status }: { status: string }) {
  return (
    <View className="px-4 py-6">
      <Text className="text-base font-semibold text-foreground">
        Status: {status}
      </Text>
      <Text className="mt-2 text-sm text-muted-foreground">
        The view for this status lands in Phase 3 turn 3.4b. The ride itself is
        unaffected — you can come back to this screen once the driver continues.
      </Text>
    </View>
  );
}

/**
 * Phase 3 turn 3.4a chat stub. Phase 3.5 replaces this with a real
 * thread modal.
 */
function onChatStub(): void {
  // intentionally empty — Phase 3.5 fills this in
}
