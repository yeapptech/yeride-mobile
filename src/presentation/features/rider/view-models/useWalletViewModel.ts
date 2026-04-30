import { useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import type { PaymentMethod } from '@domain/entities/PaymentMethod';
import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import type { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  useCurrentUserQuery,
  useDetachPaymentMethodMutation,
  useListPaymentMethodsQuery,
  useSetDefaultPaymentMethodMutation,
} from '@presentation/queries';
import { getStripePublishableKey } from '@shared/env';
import { LOG } from '@shared/logger';

const logger = LOG.extend('WalletVM');

/**
 * View-model for `WalletScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — source of truth for the rider's
 *     `stripeCustomerId` + `defaultPaymentMethodId`. Mutations invalidate
 *     `user.current` so the row indicators repaint without explicit refetch.
 *   - `useListPaymentMethodsQuery` — gated on `customerId !== null`. When
 *     the rider has no customer record yet (a fresh sign-up before first
 *     card-add), the query is disabled and the VM surfaces `'no_customer'`.
 *   - `useSetDefaultPaymentMethodMutation` — flip the default pointer.
 *     Pure user-doc write, no Stripe round-trip.
 *   - `useDetachPaymentMethodMutation` — remove a card. The use case
 *     itself clears `defaultPaymentMethodId` server-side when the
 *     detached card was the default; the UI still warns the user before
 *     they confirm.
 *
 * UI state machine (tagged union):
 *
 *   unconfigured — no `STRIPE_PUBLISHABLE_KEY` configured. The Wallet
 *                  surface is unusable; show a loud error so the dev /
 *                  ops team notices on the next dual-mode boot.
 *   loading      — current-user query in flight.
 *   no_customer  — rider has `stripeCustomerId === null`. Empty state
 *                  with an Add CTA that navigates to AddPaymentMethod
 *                  (which itself fires `EnsureStripeCustomer` on mount).
 *   empty        — rider has a customerId but no saved cards.
 *   ready        — populated list. Tap a row → set-default. Tap trash →
 *                  Alert-confirm → detach.
 *   error        — list-methods query failed.
 *
 * Per-card in-flight tracking:
 *   The `inFlight` record is split into two PaymentMethodId-keyed sets,
 *   one for set-default mutations and one for detach mutations. Each row
 *   reads its own state and shows a spinner / disables interaction.
 *   Splitting the sets means a slow set-default doesn't lock out detach
 *   on a different card.
 *
 * Authorization is enforced by the underlying use cases — the VM doesn't
 * pre-check.
 */

export interface WalletInFlightFlags {
  readonly setDefault: ReadonlySet<string>;
  readonly detach: ReadonlySet<string>;
}

const EMPTY_FLAGS: WalletInFlightFlags = {
  setDefault: new Set<string>(),
  detach: new Set<string>(),
};

export type WalletState =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'no_customer';
      readonly onAdd: () => void;
    }
  | {
      readonly kind: 'empty';
      readonly customerId: StripeCustomerId;
      readonly onAdd: () => void;
      readonly onRefresh: () => void;
      readonly isRefreshing: boolean;
    }
  | {
      readonly kind: 'ready';
      readonly customerId: StripeCustomerId;
      readonly methods: readonly PaymentMethod[];
      readonly defaultMethodId: PaymentMethodId | null;
      readonly inFlight: WalletInFlightFlags;
      readonly onAdd: () => void;
      readonly onSetDefault: (paymentMethodId: PaymentMethodId) => void;
      readonly onDelete: (paymentMethodId: PaymentMethodId) => void;
      readonly onRefresh: () => void;
      readonly isRefreshing: boolean;
    }
  | {
      readonly kind: 'error';
      readonly error: Error;
      readonly onRetry: () => void;
    };

export interface UseWalletViewModel {
  readonly state: WalletState;
}

