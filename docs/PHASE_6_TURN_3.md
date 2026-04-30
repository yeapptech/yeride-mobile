# Phase 6 — Turn 3: Rider Wallet + AddPaymentMethod modal

The first Stripe-SDK surface in the rewrite. Riders can now navigate to
the Wallet tab, see their saved cards, set a default, remove a card,
and add a new card through Stripe's `<CardForm/>` + `confirmSetupIntent`.
The 13 use cases shipped in Turn 2 are now reachable from real UI.

End of turn: **137 suites / 1031 tests passing**, **+5 suites / +31
tests** on top of Turn 2's 132/1000. typecheck + lint + format + test
all green.

## What's in

### 1. `@stripe/stripe-react-native@0.63.0`

Pinned version. `npx expo install` resolved `0.63.0` for Expo SDK 55
(higher than the kickoff doc's `~0.51.x` estimate — the SDK 55
compatibility matrix has moved on since the kickoff was written).

- `package.json` — `"@stripe/stripe-react-native": "0.63.0"`.
- `app.config.ts` — added the `@stripe/stripe-react-native` Expo plugin
  block with `merchantIdentifier: 'merchant.tech.yeapp.yeridenext.dev'`.
  Apple Pay / Google Pay are NOT enabled this phase
  (`enableGooglePay`, `includeOnramp` default to `false`); the
  `merchantIdentifier` is a placeholder so the plugin schema is
  satisfied. Phase 9 polish can flip them on.
- `app.config.ts` `extra` block gains `stripePublishableKey` from
  `process.env.STRIPE_PUBLISHABLE_KEY`. Same out-of-bundle pattern as
  the other Stripe env vars.
- **`npm run prebuild` is required before the next iOS/Android build.**
  The sandbox can't run `pod install`; the next dev to build natively
  must regenerate `ios/` + `android/` so the Stripe plugin's
  entitlement / manifest mods land.
- iOS modular-headers risk did not surface during typecheck/lint/test.
  First native iOS build will be the canonical smoke. If `pod install`
  fails with non-modular include diagnostics, extend
  `scripts/patch-podfile.js` with a `pod 'Stripe', :modular_headers => true`
  pin (mirrors the existing `@react-native-firebase` fix).

### 2. Env helper + `<StripeProvider/>` mount

- `src/shared/env/stripeServer.ts` — added `getStripePublishableKey():
string | null` reading `extra.stripePublishableKey` via lazy
  `require('expo-constants')`. Returns `null` when the key is missing
  or empty so the rest of the app degrades gracefully.
- `src/shared/env/index.ts` — re-exports `getStripePublishableKey`.
- `src/presentation/App.tsx` — mounts `<StripeProvider/>` ABOVE
  `<QueryClientProvider/>` and `<ContainerProvider/>` via a
  `MaybeStripeProvider` wrapper. When the publishable key is `null` we
  log a `LOG.warn('APP', ...)` at module load and render the navigator
  without the provider — the Wallet VM surfaces `kind: 'unconfigured'`
  in that case. Mount order:

  ```
  GestureHandlerRootView
    SafeAreaProvider
      MaybeStripeProvider           ← Phase 6 turn 3
        QueryClientProvider
          ContainerProvider
            AppContent
              NavigationContainer
                RootNavigator
  ```

  Reading the key once at module scope (not per-render) keeps the
  provider stable across renders.

### 3. Stripe SDK jest mock wired globally

`jest.setup.ts` now does `jest.mock('@stripe/stripe-react-native', () =>
require('@stripe/stripe-react-native/jest/mock'))`. The SDK ships its
own jest mock that returns stub implementations for every hook + every
`useStripe()` method. Tests that need specific behavior override
per-test via `(useStripe as jest.MockedFunction<typeof useStripe>)
.mockReturnValue({ confirmSetupIntent: jest.fn().mockResolvedValueOnce(...) })`.

Without this global mock, importing `@stripe/stripe-react-native` in a
view-model test would pull in the SDK's TurboModule registration which
fails outside a real RN runtime.

### 4. TanStack query keys + payment hooks

- `src/presentation/queries/keys.ts` — added `payment` scope:
  `payment.all()`, `payment.methodsByCustomer(customerId)`. Methods are
  scoped on `StripeCustomerId` rather than `UserId` so the cache key
  matches Stripe's resource identity.
