# Phase 9 — Turn 5: passenger-snapshot Stripe gap close

Phase 9 Turn 4 spent the rawMeta channel that Turn 6 landed — the
driver-VM foreground location push removed and five chain-fatal
`logger.warn` sites flipped to `logger.error` so the driver navigation
surface fans error sites out to Crashlytics. Turn 5 closes a different
chain-fatal hole: the passenger-snapshot Stripe gap that's been logged
in memory since Phase 6 polish and was finally surfaced by a real-user
tip-flow report ("Connection trouble — your tip didn't go through").

The gap, distilled: every trip the rewrite creates lacks the two
fields the deployed `processPaymentForTrip` Cloud Function reads off
the trip doc to make the Stripe charge. `passenger.stripeCustomerId`
isn't carried by the rewrite's `PassengerSnapshot` domain entity at
all — the validator at
[yeride-functions/lib/payments.js:43-45](../../yeride-functions/functions/lib/payments.js)
hard-rejects without it. `passenger.defaultPaymentMethod` is written
as a bare id string but the same code reads it as an object
(`tripData.passenger.defaultPaymentMethod?.id` for the
`/direct-charge` `paymentMethodId` argument;
`tripData.passenger.defaultPaymentMethod?.type` for cash-vs-card
branching). Trip writes from the rewrite never satisfy the validator,
so:

- `tipDriver` callable returns `code: 'internal'` →
  `mapFunctionsError`'s default arm → `NetworkError` →
  `useTipFlowViewModel`'s `'network'` arm → "Connection trouble"
  banner. The visible failure mode that surfaced this gap.
- `onTripUpdated` Firestore trigger calls `processPayment(event)` on
  both the `'payment_requested'` and `'completed'` status flips. Both
  fail validation. The trigger's catch block at
  [payments.js:298-336](../../yeride-functions/functions/lib/payments.js)
  explicitly does NOT set `status: "payment_failed"` — comment says
  "let webhook be authoritative." It only writes `payment.error` +
  `payment.processingError: true` to the doc and adds a
  `payment_processing_error` event. The trip ends in `'completed'`
  with a stranded payment error, the receipt UI shows "Total updates
  as soon as your charge clears." indefinitely, and the driver doesn't
  get paid. Silent failure mode — the most consequential one.
- `cancelTrip` callable returns `code: 'internal'` for late-rider /
  mid-trip cancellation paths (the ones where
  `result.processPayment === true`), same loud-failure mode as
  `tipDriver`. Cancel-before-dispatch and cancel-within-five-minutes
  paths don't process payment so they remain unaffected.

Acceptance: **180 test suites / 1525 tests passing** (+0 suites, +6
tests over Turn 4's 180/1519 — at the low end of a "+5 to +9 tests"
estimate band). Typecheck, lint, format, and test all green.
**No native rebuild required** — pure JS/TS work; no new dependencies;
no plugin patches.

## What's in

Five files modified across the four layers, plus 24 test fixtures
updated for the new shape.

### 1. Domain entity — `PassengerSnapshot.ts`

`src/domain/entities/PassengerSnapshot.ts` extends in two ways:

- New `stripeCustomerId: StripeCustomerId | null` prop. Branded id
  follows the Phase 6 turn 2 pattern (three distinct branded
  Stripe id types — customer / account / payment method — so the
  type system rejects mixing them).
- New exported `PassengerPaymentMethod` interface — minimum shape
  `{id: PaymentMethodId; type: 'card' | 'cash'}`. The old
  `defaultPaymentMethod: string | null` field is replaced by
  `defaultPaymentMethod: PassengerPaymentMethod | null`.

The JSDoc records why the minimum shape is what we write, even
though legacy yeride writes the full Stripe `PaymentMethod` object
(`{id, type, card: {brand, last4, exp_month, exp_year, ...}, ...}`).
The deployed Cloud Function only reads `.id` and `.type` off the
trip-doc passenger; the brand / last4 the rider sees on the receipt
comes from `useListPaymentMethodsQuery` against the user-side
methods list, not from this snapshot. Carrying the extra fields
would couple the rewrite's wire shape to a Stripe API surface we
don't own; carrying the minimum is enough.

The factory's `Result`-returning shape is preserved — both new
fields are nullable so a freshly-registered rider with no Stripe
customer / no card on file constructs cleanly.

### 2. DTO schema — `RideDoc.ts`

`src/data/dto/RideDoc.ts` `PassengerDocSchema` gains:

- `stripeCustomerId: z.string().nullish()` — read-side accepts both
  null and a present-but-invalid id (validation happens at the
  mapper boundary against `StripeCustomerId.create`, not at parse
  time).