export function useWalletViewModel(): UseWalletViewModel {
  const navigation = useNavigation<RiderStackNavigation>();

  const userQuery = useCurrentUserQuery();
  const customerId =
    userQuery.data?.role === 'rider' ? userQuery.data.stripeCustomerId : null;
  const defaultMethodId =
    userQuery.data?.role === 'rider'
      ? userQuery.data.defaultPaymentMethodId
      : null;

  const methodsQuery = useListPaymentMethodsQuery({ customerId });
  const setDefaultMutation = useSetDefaultPaymentMethodMutation();
  // The detach mutation needs the customerId for cache invalidation. When
  // we have no customerId, the detach affordance is unreachable anyway —
  // but the hook must be called unconditionally per Rules of Hooks. Pass
  // a placeholder customerId-shaped string when unset; it never gets used
  // because the trash buttons are gated on the `'ready'` arm.
  const detachMutation = useDetachPaymentMethodMutation({
    customerId: (customerId ??
      ('cus_unused' as StripeCustomerId)) as StripeCustomerId,
  });

  const [inFlight, setInFlight] = useState<WalletInFlightFlags>(EMPTY_FLAGS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Reading the publishable key once at render time. The env value is
  // stable across renders so we don't memoize.
  const publishableKey = getStripePublishableKey();

  const onAdd = useCallback(() => {
    navigation.navigate('AddPaymentMethod');
  }, [navigation]);

  const onSetDefault = useCallback(
    (paymentMethodId: PaymentMethodId) => {
      const key = String(paymentMethodId);
      // Re-entry guard.
      if (inFlight.setDefault.has(key)) return;
      setInFlight((prev) => ({
        setDefault: new Set([...prev.setDefault, key]),
        detach: prev.detach,
      }));
      setDefaultMutation.mutate(
        { paymentMethodId },
        {
          onError: (error) => {
            logger.warn('setDefault failed', error);
          },
          onSettled: () => {
            setInFlight((prev) => {
              const next = new Set(prev.setDefault);
              next.delete(key);
              return { setDefault: next, detach: prev.detach };
            });
          },
        },
      );
    },
    [inFlight.setDefault, setDefaultMutation],
  );

  const onDelete = useCallback(
    (paymentMethodId: PaymentMethodId) => {
      const key = String(paymentMethodId);
      if (inFlight.detach.has(key)) return;
      // Find the row to figure out the warning copy. Methods come from
      // the live query; the lookup is safe because the trash button is
      // only renderable from the `'ready'` arm.
      const methods = methodsQuery.data ?? [];
      const target = methods.find((m) => String(m.id) === key);
      if (!target) return;

      const isDefault =
        defaultMethodId !== null && String(defaultMethodId) === key;
      const isOnly = methods.length === 1;

      const title = 'Remove card';
      const message = (() => {
        if (isDefault && isOnly) {
          return (
            'This is your default card and the only card on file. ' +
            "You'll need to add a new card before requesting your next ride."
          );
        }
        if (isDefault) {
          return (
            'This is your default card. The next ride will have no payment ' +
            'method until you set a new default.'
          );
        }
        return `Remove ${target.brand.toUpperCase()} •••• ${target.last4}?`;
      })();

      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setInFlight((prev) => ({
              setDefault: prev.setDefault,
              detach: new Set([...prev.detach, key]),
            }));
            detachMutation.mutate(
              { paymentMethodId },
              {
                onError: (error) => {
                  logger.warn('detach failed', error);
                },
                onSettled: () => {
                  setInFlight((prev) => {
                    const next = new Set(prev.detach);
                    next.delete(key);
                    return { setDefault: prev.setDefault, detach: next };
                  });
                },
              },
            );
          },
        },
      ]);
    },
    [inFlight.detach, methodsQuery.data, defaultMethodId, detachMutation],
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    void methodsQuery.refetch().finally(() => {
      setIsRefreshing(false);
    });
  }, [methodsQuery]);

  const onRetry = useCallback(() => {
    void methodsQuery.refetch();
  }, [methodsQuery]);

  /* ─── State derivation ──────────────────────────────────────── */

  let state: WalletState;
  if (publishableKey === null) {
    state = { kind: 'unconfigured' };
  } else if (userQuery.isLoading || !userQuery.data) {
    state = { kind: 'loading' };
  } else if (userQuery.data.role !== 'rider') {
    // Defensive: a driver should never reach the rider Wallet route.
    // Surface as `'unconfigured'` to make the misroute visible.
    state = { kind: 'unconfigured' };
  } else if (customerId === null) {
    state = { kind: 'no_customer', onAdd };
  } else if (methodsQuery.isError) {
    state = {
      kind: 'error',
      error: methodsQuery.error,
      onRetry,
    };
  } else if (methodsQuery.isLoading || !methodsQuery.data) {
    state = { kind: 'loading' };
  } else if (methodsQuery.data.length === 0) {
    state = {
      kind: 'empty',
      customerId,
      onAdd,
      onRefresh,
      isRefreshing,
    };
  } else {
    state = {
      kind: 'ready',
      customerId,
      methods: methodsQuery.data,
      defaultMethodId,
      inFlight,
      onAdd,
      onSetDefault,
      onDelete,
      onRefresh,
      isRefreshing,
    };
  }

  return { state };
}
