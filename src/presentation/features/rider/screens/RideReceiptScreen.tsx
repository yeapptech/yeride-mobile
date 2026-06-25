import { useEffect, useRef } from 'react';
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
import {
  CardBrandBadge,
  formatBrand,
} from '@presentation/components/payment/CardBrandBadge';
import { Button } from '@presentation/components/ui/Button';
import type {
  RiderStackNavigation,
  RiderStackScreenProps,
} from '@presentation/navigation/types';

import { TipSelector } from '../components/TipSelector';
import {
  useGenerateReceiptPdfViewModel,
  type ReceiptPdfState,
} from '../view-models/useGenerateReceiptPdfViewModel';
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
 *   - Payment row — Phase 9 Turn 7 wired this. Renders a per-brand
 *     glyph + "Brand •••• last4" when the wallet-cache join hits;
 *     falls back to "Charged to your card on file" otherwise.
 *   - Informational note: receipts are emailed automatically when the
 *     charge clears (Stripe-managed via `receiptEmail` on the
 *     `/direct-charge` request — there is no in-app trigger).
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

  // Phase 10 Turn 10.5 — receipt-side payment_failed redirect.
  //
  // The receipt screen's normal landing is `payment_requested` →
  // `completed` via `useRideMonitorViewModel.replace`. But if the
  // synchronous-error path on the Cloud Function flips a trip
  // FROM `'completed'` (set by the `completeTrip` callable's
  // transaction) directly TO `'payment_failed'` (set by
  // `processPayment` catch in the same Cloud-Function invocation),
  // and the rider was already on `RideReceipt` by then, the
  // receipt's "Trip complete" UI is misleading — the charge
  // didn't actually clear. Redirect back to `RideMonitor` so the
  // rider sees the actionable `PaymentFailedView`.
  //
  // Same defensive-ref pattern as `useRideMonitorViewModel`'s
  // terminal redirect — once dispatched, the ref blocks re-fire
  // on a re-render with the same status.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (vm.ride === null) return;
    if (vm.ride.status !== 'payment_failed') return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    navigation.replace('RideMonitor', { rideId: String(rideId) });
  }, [vm.ride, navigation, rideId]);

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

  // Hand off to a child so the PDF VM (which requires a non-null
  // `Ride`) can mount unconditionally — keeps hook order clean.
  return (
    <LoadedReceipt
      ride={vm.ride}
      vm={vm}
      tipFlowVM={tipFlowVM}
      navigation={navigation}
    />
  );
}

