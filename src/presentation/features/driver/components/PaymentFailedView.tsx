import { Pressable, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import { BottomSheetHeader } from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `payment_failed`. The Stripe webhook reported a charge
 * failure on the rider's card. From the driver's perspective the trip is
 * over — the function paid the driver out of escrow regardless of whether
 * the rider's card cleared. Reconciliation with the rider happens via the
 * rider's own retry surface (Phase 6) or contacting support.
 *
 * No driver action available here:
 *   - Cancel doesn't apply: the trip already terminated server-side from
 *     the entity's perspective.
 *   - Retry-charge is rider-side (Phase 6) — the driver doesn't know
 *     which card to retry.
 *
 * The screen unmounts only when the driver taps "Close trip", which
 * resets the navigation stack back to DriverTabs (same path as
 * `CompletedView`'s close).
 */
interface PaymentFailedViewProps {
  readonly ride: Ride;
  readonly onClose: () => void;
}

export function PaymentFailedView({
  ride: _ride,
  onClose,
}: PaymentFailedViewProps) {
  void _ride;

  return (
    <View>
      <BottomSheetHeader
        title="Charge declined"
        subtitle="The rider's card couldn't be charged."
      />

      <View className="mx-4 mt-2 rounded-lg bg-error/10 p-3">
        <Text className="text-sm font-medium text-error">
          You've already been paid for this trip.
        </Text>
        <Text className="mt-1 text-xs text-error">
          The rider will be prompted to retry the charge from their app. You
          don't need to do anything else.
        </Text>
      </View>

      <View className="px-4 pt-4">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close trip"
          className="items-center rounded-xl bg-primary px-4 py-4"
          testID="payment-failed-close"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Close trip
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
