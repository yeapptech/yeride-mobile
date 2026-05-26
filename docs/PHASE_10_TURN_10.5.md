# Phase 10 Turn 10.5 — payment-error surfacing for the fare-trigger path

**Closed:** 2026-05-26
**Predecessor (rewrite):** [PHASE_10_TURN_9.md](PHASE_10_TURN_9.md) +
[PHASE_10_OOB_DRIVER_HOME_STALE_LOCATION.md](PHASE_10_OOB_DRIVER_HOME_STALE_LOCATION.md)
**Predecessor (yeride-functions):** commit
`e156da9 feat(payments): surface typed validation errors with domain codes`
**Kickoff:** [PHASE_10_TURN_10.5_KICKOFF.md](PHASE_10_TURN_10.5_KICKOFF.md)

## Why

The last user-visible silent-failure path in the fare-payment flow.
When the Firestore-trigger `processPayment` in
`yeride-functions/functions/lib/payments.js` synchronously errored
against the Stripe microservice — validation failure, expired card,
network blip during the `/direct-charge` call — the catch block wrote
a `payment_processing_error` trip-event and returned. The trip stayed
at `'completed'` (set by the `completeTrip` callable's transaction
before the trigger fired). The rider saw the receipt UI as if the
charge went through; in reality no PaymentIntent was created, no
Stripe webhook would ever fire, and no money moved.

Distinct from the Stripe-async failure path (PaymentIntent
created → card declined later → webhook fires → status flips), which
worked correctly via `yeride-stripe-server`. The gap was only the
synchronous-error path where no PaymentIntent ever existed.

With this turn closed:

- Trigger-side `processPayment` catch now flips `status: 'payment_failed'`
  and writes a structured `paymentError: {code, message, occurredAt}`
  on the trip doc.
- The rewrite carries the field end-to-end: DTO → mapper →
  `PaymentFailure` value object on `Ride` → `PaymentFailedView` switch
  on `code` against `KnownPaymentFailureCode`.
- `RideReceiptScreen` redirects to `RideMonitor` when a trip flips to
  `'payment_failed'` post-redirect, so the rider sees the actionable
  surface, not the misleading "Trip complete" receipt.
- Memory `yeride_passenger_snapshot_gap.md` closes — the entire
  three-gap framing is now resolved.

Scope: small-to-medium (1d) per kickoff sizing. Two repos touched
(rewrite + yeride-functions). No Cloud Function signature changes; the
write shape is additive on `trips/{id}` so legacy yeride continues to
read trips without modification.

## Pre-checklist outcomes (resolved at kickoff time)

1. **HEAD SHAs:**
   - `yeride-mobile`: `a828ddc fix(maps): wrap MapView onCreate NPE for Nav SDK coexistence`
   - `yeride-functions`: `e156da9 feat(payments): surface typed validation errors with domain codes`
   - Both working trees clean at kickoff time modulo the untracked
     kickoff doc.
