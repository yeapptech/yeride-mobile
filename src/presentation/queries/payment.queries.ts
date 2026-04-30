import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import type { Money } from '@domain/entities/Money';
import type { PaymentMethod } from '@domain/entities/PaymentMethod';
import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import type { Payout } from '@domain/entities/Payout';
import type { RideId } from '@domain/entities/RideId';
import type { StripeAccountId } from '@domain/entities/StripeAccountId';
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
 * Payment / Stripe queries + mutations.
 *
 * Phase 6 turn 3 shipped the rider-side hooks (Wallet + AddPaymentMethod).
 * Phase 6 turn 4 adds the driver-side Connect / balance / payouts hooks
 * for the Earnings tab.
 *
 * Cache invalidation contract (rider-side, turn 3):
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
 *
 * Cache invalidation contract (driver-side, turn 4):
 *   - `useEnsureStripeConnectAccountMutation` — invalidates `user.current`
 *     so the next render sees the new `stripeAccountId` and the Earnings
 *     VM transitions out of the `'no_account'` state.
 *   - `useCreateConnectOnboardingLinkMutation` — no invalidation; the
 *     URL feeds `WebBrowser.openAuthSessionAsync`. Each tap mints a
 *     fresh URL because Stripe's account links are single-use.
 *   - `useRefreshConnectAccountStatusMutation` — invalidates BOTH
 *     `user.current` (the canonical source of `chargesEnabled` /
 *     `payoutsEnabled`) AND `payment.balance(accountId)` (a charges-
 *     enabled flip changes balance reachability — refetch even if the
 *     immediate balance number is unchanged).
 *   - `useDriverBalanceQuery` — gated `enabled: accountId !== null`;
 *     `staleTime: 30_000` so the screen stays fresh without spamming
 *     Stripe between refresh-on-focus + manual pull-to-refresh ticks.
 *   - `useDriverPayoutsQuery` / `useBalanceTransactionsQuery` — same
 *     gating + stale-time as balance. Defaults match the legacy
 *     Earnings.js: payouts last 7 days / 10 rows; balance txns last 7
 *     days / 25 rows.
 *   - `useCreateAccountLoginLinkMutation` — no invalidation; result
 *     opens via `WebBrowser.openBrowserAsync` (no auth-session contract
 *     here, just a URL). Each tap mints a fresh single-use URL because
 *     Stripe's login links are single-use.
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

/* ─── Driver-side Connect + balance + payouts (Phase 6 turn 4) ─── */

const PAYOUTS_DEFAULT_DAYS = 7;
const PAYOUTS_DEFAULT_LIMIT = 10;
const BALANCE_TXNS_DEFAULT_DAYS = 7;
const BALANCE_TXNS_DEFAULT_LIMIT = 25;
const ACCOUNT_QUERY_STALE_MS = 30_000;

/**
 * Idempotently ensure the signed-in driver has a Stripe Connect account.
 * Returns the resolved `StripeAccountId`.
 *
 * Called by `useStripeConnectOnboarding` lazily on the first "Set up
 * payouts" / "Continue setup" tap — drivers without a Connect account
 * don't round-trip Stripe just to look at the empty Earnings tab.
 */
