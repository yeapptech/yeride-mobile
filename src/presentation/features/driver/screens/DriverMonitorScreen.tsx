import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import { RideId } from '@domain/entities/RideId';
import { ChatModal } from '@presentation/components/chat/ChatModal';
import {
  DRIVER_CAR_MARKER,
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import { DriverCancelReasonSheet } from '@presentation/components/trip/DriverCancelReasonSheet';
import { useCurrentLocation, useWatchedLocation } from '@presentation/hooks';
import type {
  DriverStackNavigation,
  DriverStackScreenProps,
} from '@presentation/navigation/types';
import { useCurrentUserQuery } from '@presentation/queries';
import {
  useGpsCurrentHeading,
  useGpsCurrentLocation,
} from '@presentation/stores';

import { AtPickupView } from '../components/AtPickupView';
import { CompletedView } from '../components/CompletedView';
import { EnRouteToPickupView } from '../components/EnRouteToPickupView';
import { PaymentFailedView } from '../components/PaymentFailedView';
import { PaymentRequestedView } from '../components/PaymentRequestedView';
import { StartedView } from '../components/StartedView';
import { useNavigationSdkConnector } from '../hooks/useNavigationSdkConnector';
import { useDriverMonitorViewModel } from '../view-models/useDriverMonitorViewModel';

/**
 * DriverMonitorScreen — full-bleed map + bottom-sheet status-router for
 * the driver's active trip.
 *
 * Status-router map:
 *   - 'loading'                   → spinner (waiting on ride subscription).
 *   - 'en_route_to_pickup'        → `<EnRouteToPickupView>`.
 *   - 'at_pickup'                 → `<AtPickupView>`.
 *   - 'started'                   → `<StartedView>`.
 *   - 'payment_requested'         → `<PaymentRequestedView>` (intermediate
 *                                   while Stripe webhook flips the trip).
 *   - 'completed'                 → `<CompletedView>` (one-frame fallback;
 *                                   VM redirects to DriverTabs).
 *   - 'payment_failed'            → `<PaymentFailedView>` (driver stays
 *                                   on the screen — VM does NOT redirect).
 *   - 'cancelled' / 'gone'        → quiet "wrapping up" — the VM resets
 *                                   to DriverTabs immediately, so this
 *                                   is a one-frame fallback.
 *
 * Snap points 25 / 50 / 90 mirror the rider-side RideMonitor. The map
 * shows a fixed-size pool of children (always-mounted-children rule
 * from `<Map/>`); we drive visibility via props. The driver → pickup
 * polyline (green) shows during `dispatched`; the pickup → dropoff
 * polyline (gold via `selectedRoute`) shows during `started` /
 * `payment_requested` / `payment_failed` / `completed`.
 *
 * Cancel: every cancel-eligible status view's header cancel button opens
 * `DriverCancelReasonSheet`. The sheet hands a built `CancellationReason`
 * to `vm.cancel({ reason })`; the VM's terminal redirect handles the
 * post-cancel navigation.
 *
 * Close-trip: `CompletedView` + `PaymentFailedView` both expose a "Close
 * trip" CTA that resets the stack to DriverTabs. The VM auto-redirects
 * on `completed` (via terminal-redirect ref), so the CompletedView CTA
 * is largely defensive — the canonical use is the PaymentFailed path
 * where the VM does NOT auto-redirect.
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
  const watched = useWatchedLocation(
    currentLocation.permissionStatus === 'granted',
  );
  // Read the GPS-store selectors unconditionally — a hook can't sit behind a
  // `??` short-circuit (it would stop being called once `watched` emits).
  const gpsLocation = useGpsCurrentLocation();
  const gpsHeading = useGpsCurrentHeading();
  // Live driver coordinate + heading: foreground watch FIRST (10m, ungated),
  // then the BG stream, then the one-shot cold-start read — so the car marker
  // tracks + rotates with the driver. Watch-first is required: the BG SDK
  // emits one fix then goes quiet behind its 200m filter + activity gate
  // (stationary on the emulator), so a BG-first order freezes the marker on
  // that stale fix instead of following.
  const liveLocation =
    watched.coordinates ?? gpsLocation ?? currentLocation.coordinates;
  const liveHeading = watched.heading ?? gpsHeading;
  const navigation = useNavigation<DriverStackNavigation>();
  const userQuery = useCurrentUserQuery();
  // Push the SDK NavigationController into our adapter as soon as
  // DriverMonitor mounts. This makes the controller alive whenever
  // the driver is on an active trip — well before they tap "Open
  // Navigation" — so `vm.onLaunchNavigation` can call `init()`
  // through the adapter without racing the screen-level mount of
  // `<NavigationView/>` (legacy `getCurrentActivity()` null quirk).
  // Phase 8 turn 2.
  useNavigationSdkConnector();
  const vm = useDriverMonitorViewModel({
    rideId,
  });

  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['25%', '50%', '90%'], []);

  // ── Cancel sheet ───────────────────────────────────────────────
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);
  const openCancelSheet = useCallback(() => {
    setCancelSheetVisible(true);
  }, []);
  const closeCancelSheet = useCallback(() => {
    setCancelSheetVisible(false);
  }, []);
  const handleCancelConfirm = useCallback(
    async (reason: CancellationReason) => {
      const ok = await vm.cancel({ reason });
      if (ok) {
        setCancelSheetVisible(false);
      }
    },
    [vm],
  );

  // ── Close-trip handler (CompletedView + PaymentFailedView) ─────
  const handleCloseTrip = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'DriverTabs' }],
    });
  }, [navigation]);

  // ── Map slots ──────────────────────────────────────────────────
  const ride = vm.ride;
  const initialRegion = ride
    ? {
        latitude: ride.pickup.location.latitude,
        longitude: ride.pickup.location.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : liveLocation
      ? {
          latitude: liveLocation.latitude,
          longitude: liveLocation.longitude,
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

  const dropoffMarker: MapMarkerProps | null = ride
    ? {
        coordinates: ride.dropoff.location,
        title: ride.dropoff.placeName ?? ride.dropoff.address ?? 'Dropoff',
      }
    : null;

  const driverMarker: MapMarkerProps | null = liveLocation
    ? {
        coordinates: liveLocation,
        title: 'You',
        image: DRIVER_CAR_MARKER,
        rotation: liveHeading ?? 0,
        flat: true,
      }
    : null;

  // Driver → pickup polyline only while dispatched (en-route OR at-pickup
  // are both server-status `dispatched`). Once the trip starts, this
  // green route disappears.
  const pickupMapRoute: MapRoute | null =
    ride?.status === 'dispatched' && ride.pickup.directions
      ? {
          id: ride.pickup.directions.routeToken || 'pickup',
          encodedPolyline: ride.pickup.directions.encodedPolyline,
        }
      : null;

  // Pickup → dropoff polyline (gold "selectedRoute") shown from `started`
  // through any terminal-but-still-rendered late status. We keep it
  // mounted across `payment_requested` / `payment_failed` / `completed`
  // so the map doesn't visibly redraw across the brief late-state
  // transitions.
  const isLateStatus =
    ride?.status === 'started' ||
    ride?.status === 'payment_requested' ||
    ride?.status === 'completed' ||
    ride?.status === 'payment_failed';
  const dropoffMapRoute: MapRoute | null =
    isLateStatus && ride?.dropoff.directions
      ? {
          id: ride.dropoff.directions.routeToken || 'dropoff',
          encodedPolyline: ride.dropoff.directions.encodedPolyline,
        }
      : null;

  return (
    <View className="flex-1 bg-background">
      <Map
        initialRegion={initialRegion}
        pickup={pickupMarker}
        dropoff={dropoffMarker}
        driver={driverMarker}
        selectedRoute={dropoffMapRoute}
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
              onPressCancel={openCancelSheet}
              onPressChat={vm.onPressChat}
              hasUnread={vm.hasUnreadMessages}
              onLaunchNavigation={() => {
                void vm.onLaunchNavigation();
              }}
              cancelDisabled={vm.isCancelling}
              launchNavigationDisabled={vm.isLaunchingNavigation}
            />
          ) : vm.status === 'at_pickup' ? (
            <AtPickupView
              ride={ride}
              onStartRide={() => {
                void vm.onStartRide();
              }}
              onBackToEnRoute={vm.onBackToEnRoute}
              onPressCancel={openCancelSheet}
              onPressChat={vm.onPressChat}
              hasUnread={vm.hasUnreadMessages}
              cancelDisabled={vm.isCancelling}
              startDisabled={vm.isStarting}
            />
          ) : vm.status === 'started' ? (
            <StartedView
              ride={ride}
              onPressCancel={openCancelSheet}
              onRequestPayment={() => {
                void vm.requestPayment();
              }}
              onPressChat={vm.onPressChat}
              hasUnread={vm.hasUnreadMessages}
              onLaunchNavigation={() => {
                void vm.onLaunchNavigation();
              }}
              cancelDisabled={vm.isCancelling}
              requestPaymentDisabled={vm.isRequestingPayment}
              launchNavigationDisabled={vm.isLaunchingNavigation}
            />
          ) : vm.status === 'payment_requested' ? (
            <PaymentRequestedView
              ride={ride}
              onPressChat={vm.onPressChat}
              hasUnread={vm.hasUnreadMessages}
            />
          ) : vm.status === 'completed' ? (
            <CompletedView ride={ride} onClose={handleCloseTrip} />
          ) : vm.status === 'payment_failed' ? (
            <PaymentFailedView ride={ride} onClose={handleCloseTrip} />
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

      <DriverCancelReasonSheet
        visible={cancelSheetVisible}
        isSubmitting={vm.isCancelling}
        errorMessage={vm.cancelError}
        onClose={closeCancelSheet}
        onConfirm={handleCancelConfirm}
      />

      {/* Phase 10 turn 8 — driver-side in-trip chat modal. Mounted as a
          sibling to the bottom-sheet + cancel sheet. Gated on the
          user query so we don't render gifted-chat before we have a
          name to display. */}
      {userQuery.data && (
        <ChatModal
          visible={vm.chatOpen}
          onClose={vm.closeChat}
          rideId={rideId}
          userId={userQuery.data.id}
          userName={userQuery.data.name}
          role="driver"
        />
      )}
    </View>
  );
}
