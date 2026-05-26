# Phase 10 Turn 10.5 Kickoff — payment-error surfacing for the fare-trigger path

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 9
closed 2026-05-19** (BG-geolocation jest regression resolved via
`skipNativeInDev` constructor flag; verify-green at 1942 passing).
Turn 10 (audit-v3 re-run + cutover sign-off) is queued.

Turn 10.5 is an interstitial P1 turn slotted between Turn 10 and §1
of `PHASE_10_CUTOVER_PLAN.md`. It closes the last user-visible
silent-failure path in the fare-payment flow before phased-rollout
traffic hits production. Sized **small-to-medium (1-1.5d)** — one
Cloud Function handler + tests, one DTO check, one client-side
view-model verification, kickoff + close doc.

## Context — why this turn now

**The bug class** (verified at HEAD 2026-05-26, not the May 2026
framing that's now mostly resolved). When the Firestore-trigger
`processPayment` in `yeride-functions/functions/lib/payments.js`
synchronously errors against the Stripe microservice — validation
failure, expired card, network blip during the `/direct-charge`
call — the catch block at L309 writes a `payment_processing_error`
trip-event and returns. The trip stays at `'completed'` (set by
the `completeTrip` callable's transaction before the trigger
fires). The rider sees the receipt UI as if the charge went
through; in reality no PaymentIntent was created, no Stripe
webhook will ever fire, and no money moved. The rider has no
surface that says "your payment didn't go through."

This is distinct from the Stripe-async failure path (PaymentIntent
created → card declined later → Stripe webhook fires → yeride-
stripe-server flips `status: 'payment_failed'` via the webhook
handler). That path works and lights up `PaymentFailedView`
correctly. **The gap is only the synchronous-error path** where no
PaymentIntent ever existed.

**Why the policy boundary matters.** `yeride-functions/CLAUDE.md`
codifies: "Never set `payment_failed` from Cloud Function — let
webhooks be authoritative." That policy is correct for the
Stripe-async path (the webhook IS the source of truth there), but
it over-extended to swallow the synchronous-error path where no
webhook will ever fire. The fix narrows the policy: webhooks are
authoritative for PaymentIntent-state transitions; the Cloud
Function owns the "no PaymentIntent was created" terminal state.

**What's already done** (so the scope below is what's actually
left, not a re-do of resolved work):

1. ✅ **Rider-side gate at trip creation.**
   `src/presentation/features/rider/view-models/useRouteSelectViewModel.ts:341-360`
   hard-blocks with `setSubmitError('Add a payment method before
   requesting a trip — open Wallet to add a card.')` when
   `user.role === 'rider' && user.defaultPaymentMethodId === null`.
   The inline comment self-references "Phase 10 turn 10."

2. ✅ **Typed `failed-precondition + details.code` for tip and
   cancel callables.** `yeride-functions/functions/handlers/tip-driver.js:100-106`
   and `cancel-trip.js:198-202` both throw
   `HttpsError("failed-precondition", msg, {code: result.domainCode})`
   when `processPaymentForTrip` returns a validation failure with a
   `domainCode`. The client's
   `src/data/services/CloudFunctionsService.ts:212-218` reads
   `details.code` into `domainCode` and produces a typed
   `ValidationError` instead of opaque `cf_<op>_internal`.

3. ✅ **`validateTripDataForPayment` validates `defaultPaymentMethod.id`.**
   Called at `payments.js:226` (trigger path) and L376 (callable
   path). The callable path additionally tags the error with
   `err.domainCode = pickDomainCodeForValidation(validationErrors)`
   at L387 so the handler can surface a typed `HttpsError`. The
   trigger path doesn't tag a `domainCode` because there's no
   callable to surface it to — but the trigger path IS exactly the
   silent-failure path this turn addresses.

4. ✅ **`PaymentFailedView` exists on both rider and driver
   sides** and is wired into `RideMonitorScreen`'s status-router
   at L26+44 (rider) and the equivalent in `DriverMonitorScreen`.
   `payment_failed` → `PaymentFailedView` routing is already
   present; the trigger that puts a trip INTO `payment_failed`
   from the synchronous-error path is what's missing.

