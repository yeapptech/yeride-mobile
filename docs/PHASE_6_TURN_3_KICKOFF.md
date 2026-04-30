# Phase 6 — Turn 3 Kickoff Prompt — Rider Wallet + AddPaymentMethod screens

Paste below the cut into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 6 (Payments / Stripe Connect / tipping). Turn 1 shipped the pure
domain + data-layer foundation; Turn 2 shipped the real
`StripeServerHttpAdapter`, the `tipDriver` Cloud Function callable, the 13
authorization-aware payment use cases, and the DI wiring. Both fakes
(`FakeStripeServerService`, `FakeCloudFunctionsService`) are wireable via
`TestContainerProvider`. End of Turn 2: 132 suites / 1000 tests, all
verify gates green. Your job this session is **Turn 3**: ship the rider
Wallet tab and the AddPaymentMethod modal — the FIRST UI surface that
talks to Stripe in the rewrite. No driver Earnings UI yet — that's Turn 4. No tip-on-receipt UI — that's Turn 5. Read carefully before writing
any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file
   map. Phase 6 Turn 2 is now ✅; Turn 3 is Next.
2. `docs/PHASE_6_TURN_2.md` — what Turn 2 shipped, the 4 resolved-at-
   kickoff issues (especially Issue A: `PaymentMethod.expiry` is
   nullable), risks surfaced (Stripe iOS modular-headers — first time
   exercised in Turn 3).
3. `docs/PHASE_6_KICKOFF.md` — overall Phase 6 plan; re-read the
   Wallet / AddPaymentMethod specifics under "Scope (in / out)" and
   the risk + mitigation block on `useStripe()` test surface.
4. `src/app/usecases/payment/` — read every use case top-to-bottom, but
   the four that Turn 3 wires into hooks are:
   - `EnsureStripeCustomer.ts` — idempotent on the rider's
     `stripeCustomerId`; called lazily on first card-add (or first
     Wallet visit, depending on UX choice — see decision 2 below).
   - `CreateSetupIntent.ts` — produces the `clientSecret` that Stripe's
     `confirmSetupIntent({clientSecret})` consumes.
   - `ListPaymentMethods.ts` — the live wallet contents.
   - `SetDefaultPaymentMethod.ts` — pure user-doc write, no Stripe call.
   - `DetachPaymentMethod.ts` — clears default first when removing the
     default card; restores best-effort on server failure.
5. `src/domain/entities/PaymentMethod.ts` — the value object the wallet
   renders. **Note: `expiry` is nullable as of Turn 2** — the legacy
   server doesn't expose `exp_month` / `exp_year`. The wallet card UI
   should show "•••• 4242" only when expiry is null, and "•••• 4242 ·
   12/30" when the server eventually surfaces expiry.
6. `src/domain/entities/PaymentMethodId.ts` and
   `src/domain/entities/StripeCustomerId.ts` — branded ids; the view-
   models pass them around internally and `String(...)`-stringify only
   when handing off to a non-domain-aware boundary (Stripe SDK,
   Firestore wire format).
7. `src/presentation/queries/keys.ts` — the centralized TanStack Query
   key factory. You'll add a `payment` scope here. Pattern matches the
   existing `vehicle` scope: `all()`, `methodsByCustomer(customerId)`,
   etc.
8. `src/presentation/queries/vehicle.queries.ts` — closest model for
   the new `payment.queries.ts`. Look at how
   `useUploadVehiclePhotosMutation` invalidates `vehicle.byVin` after a
   successful upload; you'll mirror the pattern (mutation invalidates
   the relevant query key on success).
9. `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts`
   — closest model for `useWalletViewModel` + the new
   `useAddPaymentMethodViewModel`. The per-tile state machine pattern
   maps cleanly onto per-card "is-default-being-set" / "is-being-
   detached" UI flags.
10. `src/presentation/features/driver/view-models/useVehicleDetailsViewModel.ts`
    — second view-model model. Look at the `Alert.alert` confirmation
    pattern — the wallet's "Delete card" flow should mirror it
    (legacy yeride uses Alert-confirmed trash, see legacy
    `Wallet.js`).
