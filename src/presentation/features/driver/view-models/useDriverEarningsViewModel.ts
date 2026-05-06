import { useFocusEffect } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';

import type { BalanceTransaction } from '@domain/entities/BalanceTransaction';
import type { Money } from '@domain/entities/Money';
import type { Payout } from '@domain/entities/Payout';
import type { StripeAccountId } from '@domain/entities/StripeAccountId';
import {
  deriveStripeAccountStatus,
  type StripeAccountStatus,
} from '@domain/entities/StripeAccountStatus';
import {
  useBalanceTransactionsQuery,
  useCreateAccountLoginLinkMutation,
  useCurrentUserQuery,
  useDriverBalanceQuery,
  useDriverPayoutsQuery,
  useRefreshConnectAccountStatusMutation,
} from '@presentation/queries';
import { getStripePublishableKey } from '@shared/env';
import { LOG } from '@shared/logger';

import { useStripeConnectOnboarding } from '../hooks/useStripeConnectOnboarding';

const logger = LOG.extend('EarningsVM');

/**
 * View-model for `DriverEarningsScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery`                       — driver role + Connect
 *                                                   account state.
 *   - `useDriverBalanceQuery`                     — available + pending.
 *   - `useDriverPayoutsQuery`                     — last 7 days, 10 rows.
 *   - `useBalanceTransactionsQuery`               — last 7 days, 25 rows.
 *   - `useStripeConnectOnboarding`                — multi-step
 *                                                   onboarding launcher.
 *   - `useCreateAccountLoginLinkMutation`         — Express dashboard
 *                                                   reach.
 *   - `useRefreshConnectAccountStatusMutation`    — focus + foreground
 *                                                   re-poll of flags.
 *   - `useFocusEffect` + `AppState` listener      — refresh triggers.
 *
 * UI state machine (tagged union):
 *
 *   unconfigured — no `STRIPE_PUBLISHABLE_KEY` configured. The Earnings
 *                  surface is unusable; show a loud error so the dev /
 *                  ops team notices on the next dual-mode boot.
 *   loading      — current-user query pending, driver-role check
 *                  pending, or any of the three Connect-data queries
 *                  loading on the enabled arm.
 *   no_account   — driver has `stripeAccountId === null`. Empty state
 *                  with "Set up payouts" CTA → fires the onboarding
 *                  hook.
 *   pending      — accountId present, charges OR payouts not yet
 *                  enabled. "We're verifying your account" + "Continue
 *                  setup" CTA (re-opens onboarding).
 *   enabled      — full earnings dashboard. Carries balance, payouts,
 *                  balance txns, plus `onViewExpressDashboard`,
 *                  `onRefresh`, `isRefreshing`, `isOnboarding`.
 *   error        — one of the three Connect-data queries failed; shows
 *                  Retry which triggers all three `.refetch()`.
 *
 * Refresh strategy:
 *   - On screen focus (`useFocusEffect`)         — handles the post-
 *     onboarding return after `WebBrowser` sessions close.
 *   - On app-foreground (`AppState` `'active'`)  — handles the case
 *     where onboarding completes in a different session.
 *   - On manual pull-to-refresh                  — runs all three
 *     queries' `.refetch()` in parallel + the status refresh.
 *
 * The status refresh is gated on `stripeAccountId !== null` — drivers
 * without a Connect account can't refresh status. The screen-focus
 * effect re-runs every focus, which means navigating away and back
 * fires another refresh; that's fine because the use case is idempotent
 * and the cost is one server read.
 *
 * Authorization is enforced by the underlying use cases — the VM doesn't
 * pre-check.
 *
 * **SDK seam status.** This VM imports `expo-web-browser` directly
 * (the dashboard-open call at `WebBrowser.openBrowserAsync`; the
 * onboarding-launch call lives in the sibling
 * `useStripeConnectOnboarding` hook, which is also covered by this
 * note). Qualifies for the single-call SDK escape hatch (CLAUDE.md
 * § "Single-call SDK escape hatch"): (a) one-shot call per tap to
 * open the Express dashboard or the auth session, no listener
 * stream, (b) no permissions involved at all, (c) `expo-web-browser`
 * mocks cleanly in Jest via `jest.mock('expo-web-browser', ...)`.
 * The `AppState` listener and `useFocusEffect` in this VM exist for
 * refresh-trigger purposes (re-poll Connect status after a browser
 * session closes), not for SDK lifecycle management — so condition
 * (b)'s "no permission state to mirror" still holds. If a future
 * change introduces a continuous browser-session listener (e.g.
 * mid-session URL hooks) or a mirrored consent state that drives a
 * UI banner, promote to a `SystemBrowserService` domain interface.
 */