function LoadedReceipt({
  ride,
  vm,
  tipFlowVM,
  navigation,
}: {
  readonly ride: Ride;
  readonly vm: ReturnType<typeof useRideReceiptViewModel>;
  readonly tipFlowVM: ReturnType<typeof useTipFlowViewModel>;
  readonly navigation: RiderStackNavigation;
}) {
  // Phase 9 Turn 16 — receipt-PDF flow. Mounted alongside the
  // existing TipSelector so both run independently. The CTA is
  // gated on `ride.status === 'completed'` (a `'payment_failed'`
  // ride doesn't have a finalizable receipt; the PaymentFailed
  // view's retry path is the rider's affordance there).
  const pdfVM = useGenerateReceiptPdfViewModel({
    ride,
    farePayment: vm.farePayment,
    tipPayment: vm.tipPayment,
    refundPayment: vm.refundPayment,
    fareTotal: vm.fareTotal,
    paymentBrand: vm.paymentBrand,
    paymentLast4: vm.paymentLast4,
  });
  const pdfShareEnabled = ride.status === 'completed';

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
          {vm.paymentBrand !== null && vm.paymentLast4 !== null ? (
            <View
              className="mt-1 flex-row items-center"
              testID="receipt-payment-method"
            >
              <CardBrandBadge brand={vm.paymentBrand} size="md" />
              <Text className="ml-3 text-sm text-foreground">
                {formatBrand(vm.paymentBrand)} •••• {vm.paymentLast4}
              </Text>
            </View>
          ) : (
            <Text
              className="mt-0.5 text-sm text-foreground"
              testID="receipt-payment-fallback"
            >
              Charged to your card on file.
            </Text>
          )}
          <Text className="mt-2 text-xs text-muted-foreground">
            A receipt is emailed automatically when your charge clears.
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']}>
        <View className="border-t border-border px-4 py-3">
          {pdfShareEnabled && (
            <ShareReceiptCta state={pdfVM.state} testID="receipt-share-cta" />
          )}
          <Button
            label="Done"
            onPress={() =>
              // Reset (rather than `popToTop`) so the rider always lands
              // back on RiderTabs regardless of how they reached the
              // receipt. `popToTop` fails with "POP_TO_TOP not handled by
              // any navigator" if the stack only contains RideReceipt —
              // which can happen via a misconfigured upstream `replace`.
              navigation.reset({
                index: 0,
                routes: [{ name: 'RiderTabs' }],
              })
            }
            testID="receipt-done"
          />
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

/**
 * Phase 9 Turn 16 — Share-receipt CTA + inline error band.
 *
 * Single state-driven row pinned above the Done CTA. The button
 * label and behavior shift based on `state.kind`:
 *   - `idle`        — "Share receipt" (default text)
 *   - `generating`  — spinner + "Generating PDF…"; disabled
 *   - `ready`       — spinner + "Preparing share…"; disabled (transient)
 *   - `sharing`     — spinner + "Opening share…"; disabled
 *   - `shared`      — "Share again" (the rider may want a second copy)
 *   - `error`       — error band above + "Try again" CTA
 *
 * Error-band copy maps from `error.kind`:
 *   - `pdf_generation_failed` — "Couldn't build the PDF. Try again?"
 *   - `sharing_unavailable`   — uses the message from the error
 *                                (already user-friendly; tells the
 *                                rider to email themselves instead)
 *   - `unknown`               — uses the SDK's error message verbatim
 */
function ShareReceiptCta({
  state,
  testID,
}: {
  readonly state: ReceiptPdfState;
  readonly testID: string;
}) {
  let label: string;
  let busy = false;
  let onPress: (() => void) | null = null;
  switch (state.kind) {
    case 'idle':
      label = 'Share receipt';
      onPress = state.onShare;
      break;
    case 'generating':
      label = 'Generating PDF…';
      busy = true;
      break;
    case 'ready':
      label = 'Preparing share…';
      busy = true;
      break;
    case 'sharing':
      label = 'Opening share…';
      busy = true;
      break;
    case 'shared':
      label = 'Share again';
      onPress = state.onShare;
      break;
    case 'error':
      label = 'Try again';
      onPress = state.onShare;
      break;
  }

  return (
    <View className="mb-3" testID={`${testID}-container`}>
      {state.kind === 'error' && (
        <View
          className="mb-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2"
          testID={`${testID}-error`}
        >
          <Text className="text-sm text-error" testID={`${testID}-error-text`}>
            {errorCopyFor(state.error.kind, state.error.message)}
          </Text>
          <Pressable
            onPress={state.onDismissError}
            accessibilityRole="button"
            className="mt-1 self-start"
            testID={`${testID}-error-dismiss`}
          >
            <Text className="text-xs font-semibold text-error">Dismiss</Text>
          </Pressable>
        </View>
      )}
      <Pressable
        onPress={onPress ?? undefined}
        accessibilityRole="button"
        accessibilityState={{ disabled: onPress === null }}
        disabled={onPress === null}
        className={`flex-row items-center justify-center rounded-xl border border-border px-4 py-3 ${
          onPress === null ? 'opacity-60' : ''
        }`}
        testID={testID}
      >
        {busy && (
          <ActivityIndicator
            size="small"
            className="mr-2"
            testID={`${testID}-spinner`}
          />
        )}
        <Text className="text-base font-semibold text-foreground">{label}</Text>
      </Pressable>
    </View>
  );
}

function errorCopyFor(
  kind: 'pdf_generation_failed' | 'sharing_unavailable' | 'unknown',
  message: string,
): string {
  switch (kind) {
    case 'pdf_generation_failed':
      return "Couldn't build the PDF. Please try again.";
    case 'sharing_unavailable':
      // The VM already supplies the user-friendly message
      // ("Sharing isn't available on this device — try emailing
      // yourself the receipt instead.").
      return message;
    case 'unknown':
      return message;
  }
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