11. `src/presentation/features/driver/screens/VehicleListScreen.tsx`
    and `VehicleDetailsScreen.tsx` — model for the Wallet screen body
    (list with empty-state CTA + per-row detail action). The wallet is
    list-shaped, not detail-shaped, so VehicleListScreen is the closer
    match.
12. `src/presentation/features/rider/screens/WalletPlaceholderScreen.tsx`
    — currently mounted at `RiderTabs > Wallet`. You'll replace it.
13. `src/presentation/navigation/RiderTabsNavigator.tsx` — confirm the
    `Wallet` tab mounts `WalletPlaceholderScreen` today; you'll swap to
    `WalletScreen`.
14. `src/presentation/navigation/RiderNavigator.tsx` — the rider stack.
    You'll add `AddPaymentMethod` as a modal route on the stack
    (parent of the tabs), so the modal slides over the tab bar.
15. `src/presentation/App.tsx` — the navigator root. You'll wrap the
    navigator in `<StripeProvider publishableKey={...}/>`. Read the
    current shape so you understand where the `<ContainerProvider>` /
    `<QueryClientProvider>` already mount, and place `<StripeProvider>`
    OUTSIDE both (it should be the outermost wrapper so `useStripe()`
    is callable from anywhere in the tree).
16. Legacy `yeride/src/rider/screens/Wallet.js` — UX reference for the
    rider Wallet tab. Brand glyphs, default-card indicator, "Add card"
    CTA, swipe-or-trash-or-Alert-to-delete behaviour.
17. Legacy `yeride/src/rider/screens/PaymentMethod.js` — UX reference
    for the AddPaymentMethod modal. Note: legacy uses the deprecated
    `CardField`; the rewrite uses the newer `CardForm` per the legacy
    `CLAUDE.md`'s "Don'ts" block.
18. Legacy `yeride/src/utils/cardImage.js` — the brand → glyph mapping
    legacy uses. Either port the glyph asset wiring or use the
    `lucide-react-native` `CreditCard` icon as a temporary placeholder
    (see decision 3 below).
19. Legacy `yeride/CLAUDE.md` — search for `CardForm` and the React 19
    `defaultProps` warning. Stripe React Native ships its own modular
    headers and may need a Podfile pin (see "Risks" below).

## Starting state — what's already built (Turn 2)

- **Domain.** Three branded Stripe IDs, four payment value objects,
  `StripeServerService` interface, `PaymentCallableService` interface,
  `Rider.stripeCustomerId: StripeCustomerId | null` +
  `Rider.defaultPaymentMethodId: PaymentMethodId | null`,
  `Driver.stripeAccountId: StripeAccountId | null`. Four immutable
  `set*` helpers on `User.ts`.
- **Data layer.** `StripeServerHttpAdapter` (real fetch-based, retry-
  with-backoff, Bearer auth, Idempotency-Key on `createCustomer`).
  `CloudFunctionsService.tipDriver` callable. Both wired through DI
  with `STRIPE_SERVER_URL` / `STRIPE_SERVER_API_KEY` env-driven
  fallback to fakes.
- **App layer.** 13 use cases (5 rider-side, 7 driver-side, 1 tipping).
  Auth-gated where applicable; ownership-checked
  (`stripe_customer_mismatch` / `stripe_account_mismatch`). All have
  full unit-test coverage against the fakes.
- **Test infra.** `TestContainerProvider` exposes `stripeServer?` +
  `cloudFunctions?` override knobs. `FakeStripeServerService` covers
  every `StripeServerService` method with seed/spy/failNext seams.
  `FakeCloudFunctionsService` covers `tipDriver` (+ the existing
  completeTrip / cancelTrip).
- **Presentation.** `useRouteSelectViewModel` already plumbs the
  rider's `defaultPaymentMethodId` into the `PassengerSnapshot` so the
  server-side `completeTrip` charges the right card on completion. So
  once a rider sets a default in Turn 3's Wallet, every subsequent
  trip charges that card with no further plumbing.
- **No Stripe SDK in the bundle yet.** No `<StripeProvider>` mounted.
  The Wallet / Earnings tabs are placeholder screens. AddPaymentMethod
  doesn't exist as a route. The Stripe SDK install + `<StripeProvider>`
  mount is YOUR work this turn.

