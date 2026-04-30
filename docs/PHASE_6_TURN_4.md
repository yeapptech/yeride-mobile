# Phase 6 — Turn 4: Driver Earnings + Stripe Connect onboarding

The driver Earnings tab is real now. Drivers can set up Stripe Connect
onboarding, see their available + pending balance, the recent payouts
list, the recent balance-transaction ledger, and reach the Stripe-hosted
Express dashboard. The 7 driver-side use cases shipped in Turn 2 are
finally wired through TanStack hooks → a side-effect-launching hook →
the view-model → the screen.

End of turn: **143 suites / 1068 tests passing** (1 sandbox-leftover
scratch suite intentionally skipped), **+6 suites / +37 tests** on top
of Turn 3's 137/1031. typecheck + lint + format + test all green.

## What's in

### 1. `expo-web-browser@~55.0.14`

Pinned via `npx expo install expo-web-browser`. Auto-linked — no Expo
plugin block, no native config changes beyond what `prebuild` would
regenerate. **Prebuild is not strictly required for this dep alone**;
the Stripe SDK plugin still has the prebuild requirement carried over
from Turn 3.

The sandbox virtiofs blocks `unlink()` so the trailing `husky` postinstall
errored out, but the package itself is on disk in `node_modules/` and
pinned in both `package.json` and `package-lock.json`. Any non-sandbox
checkout's `npm install` will succeed normally.

### 2. Deep-link scheme helper (`src/shared/env/scheme.ts`)

- `getDeepLinkScheme(): string | null` — reads `Constants.expoConfig?.scheme`
  via lazy `require('expo-constants')`. Mirrors the existing
  `getStripePublishableKey` lazy-require pattern so it's mockable from
  tests without Expo native modules loading.
- `buildDeepLink(path: string): string | null` — `{scheme}://{path}`.
  Returns `null` when the scheme is unconfigured (which the
  Connect-onboarding hook treats as a fail-loud `'unconfigured'` error
  arm rather than silently falling through to a hardcoded scheme).
- Re-exported from `@shared/env`.

The `RETURN_PATH = 'stripe-return'` constant stays inside the onboarding
hook — it's part of the Stripe Connect contract, not the env layer.

### 3. TanStack hooks + key factories

- `src/presentation/queries/keys.ts` — extended `payment` scope with
  three new factories. No `connectAccount(driverId)` key (the connect-
  account state lives on `user.current`, so we route all Connect-account
  invalidation through `user.current` per kickoff Q2 confirmation):
  - `payment.balance(accountId)`
  - `payment.payouts(accountId, days, limit)` — days/limit in the key so
    the cache can hold "last 7 days" and "last 30 days" separately for
    the same account (future drill-down screens).
  - `payment.balanceTransactions(accountId, days, limit)`
- `src/presentation/queries/payment.queries.ts` — seven new driver-side
  hooks:
  - `useEnsureStripeConnectAccountMutation` — invalidates `user.current`.
  - `useCreateConnectOnboardingLinkMutation` — no invalidation.
  - `useRefreshConnectAccountStatusMutation` — invalidates `user.current`
    AND `payment.balance(accountId)`.
  - `useDriverBalanceQuery({accountId})` — gated `enabled: accountId !==
null`; `staleTime: 30_000`, `refetchOnWindowFocus: false`.
  - `useDriverPayoutsQuery({accountId, days?, limit?})` — defaults
    `{days: 7, limit: 10}`.
  - `useBalanceTransactionsQuery({accountId, days?, limit?})` — defaults
    `{days: 7, limit: 25}`.
  - `useCreateAccountLoginLinkMutation` — no invalidation.
- `src/presentation/queries/index.ts` — re-exports the seven new hooks.

### 4. `useStripeConnectOnboarding` hook + 8 tests

`src/presentation/features/driver/hooks/useStripeConnectOnboarding.ts` —
the side-effect launcher. Single async `start({previouslyEnabled?})`
callback. Sequence:

1. `EnsureStripeConnectAccount` → resolves the driver's `accountId`.
2. `buildDeepLink('stripe-return')` → builds the env-aware
   `{scheme}://stripe-return` URL.
3. `CreateConnectOnboardingLink({accountId, refreshUrl, returnUrl})` →
   mints a single-use Stripe-hosted URL.
4. `WebBrowser.openAuthSessionAsync(url, returnUrl)`.
5. `'success'` and `'cancel'` both run `RefreshConnectAccountStatus`;
   `'dismiss'` is silent (per kickoff decision 2).
6. If `previouslyEnabled === false` AND post-refresh flags
   `{chargesEnabled, payoutsEnabled}` are both true, fire a Toast.show
   `"You're set up to receive payouts."`.

Returns `{start, isOnboarding, error}`. `error` is one of
`'unconfigured' | 'network' | 'unknown'`. Re-entry is guarded
(`isRunning`) so double-tapping the CTA doesn't double-mint links.