export type DriverEarningsState =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'no_account';
      readonly isOnboarding: boolean;
      readonly onSetupPayouts: () => void;
    }
  | {
      readonly kind: 'pending';
      readonly accountId: StripeAccountId;
      readonly isOnboarding: boolean;
      readonly onContinueSetup: () => void;
      readonly onRefresh: () => void;
      readonly isRefreshing: boolean;
    }
  | {
      readonly kind: 'enabled';
      readonly accountId: StripeAccountId;
      readonly available: Money;
      readonly pending: Money;
      readonly payouts: readonly Payout[];
      readonly balanceTxns: readonly BalanceTransaction[];
      readonly onViewExpressDashboard: () => void;
      readonly isOpeningDashboard: boolean;
      readonly onRefresh: () => void;
      readonly isRefreshing: boolean;
    }
  | {
      readonly kind: 'error';
      readonly error: Error;
      readonly onRetry: () => void;
    };

export interface UseDriverEarningsViewModel {
  readonly state: DriverEarningsState;
}

export function useDriverEarningsViewModel(): UseDriverEarningsViewModel {
  const userQuery = useCurrentUserQuery();
  const driver = userQuery.data?.role === 'driver' ? userQuery.data : null;
  const stripeAccountId = driver?.stripeAccountId ?? null;
  const chargesEnabled = driver?.stripeChargesEnabled ?? false;
  const payoutsEnabled = driver?.stripePayoutsEnabled ?? false;

  const status: StripeAccountStatus = deriveStripeAccountStatus({
    accountId: stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
  });

  const balanceQuery = useDriverBalanceQuery({ accountId: stripeAccountId });
  const payoutsQuery = useDriverPayoutsQuery({ accountId: stripeAccountId });
  const balanceTxnsQuery = useBalanceTransactionsQuery({
    accountId: stripeAccountId,
  });

  const onboarding = useStripeConnectOnboarding();
  const refreshStatusMutation = useRefreshConnectAccountStatusMutation();
  const loginLinkMutation = useCreateAccountLoginLinkMutation();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);

  const publishableKey = getStripePublishableKey();

  /* ─── Refresh helpers ──────────────────────────────────────────── */

  // Stash the latest mutation in a ref so the focus + AppState effect
  // dep arrays stay stable across renders. Without this, every
  // mutation-triggered re-render produces a new `refreshAccountStatus`
  // callback identity, which re-arms the focus effect, which fires the
  // callback again, which kicks another mutation — infinite loop.
  // (Real React Navigation's `useFocusEffect` only fires on actual
  // focus events, so the loop only manifests in tests, but a stable
  // callback is the right shape regardless.)
  const refreshMutateRef = useRef(refreshStatusMutation);
  useEffect(() => {
    refreshMutateRef.current = refreshStatusMutation;
  }, [refreshStatusMutation]);

  const refreshAccountStatus = useCallback(
    (accountId: StripeAccountId | null) => {
      if (accountId === null) return;
      refreshMutateRef.current.mutate(
        { accountId },
        {
          onError: (e) => {
            logger.warn('refreshConnectAccountStatus failed', e);
            // No UI surfacing — the next refresh recovers. Per kickoff
            // decision 5: refresh failures are silent.
          },
        },
      );
    },
    [],
  );

  /**
   * Pull-to-refresh: refetch the three Connect-data queries in parallel
   * AND kick the account-status refresh. Per kickoff decision 5,
   * TanStack handles concurrent invalidation idempotently — no need to
   * serialize. The `isRefreshing` flag clears once all four settle.
   */
  const onRefresh = useCallback(() => {
    if (stripeAccountId === null) return;
    setIsRefreshing(true);
    refreshStatusMutation.mutate(
      { accountId: stripeAccountId },
      {
        onError: (e) => {
          logger.warn('refresh: status mutation failed', e);
        },
      },
    );
    void Promise.all([
      balanceQuery.refetch(),
      payoutsQuery.refetch(),
      balanceTxnsQuery.refetch(),
    ])
      .catch((e) => {
        logger.warn('refresh: query refetch failed', e);
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }, [
    stripeAccountId,
    refreshStatusMutation,
    balanceQuery,
    payoutsQuery,
    balanceTxnsQuery,
  ]);

  /* ─── Focus + app-foreground refresh ───────────────────────────── */

  // Capture stripeAccountId in a ref so the focus / AppState callbacks
  // pick up the latest value without re-binding the listener every time
  // the query refetches. Without this, `useFocusEffect`'s callback
  // closure would carry a stale account id from the first render.
  const accountIdRef = useRef<StripeAccountId | null>(stripeAccountId);
  useEffect(() => {
    accountIdRef.current = stripeAccountId;
  }, [stripeAccountId]);

  useFocusEffect(
    useCallback(() => {
      refreshAccountStatus(accountIdRef.current);
    }, [refreshAccountStatus]),
  );

  // AppState listener: refresh whenever the app returns to foreground.
  // The subscription cleanup must be SYNCHRONOUS (RN ignores async
  // cleanups) so we capture the subscription handle and call
  // `.remove()` on unmount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        refreshAccountStatus(accountIdRef.current);
      }
    });
    return () => {
      sub.remove();
    };
  }, [refreshAccountStatus]);

  /* ─── Action callbacks ─────────────────────────────────────────── */

  const onSetupPayouts = useCallback(() => {
    void onboarding.start({
      previouslyEnabled: chargesEnabled && payoutsEnabled,
    });
  }, [onboarding, chargesEnabled, payoutsEnabled]);

  const onContinueSetup = useCallback(() => {
    void onboarding.start({
      previouslyEnabled: chargesEnabled && payoutsEnabled,
    });
  }, [onboarding, chargesEnabled, payoutsEnabled]);

  const onViewExpressDashboard = useCallback(() => {
    if (stripeAccountId === null) return;
    if (isOpeningDashboard) return;
    setIsOpeningDashboard(true);
    void (async () => {
      try {
        const { url } = await loginLinkMutation.mutateAsync({
          accountId: stripeAccountId,
        });
        // Fire-and-forget — `openBrowserAsync` is a system surface; we
        // don't wait for the dismissal callback. Errors opening the
        // browser are logged but don't surface to the user (the URL
        // was successfully minted).
        WebBrowser.openBrowserAsync(url).catch((e) => {
          logger.warn('openBrowserAsync threw', e);
        });
      } catch (e) {
        logger.warn('createAccountLoginLink failed', e);
        Alert.alert(
          'Unable to open dashboard',
          "We couldn't reach Stripe just now. Please try again in a moment.",
        );
      } finally {
        setIsOpeningDashboard(false);
      }
    })();
  }, [stripeAccountId, isOpeningDashboard, loginLinkMutation]);

  /* ─── State derivation ─────────────────────────────────────────── */

  let state: DriverEarningsState;
  if (publishableKey === null) {
    state = { kind: 'unconfigured' };
  } else if (userQuery.isLoading || !userQuery.data) {
    state = { kind: 'loading' };
  } else if (userQuery.data.role !== 'driver') {
    // Defensive: a rider should never reach the driver Earnings route.
    // Surface as `'unconfigured'` to make the misroute visible.
    state = { kind: 'unconfigured' };
  } else if (status.kind === 'no_account') {
    state = {
      kind: 'no_account',
      isOnboarding: onboarding.isOnboarding,
      onSetupPayouts,
    };
  } else if (status.kind === 'pending') {
    state = {
      kind: 'pending',
      accountId: status.accountId,
      isOnboarding: onboarding.isOnboarding,
      onContinueSetup,
      onRefresh,
      isRefreshing,
    };
  } else {
    // status.kind === 'enabled'
    if (
      balanceQuery.isError ||
      payoutsQuery.isError ||
      balanceTxnsQuery.isError
    ) {
      const error =
        balanceQuery.error ??
        payoutsQuery.error ??
        balanceTxnsQuery.error ??
        new Error('Earnings query failed');
      state = {
        kind: 'error',
        error,
        onRetry: () => {
          void balanceQuery.refetch();
          void payoutsQuery.refetch();
          void balanceTxnsQuery.refetch();
        },
      };
    } else if (
      balanceQuery.isLoading ||
      !balanceQuery.data ||
      payoutsQuery.isLoading ||
      !payoutsQuery.data ||
      balanceTxnsQuery.isLoading ||
      !balanceTxnsQuery.data
    ) {
      state = { kind: 'loading' };
    } else {
      state = {
        kind: 'enabled',
        accountId: status.accountId,
        available: balanceQuery.data.available,
        pending: balanceQuery.data.pending,
        payouts: payoutsQuery.data,
        balanceTxns: balanceTxnsQuery.data,
        onViewExpressDashboard,
        isOpeningDashboard,
        onRefresh,
        isRefreshing,
      };
    }
  }

  return { state };
}