## Scope decisions (locked at Turn 3 kickoff — confirm or override)

These were resolved before the kickoff doc was written. Don't re-debate
mid-turn — propose follow-ups in the deferred list.

1. **`@stripe/stripe-react-native` pin.** Use the version compatible
   with Expo SDK 55. As of Phase 6 Turn 3 the SDK 55 compatibility
   matrix lists `@stripe/stripe-react-native@~0.51.x` (confirm against
   the matrix when running `npx expo install`). The Expo plugin auto-
   adds the iOS Podfile entries; Android is largely zero-config.
   Configure `merchantIdentifier` in `app.config.ts`'s plugin block as
   a placeholder (e.g. `'merchant.tech.yeapp.yeridenext.dev'`) — Apple
   Pay isn't enabled this phase but the field is required by the
   plugin schema.

2. **Lazy `EnsureStripeCustomer` — on first AddPaymentMethod, NOT on
   first Wallet visit.** Calling Stripe to create a customer record on
   every Wallet tab open (even when the rider has zero cards and might
   navigate away) wastes round-trips and creates orphan Stripe customer
   records. Defer the call to the moment the rider taps "Add card";
   `AddPaymentMethodScreen`'s view-model fires
   `useEnsureStripeCustomerMutation` first, then
   `useCreateSetupIntentMutation` against the resolved customerId. The
   Wallet screen itself only `useListPaymentMethodsQuery` — and that
   query is gated on `user.stripeCustomerId !== null` so a rider with
   no customer record sees the empty state without any network call.

3. **Brand glyphs via lucide as temporary placeholder.** The legacy
   per-brand glyph assets live under `yeride/src/assets/cards/*.png`.
   Porting them is a Phase 9 polish concern; for Turn 3 use lucide's
   `CreditCard` icon for every brand and tag the brand name as text
   beside the last4. Track porting in the deferred list.

4. **Set-default UX = chevron + checkmark, no swipe gesture.** Legacy
   yeride uses a swipe-to-delete gesture; the rewrite picks a more
   discoverable pattern: each row has a checkmark indicator (filled
   when default, outlined when not), and tapping a row toggles
   default-on-this-card. Delete sits behind a trash icon on the right
   side of the row, gated on `Alert.alert` confirmation per the
   `useVehicleDetailsViewModel` pattern. The default card cannot be
   deleted when it's the only card; if it IS the only card and the
   user confirms delete, also clear the doc's `defaultPaymentMethodId`
   (the use case already does this, but the UI should warn).

5. **`AddPaymentMethod` is a modal stack-push, NOT a tab.** Push
   `AddPaymentMethod` as a screen on `RiderStackParamList` (parent of
   tabs) so it slides over the tab bar. `presentation: 'modal'` on
   the screen options gives the modal feel. Dismissing returns to
   the Wallet tab.

6. **`<StripeProvider>` is the OUTERMOST wrapper** in `App.tsx`. The
   Stripe context must be available everywhere `useStripe()` could be
   called — placing it inside `<ContainerProvider>` would break the
   Earnings flow in Turn 4 if the WebBrowser onboarding tries to call
   anything Stripe-y from a context that isn't mounted. Order:
   `<StripeProvider> > <QueryClientProvider> > <ContainerProvider> >
<RootNavigator/>`.

