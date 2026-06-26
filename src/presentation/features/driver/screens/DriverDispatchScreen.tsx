import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import {
  DRIVER_CAR_MARKER,
  Map,
  type MapMarkerProps,
} from '@presentation/components/map';
import { Button } from '@presentation/components/ui/Button';
import { useCurrentLocation, useWatchedLocation } from '@presentation/hooks';
import type { DriverStackScreenProps } from '@presentation/navigation/types';
import {
  useGpsCurrentHeading,
  useGpsCurrentLocation,
} from '@presentation/stores';
import { formatMilesAway } from '@presentation/utils/formatDistance';

import { useDriverDispatchViewModel } from '../view-models/useDriverDispatchViewModel';
import type {
  CannotAcceptReason,
  DispatchAction,
  DriverDispatchStatus,
} from '../view-models/useDriverDispatchViewModel';

/**
 * DriverDispatchScreen — incoming-ride preview + accept/decline.
 *
 * Status-router on the bottom panel:
 *   - 'loading'        → spinner (waiting on user / route / subscription).
 *   - 'gone'           → "This ride was already taken" + dismiss.
 *   - 'cannot_accept'  → reason-specific message + back button (no accept).
 *   - 'ready'          → trip card + Accept / Decline.
 *   - 'accepting'      → button spinners; can't be cancelled mid-flight.
 *
 * The map shows pickup pin + driver "you are here" + the driver→pickup
 * polyline (when computed). Reuses the shared <Map/> component's slots.
 *
 * Per the YeRide dispatch model: there is NO offer-timeout / NO auto-pass
 * to next driver. The driver can sit on this screen indefinitely; the
 * race-condition handling is reactive — the live ObserveRide subscription
 * flips us to 'gone' if another driver wins.
 */
