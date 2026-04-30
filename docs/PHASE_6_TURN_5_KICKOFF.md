# Phase 6 Turn 5 Kickoff Prompt — Tip flow on RideReceipt + Phase 6 cleanup

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 6
Turn 5 — the LAST turn of Phase 6.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 6 (Payments / Stripe Connect / tipping). Turns 1–4 shipped:

- Turn 1: pure domain + data-layer foundation (branded Stripe IDs,
  payment value objects, `StripeServerService` interface, fakes).
- Turn 2: real `StripeServerHttpAdapter` (11-method, retry-with-backoff),
  `tipDriver` Cloud Function callable on `CloudFunctionsService`, the
  `ProcessTip` use case + 12 other authorization-aware payment use
  cases, DI wiring, `FakeCloudFunctionsService` with `tipDriver` seam.
- Turn 3: rider Wallet + AddPaymentMethod modal — the first Stripe-SDK
  surface; `<StripeProvider/>` mounted in `App.tsx`.
- Turn 4: driver Earnings + Stripe Connect onboarding —
  `expo-web-browser`-based `WebBrowser.openAuthSessionAsync` flow,
  balance + payouts + balance-transactions list, Express dashboard
  reach.

End of Turn 4: **143 suites / 1068 tests** passing, all verify gates
green. The `tipDriver` callable + `ProcessTip` use case are both
shipped and wired through DI; what's missing is the UI side. Your job
this session is **Turn 5 — Tip flow on RideReceipt + Phase 6 cleanup**.
This closes Phase 6 and unblocks Phase 7 (background GPS + geofence
exit warnings). Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file
   map. The "Project status" table now shows Phase 6 Turn 4 ✅;
   Turn 5 is Next.
2. `docs/PHASE_6_TURN_4.md` — what shipped in Turn 4 (Driver Earnings,
   `useStripeConnectOnboarding` hook, `useDriverEarningsViewModel`
   tagged-union pattern, `useRef`-stabilized refresh callback to
   prevent infinite update loops under unstable `useMutation`
   identity).
3. `docs/PHASE_6_TURN_3.md` — re-skim the Wallet + AddPaymentMethod
   patterns. The Turn 5 Tip flow's view-model fits cleanly in the same
   tagged-union shape (idle → submitting → submitted/error). The
   `mutateAsync` + `try/catch` pattern from `useAddPaymentMethodViewModel`
   is the right shape for `useTipFlowViewModel` (or whatever you name
   the piece that owns the submit-tip state machine).
4. `docs/PHASE_6_KICKOFF.md` — re-read the "Tip flow" section under
   "Scope (in / out)". The kickoff sketches `TipSelector` as a
   parent-prop-driven component with $1 / $3 / $5 chips + custom amount
   + "Tip $X" CTA. UX intent is "tipping is optional — let the rider
   add a tip OR move on to Done without one".
5. `src/app/usecases/payment/ProcessTip.ts` — read end-to-end. Notes:
   - Authorization is enforced server-side AND client-side. Don't
     duplicate the rules in the VM; let the use case do it.
   - Tip amount is `Money` (minor units); the use case converts to
     dollars at the boundary because the Cloud Function takes dollars.
   - **$1 minimum**, **whole-dollar requirement**. Reject sub-$1 or
     fractional-dollar inputs at the form level so the user never sees
     a server-side rejection.
   - Auth check: only the trip's passenger can tip. Trip must be
     `'completed'` (not `'payment_failed'` or anything earlier).
   - Idempotent server-side via the trip doc's
     `payment.tipStatus === 'succeeded'` check, so a network-blip
     retry is safe.
6. `src/app/usecases/payment/__tests__/ProcessTip.test.ts` — read the
   test cases for the rejection codes (`tip_below_minimum`,
   `tip_non_whole_dollar`, `tip_currency_unsupported`,
   `tip_not_passenger`, `tip_trip_not_completed`). The VM's local
   validation should produce the same error codes (or a thin mapping
   on top) so the tests align cleanly.
7. `src/data/services/CloudFunctionsService.ts` — confirm the
   `tipDriver({tripId, tipAmountDollars})` callable signature. The
   real adapter calls `httpsCallable('tipDriver')` in `us-east1`.
   The fake (`FakeCloudFunctionsService`) has a `tipDriver` seam with
   spy + `failNext` support; tests should drive both happy + sad paths
   from the fake.