export function useEnsureStripeConnectAccountMutation(): UseMutationResult<
  StripeAccountId,
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  void
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    StripeAccountId,
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    void
  >({
    mutationFn: async (): Promise<StripeAccountId> => {
      const r = await useCases.ensureStripeConnectAccount.execute();
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
 * Mint a single-use Stripe-hosted URL the driver opens in
 * `WebBrowser.openAuthSessionAsync` to complete (or continue) Connect KYC
 * onboarding. Each tap of "Set up payouts" mints a fresh URL because
 * Stripe's account links are single-use server-side.
 *
 * No cache invalidation — the resulting URL is consumed by
 * `WebBrowser.openAuthSessionAsync` directly. The post-onboarding state
 * refresh is owned by `useStripeConnectOnboarding`.
 */
export function useCreateConnectOnboardingLinkMutation(): UseMutationResult<
  { readonly url: string; readonly expiresAt: Date },
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  {
    readonly accountId: StripeAccountId;
    readonly refreshUrl: string;
    readonly returnUrl: string;
  }
> {
  const useCases = useUseCases();
  return useMutation<
    { readonly url: string; readonly expiresAt: Date },
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    {
      readonly accountId: StripeAccountId;
      readonly refreshUrl: string;
      readonly returnUrl: string;
    }
  >({
    mutationFn: async (input: {
      readonly accountId: StripeAccountId;
      readonly refreshUrl: string;
      readonly returnUrl: string;
    }): Promise<{ readonly url: string; readonly expiresAt: Date }> => {
      const r = await useCases.createConnectOnboardingLink.execute({
        accountId: input.accountId,
        refreshUrl: input.refreshUrl,
        returnUrl: input.returnUrl,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
}

/**
 * Re-fetch the driver's Connect account flags from Stripe and persist
 * them on the user doc. Called by `useStripeConnectOnboarding` after the
 * `WebBrowser` session returns, AND by the Earnings VM on screen focus
 * + app foreground.
 *
 * Invalidates `user.current` so the canonical `chargesEnabled /
 * payoutsEnabled` flags repaint. Also invalidates
 * `payment.balance(accountId)` because a charges-enabled flip changes
 * balance reachability — refetch even if the immediate balance number
 * is unchanged.
 */
export function useRefreshConnectAccountStatusMutation(): UseMutationResult<
  { readonly chargesEnabled: boolean; readonly payoutsEnabled: boolean },
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  { readonly accountId: StripeAccountId }
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    { readonly chargesEnabled: boolean; readonly payoutsEnabled: boolean },
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    { readonly accountId: StripeAccountId }
  >({
    mutationFn: async (input: {
      readonly accountId: StripeAccountId;
    }): Promise<{
      readonly chargesEnabled: boolean;
      readonly payoutsEnabled: boolean;
    }> => {
      const r = await useCases.refreshConnectAccountStatus.execute({
        accountId: input.accountId,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.payment.balance(variables.accountId),
      });
    },
  });
}

/**
 * Mint a single-use Stripe-hosted URL into the driver's Express
 * dashboard. Surfaces behind a "View Express dashboard" affordance on
 * the enabled-state Earnings tab. Opens via `WebBrowser.openBrowserAsync`
 * (no auth-session contract — we just open the URL, no callback).
 */
export function useCreateAccountLoginLinkMutation(): UseMutationResult<
  { readonly url: string },
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  { readonly accountId: StripeAccountId }
> {
  const useCases = useUseCases();
  return useMutation<
    { readonly url: string },
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    { readonly accountId: StripeAccountId }
  >({
    mutationFn: async (input: {
      readonly accountId: StripeAccountId;
    }): Promise<{ readonly url: string }> => {
      const r = await useCases.createAccountLoginLink.execute({
        accountId: input.accountId,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
  });
}

/**
 * Available + pending balance for a Connect account. Powers the headline
 * number on the Earnings tab.
 *
 * Gated `enabled: accountId !== null` — drivers without a Connect account
 * (or in the loading user-doc state) fetch nothing. The 30s `staleTime`
 * matches `useDriverPayoutsQuery` / `useBalanceTransactionsQuery` so the
 * three queries refresh together on a manual pull-to-refresh tick.
 */
export function useDriverBalanceQuery(args: {
  readonly accountId: StripeAccountId | null;
}): UseQueryResult<
  { readonly available: Money; readonly pending: Money },
  AuthorizationError | NotFoundError | NetworkError | ValidationError
> {
  const useCases = useUseCases();
  const accountId = args.accountId;
  return useQuery({
    queryKey: accountId
      ? queryKeys.payment.balance(accountId)
      : ['payment', 'balance', null],
    queryFn: async (): Promise<{
      readonly available: Money;
      readonly pending: Money;
    }> => {
      if (!accountId) {
        // Unreachable when `enabled: false` — TanStack guards this — but
        // satisfies the type checker without a non-null assertion.
        throw new Error('useDriverBalanceQuery: accountId required');
      }
      const r = await useCases.getDriverBalance.execute({ accountId });
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: accountId !== null,
    staleTime: ACCOUNT_QUERY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * Recent payouts for a Connect account. Defaults match legacy
 * `getAccountPayouts` (7 days, 10 rows).
 */
export function useDriverPayoutsQuery(args: {
  readonly accountId: StripeAccountId | null;
  readonly days?: number;
  readonly limit?: number;
}): UseQueryResult<
  readonly Payout[],
  AuthorizationError | NotFoundError | NetworkError | ValidationError
> {
  const useCases = useUseCases();
  const accountId = args.accountId;
  const days = args.days ?? PAYOUTS_DEFAULT_DAYS;
  const limit = args.limit ?? PAYOUTS_DEFAULT_LIMIT;
  return useQuery({
    queryKey: accountId
      ? queryKeys.payment.payouts(accountId, days, limit)
      : ['payment', 'payouts', null, days, limit],
    queryFn: async (): Promise<readonly Payout[]> => {
      if (!accountId) {
        throw new Error('useDriverPayoutsQuery: accountId required');
      }
      const r = await useCases.listDriverPayouts.execute({
        accountId,
        days,
        limit,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: accountId !== null,
    staleTime: ACCOUNT_QUERY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * Recent balance-transaction ledger rows for a Connect account. Defaults
 * match legacy `getAccountBalanceTransactions` (7 days, 25 rows).
 */
export function useBalanceTransactionsQuery(args: {
  readonly accountId: StripeAccountId | null;
  readonly days?: number;
  readonly limit?: number;
}): UseQueryResult<
  readonly BalanceTransaction[],
  AuthorizationError | NotFoundError | NetworkError | ValidationError
> {
  const useCases = useUseCases();
  const accountId = args.accountId;
  const days = args.days ?? BALANCE_TXNS_DEFAULT_DAYS;
  const limit = args.limit ?? BALANCE_TXNS_DEFAULT_LIMIT;
  return useQuery({
    queryKey: accountId
      ? queryKeys.payment.balanceTransactions(accountId, days, limit)
      : ['payment', 'balanceTransactions', null, days, limit],
    queryFn: async (): Promise<readonly BalanceTransaction[]> => {
      if (!accountId) {
        throw new Error('useBalanceTransactionsQuery: accountId required');
      }
      const r = await useCases.listBalanceTransactions.execute({
        accountId,
        days,
        limit,
      });
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: accountId !== null,
    staleTime: ACCOUNT_QUERY_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

/* ─── Tip flow (Phase 6 turn 5) ─── */

/**
 * Process a tip for a completed trip via the `tipDriver` Cloud Function
 * callable. Routes through the `ProcessTip` use case which enforces the
 * client-side rules ($1 floor, whole-dollar, USD-only, passenger-owns-trip,
 * trip-must-be-completed) before the network round-trip.
 *
 * No cache invalidation — `useRideReceiptViewModel` already subscribes to
 * the trip's `payments` subcollection via `useFirestoreSubscription
 * (observeTripPayments)`. Once the Cloud Function's webhook fires (or its
 * direct write lands), the new `'tip'` `TripPayment` row materializes
 * through the live subscription and the receipt repaints. Adding a
 * TanStack invalidation here would just kick a redundant refetch.
 *
 * Server-side idempotency on `(tripId, customerId)` keeps a network-blip
 * retry safe; the local `useTipFlowViewModel` adds a defense-in-depth
 * single-tap guard so a double-press during a slow round-trip doesn't
 * fire the callable twice.
 */
export function useProcessTipMutation(): UseMutationResult<
  void,
  AuthorizationError | NotFoundError | NetworkError | ValidationError,
  { readonly rideId: RideId; readonly tipAmount: Money }
> {
  const useCases = useUseCases();
  return useMutation<
    void,
    AuthorizationError | NotFoundError | NetworkError | ValidationError,
    { readonly rideId: RideId; readonly tipAmount: Money }
  >({
    mutationFn: async (input: {
      readonly rideId: RideId;
      readonly tipAmount: Money;
    }): Promise<void> => {
      const r = await useCases.processTip.execute({
        rideId: input.rideId,
        tipAmount: input.tipAmount,
      });
      if (!r.ok) throw r.error;
    },
  });
}