2. **Turn 10 status:** not yet shipped. Per kickoff §Cutover-plan
   impact ("if Turn 10's audit-v3 hasn't shipped, Turn 10.5 lands
   first then Turn 10 re-runs against the post-10.5 SHA"), the turn
   proceeded. §0 of `PHASE_10_CUTOVER_PLAN.md` was already cleared
   pending Turn 10 sign-off — this turn doesn't disturb that
   clearance.
3. **Silent-failure reproduction:** documented at kickoff §Pre-3.
4. **Policy boundary re-read:** carve-out per Decision 3 confirmed.
5. **Rewrite-side fan-out:** five files touched per kickoff §Pre-5.
6. **Domain-code catalog:** `pickDomainCodeForValidation` confirmed
   to produce four codes (`trip_missing_payment_method`,
   `trip_missing_stripe_customer`, `trip_missing_driver_account`,
   `trip_payment_validation_failed`); rewrite catalog mirrors these
   four plus three Stripe decline codes (`card_declined`,
   `expired_card`, `insufficient_funds`) plus a generic fallback
   (`payment_processing_unknown`).

## Decisions taken

### Decision 1 — write shape: trip-doc field flip + structured `paymentError`

Followed kickoff Decision 1 (a). On synchronous error in
`processPayment`'s catch block:

```js
await admin
  .firestore()
  .collection('trips')
  .doc(tripId)
  .update({
    status: 'payment_failed',
    paymentError: {
      code: domainCode,
      message: failureMessage,
      occurredAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    payment: {
      error: failureMessage,
      decline_code: declineCode,
      processingError: true,
    },
  });
```

The existing `payment.error / decline_code / processingError` shape is
preserved alongside the new `paymentError` field — the two writes are
complementary, not redundant. The `payment_processing_error` event in
the events subcollection is kept too, for audit-log continuity (legacy
yeride / existing analytics consume it). Status normalization on the
rewrite side leaves `'payment_failed'` as-is — it's already canonical
in the `RideStatus` enum.

### Decision 2 — error catalog

Followed kickoff Decision 2. Domain code resolution order in the
catch block:

1. `error.domainCode` set by the validation branch via
   `pickDomainCodeForValidation` (newly tagged on the trigger path —
   the callable path was already tagging via Turn 10's previous fix).
2. `pickDomainCodeFromStripeDecline(errorDetails.decline_code)` —
   new helper exported from `lib/payments.js`. Maps Stripe's
   `decline_code` (whatever the microservice surfaces via
   `error.response.decline_code`) to the rewrite's
   `KnownPaymentFailureCode` catalog. Returns `null` for codes the
   rewrite doesn't have copy for, so the caller falls back to the
   generic.
3. Fallback `'payment_processing_unknown'`.

The Stripe-side mapping is intentionally narrow: `card_declined` +
`generic_decline` + `do_not_honor` + `fraudulent` + `lost_card` +
`stolen_card` all collapse to `'card_declined'`; `expired_card` and
`insufficient_funds` map 1:1. Stripe's full decline catalog has dozens
more codes; extending the rewrite to surface specific copy for each
is out of scope here, and the fallback to
`'payment_processing_unknown'` keeps the view rendering a
"Try a different card / contact support" surface for anything else.

### Decision 3 — policy line update

Followed kickoff Decision 3. `yeride-functions/CLAUDE.md`
security-notes §4 now reads:

> **Payment status**: Never set `payment_failed` from Cloud Function
> for PaymentIntent-state failures — webhooks are authoritative
> there. The Cloud Function MAY set `payment_failed` when the
> synchronous Stripe call itself errors (validation failure, network
> blip, declined card at request-time) and no PaymentIntent was ever
> created, since no webhook will fire to rescue the trip from limbo.
> See `lib/payments.js` `processPayment` catch block — it writes a
> structured `paymentError: {code, message, occurredAt}` alongside
> the status flip so the rider's `PaymentFailedView` can render
> actionable copy (Phase 10 Turn 10.5).

### Decision 4 — domain value object: `PaymentFailure` (NOT `PaymentError`)

**Departed from the kickoff's proposed name.** The kickoff suggested
`src/domain/entities/PaymentError.ts`, but `src/domain/errors/PaymentError.ts`
already exists as a `DomainError` subclass — same name in the same
domain barrel would collide on import. Renamed to `PaymentFailure`
(value object) to keep `PaymentError` (error class) usable as-is. The
on-disk wire field stays `paymentError` (canonical with the server
side); the domain-side property is `ride.paymentFailure`. Mapper
projects between the two names at the boundary, no leak in either
direction.

`PaymentFailure` follows the same value-object pattern as `Money` /
`Coordinates` / `Email`:

- Private constructor + `static create(props): Result<PaymentFailure, ValidationError>`.
- Immutable; `equals(other)` for structural comparison.
- `isKnown()` instance method + `isKnownPaymentFailureCode(code)`
  module helper for the view's switch.

## Files shipped

### `yeride-mobile/` (rewrite) — 13 files modified, 3 created

| File                                                                                                                                                                                                       | Change                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/domain/entities/PaymentFailure.ts` (**new**)                                                                                                                                                          | Value object + `KnownPaymentFailureCode` union + `isKnownPaymentFailureCode` helper                                                                                            |
| `src/domain/entities/__tests__/PaymentFailure.test.ts` (**new**)                                                                                                                                           | 16 tests covering factory accept/reject + equals + catalog                                                                                                                     |
| `src/domain/entities/index.ts`                                                                                                                                                                             | Export `PaymentFailure` from the barrel                                                                                                                                        |
| `src/domain/entities/Ride.ts`                                                                                                                                                                              | New `paymentFailure: PaymentFailure \| null` prop + accessor; defaulted to `null` in `Ride.create` / `Ride.createScheduled`                                                    |
| `src/data/dto/RideDoc.ts`                                                                                                                                                                                  | New `PaymentErrorDocSchema` + `PaymentErrorOccurredAtSchema` (Firestore Timestamp duck-type accepter) + `paymentError` field on `RideDocSchema`                                |
| `src/data/mappers/rideMapper.ts`                                                                                                                                                                           | `paymentFailureFromDoc` (read) + `paymentFailureToDoc` (write); wired through `toDomain` / `toDoc`                                                                             |
| `src/data/mappers/__tests__/rideMapper.test.ts`                                                                                                                                                            | 8 tests for `paymentError` DTO ↔ domain + round-trip                                                                                                                           |
| `src/presentation/features/rider/components/PaymentFailedView.tsx`                                                                                                                                         | Refactored to switch on `paymentFailure.code` against `KNOWN_COPY` catalog; primary Wallet/Support CTA + secondary support link; back-compat null branch for Stripe-async path |
| `src/presentation/features/rider/components/__tests__/PaymentFailedView.test.tsx` (**new**)                                                                                                                | 12 tests covering all 8 catalog branches + null fallback + unknown-code forward compat                                                                                         |
| `src/presentation/features/rider/screens/RideMonitorScreen.tsx`                                                                                                                                            | Thread `onPressOpenWallet` to `PaymentFailedView`                                                                                                                              |
| `src/presentation/features/rider/screens/RideReceiptScreen.tsx`                                                                                                                                            | `useEffect` redirect to `RideMonitor` when `ride.status === 'payment_failed'`                                                                                                  |
| `src/presentation/features/rider/screens/__tests__/RideReceiptScreen.test.tsx`                                                                                                                             | New describe block: redirect fires on payment_failed; not on completed                                                                                                         |
| `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`                                                                                                                   | New test: `ride.paymentFailure` surfaces through to consumers                                                                                                                  |
| Various test fixtures (`useTipFlowViewModel.test.tsx`, `useRideReceiptViewModel.test.tsx`, `useGenerateReceiptPdfViewModel.test.tsx`, `ProcessTip.test.ts`, `buildReceiptHtml.test.ts`, `_rideFixture.ts`) | Added `paymentFailure: null` to existing `Ride.fromProps` callsites (new required prop)                                                                                        |
| `.gitignore`                                                                                                                                                                                               | Added `*.bak`                                                                                                                                                                  |

### `yeride-functions/` — 3 files modified, 1 created

| File                                             | Change                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functions/lib/payments.js`                      | `processPayment` validation branch tags `err.domainCode`; catch block flips `status: 'payment_failed'` + writes structured `paymentError`; new exported helper `pickDomainCodeFromStripeDecline`        |
| `functions/__tests__/payments.test.js` (**new**) | First jest suite in yeride-functions. 21 tests: `pickDomainCodeForValidation` (4), `pickDomainCodeFromStripeDecline` (10), `processPayment` sync-error path (5), policy-boundary success-path guard (2) |
| `functions/.eslintrc.js`                         | Add `**/__tests__/**` + `*.test.*` jest-env override                                                                                                                                                    |
| `CLAUDE.md`                                      | Security-notes §4 policy-line update per Decision 3                                                                                                                                                     |

## Verify gates

### `yeride-mobile/`

```bash
npm run typecheck                # ✓ tsc --noEmit clean
npm run lint                     # ✓ eslint . clean
npm run format:check             # ✓ prettier --check clean (after one --write pass for new files)
npx jest --testPathPattern=src/domain/       # ✓ 41 suites / 486 tests
npx jest --testPathPattern=src/app/          # ✓ 55 suites / 268 tests
npx jest --testPathPattern=src/data/         # ✓ 24 suites / 389 tests
npx jest --testPathPattern=src/presentation/features/  # ✓ 45 suites / 383 tests
npx jest --testPathPattern='src/shared/|src/presentation/components/|src/presentation/stores/|src/presentation/hooks/'  # ✓ 48 suites / 460 tests
```

**Test totals:** 213 suites, 1986 tests, all passing. Up from 1942 at
Turn 9 close — net +44 tests (the new `PaymentFailure` / mapper /
view-model / view tests). The full `npm test` runs longer than the
sandbox's 45s bash limit; partitioned runs sum to a green total.

### `yeride-functions/`

```bash
cd functions && npm test         # ✓ 1 suite / 21 tests
cd functions && npm run lint     # 3 pre-existing errors (NOT introduced this turn)
```

The 3 pre-existing lint errors are in
`handlers/complete-trip.js:130` and `lib/notifications.js:45,76` —
verified absent from this turn's diff via `git diff HEAD`. They were
broken at the predecessor SHA `e156da9` already. Cleanup is a
follow-on chore; not part of Turn 10.5 scope.

## Cutover-plan impact

- §0 gate clearance unchanged — this turn doesn't alter parity-audit
  ❌/🟡/⚠️ counts (it's a UX correctness fix the rewrite is shipping
  ahead of legacy, which has the same silent-failure today).
- §3.1 `npm run verify` stays green on the rewrite side.
- §3.4 (backend health) needs a verify pass once `payments.js` is
  deployed to `yeapp-stage`; the deploy command is unchanged
  (`cd functions && npm run deploy-stage`).
- §1+ of the cutover plan picks up unchanged. Turn 10 (audit-v3
  re-run) now lands against this post-10.5 SHA.

## Rollback

Server-side: revert the `processPayment` catch-block update; trip
stays at `'completed'` on synchronous-error (back to the
silent-failure state). The new `pickDomainCodeFromStripeDecline`
helper is unreferenced after revert; can stay exported or be removed
in the same revert.

Client-side: the `paymentError` field becomes `null` on every read;
status-router never picks the `payment_failed` branch from this path.
`Ride.paymentFailure` defaults to `null` on construction. Zero data
corruption risk — `paymentError` is additive and `null`-tolerant
across the read paths.

If a production hotfix is needed mid-rollout, the server-side change
is independently revertible from the client-side without breaking
either binary (legacy yeride doesn't read `paymentError`; the
rewrite's mapper treats it as optional).

## Follow-ons (out of scope here)

- **Retry CTA on `PaymentFailedView`.** The view currently routes to
  Wallet for the rider to add/update a card; there's no inline
  "retry charge" mutation. Punt as a follow-on if production data
  shows enough abandoned trips to justify it.
- **Driver-side `PaymentFailedView` copy refresh.** Unchanged this
  turn — the driver's monitor surface still uses the pre-10.5
  generic message. Driver doesn't see the rider's payment-method
  state directly anyway; the existing `PaymentRequestedView` →
  completion flow remains.
- **Cleanup of pre-existing yeride-functions lint errors.**
  Three errors in `handlers/complete-trip.js:130` and
  `lib/notifications.js:45,76` were already broken at HEAD; not
  introduced by this turn. Sized small (a few minutes) but lives
  outside Turn 10.5 scope.
- **Move yeride-functions service-account JSONs out of the deploy
  artifact.** Pre-existing security flag from
  `yeride-stripe-server/CLAUDE.md`; same posture applies to
  yeride-functions. Out of scope here.

## References

- Memory: `yeride_passenger_snapshot_gap.md` — updated post-turn to
  reflect the resolved state (Turn 10.5 close-out note).
- `PHASE_10_CUTOVER_PLAN.md` §0, §3.1, §3.4 — unchanged.
- `yeride-functions/CLAUDE.md` security-notes §4 — updated per
  Decision 3.
- Kickoff doc: [`PHASE_10_TURN_10.5_KICKOFF.md`](PHASE_10_TURN_10.5_KICKOFF.md).