8 tests cover: happy path with status-flip Toast, cancel triggers
refresh but no Toast, dismiss is silent, already-enabled does NOT
re-Toast, unconfigured short-circuits, EnsureAccount NetworkError,
CreateLink NetworkError, `isOnboarding` true while running.

### 5. `useDriverEarningsViewModel` + 13 tests

`src/presentation/features/driver/view-models/useDriverEarningsViewModel.ts`
— tagged-union state machine driving the Earnings screen. Six arms:
`unconfigured` / `loading` / `no_account` / `pending` / `enabled` /
`error`. Per Q1 confirmation, `'disabled'` is folded into `'pending'` —
the deriver returns just three statuses (`no_account`, `pending`,
`enabled`) and the `'disabled'` case is a future scope item that needs
backend-side disabled detection.

Composes:

- `useCurrentUserQuery` — driver role + Connect-account state.
- `useDriverBalanceQuery` / `useDriverPayoutsQuery` /
  `useBalanceTransactionsQuery` — gated on `accountId !== null`.
- `useStripeConnectOnboarding` — multi-step onboarding launcher.
- `useCreateAccountLoginLinkMutation` — Express dashboard reach via
  `WebBrowser.openBrowserAsync(url)` (no auth-session contract — just
  open the URL).
- `useRefreshConnectAccountStatusMutation` — focus + foreground re-poll
  via a `useRef` to keep dep-arrays stable (without that, every
  mutation-triggered re-render would re-arm the focus effect, which
  re-fires the callback, which kicks another mutation — infinite loop;
  real React Navigation `useFocusEffect` only fires on actual focus
  events, but the test mock fires on every render, and the ref-based
  shape is the right invariant regardless).
- `useFocusEffect` + `AppState` listener — refresh triggers.

Refresh strategy:

- On screen focus → kick `RefreshConnectAccountStatus`.
- On `AppState 'change' → 'active'` → same.
- Manual pull-to-refresh → all three queries' `.refetch()` in parallel
  - the status mutation, fanned out via `Promise.all([...]).finally(() =>
setIsRefreshing(false))`.

13 tests cover: every UI arm (unconfigured / loading / no_account /
pending / enabled / error), misrouted-rider safety, Express-dashboard
success + Alert-on-network-failure, focus-effect re-fires status,
`AppState` foreground re-fires status (with synchronous `subscription
.remove()` cleanup verified), pull-to-refresh fans out.

### 6. Earnings UI: components + screen

- `src/presentation/features/driver/utils/formatMoney.ts` —
  `Intl.NumberFormat('en-US', {style:'currency', currency:'USD'})`.
  4 unit tests (whole dollars, sub-dollar, thousands separator, zero).
- `src/presentation/features/driver/components/PayoutRow.tsx` — arrival-
  date label, status pill (paid/pending/in_transit/failed/canceled),
  amount. Pure props. 3 smoke tests.
