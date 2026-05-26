import { Pressable, Text, View } from 'react-native';

import {
  isKnownPaymentFailureCode,
  type KnownPaymentFailureCode,
} from '@domain/entities/PaymentFailure';
import type { Ride } from '@domain/entities/Ride';
import { BottomSheetHeader } from '@presentation/components/trip/BottomSheetHeader';

/**
 * Status view for `payment_failed`.
 *
 * Two paths land the rider here:
 *
 *   1. **Stripe-async failure** (legacy path, still active) — a
 *      `PaymentIntent` was created but the charge failed when Stripe
 *      reconciled. The webhook server flips `status: 'payment_failed'`
 *      WITHOUT writing `paymentError` — `ride.paymentFailure` is
 *      `null` here. The view falls back to the generic
 *      "Charge couldn't go through" copy.
 *
 *   2. **Synchronous-error path (Phase 10 Turn 10.5)** — the
 *      yeride-functions `processPayment` trigger errored before a
 *      PaymentIntent was created (validation failure, expired card
 *      at request-time, Stripe microservice network error). The
 *      catch block flips `status: 'payment_failed'` AND writes
 *      `paymentError: {code, message, occurredAt}`. The view
 *      switches on `ride.paymentFailure.code` against the
 *      `KnownPaymentFailureCode` catalog to render actionable
 *      copy + a CTA (Wallet for missing-PM, "Tell support" for
 *      missing-Stripe-customer, retry-from-Wallet for declined
 *      cards, etc.).
 *
 * Retry / change-card mutations are not exposed inline here. The
 * rewrite's pattern is: the rider opens Wallet, fixes the
 * payment method, and the next trip's `validateTripDataForPayment`
 * accepts it. A surface-level retry CTA against an already-failed
 * trip lands as a follow-on if production data shows enough
 * abandoned trips to justify it (see kickoff Out of scope §3).
 */
interface PaymentFailedViewProps {
  readonly ride: Ride;
  readonly onPressContactSupport?: () => void;
  readonly onPressOpenWallet?: () => void;
}

interface FailureCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly cta: 'wallet' | 'support' | 'none';
}

const KNOWN_COPY: Record<KnownPaymentFailureCode, FailureCopy> = {
  trip_missing_payment_method: {
    title: 'Add a payment method',
    subtitle: "We couldn't charge a card on file for this trip.",
    body: 'Open Wallet to add a card, then a YeRide team member will follow up to settle the fare.',
    cta: 'wallet',
  },
  trip_missing_stripe_customer: {
    title: 'Your account needs attention',
    subtitle: 'We hit a snag on your payment profile.',
    body: 'Tap "Contact support" — our team will help you settle this trip and fix your account.',
    cta: 'support',
  },
  trip_missing_driver_account: {
    title: "Your driver's payouts aren't set up",
    subtitle: 'The fare on this trip is on hold.',
    body: 'We couldn\'t route your payment to the driver. Tap "Contact support" — our team will sort this out.',
    cta: 'support',
  },
  trip_payment_validation_failed: {
    title: 'Payment validation failed',
    subtitle: "We couldn't charge your card for this trip.",
    body: 'Open Wallet to double-check your saved payment method, then a YeRide team member will follow up.',
    cta: 'wallet',
  },
  card_declined: {
    title: 'Your card was declined',
    subtitle: "We couldn't complete the charge.",
    body: 'Open Wallet to add or update your card. Once the new card is on file we can settle this trip.',
    cta: 'wallet',
  },
  expired_card: {
    title: 'Your card expired',
    subtitle: "We couldn't complete the charge.",
    body: "Open Wallet to add an unexpired card. We'll settle this trip from the new card.",
    cta: 'wallet',
  },
  insufficient_funds: {
    title: 'Insufficient funds',
    subtitle: 'Your card declined for insufficient funds.',
    body: 'Open Wallet to switch to a different card, then a YeRide team member will follow up to settle this trip.',
    cta: 'wallet',
  },
  payment_processing_unknown: {
    title: "We couldn't process your payment",
    subtitle: 'Something went wrong on our end.',
    body: 'Open Wallet to confirm your saved card, or tap "Contact support" and our team will help settle this trip.',
    cta: 'wallet',
  },
};

const GENERIC_COPY: FailureCopy = {
  title: "Charge couldn't go through",
  subtitle: "We weren't able to charge your card.",
  body: 'Open Wallet to try a different payment method, then a YeRide team member will follow up.',
  cta: 'wallet',
};

/**
 * Resolve view copy from the ride's `paymentFailure` (synchronous-error
 * path) or fall back to the generic Stripe-async message when the
 * field is absent.
 */
function copyForRide(ride: Ride): FailureCopy {
  const failure = ride.paymentFailure;
  if (failure === null) return GENERIC_COPY;
  if (isKnownPaymentFailureCode(failure.code)) {
    return KNOWN_COPY[failure.code];
  }
  // Forward-compat: a code the server emits that this client release
  // doesn't know. Render the generic message so beta testers don't
  // see a blank surface; surface the server message as secondary
  // copy so support has something to grep for.
  return {
    ...GENERIC_COPY,
    body:
      failure.message.length > 0
        ? `${GENERIC_COPY.body}\n\nServer details: ${failure.message}`
        : GENERIC_COPY.body,
  };
}

export function PaymentFailedView({
  ride,
  onPressContactSupport,
  onPressOpenWallet,
}: PaymentFailedViewProps) {
  const copy = copyForRide(ride);
  return (
    <View>
      <BottomSheetHeader title={copy.title} subtitle={copy.subtitle} />

      <View
        className="mx-4 mt-2 rounded-lg bg-error/10 p-3"
        testID="payment-failed-body"
      >
        <Text className="text-sm font-medium text-error">{copy.body}</Text>
        <Text className="mt-1 text-xs text-error">
          Your driver has been paid out — only the fare on your card is
          unsettled.
        </Text>
      </View>

      {/* Primary CTA — gated on the resolved `cta` discriminator. */}
      <View className="border-t border-border px-4 py-3">
        {copy.cta === 'wallet' && onPressOpenWallet && (
          <Pressable
            onPress={onPressOpenWallet}
            accessibilityRole="button"
            className="items-center rounded-xl bg-primary px-4 py-3"
            testID="payment-failed-open-wallet"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Open Wallet
            </Text>
          </Pressable>
        )}
        {copy.cta === 'support' && onPressContactSupport && (
          <Pressable
            onPress={onPressContactSupport}
            accessibilityRole="button"
            className="items-center rounded-xl bg-primary px-4 py-3"
            testID="payment-failed-contact-support-primary"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Contact support
            </Text>
          </Pressable>
        )}
      </View>

      {/* Secondary "Contact support" link — always available when the
          parent supplies a handler, even when the primary CTA is the
          Wallet path. Lets the rider escalate without leaving the
          retry surface. Hidden when the primary CTA is already the
          support path. */}
      {onPressContactSupport && copy.cta !== 'support' && (
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
