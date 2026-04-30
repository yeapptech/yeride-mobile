# Phase 6 Turn 4 Kickoff Prompt — Driver Earnings + Stripe Connect onboarding

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 6
Turn 4.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 6 (Payments / Stripe Connect / tipping). Turn 1 shipped the
pure domain + data-layer foundation; Turn 2 shipped the real
`StripeServerHttpAdapter`, the `tipDriver` Cloud Function callable, the
13 authorization-aware payment use cases, and the DI wiring; Turn 3
shipped the rider-side Wallet + AddPaymentMethod modal — the first
Stripe-SDK surface in the rewrite. End of Turn 3: **137 suites / 1031
tests**, all verify gates green. `<StripeProvider/>` is now mounted in
`App.tsx`; `useStripe()` is callable from any screen. The 7 driver-side
Connect / balance / payouts use cases shipped in Turn 2 are still
behind a placeholder screen — your job this session is **Turn 4**:
ship the driver Earnings tab and the Stripe Connect onboarding flow.
No tip flow on RideReceipt yet — that's Turn 5. Read carefully before
writing any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file
   map. The "Project status" table now shows Phase 6 Turn 3 ✅; Turn 4
   is Next.
2. `docs/PHASE_6_TURN_3.md` — what shipped in Turn 3 (Wallet UI,
   `<StripeProvider/>` mount, jest-mock setup, `payment` query-key
   scope). The Wallet patterns you build on directly: tagged-union UI
   state, per-row inFlight flags, lazy mutation chaining via
   `mutateAsync`, `mockedPublishableKey` per-test override pattern.
3. `docs/PHASE_6_TURN_2.md` — re-skim the driver-side use cases
   (`EnsureStripeConnectAccount`, `CreateConnectOnboardingLink`,
   `CreateAccountLoginLink`, `RefreshConnectAccountStatus`,
   `GetDriverBalance`, `ListDriverPayouts`,
   `ListBalanceTransactions`). All 7 are wired through the DI
   container; Turn 4 is the UI side.
4. `docs/PHASE_6_KICKOFF.md` — re-read the Earnings + Connect
   onboarding scope under "Scope (in / out)" — the kickoff already
   sketched the tagged-union states. Confirm against Turn 3's actual
   outcomes (some of the original assumptions have shifted, especially
   on `@stripe/stripe-react-native` versioning and provider mount).
5. `src/app/usecases/payment/` — read every driver-side use case
   end-to-end. The four that Turn 4 wires into hooks first:
   - `EnsureStripeConnectAccount.ts` — idempotent on the driver's
     `stripeAccountId`. Mints a Standard Connect account if missing.
     Optional `country` arg defaults to `'US'`.
   - `CreateConnectOnboardingLink.ts` — produces
     `{url, expiresAt}`. The URL feeds
     `WebBrowser.openAuthSessionAsync`. The link is single-use; mint a
     fresh one per "Set up payouts" tap.
   - `RefreshConnectAccountStatus.ts` — server-read FIRST, doc-write
     SECOND. The doc-write writes the canonical flat fields AND the
     legacy nested `stripe: {...}` shape per the Turn 1 co-existence
     pattern. A doc-write failure surfaces as `NetworkError` so the
     caller knows to retry.
   - `CreateAccountLoginLink.ts` — Express dashboard URL. Used by the
     "View Express dashboard" affordance once the driver is enabled.
     The other three (`GetDriverBalance`, `ListDriverPayouts`,
     `ListBalanceTransactions`) are simple read-throughs but you'll wire
     all three.
6. `src/domain/entities/StripeAccountStatus.ts` and
   `src/domain/entities/Payout.ts` and
   `src/domain/entities/BalanceTransaction.ts` — the value objects the
   Earnings tab renders. Status is a closed union
   (`'pending' | 'enabled' | 'disabled'`); `Payout` carries
   `{id, amount: Money, status, arrivalDate}`; `BalanceTransaction`
   carries `{id, amount, fee, net, createdAt, type}`.
7. `src/domain/entities/User.ts` — confirm `Driver.stripeAccountId`
   (branded `StripeAccountId | null`), `stripeChargesEnabled`,
   `stripePayoutsEnabled`. The `'pending' | 'enabled' | 'disabled'`
   derivation in the VM is `chargesEnabled && payoutsEnabled` per
   legacy convention; `'disabled'` is the explicit "Stripe revoked
   you" state (which Turn 4 should surface even if rare).
