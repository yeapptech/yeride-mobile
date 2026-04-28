import { Pressable, Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';
import { BottomSheetHeader } from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `payment_failed`. The Stripe webhook reported a charge
 * failure; the rider lands here with a read-only "Charge declined"
 * message.
 *
 * The retry-charge and change-card buttons are visible-but-disabled stubs
 * labelled "Phase 6" so the layout reserves the space. The real
 * mutations (`retryFailedCharge`, `setDefaultPaymentMethod`) land in
 * Phase 6 alongside the Stripe wallet.
 *
 * Cancel is intentionally NOT exposed here. The trip already terminated
 * server-side; the rider's options are pay-again or contact support.
 * Showing a "cancel" CTA on a charge-failed trip would imply the trip
 * could be unwound, which it can't.
 */
interface PaymentFailedViewProps {
  readonly ride: Ride;
  readonly onPressContactSupport?: () => void;
}

export function PaymentFailedView({
  ride: _ride,
  onPressContactSupport,
}: PaymentFailedViewProps) {
  void _ride;
  return (
    <View>
      <BottomSheetHeader
        title="Charge couldn't go through"
        subtitle="We weren't able to charge your card."
      />

      <View className="mx-4 mt-2 rounded-lg bg-error/10 p-3">
        <Text className="text-sm font-medium text-error">
          Try a different card to complete your trip.
        </Text>
        <Text className="mt-1 text-xs text-error">
          Your driver has been paid out — only the fare on your card is
          unsettled.
        </Text>
      </View>

      {/* Phase 6 stubs — disabled with explicit "coming soon" copy so a
          beta tester knows which surface is live. */}
      <View className="border-t border-border px-4 py-3 opacity-50">
        <Pressable
          disabled
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          className="mb-2 items-center rounded-xl bg-primary px-4 py-3"
          testID="payment-failed-retry"
        >
          <Text className="text-base font-semibold text-primary-foreground">
            Retry charge
          </Text>
        </Pressable>
        <Pressable
          disabled
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          className="items-center rounded-xl bg-muted px-4 py-3"
          testID="payment-failed-change-card"
        >
          <Text className="text-base font-semibold text-foreground">
            Change card
          </Text>
        </Pressable>
        <Text className="mt-2 text-center text-xs text-muted-foreground">
          Both land in Phase 6 (payments + Stripe wallet).
        </Text>
      </View>

      {onPressContactSupport && (
        <View className="border-t border-border px-4 py-3">
          <Pressable
            onPress={onPressContactSupport}
            accessibilityRole="button"
            testID="payment-failed-contact-support"
          >
            <Text className="text-center text-sm font-medium text-info">
              Contact support
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
