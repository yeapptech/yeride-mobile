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
 *   2. Build the URLs:
 *      - `refresh_url` / `return_url` for Stripe: HTTPS placeholder
 *        (`https://yeride.com/stripe-return`). Stripe rejects custom
 *        schemes with HTTP 400.
 *      - `redirectUrl` for `WebBrowser.openAuthSessionAsync`:
 *        env-aware deep-link (`{scheme}://stripe-return`) so the sheet
 *        auto-closes if a server-side bridge from the HTTPS URL to the
 *        deep-link is configured. Without that bridge, the driver
 *        dismisses manually and the `dismiss` branch fires.
 *   3. `CreateConnectOnboardingLink` → mints a single-use Stripe-hosted
 *      URL. Each tap mints a fresh URL because Stripe expires links
 *      server-side.
 *   4. `WebBrowser.openAuthSessionAsync(url, redirectUrl)` → opens the
 *      Stripe-hosted form; resolves to `{type, url?}` on close.
 *   5. All three terminal states (`success`, `cancel`, `dismiss`)
 *      run `RefreshConnectAccountStatus`. `cancel` and `dismiss` may
 *      still mean "the user completed onboarding in a previous
 *      session" or "the user actually finished but no auto-close
 *      fired"; the cost of one extra status read is small compared to
 *      leaving the driver on a stale `pending` state.
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

/**
 * HTTPS URL passed to Stripe's `accountLinks.create` as both
 * `refresh_url` and `return_url`. Stripe REQUIRES HTTPS — custom
 * schemes (`yeridenext-dev://...`) are rejected with HTTP 400.
 *
 * The URL just needs to validate; Stripe doesn't actually need the
 * page to resolve. Matches the legacy yeride pattern in
 * `src/api/stripe/paymentProcessor.js` (`https://yeride.com/redirect`).
 *
 * Future polish: configure `yeride.com/stripe-return` server-side to
 * 302 to the env-aware deep-link scheme so
 * `WebBrowser.openAuthSessionAsync` auto-closes the in-app sheet
 * mid-redirect (still pass the deep-link as the redirectUrl arg below
 * for that path to fire). Until then, drivers manually dismiss the
 * sheet after Stripe completes and the hook refreshes status on
 * dismiss.
 */
const STRIPE_RETURN_HTTPS = 'https://yeride.com/stripe-return';

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

      // Two URLs in play here:
      //   - `STRIPE_RETURN_HTTPS` is what Stripe sees (HTTPS-only per
      //     their API contract).
      //   - `browserRedirectUrl` is the deep-link `WebBrowser.openAuthSessionAsync`
      //     uses to auto-close the in-app sheet when a redirect to that
      //     URL is detected. Currently only fires if `yeride.com/stripe-return`
      //     is server-side configured to 302 to the deep-link scheme; without
      //     that bridge, the driver dismisses manually and we fall through
      //     to the `dismiss`-branch refresh below.
      const browserRedirectUrl = buildDeepLink(RETURN_PATH);
      if (browserRedirectUrl === null) {
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
          refreshUrl: STRIPE_RETURN_HTTPS,
          returnUrl: STRIPE_RETURN_HTTPS,
        });
        url = minted.url;
      } catch (e) {
        logger.warn('CreateConnectOnboardingLink failed', e);
        setError(isNetworkError(e) ? 'network' : 'unknown');
        setIsRunning(false);
        return null;
      }

      try {
        // Result type isn't read — all three terminal states (success
        // / cancel / dismiss) take the same `RefreshConnectAccountStatus`
        // path below. See the comment block after this catch.
        await WebBrowser.openAuthSessionAsync(url, browserRedirectUrl);
      } catch (e) {
        // The system browser failing to open is a platform-level error
        // — surface as `'unknown'`. Stripe's onboarding URL itself is
        // valid (we just minted it) so this is unrelated to Stripe.
        logger.warn('openAuthSessionAsync threw', e);
        setError('unknown');
        setIsRunning(false);
        return null;
      }

      // All three terminal states (`success`, `cancel`, `dismiss`)
      // refresh status. `dismiss` joined the refresh path because Stripe
      // requires HTTPS return URLs (see `STRIPE_RETURN_HTTPS` above):
      // without an HTTPS→deep-link server-side bridge, the driver
      // completes Stripe in the in-app sheet and dismisses manually,
      // and dismiss is the only signal we get that they may have
      // finished onboarding. The cost of the extra `RefreshConnectAccountStatus`
      // is one HTTP call; the alternative is leaving the driver stuck
      // on a stale `pending` state until they open Earnings again.

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