8. `src/presentation/queries/payment.queries.ts` — the Turn 3 file you
   extend (or create a sibling for; see decision 3 below). Note the
   `useEnsureStripeCustomerMutation` / `useCreateSetupIntentMutation`
   / `useDetachPaymentMethodMutation` patterns — the Connect mutations
   are structurally similar.
9. `src/presentation/queries/keys.ts` — add Connect-side keys here.
   Pattern matches the existing `payment.methodsByCustomer(customerId)`
   shape: `payment.connectAccount(driverId)`,
   `payment.balance(accountId)`, `payment.payouts(accountId, args)`,
   `payment.balanceTransactions(accountId, args)`.
10. `src/presentation/features/rider/view-models/useWalletViewModel.ts`
    — closest model for `useDriverEarningsViewModel`. Both are
    tagged-union VMs that compose `useCurrentUserQuery` plus a series
    of mutations / queries plus an `Alert.alert`-driven action.
11. `src/presentation/features/rider/view-models/useAddPaymentMethodViewModel.ts`
    — closest model for `useStripeConnectOnboarding` (the
    side-effect-launching hook the Earnings VM consumes). Both
    orchestrate a multi-step async flow that ends with a SDK call;
    the error mapping pattern carries over.
12. `src/presentation/features/driver/screens/DriverEarningsPlaceholderScreen.tsx`
    — currently mounted at `DriverTabs > Earnings`. You'll replace it
    with the real `DriverEarningsScreen`.
13. `src/presentation/navigation/DriverTabsNavigator.tsx` — confirm
    the `Earnings` tab mounts the placeholder today; you'll swap in
    `DriverEarningsScreen`.
14. `src/presentation/navigation/DriverNavigator.tsx` — driver stack.
    The Connect onboarding URL opens in `WebBrowser.openAuthSessionAsync`
    (a system surface, not in-app), so NO new routes here. The
    Express dashboard is the same — opens via `WebBrowser`.
15. Legacy `yeride/src/driver/screens/Earnings.js` — UX reference for
    the Earnings tab: balance card at top (available + pending),
    "Set up payouts" CTA when not enabled, payouts list, recent
    balance-transaction list, "View Express dashboard" affordance.
    Note legacy uses Stripe Connect's hosted onboarding via
    `Linking.openURL` — the rewrite uses
    `expo-web-browser`'s `openAuthSessionAsync` instead, which gives
    us a `{type: 'success' | 'cancel'}` return value when the user
    completes or backs out.
16. Legacy `yeride/src/api/stripe/paymentProcessor.js` — re-skim the
    `createStripeAccount`, `createAccountLink`, `getAccountBalance`,
    `getAccountPayouts`, `getAccountBalanceTransactions` functions to
    confirm we're not missing any field the legacy UI surfaces.

## Starting state — what's already built (Turn 3)

- **Domain.** Three branded Stripe IDs, four payment value objects,
  `Driver.stripeAccountId: StripeAccountId | null` +
  `stripeChargesEnabled` + `stripePayoutsEnabled` on the User entity,
  immutable `setStripeAccountId` / `setStripeAccountFlags` helpers.
  `StripeAccountStatus` literal type, `Payout` / `BalanceTransaction`
  value objects.
- **Data layer.** `StripeServerHttpAdapter` (real fetch-based, retry-
  with-backoff, Bearer auth) implements all 11 `StripeServerService`
  methods. `CloudFunctionsService.tipDriver` ready for Turn 5. Both
  wired through DI with env-driven fallback to fakes.
- **App layer.** All 13 use cases shipped, including the 7 driver-
  side ones Turn 4 needs.
- **Test infra.** `TestContainerProvider` exposes `stripeServer?` +
  `cloudFunctions?` override knobs. `FakeStripeServerService` covers
  every method with seed/spy/failNext seams (read it for
  `seedConnectAccount` / `seedBalance` / `seedPayouts` /
  `seedBalanceTransactions` shape). The Stripe SDK jest mock is wired
  globally in `jest.setup.ts` so `useStripe()` returns stub methods
  out of the box; per-test overrides via
  `(useStripe as jest.MockedFunction<typeof useStripe>).mockReturnValue(...)`.
