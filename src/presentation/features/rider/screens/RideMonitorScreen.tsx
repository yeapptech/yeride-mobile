import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';
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
import { PermissionDeniedBanner } from '@presentation/components/permission';
import { CancelReasonSheet } from '@presentation/components/trip/CancelReasonSheet';
import type {
  RiderStackNavigation,
  RiderStackScreenProps,
} from '@presentation/navigation/types';

import { AwaitingDriverView } from '../components/AwaitingDriverView';
import { CompletedView } from '../components/CompletedView';
import { DispatchedView } from '../components/DispatchedView';
import { PaymentFailedView } from '../components/PaymentFailedView';
import { StartedView } from '../components/StartedView';
import { useRideMonitorViewModel } from '../view-models/useRideMonitorViewModel';

/**
 * RideMonitorScreen — top half map + bottom-half `@gorhom/bottom-sheet`
 * with a status-router that picks the right view for `ride.status`.
 *
 * Phase 3 turn 3.4b status-router map:
 *   - `awaiting_driver` / `scheduled` / `scheduled_driver_accepted`
 *                                  → `AwaitingDriverView`
 *   - `dispatched`                 → `DispatchedView`
 *   - `started`                    → `StartedView`
 *   - `payment_requested` / `completed` → `CompletedView`
 *      (`completed` also triggers the view-model's redirect to
 *      `RideReceiptScreen`; the `CompletedView` is what shows during
 *      the brief `payment_requested → completed` window before the
 *      Stripe webhook lands)
 *   - `payment_failed`             → `PaymentFailedView`
 *   - `cancelled`                  → never rendered; the view-model
 *      resets navigation to RiderTabs immediately
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
  const navigation = useNavigation<RiderStackNavigation>();

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

      {/* Phase 9 turn 10. Background-geolocation permission denied during
          an active trip — surface a banner above the bottom-sheet so the
          rider has a path to recover. The VM gates `bgPermissionDenied`
          on the trip status (`'dispatched'` or `'started'`), so this
          banner doesn't appear pre-trip / post-trip when GPS isn't
          actively in use. */}
      {vm.bgPermissionDenied && (
        <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0">
          <View
            className="mx-4 mt-2"
            testID="ride-monitor-bg-permission-banner"
          >
            <PermissionDeniedBanner
              title="We can't see where you are"
              message="YeRide needs location access to track your trip and warn you if you leave the pickup area. Tap below to enable it in Settings."
              onOpenSettings={vm.onOpenSettings}
            />
          </View>
        </SafeAreaView>
      )}

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
          ) : ride.status === 'awaiting_driver' ||
            ride.status === 'scheduled' ||
            ride.status === 'scheduled_driver_accepted' ? (
            <AwaitingDriverView
              ride={ride}
              onPressCancel={openCancel}
              cancelDisabled={vm.isCancelling}
            />
          ) : ride.status === 'dispatched' ? (
            <DispatchedView
              ride={ride}
              onPressCancel={openCancel}
              onPressChat={vm.onPressChat}
              cancelDisabled={vm.isCancelling}
              liveDurationSeconds={vm.liveDurationSeconds}
              liveDistanceMeters={vm.liveDistanceMeters}
            />
          ) : ride.status === 'started' ? (
            <StartedView
              ride={ride}
              hasUnread={vm.hasUnreadMessages}
              onPressCancel={openCancel}
              onPressChat={vm.onPressChat}
              cancelDisabled={vm.isCancelling}
              liveDurationSeconds={vm.liveDurationSeconds}
              liveDistanceMeters={vm.liveDistanceMeters}
            />
          ) : ride.status === 'payment_requested' ||
            ride.status === 'completed' ? (
            <CompletedView
              ride={ride}
              onViewReceipt={() =>
                navigation.replace('RideReceipt', { rideId: String(rideId) })
              }
            />
          ) : ride.status === 'payment_failed' ? (
            <PaymentFailedView ride={ride} />
          ) : (
            // 'cancelled' should never render here — the view-model
            // redirects on that status — but if React commits a frame
            // before the redirect lands, fall back to a quiet message.
            <View className="px-4 py-6">
              <Text className="text-sm text-muted-foreground">
                Wrapping up…
              </Text>
            </View>
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
