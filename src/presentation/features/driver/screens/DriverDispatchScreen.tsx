import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import {
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import { useCurrentLocation } from '@presentation/hooks';
import type { DriverStackScreenProps } from '@presentation/navigation/types';

import { useDriverDispatchViewModel } from '../view-models/useDriverDispatchViewModel';
import type {
  CannotAcceptReason,
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

  return <DriverDispatchInner rideId={rideIdR.value} />;
}

function DriverDispatchInner({ rideId }: { rideId: RideId }) {
  const currentLocation = useCurrentLocation();
  const vm = useDriverDispatchViewModel({
    rideId,
    driverLocation: currentLocation.coordinates,
  });

  const initialRegion = vm.ride
    ? {
        latitude: vm.ride.pickup.location.latitude,
        longitude: vm.ride.pickup.location.longitude,
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

  const pickupMarker: MapMarkerProps | null = vm.ride
    ? {
        coordinates: vm.ride.pickup.location,
        title: vm.ride.pickup.placeName ?? vm.ride.pickup.address ?? 'Pickup',
      }
    : null;

  const driverMarker: MapMarkerProps | null = currentLocation.coordinates
    ? {
        coordinates: currentLocation.coordinates,
        title: 'You',
      }
    : null;

  const pickupMapRoute: MapRoute | null = vm.pickupRoute
    ? { id: 'pickup', encodedPolyline: vm.pickupRoute.encodedPolyline }
    : null;

  return (
    <View className="flex-1 bg-background">
      <Map
        initialRegion={initialRegion}
        pickup={pickupMarker}
        dropoff={null}
        driver={driverMarker}
        selectedRoute={null}
        pickupRoute={pickupMapRoute}
        alternativeRoutes={[]}
      />

      <SafeAreaView
        edges={['bottom']}
        className="absolute left-0 right-0 bottom-0"
      >
        <View className="mx-4 mb-4 rounded-2xl bg-card p-4 shadow-lg">
          <DispatchPanel
            status={vm.status}
            ride={vm.ride}
            cannotAcceptReason={vm.cannotAcceptReason}
            driverLocation={currentLocation.coordinates}
            pickupEtaText={vm.pickupRoute?.durationText ?? null}
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
  readonly ride: Ride | null;
  readonly cannotAcceptReason: CannotAcceptReason | null;
  readonly driverLocation: Coordinates | null;
  readonly pickupEtaText: string | null;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

function DispatchPanel({
  status,
  ride,
  cannotAcceptReason,
  driverLocation,
  pickupEtaText,
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
    return (
      <View>
        <Text className="mb-2 text-base font-semibold text-foreground">
          Already taken
        </Text>
        <Text className="mb-4 text-sm text-muted-foreground">
          Another driver accepted this ride. You're back to the queue.
        </Text>
        <Pressable
          onPress={onDecline}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          className="items-center rounded-xl bg-primary px-4 py-4"
          testID="driver-dispatch-back-home"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Back to home
          </Text>
        </Pressable>
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
            {pickupEtaText && (
              <Text className="text-xs text-muted-foreground">
                {pickupEtaText} to pickup
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
          className={`flex-1 items-center rounded-xl px-4 py-4 ${
            accepting ? 'bg-muted/50' : 'bg-muted'
          }`}
          testID="driver-dispatch-decline"
        >
          <Text className="text-base font-semibold text-foreground">
            Decline
          </Text>
        </Pressable>

        <Pressable
          onPress={onAccept}
          disabled={accepting || driverLocation === null}
          accessibilityRole="button"
          accessibilityLabel="Accept"
          accessibilityState={{ disabled: accepting }}
          className={`flex-1 items-center rounded-xl px-4 py-4 ${
            accepting ? 'bg-primary/60' : 'bg-primary'
          }`}
          testID="driver-dispatch-accept"
        >
          {accepting ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="text-base font-semibold text-primary-foreground">
              Accept
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
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