7. **Stripe publishable key in `app.config.ts` `extra`.** Same out-of-
   bundle pattern as `stripeServerUrl` / `stripeServerApiKey`. The
   publishable key IS public-by-design (it's a client-side key) but
   keep it under `extra` for consistency with the other Stripe env
   vars. Helper: extend `src/shared/env/stripeServer.ts` with
   `getStripePublishableKey(): string | null`. App.tsx reads it; if
   null, mounts the navigator without `<StripeProvider>` and the
   Wallet flow shows a loud error (Wallet view-model surfaces an
   `'unconfigured'` UI state).

8. **`useStripe()` mocked at the hook seam in tests.** Per the kickoff
   risk list: mock `@stripe/stripe-react-native` via `jest.mock(...)`
   exposing `useStripe` (returning `{ confirmSetupIntent: jest.fn() }`)
   and `useConfirmSetupIntent` (the React-19-friendly hook variant).
   Don't try to render `<CardForm/>` in tests — no native module loads
   in jsdom and we don't need to test Stripe's own UI.

## Scope (in / out)

**In:**

- **Stripe SDK install + native config:**
  - `npx expo install @stripe/stripe-react-native` (record exact pinned
    version in `docs/PHASE_6_TURN_3.md`).
  - `app.config.ts` — add the `@stripe/stripe-react-native` Expo plugin
    block with `merchantIdentifier`. Add `stripePublishableKey` to the
    `extra` block from `process.env.STRIPE_PUBLISHABLE_KEY`.
  - `src/shared/env/stripeServer.ts` — extend with
    `getStripePublishableKey()` returning `string | null`.
  - `App.tsx` — mount `<StripeProvider publishableKey={...}/>` as the
    outermost wrapper. If publishable key is null, log a `LOG.warn`
    and render the navigator without it (so a fakes-only build still
    boots; Wallet surface degrades to an `'unconfigured'` state).
  - `npm run prebuild` will be required before the first iOS/Android
    build. Document in the new doc.

- **TanStack Query hooks** (`src/presentation/queries/payment.queries.ts`):
  - `useEnsureStripeCustomerMutation` → calls `EnsureStripeCustomer`,
    invalidates `user.current` on success (so the next render sees the
    new `stripeCustomerId`).
  - `useCreateSetupIntentMutation` → calls `CreateSetupIntent`. No
    invalidation; the result feeds `confirmSetupIntent` on the device.
  - `useListPaymentMethodsQuery({customerId})` → calls
    `ListPaymentMethods`. Gated on `customerId !== null` via
    `enabled: customerId !== null`. Stale time short (~10s) so the
    list refreshes promptly after `confirmSetupIntent` succeeds.
  - `useSetDefaultPaymentMethodMutation` → calls
    `SetDefaultPaymentMethod`. Invalidates `user.current` on success.
  - `useDetachPaymentMethodMutation` → calls `DetachPaymentMethod`.
    Invalidates BOTH `user.current` (the default may have cleared) AND
    `payment.methodsByCustomer(customerId)`.
  - Add a `payment` scope to `src/presentation/queries/keys.ts`:
    `payment.all()`, `payment.methodsByCustomer(customerId)`. Re-export
    from `src/presentation/queries/index.ts`.

- **Rider Wallet screen + view-model:**
  - `src/presentation/features/rider/screens/WalletScreen.tsx` —
    list-shaped UI. Header with "Wallet" title + "Add card" CTA
    (right-aligned). Body: empty-state ("Add a card to start riding"
    with a centered "Add card" button) when methods.length === 0, OR
    a `FlatList` of `WalletCardRow` components when methods.length > 0. Wires to `useWalletViewModel`.
  - `src/presentation/features/rider/components/WalletCardRow.tsx` —
    one row: lucide `CreditCard` icon + brand name + " •••• " + last4 +
    optional " · " + expiry (only when `expiry !== null`) + checkmark
    indicator (filled when default) + trash icon. Tap-to-set-default;
    trash launches Alert-confirm flow.
  - `src/presentation/features/rider/view-models/useWalletViewModel.ts`
    — composes `useCurrentUserQuery` + `useListPaymentMethodsQuery` +
    the three mutations. Returns a tagged-union UI state:
    `{kind: 'unconfigured'}` (no Stripe publishable key),
    `{kind: 'loading'}` (current user query still loading),
    `{kind: 'no_customer', onAdd}` (rider has no `stripeCustomerId`
    yet — empty state with Add CTA),
    `{kind: 'empty', customerId, onAdd}` (rider has customerId but no
    cards),
    `{kind: 'ready', methods, defaultMethodId, customerId, onSetDefault,
onDelete, onAdd}` (cards loaded).
    Plus per-card `inFlight: { setDefault: Set<PaymentMethodId>,
detach: Set<PaymentMethodId> }` flags so individual rows can show
    spinners.

- **AddPaymentMethod modal + view-model:**
  - `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx`
    — full-screen modal. Layout: `<CardForm onFormComplete={...}/>` at
    the top, "Save card" CTA at the bottom. Disabled until form is
    complete (and in-flight while the mutation runs). Cancel / X in
    the header dismisses.
  - `src/presentation/features/rider/view-models/useAddPaymentMethodViewModel.ts`
    — orchestrates: `useEnsureStripeCustomerMutation` first (idempotent
    server-side, so safe to call even when the rider already has a
    customerId), THEN `useCreateSetupIntentMutation` to get a fresh
    `clientSecret`, THEN `confirmSetupIntent({clientSecret})` from
    `useStripe()`. On success, invalidate
    `payment.methodsByCustomer(customerId)` + `user.current` and pop
    the modal. Surfaces fine-grained errors:
    `'card_declined'` (from confirmSetupIntent), `'network'` (from
    either mutation), `'unconfigured'` (no publishable key).
  - The view-model's `confirmSetupIntent` call site is what tests will
    mock at the `useStripe()` seam.

- **Wiring:**
  - `RiderTabsNavigator` — swap `WalletPlaceholderScreen` →
    `WalletScreen`.
  - `RiderNavigator` (parent stack) — add `AddPaymentMethod: undefined`
    to the param list, register the screen with
    `presentation: 'modal'`.
  - `presentation/queries/index.ts` — re-export the new
    `payment.queries` module.
  - `presentation/queries/keys.ts` — add the `payment` scope.

- **Tests:**
  - `useWalletViewModel.test.tsx` — mount through `TestContainerProvider`
    with seeded `FakeStripeServerService` payment methods. Cover every
    UI state arm + each mutation's invalidation path. ~10 tests.
  - `useAddPaymentMethodViewModel.test.tsx` — mock
    `@stripe/stripe-react-native` at the hook seam; cover happy path,
    card-declined, network failure on EnsureStripeCustomer, network
    failure on CreateSetupIntent, network failure on confirmSetupIntent,
    unconfigured-publishable-key state. ~8 tests.
  - `WalletScreen.test.tsx` — smoke render with the view-model output
    as props. ~3 tests (empty state, populated state, error state).
  - `AddPaymentMethodScreen.test.tsx` — smoke render. ~2 tests.
  - `WalletCardRow.test.tsx` — render every brand + check default
    indicator + trash interaction. ~4 tests.

**Out (deferred — do not build in Turn 3):**

- Driver Earnings UI — Turn 4.
- Connect onboarding (`WebBrowser.openAuthSessionAsync`) — Turn 4.
- Tip flow on RideReceipt + `TipSelector` component — Turn 5.
- Apple Pay / Google Pay surfaces — Phase 9 polish.
- Per-brand card-glyph assets — Phase 9 polish (lucide `CreditCard`
  is the placeholder).
- In-app earnings analytics beyond the simple list — out of Phase 6
  scope entirely.
- Refund initiation — admin-only via Stripe dashboard, never in-app.
- 3DS / SCA challenge handling — `confirmSetupIntent` triggers it
  natively when needed; the rewrite UI doesn't add anything beyond
  what Stripe's SDK pops.

## Risks + mitigations

- **`@stripe/stripe-react-native` iOS modular-headers under
  `useFrameworks: 'static'`.** First exercise of this risk in Turn 3.
  Same family as the existing `@react-native-firebase` modular-headers
  fix in `scripts/patch-podfile.js`. The Stripe SDK ships its own
  modular headers, but its dependency `Stripe-iOS` may need a
  `:modular_headers => true` pin. Mitigation: include a Stripe SDK
  smoke (mount the `<StripeProvider/>`, log a publishable-key check)
  in the dual-mode boot. If `pod install` fails after `npm run
prebuild`, extend `scripts/patch-podfile.js` with the right pin
  before declaring the install done. Don't disable New Architecture as
  a workaround — the rewrite needs it for `@googlemaps/react-native-
navigation-sdk` (see legacy `CLAUDE.md` troubleshooting).

- **`useStripe()` hook test surface.** The hook returns a stable object
  whose methods (`confirmSetupIntent`, `createPaymentMethod`, etc.)
  require a real Stripe context. Mock at `jest.mock(
'@stripe/stripe-react-native', () => ({...}))` exposing the methods
  as `jest.fn()`s. Don't attempt to render `<CardForm/>` in tests —
  assert on the VM's interaction with the mocked `confirmSetupIntent`
  only.

- **`CardForm` and React 19's `defaultProps` removal.** Legacy yeride
  CLAUDE.md flags that React 19 no longer applies `defaultProps` to
  function components and several third-party libraries crash. Verify
  `@stripe/stripe-react-native` 0.51+ doesn't rely on `defaultProps`
  on any function component before declaring the install done. If it
  does, pin to a fixed version OR pass the missing props explicitly.

- **Stripe publishable key handling.** The publishable key is PUBLIC
  by design (it's a client-side key). It can ship in the bundle. The
  SECRET key never touches the app — it lives on the
  `yeride-stripe-server`. Configure both publishable + the existing
  `STRIPE_SERVER_*` env vars in `app.config.ts` `extra` block —
  publishable is read by `<StripeProvider>` at app boot, the server
  key + URL are read by the adapter. Both via `expo-constants`'s
  `extra` (NOT `EXPO_PUBLIC_*` — same out-of-bundle-string-blob
  rationale as Turn 2).

- **`payment.methodsByCustomer` invalidation race.** After
  `confirmSetupIntent` succeeds, the new payment method is attached
  Stripe-side but the rewrite doesn't see it until
  `ListPaymentMethods` re-fetches. The view-model invalidates the
  query key on success, but Stripe's webhook (`payment_method.attached`)
  may also fire and there's no race-free way to know the server has
  the attachment indexed. Mitigation: the invalidation triggers a
  fresh fetch a tick later; if the new card doesn't appear, the
  rider can pull-to-refresh (the wallet list supports it via TanStack
  Query's `refetch`).

- **Cancellation of the AddPaymentMethod modal mid-`confirmSetupIntent`.**
  If the rider dismisses the modal while `confirmSetupIntent` is in
  flight, the SDK keeps running. The mutation completes, hits the
  unmounted view-model — TanStack Query's
  `useMutation` already handles the unmount-during-mutation case
  cleanly (the result is dropped, no state update). No special code
  needed — but the `AbortController`-style cleanup of the underlying
  network is owned by Stripe's SDK; don't try to add cancel-on-unmount
  yourself.

- **Default-card-removal edge case.** If the rider deletes their ONLY
  card AND it's the default, `DetachPaymentMethod` clears
  `defaultPaymentMethodId` first, then deletes the card Stripe-side.
  The view-model's `onDelete` handler should pop an Alert with extra
  copy in this case ("This is your default card. Removing it means the
  next ride won't have a payment method — you'll need to add a new
  card before requesting a ride.") rather than the generic delete
  prompt.

- **No Stripe publishable key in dev / testing.** A developer running
  the app without setting `STRIPE_PUBLISHABLE_KEY` will see the
  Wallet tab in `'unconfigured'` state. The view-model surfaces a
  visible error message; AppContent doesn't crash. Mirrors the
  existing pattern for `getGoogleMapsApiKey` falling back to
  `FakeRoutesService`. Document in the new doc.

## Acceptance for end of Turn 3

A signed-in rider can navigate to the Wallet tab → see no payment
methods (with the empty-state CTA visible) → tap "Add card" → land in
the AddPaymentMethod modal → fill in `<CardForm/>` (visa test card
4242 4242 4242 4242, any future expiry, any CVC) → tap "Save card" →
return to a populated Wallet tab with the new card listed and tagged
as default (because it's the only one). Tapping a non-default card
toggles the default indicator. Trash + Alert-confirm deletes a card.
Setting / detaching reflect in the trip flow without further wiring:
the next time the rider creates a ride, `useRouteSelectViewModel`
already plumbs `defaultPaymentMethodId` into
`PassengerSnapshot.defaultPaymentMethod` (Turn 2 plumbing) — so
`completeTrip` charges the right card on completion.

A signed-in rider with no `STRIPE_PUBLISHABLE_KEY` configured sees
the Wallet tab in an `'unconfigured'` state with a visible error
message; the rest of the app is unaffected.

`npm run verify` (typecheck + lint + format + test) green. Test delta
target: ~5 new test suites and ~30 new tests. Net should land around
**137 suites / ≈ 1030 tests**.

## Conventions (non-negotiable — same as Turns 1–2)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors.
- Server state goes in TanStack Query (`useListPaymentMethodsQuery`,
  the three mutations). Client/UI state goes in component-local
  `useState` for the AddPaymentMethod form readiness flag. Don't put
  per-card `inFlight` flags in a Zustand store — they live in the
  view-model state.
- Each screen gets a sibling `useXxxViewModel.ts`. Screens are dumb
  (props in, JSX out). The view-model owns the orchestration and
  produces the tagged-union UI state.
- Logger only: `LOG.extend('WALLET')` for the rider-side flow,
  `LOG.extend('PAYMENT')` for the underlying use cases (already in
  place from Turn 2). Never `console.*`.
- Idempotency: `EnsureStripeCustomer` is server-idempotent; calling it
  on every AddPaymentMethod open is safe. `CreateSetupIntent` is NOT
  idempotent (each call mints a new clientSecret) — only call it once
  per modal open.
- Run `npm run verify` before declaring the turn done.

## Suggested ordering

- **Step 1 — Stripe SDK install + native config.** `npx expo install
@stripe/stripe-react-native`. Add the Expo plugin block in
  `app.config.ts`. Run `npm run prebuild`. Verify iOS `pod install`
  succeeds; if not, extend `scripts/patch-podfile.js`. Smoke that the
  app boots.
- **Step 2 — Env helper + App.tsx mount.** Extend
  `src/shared/env/stripeServer.ts` with `getStripePublishableKey()`.
  Wrap the navigator in `<StripeProvider>`; conditional mount when
  the key is null with a `LOG.warn`. Test boot with + without the env.
- **Step 3 — TanStack hooks.** Create
  `src/presentation/queries/payment.queries.ts` with the 5 hooks +
  the `payment` scope in `keys.ts`. Re-export from the queries index.
  No tests for the hooks themselves (the use cases they wrap are
  already covered) — they get exercised by the view-model tests.
- **Step 4 — `useWalletViewModel`.** Build the tagged-union state
  machine. Test against `TestContainerProvider`-mounted fakes,
  covering each UI state arm + per-card inFlight tracking.
- **Step 5 — `useAddPaymentMethodViewModel`.** Build the orchestration.
  Mock `@stripe/stripe-react-native` at the hook seam; test happy +
  error paths.
- **Step 6 — `WalletCardRow` + `WalletScreen` + `AddPaymentMethodScreen`.**
  Smoke renders only — no business logic in screen bodies.
- **Step 7 — Navigation wiring.** Swap `WalletPlaceholderScreen` →
  `WalletScreen` in `RiderTabsNavigator`. Add `AddPaymentMethod`
  route to `RiderStackParamList` + `RiderNavigator` with
  `presentation: 'modal'`.
- **Step 8 — `npm run verify` + commit + write `docs/PHASE_6_TURN_3.md`.**
  Update `CLAUDE.md` (Phase 6 Turn 3 → ✅, Turn 4 → Next, refresh
  test counts, add to "Critical files" the new view-models /
  screens / queries module). Document the exact pinned
  `@stripe/stripe-react-native` version.

## Start with

Read `CLAUDE.md`, then `docs/PHASE_6_TURN_2.md`, then
`docs/PHASE_6_KICKOFF.md`. Then read the 5 rider-side payment use
cases in `src/app/usecases/payment/` end-to-end. Then read
`src/presentation/queries/vehicle.queries.ts` and
`useVehiclePhotosViewModel.ts` (the closest models for the new
hooks + view-model). Then read legacy `Wallet.js` + `PaymentMethod.js`
for UX shape. Then propose **Turn 3 scope as a numbered punch list**
(files to create, files to touch, tests to add — in the same shape
as Turn 2's punch list) and wait for confirmation before writing
code.

Tip: this kickoff has the same shape as Turn 2's. Mirror that
structure for Turn 4's kickoff (Driver Earnings + Connect onboarding)
when Turn 3 lands.