- `PassengerDefaultPaymentMethodSchema` preprocess now handles three
  on-disk shapes:
  1. **Canonical (rewrite writes this post-Turn-5)** — `{id, type}`
     object. Pass-through with type-narrowing on `type`.
  2. **Legacy yeride** — full Stripe `PaymentMethod` object. Strip
     to `{id, type}`; type is read from `.type` if `'cash'`,
     defaulting to `'card'` for any other value (real Stripe PMs
     always have `.type` set; this is a safety belt).
  3. **Rewrite pre-Turn-5 (bare id string)** — synthesize
     `{id: <string>, type: 'card'}` since cash rides aren't
     supported in the rewrite yet. This is the back-compat path
     for the handful of rewrite-created trips on disk in
     `yeapp-stage` that landed before this fix.
- Output schema `z.object({id: z.string().min(1), type:
  z.enum(['card', 'cash'])}).nullable()`.

JSDoc on the schema enumerates all three shapes so a future
cleanup can't accidentally re-tighten the read side and break the
data co-existence invariant. The write side is strict: only the
canonical shape goes out.

### 3. Mapper — `rideMapper.ts`

`src/data/mappers/rideMapper.ts` `passengerToDomain` and
`passengerToDoc` both touched:

`passengerToDomain` parses both new fields defensively. A malformed
`stripeCustomerId` on disk (wrong prefix, wrong char set) falls
back to `null` with a `LOG.warn` rather than crashing the
trip-doc read. Same pattern for `defaultPaymentMethod.id` →
`PaymentMethodId.create` failure → null + warn. This mirrors
`userMapper`'s behavior on the user doc's Stripe ids
(established Phase 6 turn 1) — never crash hydration on a single
bad doc; observability surfaces the gap.

`passengerToDoc` writes both fields in canonical shape:
`stripeCustomerId: p.stripeCustomerId ? String(p.stripeCustomerId)
: null` (strips the brand for wire), and
`defaultPaymentMethod: p.defaultPaymentMethod ? {id: String(...),
type: ...} : null`.