export default function DriverDispatchScreen({
  route,
}: DriverStackScreenProps<'DriverDispatch'>) {
  const { rideId: rideIdParam } = route.params;
  const rideIdR = RideId.create(rideIdParam);

  // Defensive: if the route param is malformed (shouldn't happen via the
  // typed param list, but kept as a guard for deep-link cases) render a
  // simple error state.
  if (!rideIdR.ok) {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="text-base text-error">Invalid ride id.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Key by rideId so a same-screen param change (e.g. a dispatch push while
  // already on DriverDispatch) remounts the inner component, resetting the
  // pinned-intent latch + location/route subscriptions to the new ride.
  return (
    <DriverDispatchInner key={String(rideIdR.value)} rideId={rideIdR.value} />
  );
}

function DriverDispatchInner({ rideId }: { rideId: RideId }) {
  const currentLocation = useCurrentLocation();
  // VM keys its subscriptions on the STABLE foreground read — don't pass the
  // live coordinate here or the dispatch subscription would churn on every
  // GPS tick. The live coordinate below only drives display (marker +
  // camera + "X mi away").
  const vm = useDriverDispatchViewModel({
    rideId,
    driverLocation: currentLocation.coordinates,
  });

  // Live driver coordinate + heading: foreground watch FIRST (10m, ungated),
  // then the BG stream, then the one-shot cold-start read — so the car marker
  // tracks + rotates with the driver. Watch-first is required: the BG SDK
  // emits one fix then goes quiet behind its 200m filter + activity gate
  // (stationary on the emulator), so a BG-first order freezes the marker on
  // that stale fix. The VM arg above stays on the stable one-shot read.
  const watched = useWatchedLocation(
    currentLocation.permissionStatus === 'granted',
  );
  // Read the GPS-store selectors unconditionally — a hook can't sit behind a
  // `??` short-circuit (it would stop being called once `watched` emits).
  const gpsLocation = useGpsCurrentLocation();
  const gpsHeading = useGpsCurrentHeading();
  const liveLocation =
    watched.coordinates ?? gpsLocation ?? currentLocation.coordinates;
  const liveHeading = watched.heading ?? gpsHeading;

  const initialRegion = vm.ride
    ? {
        latitude: vm.ride.pickup.location.latitude,
        longitude: vm.ride.pickup.location.longitude,
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

  const pickupMarker: MapMarkerProps | null = vm.ride
    ? {
        coordinates: vm.ride.pickup.location,
        title: vm.ride.pickup.placeName ?? vm.ride.pickup.address ?? 'Pickup',
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

  // Haversine "X mi away" to pickup — no Google call. The driver→pickup
  // route + polyline are computed AFTER the claim, in DriverMonitor.
  const pickupDistanceText =
    liveLocation && vm.ride
      ? formatMilesAway(liveLocation.distanceTo(vm.ride.pickup.location))
      : null;

  return (
    <View className="flex-1 bg-background">
      <Map
        initialRegion={initialRegion}
        pickup={pickupMarker}
        dropoff={null}
        driver={driverMarker}
        selectedRoute={null}
        pickupRoute={null}
        alternativeRoutes={[]}
      />

      <SafeAreaView
        edges={['bottom']}
        className="absolute left-0 right-0 bottom-0"
      >
        <View className="mx-4 mb-4 rounded-2xl bg-card p-4 shadow-lg">
          <DispatchPanel
            status={vm.status}
            action={vm.action}
            ride={vm.ride}
            cannotAcceptReason={vm.cannotAcceptReason}
            driverLocation={currentLocation.coordinates}
            pickupDistanceText={pickupDistanceText}
            onAccept={vm.onAccept}
            onDecline={vm.onDecline}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

interface DispatchPanelProps {
  readonly status: DriverDispatchStatus;
  readonly action: DispatchAction | null;
  readonly ride: Ride | null;
  readonly cannotAcceptReason: CannotAcceptReason | null;
  readonly driverLocation: Coordinates | null;
  readonly pickupDistanceText: string | null;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

function DispatchPanel({
  status,
  action,
  ride,
  cannotAcceptReason,
  driverLocation,
  pickupDistanceText,
  onAccept,
  onDecline,
}: DispatchPanelProps) {
  if (status === 'loading') {
    return (
      <View className="flex-row items-center gap-2 py-2">
        <ActivityIndicator size="small" />
        <Text className="text-sm text-foreground">Loading ride…</Text>
      </View>
    );
  }

  if (status === 'gone') {
    // For a begin intent (the driver's own accepted scheduled ride), 'gone'
    // means it left scheduled_driver_accepted — almost always a rider
    // cancellation, not another driver. Use accurate copy per action.
    const goneTitle =
      action === 'begin' ? 'No longer available' : 'Already taken';
    const goneBody =
      action === 'begin'
        ? 'This scheduled ride is no longer available — it may have been cancelled.'
        : "Another driver accepted this ride. You're back to the queue.";
    return (
      <View>
        <Text className="mb-2 text-base font-semibold text-foreground">
          {goneTitle}
        </Text>
        <Text className="mb-4 text-sm text-muted-foreground">{goneBody}</Text>
        <Button
          label="Back to home"
          onPress={onDecline}
          accessibilityLabel="Back to home"
          testID="driver-dispatch-back-home"
        />
      </View>
    );
  }

  if (status === 'cannot_accept') {
    return (
      <View>
        <Text className="mb-2 text-base font-semibold text-foreground">
          Can't accept yet
        </Text>
        <Text className="mb-4 text-sm text-muted-foreground">
          {messageForReason(cannotAcceptReason)}
        </Text>
        <Pressable
          onPress={onDecline}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          className="items-center rounded-xl bg-muted px-4 py-4"
          testID="driver-dispatch-cannot-accept-back"
        >
          <Text className="text-base font-semibold text-foreground">
            Back to home
          </Text>
        </Pressable>
      </View>
    );
  }

  // 'ready' or 'accepting' — both render the same panel; 'accepting'
  // disables the buttons and shows a spinner on Accept.
  const accepting = status === 'accepting';
  return (
    <View>
      {ride && (
        <View className="mb-3">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">
              {ride.rideService.name}
            </Text>
            {pickupDistanceText && (
              <Text className="text-xs text-muted-foreground">
                {pickupDistanceText}
              </Text>
            )}
          </View>
          <Text className="text-sm text-foreground" numberOfLines={1}>
            {ride.pickup.placeName ?? ride.pickup.address ?? 'Pickup'}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            → {ride.dropoff.placeName ?? ride.dropoff.address ?? 'Dropoff'}
          </Text>
          {ride.dropoff.directions && (
            <Text className="mt-1 text-xs text-muted-foreground">
              {ride.dropoff.directions.distanceText} ·{' '}
              {ride.dropoff.directions.durationText}
            </Text>
          )}
        </View>
      )}

      <View className="flex-row gap-2">
        <Pressable
          onPress={onDecline}
          disabled={accepting}
          accessibilityRole="button"
          accessibilityLabel="Decline"
          accessibilityState={{ disabled: accepting }}
          className={`flex-1 items-center rounded-2xl px-4 py-4 ${
            accepting ? 'bg-muted/50' : 'bg-muted'
          }`}
          testID="driver-dispatch-decline"
        >
          <Text className="text-base font-semibold text-foreground">
            Decline
          </Text>
        </Pressable>

        <Button
          label={acceptLabel(action)}
          onPress={onAccept}
          disabled={driverLocation === null}
          loading={accepting}
          accessibilityLabel={acceptLabel(action)}
          testID="driver-dispatch-accept"
          className="flex-1"
        />
      </View>
    </View>
  );
}

function acceptLabel(action: DispatchAction | null): string {
  switch (action) {
    case 'accept_schedule':
      return 'Accept scheduled ride';
    case 'begin':
      return 'Begin trip';
    default:
      return 'Accept';
  }
}

function messageForReason(reason: CannotAcceptReason | null): string {
  switch (reason) {
    case 'no_stripe_connect':
      return 'Complete Stripe onboarding from the Earnings tab to start accepting rides. (Lands in Phase 6.)';
    case 'no_active_vehicle':
      return 'Register a vehicle to start accepting rides. (Lands in Phase 5.)';
    case 'wrong_status':
      return 'This ride is no longer available.';
    case null:
      return '';
  }
}
