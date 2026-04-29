# Phase 6 Kickoff Prompt — Payments / Stripe Connect / tipping

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 6.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Phase 5 just closed:
the driver vehicle-management surface is end-to-end (registration →
photos → details → set-active → soft-delete), the `'vehicle-stub'`
literal is gone, DriverHome surfaces the active vehicle, and 9
authorization-aware vehicle use cases are wired through the DI
container. Your job this session is to start **Phase 6: Payments /
Stripe Connect / tipping**. Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered architecture,
   conventions, file map. The "Project status" table now shows Phase 5
   complete and Phase 6 Next.
2. `REFACTOR_PLAN.md` — Phase 6 scope (§ "Phase 6 — Payments").
3. `docs/PHASE_5_TURN_4.md` (most recent) — what closed Phase 5; in
   particular how the driver / rider tabs already declare
   `WalletPlaceholderScreen` (rider) and `DriverEarningsPlaceholderScreen`
   (driver) as Phase-6 placeholders. Those are the two tabs you'll fill
   in.
4. The rewrite's existing payment touchpoints. Read in this order:
   - `src/domain/entities/User.ts` — confirms `stripeCustomerId` (rider)
     and `stripeAccountId` / `stripeChargesEnabled` /
     `stripePayoutsEnabled` (driver) fields are already declared on the
     User aggregate. Phase 6 _populates_ them; doesn't add them.
   - `src/domain/entities/PassengerSnapshot.ts` — `defaultPaymentMethod`
     field. The Ride aggregate already copies this into the trip at
     `CreateRide` time, so the dispatcher / completeTrip callable
     already has what it needs. Phase 6 makes the field non-null by
     wiring the Wallet UI.
   - `src/domain/entities/TripPayment.ts` — read-only payment record
     (`{type: 'fare' | 'tip' | 'refund', status, amount, createdAt}`).
     Written by `yeride-stripe-server` webhooks; the rewrite reads via
     `ObserveTripPayments` + `useObserveTripPaymentsSubscription`.
   - `src/data/services/CloudFunctionsService.ts` — already wraps
     `completeTrip` and `cancelTrip` callables. Phase 6 adds a third
     callable: `tipDriver`. Same shape, same `us-east1` region.
   - `src/app/usecases/ride/RequestPayment.ts` — current trip-end
     payment trigger. The Cloud Function already runs Stripe; Phase 6
     doesn't change this pipeline, just makes sure
     `defaultPaymentMethod` is non-null when the rider creates a ride.
5. Legacy app:
   - `/Users/papagallo/yeapptech/dev/yeride/src/api/stripe/paymentProcessor.js`
     — full API surface. ~15 functions covering customer creation,
     payment methods (setup-intent / detach), Stripe Connect onboarding
     (`createStripeAccount`, `createAccountLink`, `getAccountBalance`,
     `getAccountPayouts`, `getAccountBalanceTransactions`), tip
     processing (`processTipPayment`), and direct charges. Phase 6
     mirrors most of this; insurance / payment-sheet bits stay deferred
     to Phase 9 polish.
   - `/Users/papagallo/yeapptech/dev/yeride/src/rider/screens/Wallet.js`
     and `PaymentMethod.js` — UI / UX reference for the rider Wallet tab.
   - `/Users/papagallo/yeapptech/dev/yeride/src/driver/screens/Earnings.js`
     — UI / UX reference for the driver Earnings tab.
   - `/Users/papagallo/yeapptech/dev/yeride/src/components/TipSelector.js`
     — UI / UX reference for the post-completion tip prompt
     (presets: $1 / $3 / $5 + custom).
