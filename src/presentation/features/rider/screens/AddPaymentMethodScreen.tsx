import { CardForm } from '@stripe/stripe-react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAddPaymentMethodViewModel } from '../view-models/useAddPaymentMethodViewModel';

/**
 * Modal screen for adding a new card to the rider's Stripe customer.
 *
 * Layout: Stripe's `<CardForm/>` at the top (the SDK renders a native
 * card-entry surface; we never see the card data), an inline error
 * banner just below it when the VM surfaces an `error` arm, and a Save
 * CTA at the bottom that's disabled until the form is complete and
 * dormant while the mutation chain runs.
 *
 * The Cancel affordance is the system header back gesture / button —
 * no extra X is rendered. The header is owned by the parent
 * `RiderNavigator` (modal `presentation: 'modal'`).
 */

export default function AddPaymentMethodScreen() {
  const { state } = useAddPaymentMethodViewModel();

  if (state.kind === 'unconfigured') {
    return (
      <SafeAreaView className="flex-1 bg-background px-6">
        <View className="flex-1 items-center justify-center">
          <Text className="mb-2 text-2xl font-bold text-destructive">
            Payments unavailable
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            STRIPE_PUBLISHABLE_KEY is not configured for this build.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 px-6 pt-4">
          <Text className="mb-3 text-base text-muted-foreground">
            We&apos;ll save this card for future rides.
          </Text>
          <CardForm
            autofocus
            onFormComplete={state.onFormComplete}
            style={{ height: 280, width: '100%' }}
          />
          {state.kind === 'error' ? (
            <View
              testID="add-pm-error-banner"
              className="mt-4 rounded-xl border border-destructive bg-destructive/10 px-4 py-3"
            >
              <Text className="text-sm font-medium text-destructive">
                {errorMessage(state.error)}
              </Text>
              <Pressable
                onPress={state.onDismissError}
                accessibilityRole="button"
                testID="add-pm-error-dismiss"
                className="mt-1 self-start"
              >
                <Text className="text-xs font-medium text-destructive underline">
                  Dismiss
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <View className="px-6 pb-4">
          <Pressable
            onPress={state.onSave}
            disabled={!state.isCardComplete || state.isSaving}
            accessibilityRole="button"
            testID="add-pm-save"
            className={`flex-row items-center justify-center rounded-full px-6 py-4 ${
              !state.isCardComplete || state.isSaving
                ? 'bg-muted'
                : 'bg-primary'
            }`}
          >
            {state.isSaving ? (
              <ActivityIndicator
                size="small"
                testID="add-pm-save-spinner"
                className="mr-2"
              />
            ) : null}
            <Text
              className={`text-base font-semibold ${
                !state.isCardComplete || state.isSaving
                  ? 'text-muted-foreground'
                  : 'text-primary-foreground'
              }`}
            >
              Save card
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorMessage(kind: 'card_declined' | 'network' | 'unknown'): string {
  switch (kind) {
    case 'card_declined':
      return 'Your card was declined. Try a different card.';
    case 'network':
      return "Couldn't reach our servers. Check your connection and try again.";
    case 'unknown':
      return 'Something went wrong saving your card. Try again.';
  }
}