A fresh `LOG.extend('RideMapper')` logger is added (the file
didn't have its own logger before — the warns are new behavior).

### 4. Presentation — `useRouteSelectViewModel.ts`

`src/presentation/features/rider/view-models/useRouteSelectViewModel.ts`
plumbs both new fields into the `PassengerSnapshot.create` call at
trip-creation:

```ts
stripeCustomerId: user.role === 'rider' ? user.stripeCustomerId : null,
defaultPaymentMethod:
  user.role === 'rider' && user.defaultPaymentMethodId !== null
    ? { id: user.defaultPaymentMethodId, type: 'card' as const }
    : null,
```

The four Phase-6-era warning blocks at the top of `confirm` are
trimmed to one. Three of them logged the gap that's now closed
(rider has no `stripeCustomerId` / wire-format-is-wrong warnings)
and are removed alongside the JSDoc preamble that documented the
gap. The fourth (rider has no default payment method on file)
stays — it's still a real condition and the legacy app surfaces
the same warning. Trip creation is allowed to proceed without a
default payment method since the rider may have just signed up
and intends to add a card before the driver arrives — same
permissive UX as legacy yeride.

`type: 'card' as const` is the only branch the rewrite produces
today; cash rides aren't yet supported in the rewrite. The
discriminant is in the value object so cash-rider support drops
in cleanly later (a Phase 11 or beyond concern).

### 5. Tests — 24 files

**`src/domain/entities/__tests__/PassengerSnapshot.test.ts`** — the
existing fixture (`VALID`) updates to use the new shape (with
`StripeCustomerId.create('cus_xyz789')` and `PaymentMethodId.create
('pm_123abc')` cooked into a `{id, type}` object). Test count goes
from 2 to 3: `'constructs from valid props'`, `'accepts a snapshot
with no avatar / pushToken / payment method'`, and a new
`'accepts a cash-typed default payment method'` covering the
`type: 'cash'` branch.

**`src/data/mappers/__tests__/rideMapper.test.ts`** — five new
tests, one renamed:

- `'extracts {id, type} from passenger.defaultPaymentMethod legacy
  object form'` (renamed from the prior `extracts id from ...`
  test; assertion updated to check both `.id` and `.type`).
- `'falls back to null on a malformed defaultPaymentMethod.id
  without crashing the read'` — tests the mapper's defensive
  fallback when `PaymentMethodId.create` rejects (e.g.
  underscore in body — real Stripe PM ids are alphanumeric only
  in the body).
- `'back-compat: synthesizes {id, type:"card"} from a bare-string
  defaultPaymentMethod'` — pins the contract for rewrite trips
  written before this turn.
- `'reads passenger.stripeCustomerId off a legacy doc that
  carries it'` — proves the new field round-trips on read.
- `'falls back to null on a malformed stripeCustomerId without
  crashing the read'` — same defensive contract for the customer
  id.
- `'round-trips canonical {id, type} defaultPaymentMethod through
  toDoc + toDomain'` — regression guard. The canonical write
  shape must survive a full round-trip.

The top-of-file `PASSENGER` fixture also updates its
`defaultPaymentMethod` from `'pm_123'` (bare string) to
`{id: PaymentMethodId.create('pm_123'), type: 'card'}` and gains
`stripeCustomerId: StripeCustomerId.create('cus_riderabc')`.

**`src/domain/entities/__tests__/Ride.test.ts`** — `PASSENGER`
fixture updated to the new shape (same as rideMapper's). No new
tests; the existing `Ride` tests don't exercise the snapshot's
payment fields directly.

**Twenty other test files** — all of them constructed
`PassengerSnapshot` with `defaultPaymentMethod: null` (riders
without a card on file). They each get a single-line addition
of `stripeCustomerId: null,` so the new `PassengerSnapshotProps`
shape is satisfied. Done in one sweep with `perl -i -0pe`. The
files:

```
src/app/usecases/payment/__tests__/ProcessTip.test.ts
src/app/usecases/ride/__tests__/CancelRideByRider.test.ts
src/app/usecases/ride/__tests__/DispatchRide.test.ts
src/app/usecases/ride/__tests__/GetRideById.test.ts
src/app/usecases/ride/__tests__/ListRidesByDriver.test.ts
src/app/usecases/ride/__tests__/ListRidesByPassenger.test.ts
src/app/usecases/ride/__tests__/ObserveTripEvents.test.ts
src/app/usecases/ride/__tests__/ObserveTripPayments.test.ts
src/presentation/__tests__/AppContent.test.tsx
src/presentation/features/driver/components/__tests__/EnRouteToPickupView.test.tsx
src/presentation/features/driver/components/__tests__/StartedView.test.tsx
src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx
src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx
src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx
src/presentation/features/rider/screens/__tests__/RideReceiptScreen.test.tsx
src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx
src/presentation/features/rider/view-models/__tests__/useRideReceiptViewModel.test.tsx
src/presentation/features/rider/view-models/__tests__/useTipFlowViewModel.test.tsx
src/presentation/hooks/__tests__/useActiveRideForGeofence.test.tsx
src/shared/testing/__tests__/InMemoryRideRepository.test.ts
```

## Acceptance

```
Test Suites: 180 passed, 180 total
Tests:       1525 passed, 1525 total
```

Suite count unchanged (no new test files). Test count up by +6
from Turn 4's 1519:

- PassengerSnapshot.test.ts: 2 → 3 (+1)
- rideMapper.test.ts: 35 → 40 (+5)

Typecheck, lint, format:check all green. The boundaries-rule v6
selector schema landed in Turn 6 already covers the new
mapper-layer Stripe-id imports without an override change.

## What's NOT in this turn

Three explicit deferrals worth recording.

**Pre-Turn-5 trip docs** (rewrite-created trips currently in
`yeapp-stage` Firestore with stranded `payment.error` fields)
won't auto-recover with this fix. The trip in question that
surfaced the gap (`Qvh3IcsSEa4ByVtNlxUa`) is one of these. The
options on the table:

1. **Backfill manually** — write `passenger.stripeCustomerId` and
   reshape `passenger.defaultPaymentMethod` to `{id, type:'card'}`
   on the trip doc, then trigger a re-attempt (e.g. flip the
   `payment` field to clear `processingError`, then bump status;
   or call `tipDriver` after backfill to force a server-side
   re-validation against the corrected doc).
2. **Write off as test data** — production cutover to fresh
   `yeapp-prod` (per REFACTOR_PLAN.md §7) avoids the issue going
   forward; the handful of stage trips can be ignored. This is
   the path of least resistance.
3. **One-time admin script** — small `firebase-admin` script
   over `yeapp-stage` that scans `trips` where
   `payment.processingError === true` and patches the passenger
   fields from `users/{passengerId}`.

Recommended: option 2. The stage trips have no real-money impact
(they're against Stripe test mode), and the cutover plan already
discards stage state when production stands up.

**Cash-ride support** stays out of scope. The legacy yeride
supports cash; the rewrite hasn't yet shipped that code path.
The `type: 'card' | 'cash'` discriminant is in the new
`PassengerPaymentMethod` shape so cash-rider support drops in
cleanly later (the rewrite would need a UI affordance to pick
"cash" at trip-creation, plus the user-side wallet to model
cash riders, plus a few branches in the receipt / fare-monitor
surfaces). Phase 11 or beyond.

**Retroactive driver pay** for completed trips that should have
charged — the rewrite has been in stage for several phases,
which means there's some number of completed trips where the
rider was charged $0 and the driver received $0 because the
fare-charge path silently failed. This is a finance / ops
question, not an engineering one. After Turn 5 lands, all
*future* trips charge correctly; the past is past.

## Native rebuild

**Not required.** Pure JS / TS work; no new dependencies; no
plugin patches; no Expo config changes. Existing dev / TestFlight
/ EAS builds keep working as-is. The next time anyone runs
`npm run prebuild`, nothing turn-related changes.

## Why the on-disk wire shape is what it is

A small note for posterity. The minimum-shape choice
(`{id, type}` only, not the full Stripe object) is deliberate
trade-off, not laziness:

- **Coupling control.** Carrying the full Stripe `PaymentMethod`
  object on the trip doc would couple our wire shape to Stripe's
  API surface. Stripe deprecates fields on
  `PaymentMethod.card.*` periodically; we don't want a Stripe API
  rev to force a Firestore migration on our side.
- **Read-back-compat is preserved.** The DTO's preprocess
  accepts the legacy full-object shape, so legacy-yeride-written
  trips read fine in the rewrite. The asymmetry (read full,
  write minimum) is the same dual-read pattern `userMapper`
  uses for the user-doc Stripe shape (Phase 6 turn 1).
- **The brand / last4 the rider sees doesn't come from here.**
  The receipt's "Visa ••• 4242" line is rendered from
  `useListPaymentMethodsQuery` joining the rider's saved methods
  list against the trip's `passenger.defaultPaymentMethod.id` —
  a separate code path. Carrying brand/last4 on the trip doc
  would be redundant.
- **Cash discriminant is the only thing the server reads beyond
  `id`.** `processPaymentForTrip` branches on
  `defaultPaymentMethod?.type === 'cash'` to choose between
  `/charges-create` (cash, charge driver for app fees) and
  `/direct-charge` (card, direct-charge to Connect account).
  That's it.

## File-by-file summary

| Layer | File | Change kind |
|---|---|---|
| Domain | `PassengerSnapshot.ts` | New `stripeCustomerId` field; `defaultPaymentMethod` shape `string \| null` → `{id, type} \| null`; new exported `PassengerPaymentMethod` interface |
| DTO | `RideDoc.ts` | `PassengerDocSchema` gains `stripeCustomerId`; `PassengerDefaultPaymentMethodSchema` preprocess accepts three on-disk shapes; emits canonical `{id, type}` only |
| Mapper | `rideMapper.ts` | `passengerToDomain` parses both fields defensively (warn + null on bad id); `passengerToDoc` writes canonical wire shape; new `LOG.extend('RideMapper')` logger |
| Presentation | `useRouteSelectViewModel.ts` | Plumbs `user.stripeCustomerId` and `{id: defaultPaymentMethodId, type: 'card'}` into snapshot; trims 3 of 4 gap-warning blocks |
| Domain test | `PassengerSnapshot.test.ts` | Fixture updated; +1 cash-type test |
| Mapper test | `rideMapper.test.ts` | Fixture updated; +5 new tests covering canonical round-trip, legacy object form, bare-string back-compat, and two malformed-id fallbacks |
| Domain test | `Ride.test.ts` | Fixture updated |
| 20 other test files | various | Single-line `stripeCustomerId: null,` addition |

## Sources

- [yeride-functions/lib/payments.js](../../yeride-functions/functions/lib/payments.js) — `validateTripDataForPayment` requires `passenger.stripeCustomerId`; `processPayment` and `processPaymentForTrip` both go through this validator
- [yeride-functions/handlers/tip-driver.js](../../yeride-functions/functions/handlers/tip-driver.js) — callable; throws `HttpsError("internal", error.message)` on validation failure
- [yeride-functions/handlers/trip-updated.js](../../yeride-functions/functions/handlers/trip-updated.js) — Firestore trigger; calls `processPayment(event)` on both `'payment_requested'` and `'completed'` status flips
- [yeride-functions/handlers/cancel-trip.js](../../yeride-functions/functions/handlers/cancel-trip.js) — callable; calls `processPaymentForTrip` for cancel scenarios with `result.processPayment === true` (late rider cancel / mid-trip cancel)
