# Phase 6 — Turn 5: Tip flow on RideReceipt + Phase 6 close

The tip flow is real now. Riders can pick a $1 / $3 / $5 preset (or a
whole-dollar custom amount up to $99), submit, and see a "Tip $X added —
thank you!" banner that auto-dismisses once the live `tip` payment row
lands in the receipt's fare breakdown. The Turn-2 `tipDriver` Cloud
Function callable + the `ProcessTip` use case + the dual-shape User-doc
Stripe plumbing all wire together for the first time. Phase 6 closes
here; Phase 7 (Background GPS + geofence-exit warnings) is Next.

End of turn: **146 suites / 1093 tests passing**, **+3 suites / +25
tests** on top of Turn 4's 143/1068 — squarely inside the kickoff's
"+3 to +5 suites, +20 to +35 tests" target band. typecheck + lint +
format + test all green.

## What's in

### 1. `formatMoney` re-home

Moved `src/presentation/features/driver/utils/formatMoney.ts` →
`src/presentation/utils/formatMoney.ts` so both rider-side (Tip CTA)
and driver-side (Earnings, payout/balance rows) can import from a
neutral location. The four Turn-4 consumers (`DriverEarningsScreen`,
`PayoutRow`, `BalanceTransactionRow`, the existing
`formatMoney.test.ts`) were updated to import from
`@presentation/utils/formatMoney`; the old file at the driver-side
location is retained as a 1-line re-export shim because the sandbox
virtiofs blocks `unlink()`. Any non-sandbox checkout's next dev should
`rm` the shim.

Behavior is byte-for-byte identical: `Intl.NumberFormat('en-US',
{style:'currency', currency:'USD'})`. The 4 existing tests still pass.

### 2. `useProcessTipMutation` in `payment.queries.ts`