**What's still gapped — Turn 10.5 scope:**

5. ❌ **Synchronous-error path doesn't reach `'payment_failed'`.**
   `payments.js:309` catches whatever `callStripeServer
   ("/direct-charge", ...)` throws (or whatever the upstream
   `validateTripDataForPayment` throw produces in the trigger
   path), writes a `payment_processing_error` trip-event, and
   returns. The trip document is NOT updated; status stays
   `'completed'`. `PaymentFailedView` never renders for this case.

6. ❌ **No `paymentError` structured field on the trip doc.** Even
   if we flipped status, the rider needs to know WHY ("Your card
   was declined" vs. "Add a payment method" vs. "Payment service
   temporarily unavailable — we'll retry"). The receipt-side UI
   needs a typed `paymentError: {code, message}` shape to render
   actionable copy.

## Pre-checklist (resolve before writing code)

1. **Verify HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   git log -1 --oneline                # capture for the close doc
   git status                          # working tree clean modulo this kickoff
   ```

2. **Confirm Turn 10 is closed or not blocking.** Turn 10.5 should
   land AFTER Turn 10's audit-v3 sign-off so the cutover SHA is
   chosen on the verify-green Turn-9 close, not partway through
   Turn 10.5. If Turn 10 hasn't shipped yet, hold Turn 10.5 until
   the audit signs off and `PHASE_10_CUTOVER_PLAN.md` §0 is
   formally cleared. Re-read `docs/PHASE_10_TURN_9.md` and the
   most recent `docs/PHASE_10_PARITY_AUDIT.md` to confirm state.

3. **Reproduce the silent-failure path on stage.** Easiest repro:
   - Pick a rider on stage with a known-expired card OR delete
     their saved cards in Stripe Dashboard (`yeapp-stage`) after
     the user signed in.
   - Request a trip → drive it → driver hits Complete.
   - Watch Firestore: `trips/{id}.status` flips to `'completed'`
     (via the callable's transaction), then the `onTripUpdated`
     trigger fires `processPayment`, which calls `/direct-charge`
     with a `paymentMethodId` that Stripe rejects.
   - Expected post-turn behavior: `trips/{id}.status` flips to
     `'payment_failed'` with a structured `paymentError` field;
     the rider's `RideMonitorScreen` routes to
     `PaymentFailedView`. Current behavior: trip stays `'completed'`,
     receipt UI shows "Trip completed" with no error surface.

4. **Re-read the payment policy boundary.**
   `yeride-functions/CLAUDE.md` security-notes section: "Payment
   status: Never set `payment_failed` from Cloud Function - let
   webhooks be authoritative." Confirm the framing in this turn
   doesn't violate that policy — the synchronous-error path has
   no PaymentIntent and therefore no webhook will ever fire, so
   it's outside the "webhooks are authoritative" scope. The close
   doc should update the policy line to explicitly carve out the
   synchronous-error path.

5. **Confirm the rider-receipt subscribes to `paymentError`.**
   - `src/data/dto/RideDoc.ts` — `RideDocSchema` needs a
     `paymentError` optional field added.
   - `src/data/mappers/rideMapper.ts` — pass `paymentError` through
     to the domain.
   - `src/domain/entities/Ride.ts` — add `paymentError` to the
     `Ride` aggregate as an optional value object.
   - `src/presentation/features/rider/components/PaymentFailedView.tsx`
     — read the `ride.paymentError?.code` and switch on the
     domain-code catalog to render the right copy.
   - `src/presentation/features/rider/screens/RideReceiptScreen.tsx`
     — confirm the receipt screen redirects to `RideMonitor` when
     `ride.status === 'payment_failed'` so the rider sees the
     actionable surface, not the "successful receipt" UI.

6. **Confirm the domain-code catalog.** Re-read
   `pickDomainCodeForValidation` in `payments.js` (~L530 per
   grep) and confirm the codes produced match the codes the
   client maps in
   `src/data/services/CloudFunctionsService.ts:mapFunctionsError`.
   The new server-side write should use the SAME catalog so
   `PaymentFailedView` can switch on a known finite set.

## Decisions to lock at kickoff time

Make these explicit in the Turn 10.5 close doc.

### Decision 1 — write shape for the failed terminal state

**(a) Trip-doc field flip + structured `paymentError` (recommended).**
On synchronous error in `processPayment`'s catch block:

```js
await admin.firestore().collection("trips").doc(tripId).update({
  status: "payment_failed",
  paymentError: {
    code: domainCode || "payment_processing_unknown",
    message: error.message || "Payment failed",
    occurredAt: admin.firestore.FieldValue.serverTimestamp(),
  },
});
```

Plus keep the existing `payment_processing_error` event-doc write
for audit-log continuity (don't break what the legacy app or
existing analytics already consume).

**Pros:** Direct read for the rider's status-router; structured
error surface; aligns with the existing
`'completed' → 'payment_failed'` status transition that the
webhook already drives for async failures.

**(b) Event-doc-only with client-side derivation.** Leave the
trip status at `'completed'`; have the client subscribe to the
events subcollection and derive a "failed" state from the
presence of a `payment_processing_error` event.

**Pros:** Smaller server change.
**Cons:** Adds a Firestore subscription the client doesn't
otherwise need; makes the receipt-success state racy with
event-doc arrival; harder to test; the rider-side status-router
becomes "status OR derived-from-events" which is the kind of
implicit state the rewrite explicitly avoids.

**Pick (a).** Decision 1 = "trip-doc field flip with structured
paymentError."

### Decision 2 — error catalog for `paymentError.code`

Use the existing `pickDomainCodeForValidation` catalog from
`payments.js` (whatever it produces — verify in step 6 above) as
the canonical source. The catch block should resolve the code in
this order:

1. `error.domainCode` (set by `validateTripDataForPayment` failure)
2. Stripe error code mapping (decoded from `error.response` /
   `error.raw` if `callStripeServer` surfaces Stripe errors with
   structure)
3. Fallback `"payment_processing_unknown"`

The client switches on the resolved code in `PaymentFailedView`
to render the right copy. If the catalog grows during this turn,
add the new codes to BOTH the server-side picker AND the client-
side switch in the same commit — they're a contract.

### Decision 3 — does the Cloud Function CLAUDE.md policy line change

**Yes.** The line currently reads:

> Payment status: Never set `payment_failed` from Cloud Function -
> let webhooks be authoritative.

Should become:

> Payment status: Never set `payment_failed` from Cloud Function
> for PaymentIntent-state failures — webhooks are authoritative
> there. The Cloud Function MAY set `payment_failed` when the
> synchronous Stripe call itself errors (validation failure,
> network blip, declined card at request-time) and no
> PaymentIntent was ever created, since no webhook will fire to
> rescue the trip from limbo.

Update the line in `yeride-functions/CLAUDE.md` security-notes
section as part of this turn.

### Decision 4 — does the rewrite's `paymentError` shape get a domain value object

**Recommended yes** — `src/domain/entities/PaymentError.ts` with
a `static create` factory returning `Result<PaymentError,
ValidationError>`. Same pattern as `Money`, `Coordinates`, etc.
This keeps `Ride.paymentError: PaymentError | null` typed and
testable. The DTO at `RideDocSchema` accepts the wire shape
(strings + timestamp); the mapper constructs the value object.

## Tests to write

- **Server-side unit test** in `yeride-functions/functions/__tests__/payments.test.js`
  (or wherever the existing payment tests live): mock
  `callStripeServer` to throw a validation error; assert
  `processPayment` calls `trips/{id}.update` with
  `status: 'payment_failed'` AND a structured `paymentError`
  field carrying the right `domainCode`. Repeat for a Stripe
  network error and for a `validateTripDataForPayment` failure.
- **Server-side test for the policy boundary**: when
  `callStripeServer` succeeds (PaymentIntent created), the catch
  block must NOT fire and trip status must NOT flip to
  `payment_failed` from the Cloud Function — the Stripe webhook
  remains authoritative for the async path. This is a
  regression guard against accidentally widening the carve-out.
- **Client-side mapper test** in `src/data/mappers/__tests__/rideMapper.test.ts`:
  legacy doc without `paymentError` field reads as
  `ride.paymentError === null`; new doc with the field reads
  through to a `PaymentError` value object.
- **Domain test** in `src/domain/entities/__tests__/PaymentError.test.ts`:
  factory accepts valid shape, rejects empty code / negative
  timestamp / wrong types. Standard value-object test pattern.
- **View-model test** in `useRideMonitorViewModel.test.tsx`:
  fake repo emits a `Ride` with `status === 'payment_failed'`
  and a `paymentError`; view-model surfaces it through the
  status-router prop; `PaymentFailedView` renders.
- **`PaymentFailedView` component test**: switch on the
  domain-code catalog and assert each branch renders the right
  copy + the right CTA (Wallet for missing-PM,
  Wallet-update-card for expired, Retry for transient).

## Out of scope

- The Stripe-async failure path (PaymentIntent → webhook). It
  already works correctly and is owned by `yeride-stripe-server`.
- The driver-side `PaymentFailedView` — unchanged. Driver
  doesn't see the rider's payment state directly; the existing
  `PaymentRequestedView` → completion flow remains.
- Retry mechanics ("tap to retry payment"). Out of scope —
  the rewrite doesn't currently expose a client-driven retry;
  riders fix their card in Wallet and the next trip's
  `validateTripDataForPayment` accepts it. Punt the retry CTA
  as a follow-on if production data shows enough failed-then-
  abandoned trips to justify it.
- Touching the legacy yeride app. Both binaries write to the
  same Firestore; the new `paymentError` field is additive and
  legacy's read paths will simply ignore it. No legacy hotfix
  required.

## Verify gates

Same as every turn — `npm run verify` green at the close SHA,
with the new tests added. Cross-repo: `cd yeride-functions &&
npm run test && npm run lint` green too.

`PHASE_10_CUTOVER_PLAN.md` §3.1 verify gate stays green
post-Turn-10.5 because the rewrite changes are additive
(new DTO field, new domain entity, new view-model branch).

## Rollback

Server-side: revert the `processPayment` catch-block update;
trip stays at `'completed'` on synchronous-error (back to the
silent-failure state). Client-side: the `paymentError` field
becomes `null` on every read; status-router never picks the
`payment_failed` branch from this path. Zero data corruption
risk — `paymentError` is additive and `null`-tolerant.

If a production hotfix is needed mid-rollout, the server-side
change is independently revertible from the client-side without
breaking either binary (legacy yeride doesn't read
`paymentError`; the rewrite's mapper treats it as optional).

## Cutover-plan impact

Turn 10.5 lands between Turn 10 close and §1 of
`PHASE_10_CUTOVER_PLAN.md`. After this turn:

- Parity-audit headline remains `0 ❌ / 0 🟡 / 0 ⚠️` (this isn't
  a parity gap with legacy — it's a UX correctness fix the
  rewrite is shipping ahead of legacy, which has the same
  silent-failure today).
- `npm run verify` stays green at the new SHA.
- §1+ of the cutover plan picks up unchanged.

If the verify gate is red at Turn 10 close (it shouldn't be, but
guard), Turn 10.5 lands first, Turn 10 audit-v3 re-runs against
the post-10.5 SHA, then §0 clears.

## References

- Memory: `yeride_passenger_snapshot_gap.md` (5 days stale at
  time of kickoff drafting; rider-gate and typed-error claims
  have since landed — verify-and-update the memory in the close
  doc).
- `PHASE_10_CUTOVER_PLAN.md` §0, §3.1, §3.4 (backend health).
- `yeride-functions/CLAUDE.md` security-notes section (policy
  line to update per Decision 3).
- `src/data/services/CloudFunctionsService.ts:mapFunctionsError`
  (client-side typed-error path the failed-precondition write
  flows through — but note this turn writes to Firestore
  directly, not via a callable, so the client subscribes to the
  trip doc rather than mapping a callable error).