8. `src/presentation/features/rider/screens/RideReceiptScreen.tsx`
   AND `src/presentation/features/rider/view-models/useRideReceiptViewModel.ts`
   — the existing receipt surface. The `useRideReceiptViewModel`
   already exposes `tipPayment: TripPayment | null` (live via
   `useFirestoreSubscription(observeTripPayments)`), so the post-tip
   refresh is FREE — once the Cloud Function writes the
   `tip` payment row, the receipt repaints automatically.
9. `src/presentation/features/rider/view-models/__tests__/useRideReceiptViewModel.test.tsx`
   — confirm the existing test shape; Turn 5 extends this VM with
   tip-flow callbacks + their own tests.
10. Legacy `yeride/src/components/TipSelector.js` — UX reference. Note:
    - $1 / $3 / $5 chips + a "Custom amount" toggle.
    - Disabled while processing.
    - Hides itself entirely once a tip has already been added (no
      "tip again" affordance — single-use per trip).
    - Reads `defaultPaymentMethod` from context to render
      "Charged to your card ending in 4242" copy. The rewrite has
      `Rider.defaultPaymentMethodId` already plumbed through
      `PassengerSnapshot` (Phase 6 Turn 2); the receipt surface can
      pull the brand+last4 from a wallet read OR fall back to a
      generic "Charged to your default card" placeholder per the
      Turn 3 receipt body. **Decision below: defer brand+last4 lookup
      to Phase 9 polish; render the generic placeholder for Turn 5.**
11. Legacy `yeride/src/api/stripe/paymentProcessor.js` (`processTipPayment`)
    — confirms the legacy client called Stripe directly for the tip
    charge. The rewrite has been migrated to the `tipDriver` Cloud
    Function (Turn 2 decision); don't try to mirror the legacy client-
    side direct charge.
12. `src/presentation/queries/payment.queries.ts` — Turn 3+4's payment-
    queries file. Add `useProcessTipMutation` here (per kickoff Q3 from
    Turn 4: keep payment hooks co-located; don't fork into
    `tipping.queries.ts`).

## Starting state — what's already built

- **Domain.** `TripPayment` value object with `type: 'fare' | 'tip' |
'refund'`. `Money` value object with $1 minimum + whole-dollar
  validation already enforced inside `ProcessTip.execute`.
- **Data.** `tipDriver` callable on `CloudFunctionsService` (Turn 2);
  `FakeCloudFunctionsService.tipDriver` with seed/spy/failNext seams.
- **App.** `ProcessTip` use case (Turn 2), wired through DI as
  `useCases.processTip`. All five rejection codes covered by tests.
- **Presentation.** `RideReceiptScreen` + `useRideReceiptViewModel`
  exist (Phase 3 turn 5). The VM exposes `tipPayment` live via
  `useFirestoreSubscription(observeTripPayments)`. The `payment` query
  scope in `keys.ts` covers wallet + connect-account state but has no
  tipping-specific keys (none needed — the post-tip refresh comes
  through the existing `useFirestoreSubscription`, NOT through
  TanStack invalidation).
- **No tipping affordance on RideReceipt yet.** The `TripPayment` of
  type `'tip'` already renders correctly in the breakdown when one
  exists; what's missing is the "submit a tip" UI surface.

## Scope decisions (locked at Turn 5 kickoff — confirm or override)

These were resolved before the kickoff doc was written. Don't re-debate
mid-turn — propose follow-ups in the deferred list instead.

1. **`useProcessTipMutation` in `payment.queries.ts`.** Co-located with
   the rest of the payment hooks (Turn 4 Q3). The mutation does NOT
   invalidate any TanStack key — `useRideReceiptViewModel` already
   subscribes to `observeTripPayments` via `useFirestoreSubscription`,
   so the post-tip `tip` payment row appears live on the receipt
   without TanStack involvement. The mutation just throws on
   `Result.err` so the VM can `try/catch`.

2. **`TipSelector` is a presentation component, not a screen.** Mount
   it INLINE on `RideReceiptScreen` between the fare-breakdown rows
   and the "Email receipt" button. The legacy app pops a sheet; the
   rewrite renders inline because the receipt is short and the tip CTA
   is the natural next-step affordance. No new route in
   `RiderStackParamList`.