New TanStack mutation co-located with the rest of the payment hooks
(per Turn 4's "keep payment hooks co-located" decision). Args
`{rideId, tipAmount}`; throws on `Result.err`; returns `void` on
success. **No cache invalidation** — `useRideReceiptViewModel` already
subscribes to the trip's `payments` subcollection via
`useFirestoreSubscription(observeTripPayments)`, so the new `'tip'`
`TripPayment` row materializes through the live subscription as soon
as the Cloud Function's webhook fires (or its direct write lands).
Adding a TanStack invalidation here would just kick a redundant
refetch.

Server-side idempotency on `(tripId, customerId)` keeps a
network-blip retry safe; the local view-model adds a defense-in-depth
single-tap guard so a double-press during a slow round-trip doesn't
fire the callable twice.

Re-exported from `src/presentation/queries/index.ts`.

### 3. `useTipFlowViewModel` + 14 tests

`src/presentation/features/rider/view-models/useTipFlowViewModel.ts`
— the six-arm tagged-union state machine driving the `<TipSelector/>`.
Composes `useProcessTipMutation` over the parent receipt VM's `ride`
(now live — see §5) + `tipPayment` (already live).

Six arms (per kickoff decision 3):

- `hidden` — trip not in `'completed'` OR a `'tip'` row already
  exists. Component renders nothing.
- `idle` — chips visible, no amount picked yet, CTA disabled.
- `selected` — preset OR a valid custom amount picked; CTA enabled.
- `submitting` — `mutateAsync` in flight; chips + CTA disabled.
- `submitted` — local optimistic flag held until the live `tipPayment`
  row lands and the next render flips `'hidden'`. **No fixed-duration
  auto-hide** — the live subscription is the source of truth (kickoff
  decision 2).
- `error` — distinct UX for `validation` (server-side race —
  `tip_trip_not_completed`), `network`, `unauthorized` (rider's auth
  flickered mid-flight), and `unknown`. Form stays interactive so the
  rider can pick a different amount and retry; the band has a
  Dismiss affordance that returns to `selected` (since the amount is
  still picked) or `idle` (if no amount).

Validation rules (mirrors `ProcessTip`):

- Preset chips: $1 / $3 / $5.
- Custom amount: whole dollars only, **1 ≤ x ≤ 99** (the $99 ceiling
  is a defensive upper bound the kickoff locked in — legacy has no
  max, but tipping above $99 is an admin action). The
  `onCustomAmountChange` callback strips non-digits and slices to
  `maxLength={2}` defensively in case anything bypasses the
  component-level constraints.
- Idempotent submit: a second `onSubmit()` while `'submitting'` is a
  no-op.

Errors are classified via `instanceof` checks against the domain error
classes (with a structural-`kind` fallback for any subclass that
doesn't survive the TanStack throw boundary). 14 tests cover every
arm + every classification path + the live-subscription
`'submitted' → 'hidden'` transition + the double-submit guard +
dismiss-error returns to `selected`.

The VM also exports `TIP_PRESETS` (the `[100, 300, 500]` constant) and
the `TipPresetMinorUnits` / `TipFlowState` / `TipFlowError` types for
the component to consume.

### 4. `TipSelector` component + 8 smoke tests

`src/presentation/features/rider/components/TipSelector.tsx` — pure
prop-driven view over `useTipFlowViewModel`'s `state`. Layout:

- Header "Tip your driver" + subhead "Optional — tipping is never
  required."
- Four chips (`$1` / `$3` / `$5` / `Custom`) in a row.
- Custom-mode TextInput with `$` prefix, `keyboardType="number-pad"`,
  `maxLength={2}`, accessibility-labeled "Custom tip amount in whole
  dollars".
- Inline error band on the `error` arm with a Dismiss affordance.
- Large CTA at the bottom: "Tip $X" with the amount via `formatMoney`
  when valid, "Tip your driver" (disabled) when no amount, spinner
  during `submitting`.
- `submitted` swaps the body for a "Tip $X added — thank you!"
  confirmation strip.
- `hidden` returns `null`.

Tailwind tokens only (`bg-primary`, `text-primary-foreground`,
`bg-muted`, `border-error/40`, `bg-success/10`, etc.) per the design
system rules. Test IDs scoped to `tip-selector-*` for the smoke
tests' selectors.

The error band's copy is per-kind (`network` / `validation` /
`unauthorized` / `unknown`) — the VM's raw message is used as a
fallback for `unknown`. 8 smoke tests cover render variants per arm,
preset/submit/dismiss callbacks, custom-mode TextInput wiring, and
the disabled-CTA invariant on idle.

### 5. `RideReceipt` switched to live ride subscription + TipSelector mount

`useRideReceiptViewModel` now subscribes to `ObserveRide` via
`useFirestoreSubscription` instead of the one-shot `useRideQuery`. A
`'payment_failed' → 'completed'` flip server-side (e.g. rider re-tries
the charge from a different surface) now lights up the `<TipSelector/>`
without a re-navigation. Loading semantics: a `useState` flag flips
to `true` on the first emission so `isLoading` only spans the
subscription-establish window. After that, `ride === null` means the
doc was deleted (rare; admin tooling only) and the screen renders the
"couldn't find that receipt" branch.

`RideReceiptScreen.tsx` mounts a fresh `useTipFlowViewModel` call
inside `RideReceiptContent` (side-by-side VMs — the receipt VM stays
read-only). The `<TipSelector/>` is placed between the fare-breakdown
card and the Payment placeholder card. The Payment-placeholder copy
was tightened ("Card brand + last-4 land alongside Stripe brand
glyphs in Phase 9") since Phase 6 is closing.

A new screen smoke (`RideReceiptScreen.test.tsx`, 3 tests) verifies
the TipSelector mounts on idle, hides when a `tip` row lands, and
that the receipt VM's `{ride, tipPayment}` are passed into the tip
flow VM. The `@presentation/components/map` module is jest-mocked at
the test seam since the native `react-native-maps` module isn't
loadable under jest.

The 6 existing `useRideReceiptViewModel.test.tsx` tests still pass
unchanged — the VM's surface (`ride: Ride | null` shape, payment
derivations, fareTotal math) is unchanged from outside.

### 6. Phase 6 wrap-up

- `CLAUDE.md` flips Phase 6 → ✅ across all five turns; Phase 7 →
  Next; refreshes test counts to 146/1093; adds a one-line Phase-6
  arc summary at the top of the status block; registers the new
  files in "Critical files" + the file-locations cheat sheet.
- `defaultPaymentMethodId` plumbing re-verified: `useRouteSelectViewModel`
  reads the rider's default from `useCurrentUserQuery` and bakes it
  into `PassengerSnapshot.defaultPaymentMethod` at `CreateRide` time
  (Turn 2 work). The Cloud Function's `completeTrip` reads this from
  the trip doc to charge the right card. No regression introduced
  this turn.

## Why this turn doesn't include

- **Brand + last4 on the receipt's Payment line** — Phase 9 polish.
  Resolving the rider's `defaultPaymentMethodId` to a `{brand, last4}`
  pair requires a `useListPaymentMethodsQuery` round-trip + a `.find()`
  lookup; the screen retains the generic "Charged to your default
  card" placeholder for now.
- **Tip flow on `'payment_failed'` trips** — out of scope per kickoff
  decision 8. `ProcessTip` rejects with `tip_trip_not_completed` for
  any non-`'completed'` status; the VM's `'hidden'` arm gates on
  `ride.status === 'completed'` so the selector never appears in
  those branches.
- **Driver-side push notification on tip received** — Phase 9 (push
  pipeline lands then). The `tipDriver` Cloud Function already wires
  the `sendPushNotification` call; the rewrite's Expo notifications
  setup isn't shipped.
- **Analytics events on tip submit / preset selection** — Phase 9.
- **"Tip again" affordance** — single-tip-per-trip matches legacy.
- **Multi-currency tipping** — USD only; the `Money` value object
  already constrains this and `ProcessTip` rejects non-USD.
- **Per-brand card-glyph assets on the wallet rows** — Phase 9.
- **Local-validation error band on the form** — kicked out as
  unreachable in practice. The CTA stays disabled while no valid
  amount is selected, so the rider never reaches the "validation
  error from local input" path. The defensive guard inside
  `onSubmit()` remains in place but is exercised only as a
  defense-in-depth seam from outside the public surface.

## Risks surfaced

- **Sandbox virtiofs prevents `unlink()` so deprecation stubs
  accumulate.** This turn adds one more (the driver-side
  `formatMoney.ts` is now a 1-line re-export shim). Joins the existing
  Turn 3 / Turn 4 stubs (`WalletPlaceholderScreen.tsx`,
  `DriverEarningsPlaceholderScreen.tsx`) and the scratch test files
  (`src/probe.test.tsx`, `src/__tests__/probe.test.tsx`). All four
  should be `rm`'d in any non-sandbox checkout. Documented in the
  status block; doesn't affect runtime.
- **`tipPayment` lag during a slow Stripe webhook.** The
  `'submitted' → 'hidden'` transition depends on the live
  `useFirestoreSubscription(observeTripPayments)` landing a `'tip'`
  row. Stripe webhooks can take 5–10 seconds to fire on heavy days;
  in that window the rider sees the "Tip $X added — thank you!"
  confirmation strip instead of the row appearing in the breakdown.
  No correctness issue; just a UI-lag tradeoff. The local banner is
  honest about being a confirmation, not the final state, so the
  copy holds up while the webhook flushes.
- **One-shot → live ride subscription is a behavioral change.** The
  receipt screen now re-renders on every server-side ride mutation,
  not just on initial load. In practice the trip is in `'completed'`
  by the time the receipt mounts and won't change again — but a
  defensive code path is now reachable (`ride !== null` post-mount
  could become `ride === null` if an admin deletes the doc). The
  screen renders the "couldn't find that receipt" branch in that
  case. Existing tests still pass; no observed regression.
- **Double-tap during slow network.** `useTipFlowViewModel.onSubmit`
  starts with `if (isSubmitting) return;` and the `submitting` arm
  doesn't expose `onSubmit` to the screen. Belt-and-suspenders on
  top of the Cloud Function's server-side
  `(tripId, customerId)` idempotency key — a doubled call would
  return the original result rather than double-charge.
- **No iOS/Android native build attempted from the sandbox.** Same
  as Turn 4; the next dev rebuilds with `npm run prebuild` and
  exercises the live tip flow against a real Stripe staging key.
  The `tipDriver` callable is wired to `us-east1` (matches legacy)
  so the same staging Cloud Functions deployment serves both apps.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at end
of turn. **146 test suites / 1093 tests** (+3 suites / +25 tests over
Turn 4's 143/1068).

A signed-in rider on a completed trip can now:

1. Open the receipt → see the `<TipSelector/>` inline between the fare
   breakdown and the Payment placeholder.
2. Tap a $1 / $3 / $5 chip → CTA enables → tap "Tip $3" → land in
   `'submitting'` (chips + CTA disabled, spinner on CTA) → land in
   `'submitted'` (local "Tip $3 added — thank you!" banner) → within
   ~5 seconds, the webhook fires, the Firestore `tip` payment row
   lands, the receipt's fare breakdown updates to include the tip
   line, and the TipSelector disappears.
3. Tap "Custom" → enter `4` on the number pad → CTA reads "Tip $4.00"
   → submit → same flow.
4. Try entering `0` (or any out-of-range number) → CTA stays
   disabled; the chips + custom toggle stay interactive so the rider
   can pick a valid amount.
5. On a network blip mid-submit → see the inline error band
   ("Connection trouble — your tip didn't go through. Please try
   again.") → tap Dismiss → return to `'selected'` with the amount
   still picked → re-submit.
6. Try double-tapping the CTA during a slow network → see exactly
   one `tipDriver` Cloud Function call.

A signed-in rider on a `'payment_failed'` (or any non-`'completed'`)
trip sees no TipSelector.

A signed-in rider whose `'completed'` trip already has a `tip`
payment row sees no TipSelector.

## Optional integration smoke (manual, skipped in CI)

To verify against a real Stripe staging environment:

1. Set `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SERVER_URL` +
   `STRIPE_SERVER_API_KEY` in `.env.development` (test-mode keys + the
   staging Cloud Run URL).
2. `npm run prebuild` — the Stripe SDK plugin's prebuild requirement
   from Turn 3 still stands; this turn doesn't add native deps.
3. `npm run ios` / `npm run android`.
4. Sign in as a rider with at least one saved card and a default set
   in the Wallet tab.
5. Complete a trip end-to-end with a driver that has a Connect account
   (the `tipDriver` callable rejects if `driver.stripeAccountId` is
   missing).
6. On the receipt, tap $3 → "Tip $3.00" → confirm the local banner
   appears → wait ≤30s for the live `tip` payment row to land →
   confirm the row appears in the fare breakdown and the TipSelector
   disappears.
7. Verify the driver's Earnings tab (in another build / device): the
   tip lands in `pending` balance immediately, then in `available`
   after Stripe's payout window per legacy parity.

## Phase 6 arc — what landed across all five turns

- **Turn 1** — pure domain + data-layer foundation. Branded Stripe
  IDs (`StripeCustomerId`, `StripeAccountId`, `PaymentMethodId`),
  payment value objects (`PaymentMethod`, `Payout`,
  `BalanceTransaction`, `StripeAccountStatus`), the
  `StripeServerService` interface, the `FakeStripeServerService`
  in-memory fake. Critical hygiene fix: `userMapper` reads BOTH the
  legacy nested `users/{uid}.stripe = {id, charges_enabled, ...}`
  shape AND the canonical flat fields, and writes both shapes for
  legacy yeride co-existence.
- **Turn 2** — real `StripeServerHttpAdapter` (11 methods,
  fetch-based, retry-with-backoff on 5xx + transport throws via the
  shared `retryWithBackoff` helper); `tipDriver` callable on
  `CloudFunctionsService`; 13 authorization-aware payment use cases
  (4 rider-side, 7 driver-side, plus `ProcessTip`); DI wiring;
  `FakeCloudFunctionsService` with `tipDriver` seam.
- **Turn 3** — rider Wallet + AddPaymentMethod modal. First Stripe-
  SDK surface (`@stripe/stripe-react-native@0.63.0`); `<StripeProvider/>`
  mounted via `MaybeStripeProvider` wrapper; five rider-side TanStack
  hooks; `useWalletViewModel` six-arm tagged union; `<CardForm/>` +
  `confirmSetupIntent` plumbing.
- **Turn 4** — driver Earnings + Stripe Connect onboarding. Seven
  driver-side TanStack hooks; `useStripeConnectOnboarding` multi-step
  launcher (`expo-web-browser` + `openAuthSessionAsync`);
  `useDriverEarningsViewModel` six-arm tagged union; balance card
  - payouts list + balance-transactions ledger; Express-dashboard
    reach via `createAccountLoginLink` + `openBrowserAsync`.
- **Turn 5** — tip flow on RideReceipt. `useProcessTipMutation`;
  `useTipFlowViewModel` six-arm tagged union; `<TipSelector/>` with
  $1/$3/$5 + custom up to $99; live ride subscription on the receipt
  VM; Phase 6 close.

Net Phase-6 delta: **+31 suites / +216 tests** (115 → 146,
877 → 1093). Two new Stripe-bearing tabs (Wallet, Earnings) and the
inline tip flow on the receipt all backed by 13 use cases over a
single `StripeServerService` seam + the `tipDriver` Cloud Function
callable. Legacy yeride co-existence preserved on the User-doc Stripe
shape via dual-read / dual-write in `userMapper`.

Phase 7 — Background GPS + geofence-exit warnings — is Next.
