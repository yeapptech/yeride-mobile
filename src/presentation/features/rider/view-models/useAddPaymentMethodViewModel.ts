import { useNavigation } from '@react-navigation/native';
import { useStripe } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  queryKeys,
  useCreateSetupIntentMutation,
  useEnsureStripeCustomerMutation,
} from '@presentation/queries';
import { getStripePublishableKey } from '@shared/env';
import { LOG } from '@shared/logger';

const logger = LOG.extend('AddPaymentMethodVM');

/**
 * View-model for `AddPaymentMethodScreen`.
 *
 * Orchestrates the three-step "save a card" flow:
 *
 *   1. `EnsureStripeCustomer` — idempotent server-side; safe to call on
 *      every modal open. The first card-add is also the moment we mint
 *      the rider's Stripe customer record (lazy creation per Phase 6
 *      decision: don't ping Stripe just to look at an empty wallet).
 *   2. `CreateSetupIntent({customerId})` — single-use client secret. We
 *      mint a fresh one per "Save card" tap so a stale secret from an
 *      earlier failed attempt isn't reused.
 *   3. `confirmSetupIntent({clientSecret})` — Stripe's native SDK call.
 *      Card data never touches our app or our server; the SDK tokenizes
 *      against Stripe directly.
 *
 * On success we invalidate `payment.methodsByCustomer(customerId)` and
 * `user.current` (the new card may become the default later, and TanStack
 * needs to know the user-doc shape may have changed) then pop the modal.
 *
 * Error arms:
 *   `card_declined` — `confirmSetupIntent` returned an error code that
 *                     maps to user-recoverable card issues
 *                     (declined, insufficient funds, etc.).
 *   `network`       — any `Result.err(NetworkError)` from the use cases
 *                     OR a thrown network error from confirmSetupIntent.
 *   `unknown`       — anything else; surfaces a generic message.
 *
 * If `confirmSetupIntent` returns `error.code === 'Canceled'`, that
 * means the user backed out (e.g. dismissed a 3DS challenge); we treat
 * it as silent — no error banner — so re-tapping Save just re-runs the
 * flow.
 */

export type AddPaymentMethodErrorKind = 'card_declined' | 'network' | 'unknown';

export type AddPaymentMethodState =
  | { readonly kind: 'unconfigured' }
  | {
      readonly kind: 'idle';
      readonly isCardComplete: boolean;
      readonly isSaving: boolean;
      readonly onFormComplete: (details: {
        readonly complete: boolean;
      }) => void;
      readonly onSave: () => void;
      readonly onCancel: () => void;
    }
  | {
      readonly kind: 'error';
      readonly error: AddPaymentMethodErrorKind;
      readonly isCardComplete: boolean;
      readonly isSaving: boolean;
      readonly onFormComplete: (details: {
        readonly complete: boolean;
      }) => void;
      readonly onSave: () => void;
      readonly onCancel: () => void;
      readonly onDismissError: () => void;
    };

export interface UseAddPaymentMethodViewModel {
  readonly state: AddPaymentMethodState;
}

/**
 * Map a Stripe SDK error code to our internal error kind. Stripe's
 * `confirmSetupIntent` returns codes from a closed set (`'Canceled' |
 * 'Failed' | ...`); the `'Failed'` bucket subsumes card declines along
 * with other recoverable issues.
 */
function mapStripeError(
  code: string | undefined,
  rawMessage: string | undefined,
): AddPaymentMethodErrorKind | 'silent' {
  if (code === 'Canceled') return 'silent';
  // Stripe historically returned card-decline codes via the message
  // body; anything containing "decline", "insufficient", or "incorrect"
  // maps to `card_declined`. Defensive against future SDK changes.
  const haystack = `${code ?? ''} ${rawMessage ?? ''}`.toLowerCase();
  if (
    haystack.includes('declin') ||
    haystack.includes('insufficient') ||
    haystack.includes('incorrect') ||
    haystack.includes('expired')
  ) {
    return 'card_declined';
  }
  return 'unknown';
}

export function useAddPaymentMethodViewModel(): UseAddPaymentMethodViewModel {
  const navigation = useNavigation<RiderStackNavigation>();
  const queryClient = useQueryClient();
  const stripe = useStripe();

  const ensureCustomerMutation = useEnsureStripeCustomerMutation();
  const createSetupIntentMutation = useCreateSetupIntentMutation();

  const [isCardComplete, setIsCardComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<AddPaymentMethodErrorKind | null>(null);

  const publishableKey = getStripePublishableKey();

  const onFormComplete = useCallback(
    (details: { readonly complete: boolean }) => {
      setIsCardComplete(details.complete);
    },
    [],
  );

  const onCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const onDismissError = useCallback(() => {
    setError(null);
  }, []);

  const onSave = useCallback(() => {
    if (!isCardComplete || isSaving) return;
    setIsSaving(true);
    setError(null);

    void (async () => {
      let customerId: StripeCustomerId;
      try {
        customerId = await ensureCustomerMutation.mutateAsync();
      } catch (e) {
        logger.warn('EnsureStripeCustomer failed', e);
        // The use cases surface domain errors with a `name`-like
        // discriminator. Treat NetworkError as `'network'` and anything
        // else as `'unknown'` (auth / not-found shouldn't reach this
        // path: the modal is only mounted from a signed-in rider screen).
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsSaving(false);
        return;
      }

      let clientSecret: string;
      try {
        const r = await createSetupIntentMutation.mutateAsync({ customerId });
        clientSecret = r.clientSecret;
      } catch (e) {
        logger.warn('CreateSetupIntent failed', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsSaving(false);
        return;
      }

      try {
        const { error: stripeError, setupIntent } =
          await stripe.confirmSetupIntent(clientSecret, {
            paymentMethodType: 'Card',
          });

        if (stripeError) {
          const mapped = mapStripeError(stripeError.code, stripeError.message);
          if (mapped !== 'silent') setError(mapped);
          setIsSaving(false);
          return;
        }

        if (!setupIntent) {
          // Defensive — shouldn't happen on success, but matches the
          // "explicit error or success state" contract.
          setError('unknown');
          setIsSaving(false);
          return;
        }
      } catch (e) {
        logger.warn('confirmSetupIntent threw', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsSaving(false);
        return;
      }

      // Success — invalidate caches + dismiss the modal.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.payment.methodsByCustomer(customerId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
      setIsSaving(false);
      navigation.goBack();
    })();
  }, [
    isCardComplete,
    isSaving,
    ensureCustomerMutation,
    createSetupIntentMutation,
    stripe,
    queryClient,
    navigation,
  ]);

  let state: AddPaymentMethodState;
  if (publishableKey === null) {
    state = { kind: 'unconfigured' };
  } else if (error !== null) {
    state = {
      kind: 'error',
      error,
      isCardComplete,
      isSaving,
      onFormComplete,
      onSave,
      onCancel,
      onDismissError,
    };
  } else {
    state = {
      kind: 'idle',
      isCardComplete,
      isSaving,
      onFormComplete,
      onSave,
      onCancel,
    };
  }
  return { state };
}

/**
 * Coerce an unknown error to "is this a NetworkError?". Domain errors
 * carry a `name` property; the data-layer maps server timeouts /
 * transport throws to NetworkError. Tests fake-throw plain objects with
 * `name: 'NetworkError'` to exercise this path.
 */
function isNetworkError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as { name: unknown }).name === 'NetworkError'
  );
}
