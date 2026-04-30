import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { PaymentMethod } from '@domain/entities/PaymentMethod';
import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import type { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import type {
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { useUseCases } from '@presentation/di';

import { queryKeys } from './keys';

/**
 * Payment / Stripe queries + mutations (Phase 6 turn 3 — rider-side only).
 *
 * The driver-side Connect / balance / payouts hooks land in turn 4.
 *
 * Cache invalidation contract:
 *   - `useEnsureStripeCustomerMutation` — invalidates `user.current` so
 *     the next render sees the new `stripeCustomerId` and the Wallet VM
 *     transitions out of the `'no_customer'` state.
 *   - `useCreateSetupIntentMutation` — no invalidation. The resulting
 *     `clientSecret` feeds Stripe's native `confirmSetupIntent`; the
 *     post-confirm refresh is owned by the AddPaymentMethod VM
 *     (invalidates `payment.methodsByCustomer(...)` after the SDK call
 *     succeeds).
 *   - `useListPaymentMethodsQuery` — gated `enabled: customerId !== null`
 *     so a rider without a customer record fetches nothing. Stale time
 *     is short (10s) so a fresh card appears within a tick of the
 *     AddPaymentMethod VM's invalidation.
 *   - `useSetDefaultPaymentMethodMutation` — invalidates `user.current`
 *     so the default-card indicator repaints. No payment-list
 *     invalidation: the list contents themselves don't change.
 *   - `useDetachPaymentMethodMutation` — invalidates BOTH
 *     `user.current` (the default may have cleared if the detached card
 *     was the default — `DetachPaymentMethod` does this server-side)
 *     AND `payment.methodsByCustomer(customerId)` so the row disappears.
 */

/**
 * Idempotently ensure the signed-in rider has a Stripe customer record.
 * Returns the resolved `StripeCustomerId`.
 *
 * Called by `useAddPaymentMethodViewModel` lazily on first card-add
 * rather than on Wallet open — riders without saved cards shouldn't
 * round-trip Stripe just to look at an empty wallet.
 */
export function useEnsureStripeCustomerMutation(): UseMutationResult<
  StripeCustomerId,
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  void
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    StripeCustomerId,
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    void
  >({
    mutationFn: async (): Promise<StripeCustomerId> => {
      const r = await useCases.ensureStripeCustomer.execute();
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
    },
  });
}

/**
 * Mint a fresh SetupIntent client secret for the rider's customer record.
 *
 * The hook is single-shot per modal open: `useAddPaymentMethodViewModel`
 * fires it once after `EnsureStripeCustomer` resolves, then hands the
 * `clientSecret` to Stripe's `confirmSetupIntent`. SetupIntents are
 * single-use server-side, so don't cache or replay results.
 */
export function useCreateSetupIntentMutation(): UseMutationResult<
  { readonly clientSecret: string },
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  { readonly customerId: StripeCustomerId }
> {
  const useCases = useUseCases();
  return useMutation<
    { readonly clientSecret: string },
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    { readonly customerId: StripeCustomerId }
  >({
    mutationFn: async (args: {
      readonly customerId: StripeCustomerId;
    }): Promise<{ readonly clientSecret: string }> => {
      const r = await useCases.createSetupIntent.execute({
        customerId: args.customerId,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
}

/**
 * Live list of saved payment methods for the rider's Stripe customer.
 *
 * Gated on `customerId !== null` — when the rider hasn't ensured a
 * customer record yet, the query is disabled and the Wallet VM surfaces
 * the `'no_customer'` empty state. The 10s `staleTime` is short enough
 * that a successful card-add sees the new method on the next render
 * without an explicit refetch from the screen.
 */
export function useListPaymentMethodsQuery(args: {
  readonly customerId: StripeCustomerId | null;
}): UseQueryResult<
  readonly PaymentMethod[],
  AuthorizationError | NotFoundError | NetworkError | ValidationError
> {
  const useCases = useUseCases();
  const customerId = args.customerId;
  return useQuery({
    queryKey: customerId
      ? queryKeys.payment.methodsByCustomer(customerId)
      : ['payment', 'methodsByCustomer', null],
    queryFn: async (): Promise<readonly PaymentMethod[]> => {
      // Unreachable when `enabled: false` — TanStack guards this — but
      // satisfies the type checker without a non-null assertion.
      if (!customerId) {
        throw new Error('useListPaymentMethodsQuery: customerId required');
      }
      const r = await useCases.listPaymentMethods.execute({ customerId });
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: customerId !== null,
    staleTime: 10 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Set or clear the rider's default payment method.
 *
 * Pass `paymentMethodId: null` to clear the default — the use case
 * accepts both. The pure user-doc write means there's no Stripe
 * round-trip; only the local cache is dirty. Invalidating
 * `user.current` repaints the default indicator on the wallet rows.
 */
export function useSetDefaultPaymentMethodMutation(): UseMutationResult<
  true,
  AuthorizationError | NotFoundError,
  { readonly paymentMethodId: PaymentMethodId | null }
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    true,
    AuthorizationError | NotFoundError,
    { readonly paymentMethodId: PaymentMethodId | null }
  >({
    mutationFn: async (args: {
      readonly paymentMethodId: PaymentMethodId | null;
    }): Promise<true> => {
      const r = await useCases.setDefaultPaymentMethod.execute({
        paymentMethodId: args.paymentMethodId,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
    },
  });
}

/**
 * Detach a saved card from the rider's Stripe customer record.
 *
 * The use case clears `defaultPaymentMethodId` BEFORE the Stripe detach
 * when the detached card is the default (so a partial failure leaves
 * the rider with no default rather than a stale-pointer default). On
 * success the mutation invalidates both `user.current` (default may
 * have cleared) AND `payment.methodsByCustomer(customerId)` (row
 * disappears).
 *
 * `customerId` is required by the mutation factory — a global
 * invalidation of `payment.all()` would needlessly refetch every
 * rider's wallet during multi-account testing, so we key the
 * invalidation on the specific customer.
 */
export function useDetachPaymentMethodMutation(args: {
  readonly customerId: StripeCustomerId;
}): UseMutationResult<
  true,
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  { readonly paymentMethodId: PaymentMethodId }
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  const customerId = args.customerId;
  return useMutation<
    true,
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    { readonly paymentMethodId: PaymentMethodId }
  >({
    mutationFn: async (input: {
      readonly paymentMethodId: PaymentMethodId;
    }): Promise<true> => {
      const r = await useCases.detachPaymentMethod.execute({
        paymentMethodId: input.paymentMethodId,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.payment.methodsByCustomer(customerId),
      });
    },
  });
}