- `src/presentation/queries/payment.queries.ts` — five hooks:
  - `useEnsureStripeCustomerMutation()` — invalidates `user.current`.
  - `useCreateSetupIntentMutation()` — no invalidation; result feeds
    `confirmSetupIntent` on the device.
  - `useListPaymentMethodsQuery({customerId})` — gated `enabled:
customerId !== null`; `staleTime: 10_000`.
  - `useSetDefaultPaymentMethodMutation()` — invalidates `user.current`.
  - `useDetachPaymentMethodMutation({customerId})` — invalidates BOTH
    `user.current` AND `payment.methodsByCustomer(customerId)`. The
    `customerId` is required at hook construction so we can target the
    invalidation.
- `src/presentation/queries/index.ts` — re-exports the five hooks.

No tests for the hooks themselves — they're thin Promise/Result
adapters over the Turn 2 use cases (which have full coverage). The
hooks are exercised end-to-end through the view-model tests.

### 5. `useWalletViewModel` + 11 tests

`src/presentation/features/rider/view-models/useWalletViewModel.ts` —
tagged-union state machine driving the Wallet screen. Six arms:
`unconfigured` / `loading` / `no_customer` / `empty` / `ready` / `error`.

Per-card in-flight tracking via component-local `useState<{setDefault:
Set<string>, detach: Set<string>}>` (mirroring the `useVehiclePhotos
ViewModel` `PerTileFlags` pattern). Each row reads its own state so a
slow set-default mutation doesn't lock out detach on a different card.

`onDelete` pops `Alert.alert` with three message variants:

- The default-and-only card: "This is your default card and the only
  card on file. You'll need to add a new card before requesting your
  next ride."
- The default card with siblings: "This is your default card. The next
  ride will have no payment method until you set a new default."
- A non-default card: `Remove ${BRAND} •••• ${last4}?`

`onSetDefault` is a no-op for the already-default row (the row's
Pressable also has `disabled={isDefault}` as defense in depth).

11 tests cover: every UI arm, both Alert variants, the trash-Pressable
plumbing, navigation, the inFlight transition during a slow mutation,
and the error arm.

### 6. `useAddPaymentMethodViewModel` + 9 tests

`src/presentation/features/rider/view-models/useAddPaymentMethodViewModel.ts`
— orchestrates the three-step "save a card" flow:

1. `EnsureStripeCustomer` — idempotent server-side; safe to call on
   every modal open. The first card-add is the moment we lazily mint
   the rider's Stripe customer record (per kickoff decision: don't
   ping Stripe just to look at an empty wallet).
2. `CreateSetupIntent({customerId})` — fresh client secret per "Save
   card" tap so a stale secret from a failed earlier attempt isn't
   reused.
3. `confirmSetupIntent({clientSecret})` — Stripe's native SDK call.
   Card data never touches our app or our server.

Three error arms with distinct UX copy:

- `card_declined` — `confirmSetupIntent` returned a recoverable card
  error (declined / insufficient / incorrect / expired). Mapping
  function `mapStripeError` looks at both `code` and `message` for
  defensive matching against future SDK changes.
- `network` — any `Result.err(NetworkError)` from the use cases OR a
  thrown network-shaped error from `confirmSetupIntent`.
- `unknown` — anything else.

The `Canceled` code from `confirmSetupIntent` (user dismissed a 3DS
challenge or the picker) is silent — no error banner, the modal stays
on the idle arm so re-tapping Save just re-runs the flow.

On success the VM invalidates `payment.methodsByCustomer(customerId)`

- `user.current`, then `navigation.goBack()`.

9 tests cover: unconfigured arm, idle isCardComplete toggle, happy
path, idempotent customerId path (no createCustomer call when the
rider already has one), each error arm (network on EnsureCustomer,
network on CreateSetupIntent, card_declined from confirm, unknown
from confirm-throw, silent Canceled), and onDismissError.

### 7. Components + screens