6. Backend services:
   - `/Users/papagallo/yeapptech/dev/yeride-stripe-server/CLAUDE.md` —
     auth (`STRIPE_SERVER_API_KEY` Bearer token), rate-limit tiers,
     endpoint map. The rewrite's `StripeServerService` adapter will
     POST against `/create-setup-intent`, `/customers-create`,
     `/customer-payment-methods`, `/detach-payment-method`,
     `/accounts-create`, `/account-links-create`, `/account-balance`,
     `/account-payouts`, `/customer-charges-list`, and similar.
   - `/Users/papagallo/yeapptech/dev/yeride-functions/CLAUDE.md` —
     confirms `tipDriver` callable lives alongside `completeTrip` /
     `cancelTrip` (`handlers/tip-driver.js`). Phase 6 calls it via the
     existing `CloudFunctionsService` pattern.
7. Existing PaymentSheet / Stripe React Native usage. Read
   `/Users/papagallo/yeapptech/dev/yeride/package.json` for the
   `@stripe/stripe-react-native` version legacy ships, and the
   relevant `Wallet.js` / `PaymentMethod.js` to see how it's used. The
   rewrite will pin a compatible Expo SDK 55–era version.

## Starting state — what's already built

- **Domain.** `User.stripeCustomerId` + the three driver fields exist.
  `PassengerSnapshot.defaultPaymentMethod` exists. `TripPayment` value
  object + `ObserveTripPayments` use case exist (Phase 3 turn 4b shipped
  these for the rider receipt). No Stripe-specific use cases or
  services yet — Phase 6 creates them.
- **Data.** `CloudFunctionsService` already calls `completeTrip` /
  `cancelTrip`. The `payment_requested` → `completed` Firestore trip
  status flip already happens on the server side via webhooks. No
  `StripeServerService` adapter yet.
- **Presentation.** `WalletPlaceholderScreen` + `DriverEarningsPlaceholderScreen`
  are the two existing placeholder tabs Phase 6 replaces. The rider's
  `RideReceiptScreen` (Phase 3 turn 5) already renders `TripPayment`
  records but has no tipping affordance — Phase 6 adds it. Driver's
  Profile / Vehicles surfaces do not need changes.
- **Backend co-existence.** `yeride-stripe-server` and
  `yeride-functions` are deployed once and called by both legacy yeride
  and the rewrite. Don't rev API contracts; just consume the existing
  endpoints. The rewrite shares the staging Stripe account with legacy
  in dev/stage; production cutover (Phase 10) gets a fresh account.

So Phase 6 spans every layer: a few new domain value objects + a new
service interface, a new HTTP adapter (`StripeServerHttpAdapter`) +
extension to `CloudFunctionsService` (`tipDriver`), ~9 new use cases,
two new full screens (Wallet, Earnings) + one new component (tip
selector on the rider receipt), and a compositing rewrite of the rider
default-payment-method selection so it propagates into the existing
`CreateRide` flow.

## Scope decisions (locked at kickoff)

These were resolved before the kickoff doc was written. Don't re-debate
them mid-phase — propose follow-ups in the deferred list instead.

1. **`@stripe/stripe-react-native` for in-app card collection.** The
   library handles `CardForm` / `PaymentSheet` natively per platform.
   Pin a version compatible with Expo SDK 55 (likely `~0.51.x` —
   confirm against the SDK 55 compatibility matrix when adding the
   dep). Use `CardForm` (not deprecated `CardField`) per legacy
   `CLAUDE.md`. Card data NEVER touches our app or our server — Stripe
   tokenizes inside their native SDK.
2. **`StripeServerHttpAdapter` is the single seam to the Stripe
   microservice.** No other layer talks to the stripe-server. The
   adapter exposes a `StripeServerService` interface in `domain/services/`.
   Implementation lives in `data/services/StripeServerHttpAdapter.ts`
   and uses `fetch` with a Bearer token from env.
3. **`tipDriver` Cloud Function callable**, NOT a direct
   `stripe-server` call. Tipping needs to (a) charge the rider, (b)
   route to the driver's Connect account, AND (c) write a TripPayment
   record + notify the driver. Doing this from the client is racy;
   the Cloud Function already orchestrates it. Just call it via
   `CloudFunctionsService.tipDriver({tripId, amount})`.