3. **Tip-flow state machine.** Tagged-union, OWNED by a new
   `useTipFlowViewModel` hook (sibling file alongside
   `useRideReceiptViewModel`). Six arms:
   - `hidden` — tip already submitted (server has a `tip` payment row)
     OR trip is not in `'completed'` status. The component renders
     nothing.
   - `idle` — initial / after error-dismiss. Chips visible; CTA
     disabled until amount selected.
   - `selected` — chip or custom amount picked; CTA enabled.
   - `submitting` — `mutateAsync` in flight. Chips + CTA disabled,
     spinner on CTA.
   - `submitted` — local optimistic flag. The `useFirestoreSubscription`
     in the parent VM will land the actual `tip` row a tick later and
     `hidden` arm takes over. Until then, render a "Tip $X added — thank
     you!" confirmation strip (so the user gets immediate feedback
     even before the webhook → Firestore write lands).
   - `error` — one of `validation` (sub-$1 / fractional / non-USD),
     `network`, `unauthorized` (race: rider's auth flickered),
     `unknown`. Each arm renders inline error copy + a Dismiss
     affordance that returns to `idle`.

   Composing the receipt VM's `tipPayment` (live) with the local
   submit-state is the source of truth: as soon as the webhook lands,
   `useRideReceiptViewModel.tipPayment !== null` flips, the receipt VM
   re-renders, and the `TipSelector`'s VM transitions
   `submitted → hidden`.

4. **Preset chips: $1 / $3 / $5 + custom.** Match legacy. Custom amount
   accepts whole-dollar input only — the input field rejects non-digit
   characters. Min: $1. Max: $99 (defensive — tipping more should be
   handled by an admin action, not the app). Validation surfaces in
   the `error.kind === 'validation'` arm with code
   `'tip_below_minimum'` / `'tip_above_maximum'` / `'tip_non_whole_dollar'`.

5. **Single-tap discipline + double-submit guard.** The submit button
   has an internal `isSubmitting` ref-style guard (similar to Turn 4's
   `useStripeConnectOnboarding.isRunning`) so a double-tap during a
   slow network round-trip doesn't double-charge. The Cloud Function
   is server-idempotent on `(tripId, customerId)`, but defense-in-depth
   matters; the second click is a no-op locally.

6. **Currency display.** Reuse the `formatMoney` utility shipped in
   Turn 4 (`src/presentation/features/driver/utils/formatMoney.ts`).
   Move it up to a more general location if it feels wrong under
   `driver/` — the Tip CTA's "Tip $X" label uses it, and rider-side
   utility consumption is fair game. **Decision: move
   `formatMoney.ts` to `src/presentation/utils/formatMoney.ts`** so
   both `driver/` and `rider/` can import from a neutral location.
   Update Turn 4's import paths to point to the new location; the
   change is import-only (zero behavioral diff).

7. **Brand+last4 on the receipt.** Phase 9 polish, NOT this turn. The
   rewrite has `defaultPaymentMethodId: PaymentMethodId | null` on
   `Rider`, but resolving it to `{brand, last4}` requires a
   `useListPaymentMethodsQuery` round-trip and a `.find()` lookup. For
   Turn 5, retain the existing "Charged to your default card"
   placeholder. The kickoff for Phase 9 will add this.

8. **Tip on `'payment_failed'` trips.** Out of scope. The user case
   wants drivers to be tippable only after the rider's fare landed;
   the `'payment_failed'` arm is a separate UX surface (the rider
   re-tries the charge from a different screen). `ProcessTip` already
   rejects with `tip_trip_not_completed` for any non-`'completed'`
   status; the VM mirrors this by surfacing `hidden` for any non-
   `'completed'` trip status.

9. **No analytics events this turn.** Turn 5 is feature work; Phase 9
   adds analytics across the rewrite.

10. **Phase 6 cleanup checklist** (do all of these before declaring
    Turn 5 done):
    - Mark `Phase 6` overall ✅ in `CLAUDE.md`'s status table.
    - Mark `Phase 7` Next.
    - Refresh test counts.
    - Add a one-line summary of the entire Phase 6 arc to the top of
      CLAUDE.md (right after the Turn 5 status block) so the next
      Phase 7 kickoff has a quick "what landed across Phase 6" recap.
    - Audit the deprecation stubs (`WalletPlaceholderScreen`,
      `DriverEarningsPlaceholderScreen`) — leave them in place since
      sandbox virtiofs blocks `unlink()`, but document them as
      "remove in any non-sandbox checkout" in the Turn 5 doc.
    - Audit the scratch test files left in `src/` from Turn 4
      (`probe.test.tsx`) — same disposition.
    - Audit `defaultPaymentMethodId` plumbing — confirm `CreateRide`
      bakes it into `PassengerSnapshot.defaultPaymentMethod` and the
      Cloud Function actually consumes it (this was Turn 2 work but
      worth a re-verify before closing Phase 6).

## Scope (in / out)

**In:**

- **TanStack hook:**
  - `useProcessTipMutation` in `src/presentation/queries/payment.queries.ts`.
    No invalidation. Mutation argument: `{rideId: RideId, tipAmount: Money}`.
    Throws on `Result.err`. Returns `void` on success.
  - Re-export from `src/presentation/queries/index.ts`.

- **`formatMoney` re-home:**
  - Move `src/presentation/features/driver/utils/formatMoney.ts` →
    `src/presentation/utils/formatMoney.ts`.
  - Update Turn 4 imports (`useDriverEarningsViewModel.ts`,
    `DriverEarningsScreen.tsx`, `PayoutRow.tsx`,
    `BalanceTransactionRow.tsx`, the existing test file). Keep the
    test file in its existing location OR co-locate alongside the new
    home — your call, but be consistent.

- **`useTipFlowViewModel` + tests:**
  - File: `src/presentation/features/rider/view-models/useTipFlowViewModel.ts`.
  - Composes `useProcessTipMutation` + the parent VM's `ride` +
    `tipPayment`.
  - Six-arm tagged-union state per kickoff decision 3.
  - `onSelectPreset(amount: Money)`, `onSelectCustom()`,
    `onCustomAmountChange(text: string)`, `onSubmit()`,
    `onDismissError()` callbacks.
  - Local validation BEFORE calling the mutation: parse custom
    amount, check $1-$99 whole-dollar bounds, surface to
    `error.kind === 'validation'` if invalid.
  - Idempotent submit: `if (state.kind === 'submitting') return;`.
  - Tests: ~10-12 covering each arm + each rejection-code path +
    happy path + double-tap guard.

- **`TipSelector` component + smoke tests:**
  - File: `src/presentation/features/rider/components/TipSelector.tsx`.
  - Pure prop-driven (consumes the VM's `state`).
  - Layout: header "Tip your driver", three preset chips, "Custom"
    toggle that swaps the chips for a TextInput, large CTA "Tip $X"
    at the bottom. Inline error band when `state.kind === 'error'`.
  - Smoke tests: 3-4 covering chip selection, custom amount entry,
    submit-press, error display.

- **`RideReceiptScreen` integration:**
  - Mount `<TipSelector/>` between the fare-breakdown card and the
    Email/Done CTAs. Wire it to the new `useTipFlowViewModel`.
  - The receipt's existing `tipPayment !== null` check already drives
    the `'tip'` row in the fare breakdown — no change there.
  - Smoke test on the screen: the existing receipt smoke covers the
    happy path; add one or two render variants confirming
    TipSelector appears in `'idle'` state and disappears once
    `tipPayment !== null`.

- **`useRideReceiptViewModel` extension (optional — depends on shape):**
  - The cleanest plumbing might be to expose `useTipFlowViewModel`
    from the receipt VM (so the screen consumes one VM, not two).
    Up to your judgment — the alternative is mounting both VMs side-
    by-side in the screen body. Pick the shape that keeps the screen
    body dumbest.

- **Phase 6 cleanup:**
  - `CLAUDE.md`: flip Phase 6 to ✅ across all five turns; flip Phase 7
    to Next; refresh test counts; add the Phase-6-arc one-liner.
  - `docs/PHASE_6_TURN_5.md` written with the same shape as Turn 4's
    doc (what's in / what's not / acceptance / risks / optional
    integration smoke).
  - Final `npm run verify` green.
  - Sanity check: open `WalletPlaceholderScreen.tsx`,
    `DriverEarningsPlaceholderScreen.tsx`, `src/probe.test.tsx`,
    `src/__tests__/probe.test.tsx`. Confirm they're all deprecation
    stubs / `it.skip` placeholders. Don't try to delete them
    (virtiofs blocks); just document them.

**Out (deferred — do not build in Turn 5):**

- Brand+last4 on the receipt — Phase 9 polish.
- Tip-on-`'payment_failed'` flows — out of scope; rider hits a
  different surface for re-trying the fare.
- Driver-side push notification on tip received — Phase 9 (push
  pipeline lands then; the Cloud Function already wires the
  `sendPushNotification` call, but the rewrite's Expo notifications
  setup isn't shipped).
- Analytics events on tip submit / preset selection — Phase 9.
- "Tip again" affordance after a successful tip — single-tip-per-trip
  matches legacy behavior; keep it.
- Multi-currency tipping — USD only.
- `PaymentMethod` brand-glyph assets on the wallet rows — Phase 9.

## Risks + mitigations

- **`useFirestoreSubscription` → `tipPayment` flicker.** The optimistic
  `submitted` state in the VM holds a local "Tip $X — thank you!"
  banner. When the webhook → Firestore write lands, the parent
  receipt VM's `tipPayment` flips non-null and the TipSelector
  transitions to `hidden`. Risk: if the webhook is slow (Stripe sometimes
  takes 5-10 seconds to fire), the user sees the local banner for
  longer than expected. Mitigation: the local banner is honest about
  being a confirmation, not the final state — copy reads "Tip $X added
  — thank you!" not "Tip processed". When the row lands, the receipt
  card re-renders and the banner disappears. No correctness issue;
  just a slight UI lag during slow Stripe-webhook moments.

- **Double-tap during slow network.** `useTipFlowViewModel.onSubmit`
  starts with `if (state.kind === 'submitting') return;` and the
  `submitting` arm renders the CTA disabled. Belt-and-suspenders.

- **Rider re-opens receipt after closing browser mid-onboarding.**
  Not relevant to Turn 5 — onboarding is driver-side. The rider's
  flow doesn't touch `WebBrowser`. But: if the rider's
  `defaultPaymentMethodId` is null at trip-completion time, the Cloud
  Function's tip charge will fail. Mitigation: the rewrite ensures
  `defaultPaymentMethodId` is non-null at `CreateRide` time (Turn 2)
  by gating the Confirm CTA on a non-null default. The receipt
  surface inherits this — if the rider somehow reaches the receipt
  with no default card on file, the `'error'` arm with
  `kind === 'unauthorized'` (or a fresh `'no_payment_method'` code if
  you want to be more granular) renders.

- **Stripe SDK iOS modular-headers / `expo-web-browser` regressions.**
  Settled by Turn 3 / Turn 4. Turn 5 doesn't add native deps; no risk.

- **Trip status race.** A trip in `'payment_failed'` could flip to
  `'completed'` server-side mid-render if the rider re-tries the
  charge. The TipSelector's `'hidden'` arm gates on the live
  `ride.status` — once the status flips, the selector appears. No
  manual refresh required.

- **Test mock for `useFirestoreSubscription`.** The Turn 5 tests need
  to drive `tipPayment` from null → an actual `TripPayment` to verify
  the `submitted → hidden` transition. The `useRideReceiptViewModel.test.tsx`
  pattern from Phase 3 uses an `InMemoryRideRepository` seam to
  emit payment rows; mirror that.

## Acceptance for end of Turn 5 (closes Phase 6)

A signed-in rider on the post-trip receipt can:

1. See the `TipSelector` inline between the fare breakdown and the
   Email / Done CTAs.
2. Tap a $1 / $3 / $5 chip → CTA enables → tap "Tip $3" → land in
   `submitting` (chips + CTA disabled, spinner on CTA) → land in
   `submitted` (local "Tip $3 added — thank you!" banner) → within
   ~5 seconds, the webhook fires, the Firestore `tip` payment row
   lands, the receipt's fare breakdown updates to include the tip
   line, and the TipSelector disappears.
3. Tap "Custom" → enter `4` → CTA reads "Tip $4" → submit → same
   flow.
4. Try entering `0` or `0.50` or `200` → see the validation error
   inline; dismiss → return to idle.
5. Try double-tapping the CTA during a slow network → see exactly
   one `tipDriver` Cloud Function call.

A signed-in rider on a `'payment_failed'` trip sees no TipSelector
(per scope decision 8).

A signed-in rider whose `'completed'` trip already has a `tip`
payment row sees no TipSelector (per kickoff decision 3, `hidden` arm).

`npm run verify` (typecheck + lint + format + test) all green.
**Test delta target: +3 to +5 suites, +20 to +35 tests.** Net should
land around **148 suites / 1095 tests** (informational; the hard gate
is "all four checks pass").

## Conventions (non-negotiable — same as Turns 1-4)

- `Result.ok` / `Result.err` for every expected failure inside
  use cases. The hook layer (`useProcessTipMutation`) throws to be
  TanStack-compatible; the VM `try/catch`es to handle the throw.
- Server state goes in TanStack Query OR in
  `useFirestoreSubscription` (already in use for trip payments); the
  Tip flow rides BOTH — TanStack for the submit mutation, Firestore
  subscription for the post-tip refresh. Don't try to converge them.
- Each screen gets a sibling `useXxxViewModel.ts`. The Tip flow lives
  in its own VM (`useTipFlowViewModel`) so the receipt VM stays
  read-only.
- Logger only: `LOG.extend('TIP')`. Never `console.*`.
- Idempotent submit on the client (defense-in-depth); the Cloud
  Function's server-side idempotency on `(tripId, customerId)` is the
  authoritative guarantee.
- Every Stripe-server call still goes through `StripeServerService`
  (the real impl OR the fake) — but `tipDriver` is a Cloud Functions
  callable, NOT a Stripe-server call, so it routes through
  `paymentCallable` in DI. Don't add a Stripe-server seam for
  tipping.
- Run `npm run verify` before declaring the turn done.

## Suggested ordering

- **Step 1 — `formatMoney` re-home.** Tiny prep step. Move
  `src/presentation/features/driver/utils/formatMoney.ts` →
  `src/presentation/utils/formatMoney.ts`. Update the four Turn-4
  import sites + the test file. Run `npm run typecheck` to confirm
  no broken imports.

- **Step 2 — `useProcessTipMutation` + tests.** Add to
  `payment.queries.ts`. Re-export from `queries/index.ts`. The
  hook's contract: throws on `Result.err`, returns `void` on success,
  no cache invalidation. No new tests needed for the hook itself —
  it's exercised through the VM tests.

- **Step 3 — `useTipFlowViewModel` + tests.** Tagged-union state
  machine. Mock `useProcessTipMutation` at the hook seam (or use the
  full `TestContainerProvider` flow with `FakeCloudFunctionsService`
  spies — pick whichever shape gives the cleanest assertions). Cover
  every arm + each rejection-code path + happy path + idempotent-
  submit guard.

- **Step 4 — `TipSelector` component + smoke tests.** Pure prop-driven
  surface. Smoke renders confirming chips render, custom mode swaps
  to a TextInput, error band displays, submit-press fires the
  callback.

- **Step 5 — RideReceiptScreen integration.** Mount the new component
  + VM. If you choose to expose `useTipFlowViewModel` from
  `useRideReceiptViewModel`, update the existing receipt VM's tests
  to confirm the new shape. Otherwise, mount both VMs side-by-side in
  the screen body.

- **Step 6 — Phase 6 cleanup pass.** `CLAUDE.md` updates, doc updates,
  audit deprecation stubs + scratch test files. Re-verify
  `defaultPaymentMethodId` plumbing through `CreateRide` →
  `PassengerSnapshot.defaultPaymentMethod`.

- **Step 7 — `npm run verify` + commit + write `docs/PHASE_6_TURN_5.md`.**
  Update `CLAUDE.md` (Phase 6 → ✅ entirely, Phase 7 → Next, refresh
  test counts, add the Phase-6-arc one-liner, add new VMs / hooks /
  components to "Critical files"). Commit via the sandbox
  `GIT_INDEX_FILE` shadow pattern (memory:
  `sandbox_git_commit_pattern.md`). Land the kickoff doc as a
  separate `docs:` commit (Turn 3 / Turn 4 pattern).

## Start with

Read `CLAUDE.md`, then `docs/PHASE_6_TURN_4.md`, then re-skim
`docs/PHASE_6_KICKOFF.md` (Tip flow section). Then read `ProcessTip.ts`
+ `ProcessTip.test.ts` + `useRideReceiptViewModel.ts` +
`RideReceiptScreen.tsx` end-to-end. Then read legacy `TipSelector.js`
for UX shape. Then propose **Turn 5 scope as a numbered punch list**
(files to create, files to touch, tests to add — in the same shape as
Turn 3 / Turn 4's punch lists) and wait for confirmation before
writing code.

Tip: Turn 5 closes Phase 6, so the Phase-7 kickoff is the next
deliverable after this turn. The Phase-7 kickoff lives in
`docs/PHASE_7_KICKOFF.md` and follows the same shape as the Phase-6
kickoff — but written for "background GPS + geofence-exit warnings",
which is a Phase 4-era topic with carryover work from the legacy
`gpsLocation.js`, `BackgroundGeolocation` config, and the geofence-
exit warning surfaced in legacy `RideMonitor.js`.