- `src/presentation/features/rider/components/WalletCardRow.tsx` — one
  row in the wallet list. `BrandBadge` text-only — Phase 9 polish ports
  the legacy per-brand glyph assets. `expiry` line is hidden when
  `null` (the legacy server doesn't expose `exp_month` / `exp_year`).
  6 smoke tests cover render variations + the trash + tap callbacks.
- `src/presentation/features/rider/screens/WalletScreen.tsx` —
  view-model-driven. Each tagged-union arm gets a dedicated layout.
  Pull-to-refresh on the populated/empty arms; loud error block on
  unconfigured. 3 smoke tests.
- `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx`
  — `<CardForm/>` at the top, error banner inline, Save CTA at the
  bottom (disabled until form is complete, spinner while saving). 2
  smoke tests covering the disabled-Save invariant + the error
  banner's dismiss action.

### 8. Navigation wiring

- `src/presentation/navigation/types.ts` — added `AddPaymentMethod:
undefined` to `RiderStackParamList`.
- `src/presentation/navigation/RiderTabsNavigator.tsx` — swapped
  `WalletPlaceholderScreen` → `WalletScreen` on the Wallet tab.
- `src/presentation/navigation/RiderNavigator.tsx` — registered
  `AddPaymentMethod` with `presentation: 'modal'` + `title: 'Add card'`.
- `WalletPlaceholderScreen.tsx` retained as a deprecation stub (sandbox
  virtiofs blocks `unlink()`); the next dev in a regular checkout
  should `rm` it.

## Why this turn doesn't include

- **Driver Earnings UI** — Turn 4. `WebBrowser.openAuthSessionAsync`
  Connect onboarding + balance / payouts list.
- **Tip flow on RideReceipt** — Turn 5. The `TipSelector` component +
  `useProcessTipMutation` hook over the Turn 2 `tipDriver` callable.
- **Apple Pay / Google Pay** — Phase 9 polish. The `<StripeProvider/>`
  is mounted with the merchantIdentifier so future enablement is a
  one-flag flip.
- **Per-brand card-glyph assets** — Phase 9 polish. Lucide
  `CreditCard` was the kickoff's placeholder choice; we instead chose
  a text-only `BrandBadge` to avoid pulling in `lucide-react-native`
  for a single icon.

## Risks surfaced

- **`@stripe/stripe-react-native` iOS modular-headers under
  `useFrameworks: 'static'`** — not exercised yet (only `npm run verify`
  ran; no native build attempted from the sandbox). First iOS
  `pod install` is the canonical smoke. Same family of issue as the
  existing `@react-native-firebase` fix in `scripts/patch-podfile.js`.
  If it surfaces, extend the patch script before declaring the next
  native build done.
- **`Pressable` `disabled` prop semantics in tests** — the
  AddPaymentMethod smoke test relies on the fact that pressing a
  `<Pressable disabled={true}/>` doesn't invoke `onPress`. This is RN
  behavior, but if testing-library / RN ever changes that we'd need
  an explicit `accessibilityState.disabled` assertion instead.
- **Cancellation mid-`confirmSetupIntent`** — TanStack Query handles
  unmount-during-mutation cleanly (the result is dropped, no state
  update). Verified by inspection. If a future RN version changes the
  unmount semantics, the AddPaymentMethod VM's `setIsSaving` /
  `setError` calls could fire on an unmounted component — RN logs a
  warning but doesn't crash.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at end
of turn. **137 test suites / 1031 tests** (+5 suites / +31 tests over
Turn 2's 132/1000).

A signed-in rider can now:

1. Open the Wallet tab → see the empty state if no card-add yet.
2. Tap "Add card" → land in the AddPaymentMethod modal → fill in
   `<CardForm/>` (visa test card 4242 4242 4242 4242, any future
   expiry, any CVC) → tap "Save card" → return to the Wallet tab.
3. See the new card listed; the FIRST card add doesn't auto-set
   default — that's a `SetDefaultPaymentMethod` call which the user
   makes by tapping the row.
4. Tap a non-default row → the default checkmark moves.
5. Tap the trash icon → Alert-confirm → card disappears.

The trip flow already plumbs `defaultPaymentMethodId` into
`PassengerSnapshot.defaultPaymentMethod` (Turn 2 work in
`useRouteSelectViewModel`) — so once a rider sets a default in the
Wallet, every subsequent trip charges that card on completion via the
existing `completeTrip` Cloud Function.

A rider on a build without `STRIPE_PUBLISHABLE_KEY` configured sees
the Wallet tab in `'unconfigured'` state with a loud error block; the
rest of the app is unaffected.

## Optional integration smoke (manual, skipped in CI)

To verify against a real Stripe staging account:

1. Set `STRIPE_PUBLISHABLE_KEY` (test-mode publishable key from the
   YeRide stage Stripe dashboard) + `STRIPE_SERVER_URL` +
   `STRIPE_SERVER_API_KEY` in `.env.development`.
2. `npm run prebuild` (regenerate native projects with the Stripe
   plugin's mods).
3. `npm run ios` / `npm run android`.
4. Sign in as a rider, open Wallet, add card with `4242 4242 4242 4242`
   / any future expiry / any CVC / any zip.
5. Verify the card appears in the Stripe dashboard's Customers view
   under the rider's customer record.
6. Test the decline path with `4000 0000 0000 0002` (Stripe's
   "card_declined" test card) and confirm the error banner.
7. Set as default + delete + re-add to exercise the full surface.

If the iOS build fails at `pod install` time, capture the error and
extend `scripts/patch-podfile.js` before calling Turn 3 fully smoked
on real device.