4. **Stripe Connect onboarding via `WebBrowser.openAuthSessionAsync`.**
   Driver taps "Set up payouts" on Earnings tab → backend creates a
   Connect account + an account link → app opens the Stripe-hosted URL
   in `WebBrowser.openAuthSessionAsync` with a `yeridenext-dev://stripe-return`
   redirect → on return, the app polls account status. Same UX as
   legacy. Use `expo-web-browser`; deep-link return uses the existing
   scheme.
5. **No webhook handling in the mobile app.** Webhooks live in
   `yeride-stripe-server` and write to Firestore (the trip-events
   subcollection + the trip doc's `status` flip). The rewrite
   subscribes to those Firestore changes via the existing
   `useRideQuery` / `useObserveTripPaymentsSubscription` — no new
   webhook surface.
6. **`yeride-functions` and `yeride-stripe-server` deploy once.** Both
   apps consume the same endpoints; no parallel deployments. If the
   rewrite needs a NEW endpoint, that's a separate decision and a
   separate PR against the backend repos — Phase 6 should not require
   any backend changes if everything is mirrored faithfully.

## Scope (in / out)

**In:**

- **Domain layer**:
  - `PaymentMethod` value object — branded `PaymentMethodId` + masked
    `last4` + `brand` (`'visa' | 'mastercard' | …`) + `expiry: { month, year }`.
    Factory returns `Result<PaymentMethod, ValidationError>`.
  - `StripeAccountStatus` literal type — `'pending' | 'enabled' | 'disabled'`.
    Derived from `stripeChargesEnabled && stripePayoutsEnabled` per
    legacy convention.
  - `Payout` value object — `{id, amount: Money, status, arrivalDate}`.
  - `BalanceTransaction` value object —
    `{id, amount, fee, net, createdAt, type}`.
  - `StripeServerService` interface in `src/domain/services/`. Methods:
    `createCustomer`, `createSetupIntent`, `listPaymentMethods`,
    `detachPaymentMethod`, `createConnectAccount`, `createAccountLink`,
    `createAccountLoginLink`, `getAccountBalance`, `listAccountPayouts`,
    `listBalanceTransactions`, `listCustomerCharges`. Each returns
    `Promise<Result<X, NetworkError | AuthorizationError | ValidationError>>`.

- **Data layer**:
  - `StripeServerHttpAdapter` in `src/data/services/StripeServerHttpAdapter.ts`.
    `fetch`-based, Bearer-token auth, structured error mapping
    (`401 → AuthorizationError`, `429 → NetworkError(rate_limited)`,
    `5xx → NetworkError(server_error)`). Same retry policy as
    `GoogleRoutesService` (3 attempts with exponential backoff for
    `5xx` only — never retry `4xx`).
  - `CloudFunctionsService.tipDriver({tripId, amount})` extension —
    same callable shape as `completeTrip` / `cancelTrip`.
  - `FakeStripeServerService` in `src/shared/testing/`. Configurable
    seam for use-case tests. `seedSetupIntentClientSecret`,
    `seedConnectAccount`, `seedBalance`, etc. — same shape as
    `FakeRoutesService`.

- **App layer (use cases in `src/app/usecases/payment/`)**:
  - `EnsureStripeCustomer` — idempotent: returns the user's existing
    `stripeCustomerId` or creates one via `StripeServerService` and
    persists it on the user doc.
  - `CreateSetupIntent` — wraps `StripeServerService.createSetupIntent`.
    Used by the rider Wallet add-card flow.
  - `ListPaymentMethods` — wraps `StripeServerService.listPaymentMethods`.
    Auth-gated on the signed-in user matching the customerId.
  - `DetachPaymentMethod` — wraps the detach endpoint. Auth-gated.
  - `SetDefaultPaymentMethod` — updates the user doc. Pure Firestore
    write; no Stripe call.
  - `EnsureStripeConnectAccount` — idempotent: returns the user's
    existing `stripeAccountId` or creates a Standard Connect account
    via `StripeServerService.createConnectAccount` and persists it on
    the user doc.
  - `CreateConnectOnboardingLink` — wraps `createAccountLink`. Returns
    the URL the app opens in `WebBrowser`.
  - `RefreshConnectAccountStatus` — re-fetches the account from the
    server, derives `chargesEnabled` / `payoutsEnabled`, updates the
    user doc. Called after `WebBrowser` returns.
  - `GetDriverBalance` + `ListDriverPayouts` + `ListBalanceTransactions`
    — Earnings-tab data reads.
  - `ProcessTip({tripId, amount})` — wraps the `tipDriver` Cloud
    Function callable. Returns the new `TripPayment` record on success.

- **Presentation layer**:
  - **Rider Wallet** (replaces `WalletPlaceholderScreen`):
    - `WalletScreen` + `useWalletViewModel` — list of payment methods
      (live via `useListPaymentMethodsQuery`), default-payment-method
      indicator, swipe-to-delete (or trash + Alert per legacy), CTA to
      add a new card. Uses `useEnsureStripeCustomerMutation` lazily on
      first card add.
    - `AddPaymentMethodScreen` + `useAddPaymentMethodViewModel` —
      Stripe `CardForm` + the standard Stripe React Native flow:
      `useStripe()` → `confirmSetupIntent({clientSecret})`. On success,
      invalidate `paymentMethod.list` query.
  - **Driver Earnings** (replaces `DriverEarningsPlaceholderScreen`):
    - `DriverEarningsScreen` + `useDriverEarningsViewModel` —
      tagged-union state: `{ kind: 'no_account' }` → onboarding CTA;
      `{ kind: 'pending' }` → "We're verifying your account" state;
      `{ kind: 'enabled', balance, payouts, recentTransactions }` →
      full earnings dashboard. The `pending` branch surfaces a "Continue
      setup" button that re-opens the `createAccountLink` URL.
    - `useStripeConnectOnboarding` hook — wraps
      `WebBrowser.openAuthSessionAsync` + `RefreshConnectAccountStatus`.
      The Earnings VM consumes it; the screen body stays dumb.
  - **Tip flow** (extension to `RideReceiptScreen`):
    - `TipSelector` component — preset chips ($1 / $3 / $5) + custom
      amount input + "Tip $X" CTA. Driven by parent props.
    - `useRideReceiptViewModel` extended with `onSubmitTip(amount)` —
      fires `useProcessTipMutation`. On success, the receipt re-renders
      with the new TripPayment record (server-side push via
      `useObserveTripPaymentsSubscription`).

- **Wiring**:
  - `package.json` adds `@stripe/stripe-react-native` (Expo SDK 55-
    compatible version) + `expo-web-browser`. Both via
    `npx expo install`.
  - `app.config.ts` registers the `@stripe/stripe-react-native` Expo
    plugin and configures `merchantIdentifier` for Apple Pay (placeholder
    string is fine; we don't enable Apple Pay this phase).
  - `App.tsx` (or `AppContent.tsx`) wraps the navigator in
    `<StripeProvider publishableKey={...} />`. Read the publishable key
    from `extra.stripePublishableKey` per the existing env pattern.
  - DI container gains `stripeServer: StripeServerService` arg, threads
    through `makeUseCases({...})`. Production branch lazy-`require`s
    `StripeServerHttpAdapter`; fakes branch wires
    `FakeStripeServerService`. `TestContainerProvider` gains
    `stripeServer?` override.
  - New TanStack query keys: `paymentMethod.list(userId)`,
    `stripeAccount.byDriver(driverId)`, `stripeAccount.balance(driverId)`,
    `stripeAccount.payouts(driverId)`. Mutations invalidate the right
    keys.
  - `RiderTabsNavigator` swaps `WalletPlaceholderScreen` →
    `WalletScreen`. `DriverTabsNavigator` swaps
    `DriverEarningsPlaceholderScreen` → `DriverEarningsScreen`.
  - `RiderStackParamList` gains `AddPaymentMethod: undefined` (modal
    push). `DriverStackParamList` doesn't gain new routes — the
    onboarding URL opens in `WebBrowser`, not in-app.

**Out (deferred — do not build in Phase 6):**

- **Apple Pay / Google Pay.** Legacy doesn't have it; Phase 6 mirrors
  that. Phase 9 polish can layer it on top of the existing
  `StripeProvider`.
- **Express Dashboard inside the app.** Legacy redirects to the
  Stripe-hosted dashboard via `createAccountLoginLink`; we keep that
  pattern. No in-app earnings analytics beyond the simple list.
- **Refund initiation from the app.** Refunds are admin-only via the
  Stripe dashboard (the existing webhook → trip-event flow handles the
  app-side reconciliation when a refund lands).
- **Multi-currency.** USD only, same as legacy. The `Money` value
  object already constrains this.
- **Subscription / pre-auth holds.** Charges happen at trip completion
  via `completeTrip`; no pre-trip authorization holds.
- **Insurance document upload.** Out of Phase 5 already; stays out.
- **Driver Express Dashboard re-onboarding mid-trip.** If a driver's
  Connect account becomes disabled mid-trip, the trip completes
  normally (the funds queue server-side); we surface the "your
  account needs attention" state on the next Earnings-tab open. No
  in-trip interruption.
- **Promo codes / discounts.** Legacy doesn't have them; rewrite
  doesn't either.

## Suggested turn breakdown (5 turns)

- **Turn 1 — Domain + DTO + in-memory fakes.** Pure domain/data work,
  no Firebase, no Stripe SDK. `PaymentMethod`, `Payout`,
  `BalanceTransaction`, `StripeAccountStatus` value objects with full
  factory tests. `StripeServerService` interface.
  `FakeStripeServerService` in `@shared/testing` with seed/spy seams
  (`seedCustomer`, `seedSetupIntent`, `seedPaymentMethods`,
  `seedConnectAccount`, `seedBalance`, etc.). Tests pass against fakes
  only; no Stripe imports yet.

- **Turn 2 — Real adapter + 9 use cases + DI wiring.** Build
  `StripeServerHttpAdapter` against the legacy stripe-server contract
  documented in `yeride-stripe-server/CLAUDE.md`. Implement
  `EnsureStripeCustomer`, `CreateSetupIntent`, `ListPaymentMethods`,
  `DetachPaymentMethod`, `SetDefaultPaymentMethod`,
  `EnsureStripeConnectAccount`, `CreateConnectOnboardingLink`,
  `RefreshConnectAccountStatus`, `GetDriverBalance`,
  `ListDriverPayouts`, `ListBalanceTransactions`, `ProcessTip` use
  cases with full unit coverage against the in-memory fakes. Update
  `src/presentation/di/container.ts` with lazy-required branches.
  Dual-mode boot smoke (real Stripe staging + fakes) before declaring
  done.

- **Turn 3 — Rider Wallet + AddPaymentMethod screens.** Replace
  `WalletPlaceholderScreen` with `WalletScreen`. Add
  `AddPaymentMethodScreen` modal. Wire `useStripe()` for the
  CardForm + `confirmSetupIntent` flow. Set-default-payment-method
  flow. View-model tests + screen smoke tests with
  `TestContainerProvider`. The Stripe SDK's `useStripe` mocked at the
  hook seam.

- **Turn 4 — Driver Earnings + Connect onboarding.** Replace
  `DriverEarningsPlaceholderScreen` with the tagged-union
  `DriverEarningsScreen`. Wire the `WebBrowser` onboarding flow.
  Account-status polling on app foreground + on screen focus.
  Balance + recent payouts + recent transactions list. Reach Stripe
  Connect's hosted dashboard via `createAccountLoginLink` for the
  "View Express dashboard" affordance.

- **Turn 5 — Tip flow on RideReceipt + Phase 6 cleanup.** Add the
  `TipSelector` component to `RideReceiptScreen`. Wire
  `useProcessTipMutation` → `tipDriver` Cloud Function callable.
  Show the new `TripPayment` (type: `'tip'`) appearing in the receipt
  after success. Update `CLAUDE.md` (Phase 6 → ✅, Phase 7 → Next,
  refresh test count + critical-files block + import paths). Write
  `docs/PHASE_6_TURN_*.md` records for each turn. Final `npm run verify`
  green.

## Conventions (non-negotiable — same as Phases 3–5)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors. Programming errors still throw.
- Build the in-memory fake first (Turn 1) before the real Stripe
  adapter (Turn 2). The contract is firmer that way.
- Server state → TanStack Query (`usePaymentMethodsQuery`,
  `useDriverBalanceQuery`, `useDriverPayoutsQuery`). Client/UI state
  → Zustand if any UI flag needs holding. Don't mix.
- Each screen gets a sibling `useXxxViewModel.ts`. Screens are dumb
  (props in, JSX out).
- Logger only: `LOG.extend('STRIPE')`, never `console.*`.
- Every Stripe-server call goes through `StripeServerService`. No
  fetch / axios calls scattered across the codebase. The Stripe React
  Native SDK is the ONLY client-side Stripe surface; everything else
  is server-mediated.
- Idempotency: every charge / customer-create / account-create call
  through the server must include an idempotency key. Mirror legacy's
  pattern (`{userId}_{action}_{timestamp}` or similar — confirm by
  reading `paymentProcessor.js`).
- Permissive on read, canonical on write. The User-doc Stripe fields
  must accept legacy field shapes (e.g. legacy may have written
  `stripeAccount` instead of `stripeAccountId` — verify and handle).
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring a turn done.

## Acceptance for end of Phase 6

- A signed-in rider can navigate to the Wallet tab → see no payment
  methods → tap "Add card" → fill in CardForm → confirm setup intent
  → return to a populated Wallet tab. Set-as-default flips the
  default-payment-method indicator. Delete a non-default card via
  Alert-confirmed trash. After the rider has a default card, creating
  a ride and completing it triggers the existing
  `completeTrip` Cloud Function which charges the card; the
  `TripPayment` record (type: `'fare'`) appears on the receipt within
  the existing observation pipeline.
- A signed-in driver can navigate to the Earnings tab → see the
  no-account state → tap "Set up payouts" → land in
  `WebBrowser.openAuthSessionAsync` showing the Stripe-hosted form →
  complete the form → return to the app → see the Earnings tab in
  the `pending` state (charges/payouts not yet enabled) or `enabled`
  state with balance + recent payouts. Tapping "View Express
  dashboard" opens the Stripe-hosted dashboard via
  `createAccountLoginLink`.
- After a trip completes, the rider's `RideReceiptScreen` shows the
  `TipSelector` ($1 / $3 / $5 + custom). Tapping a preset → "Tip $X"
  CTA → `tipDriver` Cloud Function runs → a new `TripPayment`
  (type: `'tip'`) appears in the receipt. The driver's Earnings
  balance reflects the tip on the next refresh.
- Test suite stays green; new view-models have unit tests against
  in-memory fakes; new components have at least smoke renders. Net
  test gain: ≥40 tests (estimate; Phase 5 added 27 across 4 turns,
  Phase 6 has more surface).
- `CLAUDE.md` updated; `docs/PHASE_6_TURN_*.md` records written.

## Risks + mitigations

- **`@stripe/stripe-react-native` iOS modular-headers under
  `useFrameworks: 'static'`.** Same family of issue as the existing
  `@react-native-firebase` modular-headers fix in
  `scripts/patch-podfile.js`. The Stripe SDK ships its own modular
  headers, but its dependency `Stripe-iOS` may need a `:modular_headers => true`
  pin. Mitigation: include a Stripe SDK smoke (mount the
  `<StripeProvider/>`, log a publishable-key check) in Turn 3's
  dual-mode boot; if the build fails, extend
  `scripts/patch-podfile.js` with the right pin before moving to the
  Wallet UI.
- **Stripe React Native's `useStripe()` hook test surface.** The
  hook returns a stable object whose methods (`confirmSetupIntent`,
  `createPaymentMethod`, etc.) require a real Stripe context. Mock it
  in tests via `jest.mock('@stripe/stripe-react-native', () => ({...}))`
  exposing the methods as `jest.fn()`s. Don't attempt to render
  `<CardForm/>` in tests — assert on the VM's interaction with the
  mocked `confirmSetupIntent` only.
- **Stripe Connect onboarding deeplink return.** The
  `WebBrowser.openAuthSessionAsync` Promise resolves to
  `{type, url}`. On `cancel`, do nothing; on `success`, refresh the
  account status and refetch. Don't depend on the URL params for
  state — re-fetch is the source of truth (the user could close the
  browser tab early).
- **Stripe-server publishable key handling.** The publishable key is
  PUBLIC by design (it's a client-side key). It can ship in the
  bundle. The SECRET key never touches the app — it lives on
  `yeride-stripe-server`. Configure both in `app.config.ts` `extra`
  block: `stripePublishableKey` from env (no `EXPO_PUBLIC_*` prefix
  needed since it's read via `expo-constants`), `stripeServerUrl` for
  the adapter base URL.
- **Stripe-server API key in env.** The `STRIPE_SERVER_API_KEY`
  Bearer token is an APP-LEVEL secret — not Stripe's secret key, but
  a key the stripe-server uses to authenticate the app. Read it from
  `extra.stripeServerApiKey`. It's safe-ish to ship (the server
  enforces rate limits + payload validation), but treat it as
  semi-sensitive: rotate after any leak, etc.
- **Idempotency under retry.** Every charge / customer-create
  request the rewrite makes through the server must include an
  `Idempotency-Key` header. Legacy does this; preserve the pattern.
  The retry policy on transient 5xx errors already exists in
  `GoogleRoutesService` — port the helper into a shared utility if
  it isn't already.
- **Co-existence with legacy yeride.** Both apps still write to the
  same `users/` collection in dev/stage. The User-doc Stripe fields
  must round-trip every legacy field shape; writes use the canonical
  shape with `setDoc { merge: true }` so any legacy-written field
  survives. Don't trust the field names — read the legacy
  `paymentProcessor.js` to see what it actually writes.
- **Tipping double-charge.** If `tipDriver` succeeds server-side but
  the client never sees the response (network interruption), a naive
  retry would double-charge. The Cloud Function uses idempotency
  keys; the rewrite must include one in the callable args (e.g.
  `{tipId: nanoid()}` per tap). If the user taps "Tip $X" twice
  quickly, the second call sees the same idempotency key and the
  server returns the original result.
- **Test count drift on stripe-server changes.** If the rewrite
  changes the stripe-server's API contract, legacy yeride breaks.
  Don't change the contract. If a new endpoint is genuinely needed,
  add it (don't replace) and gate the rewrite's adoption behind a
  config flag.

## Start with

Read `CLAUDE.md`, then the Phase 6 section of `REFACTOR_PLAN.md`,
then `docs/PHASE_5_TURN_4.md`, then the legacy
`src/api/stripe/paymentProcessor.js` end-to-end (it's not long), then
the legacy `Wallet.js` / `PaymentMethod.js` / `Earnings.js` /
`TipSelector.js` for UX shape. Then read
`yeride-stripe-server/stripe/routes.js` for the actual endpoint
implementations. Then propose **Turn 1 scope** as a numbered punch
list (files to create, files to touch, tests to add) and wait for
confirmation before writing code.

Tip: this kickoff has the same shape as Phase 5's. Mirror that
structure for Phase 7's kickoff (Background GPS + geofence-exit
warnings).