- `src/presentation/features/driver/components/BalanceTransactionRow.tsx`
  — type label (Stripe's free-form type → friendly label table), date,
  amount with sign-aware coloring (positive=`text-success`,
  negative=`text-error`), fee/net subline only when `fee > 0`. Pure
  props. 3 smoke tests.
- `src/presentation/features/driver/screens/DriverEarningsScreen.tsx`
  — view-model-driven; one layout per tagged-union arm. Pull-to-refresh
  on `pending` and `enabled` arms; loud error block on `unconfigured`.
  6 smoke tests covering each arm + CTA wire-up.

### 7. Navigation wiring

- `src/presentation/navigation/DriverTabsNavigator.tsx` — swapped
  `DriverEarningsPlaceholderScreen` → `DriverEarningsScreen`.
  No new routes anywhere; both onboarding and Express dashboard live
  in the system browser via `expo-web-browser`.
- `DriverEarningsPlaceholderScreen.tsx` retained as a deprecation stub
  (sandbox virtiofs blocks `unlink()`); the next dev in a regular
  checkout should `rm` it.

### 8. Other housekeeping

- `.prettierignore` — added `docs/PHASE_*_KICKOFF.md` and
  `docs/PHASE_*_TURN_*_KICKOFF.md` patterns. Phase-kickoff prompts are
  ephemeral session-starting artifacts whose layout is part of the
  prompt; they shouldn't be auto-reformatted.
- `src/__tests__/probe.test.tsx` and `src/probe.test.tsx` — leftover
  debug scratch files from this turn's TanStack-mutation diagnosis.
  Both contain `it.skip` placeholders since the sandbox can't unlink
  them. Safe to remove in any non-sandbox checkout.

## Why this turn doesn't include

- **Tip flow on RideReceipt** — Turn 5. The `TipSelector` component +
  `useProcessTipMutation` over the Turn 2 `tipDriver` callable.
- **Per-payout drill-down** — Phase 9 polish; the row stays read-only.
- **`'disabled'` arm** — explicit backend-side disabled detection isn't
  modeled in `StripeServerService.retrieveAccount` yet (only returns
  `{chargesEnabled, payoutsEnabled}`). Folded into `'pending'` for
  Turn 4 per Q1 confirmation. A future phase that wires server-side
  disabled detection adds the dedicated arm.
- **Reconnect-mid-trip warning banner** — kickoff decision 10. Funds
  queue server-side on disable; the disabled state surfaces only on
  the next Earnings tab open.
- **Multi-currency** — USD only, same as legacy. The `Money` value
  object already constrains this.

## Risks surfaced

- **Sandbox virtiofs prevents `prebuild` and `husky` postinstall.** The
  `npx expo install expo-web-browser` call hit `EPERM: unlink` inside
  the husky `prepare` script. Package install itself succeeded; only the
  husky reset failed. Any non-sandbox checkout's `npm install` will
  succeed normally. Verified the `expo-web-browser` package is fully on
  disk.
- **Test mock for `useFocusEffect` fires on every render.** This caused
  an infinite update loop the first time the VM was wired with a
  callback that depended on the unstable `useMutation` return value.
  The fix (`useRef` to stash the mutation object) makes the callback
  identity stable across renders. Real React Navigation's
  `useFocusEffect` only fires on actual focus events, but the
  ref-based shape is the right invariant regardless. New driver
  view-models that wire mutations into `useFocusEffect` callbacks
  should follow the same pattern.
- **TanStack `mutate(args, callbacks)` callbacks dropped under some
  test conditions.** During development, the Earnings VM's first
  `loginLinkMutation.mutate(args, {onSuccess, onError})` shape was
  losing its callbacks under `renderHook` + `act` + `waitFor`. The
  `useAddPaymentMethodViewModel` pattern (`mutateAsync` + `try/catch`)
  was reproducible in that environment, so the VM moved to that shape
  for `onViewExpressDashboard`. The Wallet VM's `mutate(args, callbacks)`
  pattern still works there — the failure is specific to this VM's
  call site, possibly because of unrelated state churn. Future driver
  VMs should default to `mutateAsync` to avoid the issue.
- **iOS modular-headers under `useFrameworks: 'static'`** — Turn 3
  surfaced this risk for Stripe SDK; `expo-web-browser` adds no new
  modular dependencies, so no Podfile patch needed this turn. The next
  iOS native build is the canonical smoke.
- **`AppState` listener cleanup**. Verified the VM's `useEffect`
  cleanup calls `subscription.remove()` (NOT the legacy
  `AppState.removeEventListener`) and that the test exercises the
  cleanup explicitly via `unmount() → expect(remove).toHaveBeenCalled()`.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green.
**143 test suites / 1068 tests** (+6 suites / +37 tests over Turn 3's
137/1031). 1 suite skipped (sandbox scratch).

A signed-in driver can now:

1. Open the Earnings tab without a Connect account → see the
   "Set up payouts" CTA → tap → land in
   `WebBrowser.openAuthSessionAsync` showing the Stripe-hosted form →
   complete or back out → return to the app → see the appropriate
   state (`enabled` if onboarding succeeded, `pending` if not).
2. In the `pending` state: see "We're verifying your account" + the
   "Continue setup" CTA that re-opens the onboarding link.
3. In the `enabled` state: see the balance card (available + pending
   in USD), payouts list (last 7 days, max 10), recent balance
   transactions list (last 7 days, max 25), and the "View Express
   dashboard" affordance that opens the Stripe-hosted dashboard via
   `WebBrowser.openBrowserAsync`.
4. Pull-to-refresh refreshes all three queries + the account-status.
5. App-foreground re-fires the account-status refresh.
6. A driver in the unconfigured (no publishable key) state sees a
   loud error block; the rest of the app is unaffected.

A signed-in driver who completes onboarding sees a Toast success
"You're set up to receive payouts." on the `'pending' → 'enabled'`
status flip.

## Optional integration smoke (manual, skipped in CI)

To verify against a real Stripe staging Connect account:

1. Set `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SERVER_URL` +
   `STRIPE_SERVER_API_KEY` in `.env.development` (test-mode keys + the
   Cloud Run staging URL).
2. `npm run prebuild` — `expo-web-browser` is auto-linked but the
   Stripe SDK plugin's mods (Turn 3) still need a regenerated native
   tree.
3. `npm run ios` / `npm run android`.
4. Sign in as a driver, navigate to Earnings.
5. Tap "Set up payouts" → complete (or back out of) the Stripe-hosted
   form.
6. Verify the user doc gains `stripeAccountId` (flat) AND `stripe.id`
   (legacy nested) per the Turn 1 dual-write co-existence pattern.
7. After Stripe approves the account: pull-to-refresh on Earnings →
   balance + payouts + transactions populate.
8. Tap "View Express dashboard" → opens the Stripe-hosted dashboard
   in the system browser.
9. The Toast success banner should fire when the
   `pending → enabled` flip is observed.

If the iOS build fails at `pod install` time after this turn, capture
the error and extend `scripts/patch-podfile.js` before calling Turn 4
fully smoked on real device.