- **Presentation.** `<StripeProvider/>` mounted as the outermost
  provider in `App.tsx` via `MaybeStripeProvider` (no-ops when no
  publishable key). `getStripePublishableKey()` env helper in
  `@shared/env`. The `payment` query-key scope exists with one entry
  (`methodsByCustomer`); Turn 4 extends it. The rider Wallet flow is
  end-to-end — set-default plumbed into `PassengerSnapshot.defaultPaymentMethod`
  for trip completion. Driver Earnings tab is still the placeholder
  screen.
- **No `expo-web-browser` in the bundle yet.** No Connect onboarding
  affordance. The Earnings + Connect surface is YOUR work this turn.

## Scope decisions (locked at Turn 4 kickoff — confirm or override)

These were resolved before the kickoff doc was written. Don't re-debate
mid-turn — propose follow-ups in the deferred list.

1. **`expo-web-browser` for Connect onboarding.** Use
   `WebBrowser.openAuthSessionAsync(url, returnUrl)` per the kickoff
   plan. The system browser handles the Stripe-hosted onboarding form;
   on completion or cancel the Promise resolves to `{type, url}`.
   `returnUrl` uses the existing app deep-link scheme
   (`yeridenext-dev://stripe-return` for dev,
   `yeridenext-stage://stripe-return` for stage,
   `yeridenext://stripe-return` for prod) — `app.config.ts` already
   declares the scheme per env. The microservice's
   `/account-links-create` accepts `refreshUrl` + `returnUrl`; pass
   the env-appropriate scheme on every call. Run `npx expo install
expo-web-browser` (let it pick the SDK 55-compatible version).

2. **Re-fetch is the source of truth, NOT the URL params.** Stripe's
   onboarding return URL doesn't carry account-state params
   reliably; users can also close the browser tab early. The
   `useStripeConnectOnboarding` hook should call
   `RefreshConnectAccountStatus` regardless of the
   `WebBrowser.openAuthSessionAsync` outcome (`success` or `cancel`)
   — even on `cancel`, the user might have completed onboarding in a
   previous session and only just opened the tab. On `dismiss` (the
   user dismissed the in-app browser sheet), no-op — no state change.

3. **Extend `payment.queries.ts`, don't fork into `connect.queries.ts`.**
   The Turn 3 file is named after the bounded context (payments
   broadly), not the subdomain (rider methods). Adding the Connect /
   balance / payouts hooks to the same file keeps related TanStack
   keys + their mutations co-located. If the file grows past ~600
   lines we can split later. The `payment` scope in `keys.ts`
   similarly grows — add `connectAccount`, `balance`, `payouts`,
   `balanceTransactions` keys under the same scope.

4. **`'pending'` vs `'enabled'` derivation.** `'pending'` =
   `stripeAccountId !== null && (!chargesEnabled || !payoutsEnabled)`.
   `'enabled'` = both flags true. `'disabled'` = the explicit
   `disabled` literal from `RefreshConnectAccountStatus`'s server
   response. Add a `deriveStripeAccountStatus(driver)` helper in
   `src/domain/services/` (next to `FareCalculator`) so both the VM
   and any future consumer use the same derivation. Pure function,
   easy to test.

5. **Refresh strategy.** The Earnings VM refreshes account status:
   - On screen focus (`useFocusEffect`) — handles the post-onboarding
     return.
   - On app-foreground (`AppState` change to `'active'`) — handles
     the case where onboarding completes in a different session.
   - Manual pull-to-refresh on the screen's `RefreshControl`.

   Balance and payouts queries: TanStack `staleTime: 30_000`,
   `refetchOnWindowFocus: false` (we'll handle focus manually because
   the screen mounts under a tab navigator that doesn't fire
   window-focus events). Pull-to-refresh runs all three queries
   in parallel via `Promise.all([balance.refetch(), payouts.refetch(),
balanceTxns.refetch()])`.

6. **Currency display.** USD only, formatted via a
   `formatMoney(money: Money): string` helper that produces
   `'$12,345.67'`. Put it in `src/presentation/features/driver/utils/`
   so it's reachable from the Earnings VM, payouts list rows, and
   balance-txn rows. `Money.minorUnits / 100` with `Intl.NumberFormat`
   - `currency: 'USD'`. Negative amounts (refunds, transfers out)
     render with a leading minus, not parentheses.

