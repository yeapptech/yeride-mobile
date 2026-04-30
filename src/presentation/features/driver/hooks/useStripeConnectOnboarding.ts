import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { StripeAccountId } from '@domain/entities/StripeAccountId';
import {
  useCreateConnectOnboardingLinkMutation,
  useEnsureStripeConnectAccountMutation,
  useRefreshConnectAccountStatusMutation,
} from '@presentation/queries';
import { buildDeepLink } from '@shared/env';
import { LOG } from '@shared/logger';

const logger = LOG.extend('CONNECT');

/**
 * Side-effect launcher for the Stripe Connect onboarding flow. Consumed
 * by `useDriverEarningsViewModel` from both the `'no_account'` arm
 * ("Set up payouts" CTA) and the `'pending'` arm ("Continue setup" CTA).
 *
 * Pre-call invariant: the caller knows the driver's current Connect
 * account state via `previouslyEnabled`. We use it to detect a
 * `'pending' → 'enabled'` flip after the browser session and fire a
 * success Toast — only when transitioning IN to enabled, not when
 * already-enabled (a stale resume of the screen still triggers a
 * refresh, but no Toast).
 *
 * Sequence (single async `start()` call):
 *
 *   1. `EnsureStripeConnectAccount`  → resolves the driver's accountId
 *      (creating a Standard Connect account on Stripe if missing).
 *   2. Build `returnUrl` + `refreshUrl` from the env-aware deep-link
 *      scheme (`{scheme}://stripe-return`). Both URLs collapse to the
 *      same screen-refresh path.
 *   3. `CreateConnectOnboardingLink` → mints a single-use Stripe-hosted
 *      URL. Each tap mints a fresh URL because Stripe expires links
 *      server-side.
 *   4. `WebBrowser.openAuthSessionAsync(url, returnUrl)` → opens the
 *      Stripe-hosted form; resolves to `{type, url?}` on close.
 *   5. Always run `RefreshConnectAccountStatus` afterwards on
 *      `success` / `cancel` — even on `cancel`, the user might have
 *      completed onboarding in a previous session and only just opened
 *      the tab to verify. `dismiss` (the user dismissed the in-app
 *      browser sheet without action) is silent: no refresh, no Toast.
 *   6. If `previouslyEnabled === false` AND the post-refresh flags
 *      indicate `enabled` (both true), fire the success Toast. Already-
 *      enabled drivers triggering the flow (a defensive resume) do not
 *      re-fire the Toast.
 *
 * Error handling:
 *   - Each step is wrapped in `mutateAsync` + `try/catch` per the Turn 3
 *     `useAddPaymentMethodViewModel` pattern. Failures log + return
 *     early; the Earnings VM consumes `isOnboarding` to keep the
 *     spinner up across the full flow but the underlying mutations'
 *     `error` state is consulted by the VM for surfacing error UI.
 *   - The screen-level error UX is owned by the Earnings VM, not this
 *     hook. The hook fires a `LOG.warn` per failure so the dev console
 *     captures the path even when the UI degrades silently.
 *
 * Test seam: `expo-web-browser` and `expo-constants` (via
 * `getDeepLinkScheme`) are mocked at the module seam in the hook's
 * tests; per-test overrides for `openAuthSessionAsync` return type drive
 * the success / cancel / dismiss branches.
 */

export type ConnectOnboardingError = 'unconfigured' | 'network' | 'unknown';

export interface UseStripeConnectOnboarding {
  /**
   * Kick off the onboarding flow. Returns the post-refresh
   * `{chargesEnabled, payoutsEnabled}` on success, or `null` if the flow
   * short-circuited before reaching the browser session (unconfigured
   * scheme, ensure-account / link-mint failure, or browser-dismiss).
   */
  readonly start: (args?: { readonly previouslyEnabled?: boolean }) => Promise<{
    readonly chargesEnabled: boolean;
    readonly payoutsEnabled: boolean;
  } | null>;
  readonly isOnboarding: boolean;
  readonly error: ConnectOnboardingError | null;
}

const RETURN_PATH = 'stripe-return';

export function useStripeConnectOnboarding(): UseStripeConnectOnboarding {
  const ensureAccount = useEnsureStripeConnectAccountMutation();
  const createLink = useCreateConnectOnboardingLinkMutation();
  const refreshStatus = useRefreshConnectAccountStatusMutation();

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<ConnectOnboardingError | null>(null);

  const start = useCallback(
    async (args?: {
      readonly previouslyEnabled?: boolean;
    }): Promise<{
      readonly chargesEnabled: boolean;
      readonly payoutsEnabled: boolean;
    } | null> => {
      // Re-entry guard. `start()` is callable from anywhere the hook is
      // mounted; double-tapping the CTA shouldn't double-mint links.
      if (isRunning) return null;

      setIsRunning(true);
      setError(null);

      const returnUrl = buildDeepLink(RETURN_PATH);
      if (returnUrl === null) {
        logger.warn('start: deep-link scheme not configured; cannot proceed');
        setError('unconfigured');
        setIsRunning(false);
        return null;
      }

      let accountId: StripeAccountId;
      try {
        accountId = await ensureAccount.mutateAsync();
      } catch (e) {
        logger.warn('EnsureStripeConnectAccount failed', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsRunning(false);
        return null;
      }

      let url: string;
      try {
        const minted = await createLink.mutateAsync({
          accountId,
          refreshUrl: returnUrl,
          returnUrl,
        });
        url = minted.url;
      } catch (e) {
        logger.warn('CreateConnectOnboardingLink failed', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsRunning(false);
        return null;
      }

      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      } catch (e) {
        // The system browser failing to open is a platform-level error
        // — surface as `'unknown'`. Stripe's onboarding URL itself is
        // valid (we just minted it) so this is unrelated to Stripe.
        logger.warn('openAuthSessionAsync threw', e);
        setError('unknown');
        setIsRunning(false);
        return null;
      }

      // `dismiss` (user dismissed the in-app browser sheet) is silent —
      // no refresh, no Toast. `success` and `cancel` both refresh: on
      // `cancel`, the user might have completed onboarding in a previous
      // session and only just opened the tab to verify.
      if (result.type === 'dismiss') {
        setIsRunning(false);
        return null;
      }

      let flags: {
        readonly chargesEnabled: boolean;
        readonly payoutsEnabled: boolean;
      };
      try {
        flags = await refreshStatus.mutateAsync({ accountId });
      } catch (e) {
        logger.warn('RefreshConnectAccountStatus failed', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsRunning(false);
        return null;
      }

      // Status-flip Toast: only fire when transitioning INTO enabled
      // from a not-enabled state. `previouslyEnabled === true` triggers
      // include defensive resume opens — refresh runs, but Toast does
      // not (no flip).
      const isNowEnabled = flags.chargesEnabled && flags.payoutsEnabled;
      const previouslyEnabled = args?.previouslyEnabled === true;
      if (isNowEnabled && !previouslyEnabled) {
        Toast.show({
          type: 'success',
          text1: "You're set up to receive payouts.",
        });
      }

      setIsRunning(false);
      return flags;
    },
    [isRunning, ensureAccount, createLink, refreshStatus],
  );

  return {
    start,
    isOnboarding: isRunning,
    error,
  };
}

/**
 * Coerce an unknown error to "is this a NetworkError?". Mirrors the
 * Turn 3 `useAddPaymentMethodViewModel.isNetworkError` helper — the
 * data-layer surfaces server timeouts / transport throws via domain
 * `NetworkError` instances which carry `name: 'NetworkError'`.
 */
function isNetworkError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as { name: unknown }).name === 'NetworkError'
  );
}
