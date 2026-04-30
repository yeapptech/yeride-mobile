import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Money } from '@domain/entities/Money';
import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import {
  Map,
  type MapMarkerProps,
  type MapRoute,
} from '@presentation/components/map';
import type {
  RiderStackNavigation,
  RiderStackScreenProps,
} from '@presentation/navigation/types';

import { TipSelector } from '../components/TipSelector';
import { useRideReceiptViewModel } from '../view-models/useRideReceiptViewModel';
import { useTipFlowViewModel } from '../view-models/useTipFlowViewModel';

/**
 * RideReceiptScreen — read-only post-ride summary.
 *
 * Layout (top to bottom):
 *   - small map showing the dropoff polyline (no live driver pin)
 *   - "Trip with {Driver}" header + receipt-id timestamp
 *   - pickup / dropoff endpoint summary
 *   - fare breakdown (fare + tip − refund = total) sourced from the
 *     `payments` subcollection. The view-model collapses multi-row
 *     math into a single `fareTotal` value.
 *   - "Charged to your default card" placeholder. Card brand + last-4
 *     land in Phase 6 alongside the Stripe wallet.
 *   - "Email receipt" button (disabled stub for Phase 9 polish).
 *   - Done CTA → popToTop, returning the rider to home.
 *
 * The screen is reachable from:
 *   - `CompletedView` "View receipt" CTA on RideMonitor
 *   - `RideMonitorScreen`'s view-model `completed → replace`
 *   - Phase 5 Activity tab (when it lands)
 */
export default function RideReceiptScreen({
  route,
  navigation,
}: RiderStackScreenProps<'RideReceipt'>) {
  const rideIdR = RideId.create(route.params.rideId);
  if (!rideIdR.ok) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base text-error">
          Invalid ride id. Return home and try again.
        </Text>
      </SafeAreaView>
    );
  }
  return <RideReceiptContent rideId={rideIdR.value} navigation={navigation} />;
}

function RideReceiptContent({
  rideId,
  navigation,
}: {
  readonly rideId: RideId;
  readonly navigation: RiderStackNavigation;
}) {
  const vm = useRideReceiptViewModel({ rideId });

  // Tip flow lives in its own VM so the receipt VM stays read-only.
  // We feed in the live `ride` + `tipPayment` so the selector hides the
  // moment the trip flips out of `'completed'` or a `'tip'` row lands.
  const tipFlowVM = useTipFlowViewModel({
    rideId,
    ride: vm.ride,
    tipPayment: vm.tipPayment,
  });

  if (vm.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <ActivityIndicator size="large" />
        <Text className="mt-3 text-sm text-muted-foreground">
          Pulling up your receipt…
        </Text>
      </SafeAreaView>
    );
  }

  if (vm.error || !vm.ride) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-base text-error">
          {vm.error ?? "We couldn't find that receipt."}
        </Text>
      </SafeAreaView>
    );
  }

  const ride = vm.ride;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <ReceiptMap ride={ride} />

        <View className="px-4 pt-4">
          <Text className="text-2xl font-bold text-foreground">
            Trip {ride.driver ? `with ${ride.driver.name.first}` : 'complete'}
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            Receipt {String(ride.id)}
          </Text>
        </View>

        <View className="border-t border-border px-4 py-3 mt-4">
          <Text className="text-xs uppercase text-muted-foreground">
            Pickup
          </Text>
          <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
            {ride.pickup.placeName ?? ride.pickup.address}
          </Text>
          <Text className="mt-2 text-xs uppercase text-muted-foreground">
            Dropoff
          </Text>
          <Text className="mt-0.5 text-sm text-foreground" numberOfLines={2}>
            {ride.dropoff.placeName ?? ride.dropoff.address}
          </Text>
        </View>

        <View className="border-t border-border px-4 py-3">
          <Text className="text-xs uppercase text-muted-foreground">Fare</Text>
          <View className="mt-2">
            {vm.farePayment && (
              <ReceiptRow label="Trip fare" amount={vm.farePayment.amount} />
            )}
            {vm.tipPayment && (
              <ReceiptRow label="Tip" amount={vm.tipPayment.amount} />
            )}
            {vm.refundPayment && (
              <ReceiptRow
                label="Refund"
                amount={vm.refundPayment.amount}
                negate
              />
            )}
            {vm.fareTotal && (
              <View className="mt-2 border-t border-border pt-2">
                <ReceiptRow label="Total" amount={vm.fareTotal} bold />
              </View>
            )}
            {!vm.fareTotal && (
              <Text className="text-sm text-muted-foreground">
                Total updates as soon as your charge clears.
              </Text>
            )}
          </View>
        </View>

        <TipSelector state={tipFlowVM.state} />

        <View className="border-t border-border px-4 py-3">
          <Text className="text-xs uppercase text-muted-foreground">
            Payment
          </Text>
          <Text className="mt-0.5 text-sm text-foreground">
            Charged to your default card.
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            Card brand + last-4 land alongside Stripe brand glyphs in Phase 9.
          </Text>
        </View>

        <View className="px-4 py-3 opacity-50">
          <Pressable
            disabled
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            className="items-center rounded-xl bg-muted px-4 py-3"
            testID="receipt-email"
          >
            <Text className="text-sm font-medium text-foreground">
              Email receipt
            </Text>
          </Pressable>
          <Text className="mt-1 text-center text-xs text-muted-foreground">
            Emailed receipts land in Phase 9 polish.
          </Text>
        </View>
      </ScrollView>

      <View className="border-t border-border px-4 py-3">
        <Pressable
          onPress={() => navigation.popToTop()}
          accessibilityRole="button"
          className="items-center rounded-xl bg-primary px-4 py-3"
          testID="receipt-done"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Done
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ReceiptRow({
  label,
  amount,
  bold,
  negate,
}: {
  readonly label: string;
  readonly amount: Money;
  readonly bold?: boolean;
  readonly negate?: boolean;
}) {
  const sign = negate ? '-' : '';
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text
        className={`${bold ? 'font-semibold' : ''} text-sm text-foreground`}
      >
        {label}
      </Text>
      <Text
        className={`${bold ? 'text-base font-semibold' : 'text-sm'} text-foreground`}
      >
        {sign}${amount.majorUnits.toFixed(2)}
      </Text>
    </View>
  );
}

function ReceiptMap({ ride }: { readonly ride: Ride }) {
  const initialRegion = {
    latitude: ride.pickup.location.latitude,
    longitude: ride.pickup.location.longitude,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };
  const pickupMarker: MapMarkerProps = {
    coordinates: ride.pickup.location,
    title: 'Pickup',
  };
  const dropoffMarker: MapMarkerProps = {
    coordinates: ride.dropoff.location,
    title: 'Dropoff',
  };
  const selectedRoute: MapRoute | null = ride.dropoff.directions
    ? {
        id: ride.dropoff.directions.routeToken || 'selected',
        encodedPolyline: ride.dropoff.directions.encodedPolyline,
      }
    : null;

  return (
    <View style={{ height: 220 }}>
      <Map
        initialRegion={initialRegion}
        pickup={pickupMarker}
        dropoff={dropoffMarker}
        driver={null}
        selectedRoute={selectedRoute}
        pickupRoute={null}
        alternativeRoutes={[]}
      />
    </View>
  );
}