7. **Empty list copy.** "No payouts yet" for empty payouts;
   "No transactions yet" for empty balance txns. Friendly + dry, in
   line with the Wallet's "No payment methods" empty state. Don't
   over-explain.

8. **Express dashboard reach.** Behind a "View Express dashboard"
   row in the Earnings screen, visible only in the `'enabled'` arm.
   Tapping fires `CreateAccountLoginLink` (mints a single-use URL),
   then opens it via `WebBrowser.openBrowserAsync(url)` (NOT
   `openAuthSessionAsync` — there's no auth-session contract here;
   we're just opening a URL). On error (network), surface a Toast.

9. **Account-status Toast on success.** When the
   `useStripeConnectOnboarding` hook detects a status flip
   `'pending' → 'enabled'`, fire a Toast.show success
   "You're set up to receive payouts." This is the only place the
   Earnings flow surfaces a Toast — the rest is screen-driven.

10. **No mid-trip interruption.** If a driver's account flips to
    `'disabled'` while on a trip, the trip completes normally — funds
    queue server-side. The disabled state surfaces on the Earnings
    tab the next time the driver opens it. Do NOT add a global banner
    or interrupt the active-trip flow.

## Scope (in / out)

**In:**

- **`expo-web-browser` install + native config:**
  - `npx expo install expo-web-browser`. Record exact pinned version
    in `docs/PHASE_6_TURN_4.md`.
  - The package is auto-linked; no Expo plugin config needed.
  - Verify `WebBrowser.openAuthSessionAsync(url, returnUrl)` resolves
    `{type: 'success' | 'cancel' | 'dismiss', url?}` per the SDK
    docs. Mock at the module seam in tests:
    ```ts
    jest.mock('expo-web-browser', () => ({
      openAuthSessionAsync: jest.fn(async () => ({
        type: 'success',
        url: 'yeridenext-dev://stripe-return',
      })),
      openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
      WebBrowserResultType: {
        Success: 'success',
        Cancel: 'cancel',
        Dismiss: 'dismiss',
      },
    }));
    ```

- **Domain helper:**
  - `src/domain/services/StripeAccountStatusDeriver.ts` — pure
    function `deriveStripeAccountStatus(driver: Driver):
StripeAccountStatus`. Returns `'no_account'` when
    `stripeAccountId === null`, `'pending'` when accountId present but
    flags incomplete, `'enabled'` when both flags true, `'disabled'`
    is set ONLY by an explicit field on the user doc (a future field;
    for Turn 4 we conservatively map a server-confirmed disabled
    response into a separate `lastConnectStatusCheckedAt` /
    `connectAccountDisabled: boolean` pair on the User doc). Decision:
    add `connectAccountDisabled?: boolean` to `Driver` (defaults to
    false) so `RefreshConnectAccountStatus` can persist it. Update
    `userMapper` to read/write the field on both flat AND legacy
    nested shapes.

- **TanStack hooks** (extending `src/presentation/queries/payment.queries.ts`):
  - `useEnsureStripeConnectAccountMutation` — invalidates
    `user.current`.
  - `useCreateConnectOnboardingLinkMutation` — no invalidation;
    result feeds `WebBrowser.openAuthSessionAsync`.
  - `useRefreshConnectAccountStatusMutation` — invalidates
    `user.current` AND `payment.balance(accountId)` (charges-enabled
    flip changes balance reachability).
  - `useDriverBalanceQuery({accountId})` — gated `enabled: accountId
!== null`; `staleTime: 30_000`.
  - `useDriverPayoutsQuery({accountId, days, limit})` — defaults
    `{days: 7, limit: 10}` per legacy. Same staleTime.
  - `useBalanceTransactionsQuery({accountId, days, limit})` —
    defaults `{days: 7, limit: 25}` per legacy.
  - `useCreateAccountLoginLinkMutation` — no invalidation; result
    opens via `WebBrowser.openBrowserAsync`.
  - Add to `keys.ts` payment scope:
    `payment.connectAccount(driverId)`,
    `payment.balance(accountId)`,
    `payment.payouts(accountId, {days, limit})`,
    `payment.balanceTransactions(accountId, {days, limit})`.

- **`useStripeConnectOnboarding` hook**
  (`src/presentation/features/driver/hooks/useStripeConnectOnboarding.ts`):
  - Single async `start()` callback. On call:
    1. `useEnsureStripeConnectAccountMutation` to get the accountId.
    2. `useCreateConnectOnboardingLinkMutation` to mint the link.
    3. `WebBrowser.openAuthSessionAsync(link.url, returnUrl)`.
    4. Always run `useRefreshConnectAccountStatusMutation` afterwards
       — `success` and `cancel` both trigger refresh; `dismiss`
       no-ops.
    5. If status flipped to `'enabled'`, fire a success Toast.
  - Returns `{start, isOnboarding}` where `isOnboarding` is the
    union of the underlying mutations' `isPending`.
  - Error-mapping per Turn 3's `mapStripeError` discipline:
    `'network'` / `'unknown'`. Reuses `getStripePublishableKey()`
    only as a defense-in-depth check (the surface is gated by
    `<StripeProvider/>` mounting — but the hook can run in surfaces
    where the provider is absent, so a defensive check guards
    against a misconfigured build).

- **`useDriverEarningsViewModel` + tests:**
  - File: `src/presentation/features/driver/view-models/useDriverEarningsViewModel.ts`.
  - Composes `useCurrentUserQuery` + the four queries/mutations +
    `useStripeConnectOnboarding` + `useFocusEffect` +
    `AppState` listener.
  - Tagged-union state:
    - `unconfigured` — no publishable key
    - `loading` — initial currentUser still pending
    - `no_account` — driver has no `stripeAccountId`. Shows
      "Set up payouts" CTA.
    - `pending` — accountId present, charges/payouts not yet
      enabled. Shows "We're verifying your account" + "Continue
      setup" CTA (re-opens onboarding).
    - `disabled` — explicit disabled status from server.
      Shows "Your account needs attention" + "Resolve" CTA
      (re-opens onboarding).
    - `enabled` — full earnings dashboard. Carries
      `{available: Money, pending: Money, payouts, balanceTxns,
onViewExpressDashboard, onRefresh, isRefreshing}`.
    - `error` — one of the queries failed; shows Retry.
  - Tests via `TestContainerProvider`: ~10-12 tests covering each
    arm + onboarding success path + onboarding cancel path +
    Express-dashboard reach + refresh-on-focus + error.

- **`DriverEarningsScreen` + `formatMoney` util + smoke tests:**
  - `src/presentation/features/driver/screens/DriverEarningsScreen.tsx`
    consumes the VM. Each arm gets a dedicated layout per the
    Wallet's pattern.
  - `src/presentation/features/driver/components/PayoutRow.tsx`
    — one row: arrival-date label, status pill, amount.
  - `src/presentation/features/driver/components/BalanceTransactionRow.tsx`
    — one row: type, created-at, fee/net split (small text).
  - `src/presentation/features/driver/utils/formatMoney.ts` — the
    USD formatter helper.
  - Smoke renders for the screen + each row. ~6 tests total.

- **Wiring:**
  - `DriverTabsNavigator` — swap `DriverEarningsPlaceholderScreen` →
    `DriverEarningsScreen`.
  - No new routes in `DriverNavigator` (onboarding is system
    browser).
  - `presentation/queries/index.ts` — re-export the new hooks.
  - `keys.ts` — extend `payment` scope with the four new key
    factories.
  - `app.config.ts` — confirm the `scheme` declaration per env is
    the source of truth for the `returnUrl`. No changes needed
    (Phase 0 set this up).

**Out (deferred — do not build in Turn 4):**

- Tip flow on RideReceipt — Turn 5.
- Per-payout drill-down screen — Phase 9 polish (the row stays
  read-only this turn).
- Earnings analytics beyond the simple list — Phase 9.
- Reconnect-mid-trip warning banner — kickoff decision 10.
- Disable-state recovery flow beyond opening onboarding again —
  Stripe handles the disable resolution flow on their side.
- Push notifications for arrived payouts — Phase 9.
- Multi-currency — Phase ∞ (legacy is USD-only; same).
- Toast for failed `RefreshConnectAccountStatus` (just stays in
  the previous state; the next refresh recovers).

## Risks + mitigations

- **`expo-web-browser` permissions / iOS Safari View Controller
  modal stack.** On iOS, `openAuthSessionAsync` uses
  `ASWebAuthenticationSession` which presents a system-level
  permission prompt the first time. Test on a real device — the
  simulator behavior can drift. If the prompt loop fails, fall back
  to `openBrowserAsync` (no callback contract, no permission prompt)
  and rely on `useFocusEffect` + `AppState` to detect the return.
  Document the fallback in the Turn 4 doc.

- **`returnUrl` deep-link scheme drift.** Each env has its own
  scheme. A missed env in `app.config.ts` would silently produce a
  return URL the system can't route. Read `Constants.expoConfig
?.scheme` at runtime to derive the right scheme; don't hardcode.
  Test with a snapshot per env.

- **`AppState` listener leak.** The Earnings VM subscribes to
  `AppState.addEventListener('change', ...)`. The `useEffect`
  cleanup MUST remove the listener or the listener accumulates
  across screen re-mounts. Use `subscription.remove()` per the
  React Native docs (NOT the legacy `removeEventListener`).

- **Concurrent refresh race.** Pull-to-refresh fires three queries
  in parallel; if `RefreshConnectAccountStatus` lands AFTER one of
  the others, the `chargesEnabled` flip might invalidate the
  balance query mid-fetch. Mitigation: TanStack handles
  invalidation idempotently — the in-flight balance fetch resolves,
  then the invalidation triggers a fresh fetch. No correctness
  issue; just an extra round-trip on rare timing. Do NOT try to
  serialize.

- **Stripe Connect status on a brand-new account.** A freshly-
  created Connect account starts with `chargesEnabled: false`,
  `payoutsEnabled: false`. The `'pending'` arm is correct;
  the user hasn't completed onboarding yet. Don't try to be clever
  about distinguishing "in-progress onboarding" vs "not started" —
  the UI shows the same `'pending'` state in both, with a
  "Continue setup" CTA that reopens the onboarding link.

- **Express dashboard URL expiry.** Account login links are
  single-use and expire quickly. If the user taps "View Express
  dashboard" twice, the second tap mints a fresh link — no
  reuse. The mutation handles this naturally.

- **`expo-constants` `scheme` reading in tests.** The hook will
  read `Constants.expoConfig?.scheme` to build the `returnUrl`.
  The test environment doesn't load `expo-constants` natively
  unless mocked. Mock the module return value at the test seam,
  matching the existing `getStripePublishableKey` mock pattern.

- **`useFocusEffect` re-runs on every focus.** The refresh
  triggers ON every focus, which means navigating away and back
  fires another `RefreshConnectAccountStatus`. That's fine — the
  use case is idempotent and the cost is one server read. Don't
  add a debounce; the user is already implicitly intent-driving
  the refresh.

- **Stripe SDK iOS modular-headers.** Should be settled by Turn 3.
  If `pod install` regresses on Turn 4 (e.g. because `expo-web-
browser` adds a transitively-modular dependency), extend
  `scripts/patch-podfile.js` per the existing pattern.

## Acceptance for end of Turn 4

A signed-in driver can navigate to the Earnings tab and:

1. Without a Connect account: see the "Set up payouts" CTA → tap →
   land in `WebBrowser.openAuthSessionAsync` showing the Stripe-
   hosted form → complete or back out → return to the app → see
   the appropriate state (`enabled` if onboarding succeeded,
   `pending` if not).
2. In `pending` state: see "We're verifying your account" and a
   "Continue setup" CTA that reopens the onboarding link.
3. In `enabled` state: see the balance card (available + pending
   in USD), payouts list (last 7 days, max 10), recent balance
   transactions list (last 7 days, max 25), "View Express
   dashboard" row that opens the Stripe-hosted dashboard.
4. Pull-to-refresh refreshes all three queries.
5. App-foreground re-fires the account-status refresh.
6. A driver in the unconfigured (no publishable key) state sees a
   loud error block; the rest of the app is unaffected.

A signed-in driver who completes onboarding sees a Toast success
"You're set up to receive payouts." on the status flip.

`npm run verify` (typecheck + lint + format + test) all green.
Test delta target: **+5 to +6 suites, +35 to +45 tests**. Net should
land around **143 suites / 1070 tests**.

## Conventions (non-negotiable — same as Turns 1–3)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors.
- Server state goes in TanStack Query (`useDriverBalanceQuery` etc.).
  Client/UI state goes in component-local `useState` / Zustand. The
  Earnings VM has no Zustand state — all state is server-derived or
  per-component.
- Each screen gets a sibling `useXxxViewModel.ts`. Screens are dumb
  (props in, JSX out). The `useStripeConnectOnboarding` hook is a
  side-effect-launcher consumed by the Earnings VM, not a screen-
  level VM.
- Logger only: `LOG.extend('EARNINGS')` for the screen flow,
  `LOG.extend('CONNECT')` for the onboarding hook. Never `console.*`.
- Idempotency: `EnsureStripeConnectAccount` is server-idempotent;
  calling it on every "Set up payouts" tap is safe. The onboarding
  link, however, is single-use — mint a fresh one per tap.
- Dual-mode boot: with env configured, the real adapter runs; without
  env, the fake runs and the onboarding flow surfaces a fail-loud
  banner. Same pattern as Turn 3.
- Every Stripe-server call goes through `StripeServerService` (the
  real impl OR the fake). No direct fetch calls anywhere in the new
  code.
- Run `npm run verify` before declaring the turn done. Target test
  count is informational; the hard gate is "all four checks pass."

## Suggested ordering

- **Step 1 — `expo-web-browser` install.** `npx expo install expo-web-browser`.
  Verify it's in `package.json` and node_modules. Record the pinned
  version. Note: prebuild is NOT required for `expo-web-browser`
  alone — it's auto-linked. If you're paranoid run prebuild anyway,
  but the doc should clarify it's not strictly required this turn
  (only Stripe needed it last turn).

- **Step 2 — Domain helper + tests.** Build
  `deriveStripeAccountStatus(driver)` in
  `src/domain/services/StripeAccountStatusDeriver.ts`. Tests cover
  every arm including the new `'no_account'` state. Update
  `Driver` entity with `connectAccountDisabled?: boolean` (default
  false) + helper `setConnectAccountDisabled`. Update `userMapper`
  to read/write on both flat AND legacy nested shapes per the
  Turn 1 co-existence pattern.

- **Step 3 — TanStack hooks + key factories.** Extend
  `payment.queries.ts` with the 4 driver-side mutations + 3 read
  queries. Extend `keys.ts`. Re-export from `queries/index.ts`.

- **Step 4 — `useStripeConnectOnboarding` hook + tests.** Mock
  `expo-web-browser` at the module seam. Test: success path,
  cancel-still-refreshes path, dismiss is no-op, network failure on
  EnsureAccount, network failure on CreateLink, success Toast on
  status flip.

- **Step 5 — `useDriverEarningsViewModel` + tests.** Mount through
  `TestContainerProvider`. Cover every UI arm + onboarding launch
  - Express-dashboard reach + refresh-on-focus + error.

- **Step 6 — Components + screen + smoke tests.** `formatMoney`
  helper, `PayoutRow`, `BalanceTransactionRow`, `DriverEarningsScreen`.
  Smoke renders only — business logic is in the VM.

- **Step 7 — Navigation wiring.** Swap placeholder → real screen in
  `DriverTabsNavigator`. No new routes.

- **Step 8 — `npm run verify` + commit + write `docs/PHASE_6_TURN_4.md`.**
  Update `CLAUDE.md` (Phase 6 Turn 4 → ✅, Turn 5 → Next, refresh
  test counts, add to "Critical files" the new VMs / hooks /
  screens). Commit via the sandbox `GIT_INDEX_FILE` shadow pattern.

## Start with

Read `CLAUDE.md`, then `docs/PHASE_6_TURN_3.md`, then re-skim
`docs/PHASE_6_KICKOFF.md` (driver Earnings + Connect section). Then
read the 7 driver-side payment use cases in `src/app/usecases/payment/`
end-to-end. Then read `src/presentation/features/rider/view-models/
useWalletViewModel.ts` and `useAddPaymentMethodViewModel.ts` (the
closest models for the new VM and onboarding hook). Then read legacy
`Earnings.js` for UX shape. Then propose **Turn 4 scope as a numbered
punch list** (files to create, files to touch, tests to add — in the
same shape as Turn 3's punch list) and wait for confirmation before
writing code.

Tip: this kickoff has the same shape as Turn 3's. Mirror that
structure for Turn 5's kickoff (Tip flow on RideReceipt + Phase 6
cleanup) when Turn 4 lands.
