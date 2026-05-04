# CLAUDE.md — AI Assistant Guide for YeRide-Next

**Last updated:** May 4, 2026 (Phase 9 Turn 9 closed — SDK-adapter telemetry: 4 LOG.warn → LOG.error flips in BackgroundGeolocationClient routing onLocation SDK error codes + invalid coords + subscriber-throws through Crashlytics recordError; 181 suites / 1573 tests)
**Codebase:** the clean-architecture rewrite of YeRide. New project at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Legacy app still lives at
`/Users/papagallo/yeapptech/dev/yeride/` and is the source of truth for
domain knowledge — read its `CLAUDE.md` for trip lifecycle, Stripe,
Navigation SDK quirks, and other behaviors not yet ported.

## Project status

**Phase 9 Turn 9 closed.** SDK-adapter telemetry flips — the four
candidate sites in `BackgroundGeolocationClient.ts` that Turn 8's
audit catalogued and deferred. All four pre-checklist questions
landed on the Recommended option, so the full surface ships in one
turn. (1) **L348 `onLocation: error`** — flipped to `LOG.error` with
a constructed `Error` carrying the SDK's numeric error code in the
message: `new Error(\`bg_geolocation_onlocation_error:
code=${errorCode}\`)`. The original meta `{code: String(errorCode)}`was a plain object — without the constructed wrapper the rawMeta
channel's`extractError(rawMeta ?? meta)`returned null and the`recordError`fan-out skipped this site. Constructed-Error pattern
mirrors Turn 4's`navigation_route_status:`site; Crashlytics groups
non-fatals by`name + message`first chars so each distinct numeric
code (1=permission denied, 2=network unavailable, 408=timeout, 499=
client cancelled, ...) groups under its own Firebase Console issue
for triage granularity. The routine-status path (codes 0 / 499) at
L344 stays at`info`— those are platform-level OK / cancel signals,
not failures. (2) **L480`handleLocation: invalid coords`** — flipped
to `LOG.error`passing`coordsR.error`(a`ValidationError`) directly.
The original meta `{code: coordsR.error.code}`was a plain object that`extractError`would skip, but`coordsR.error`itself IS a real`Error` (`ValidationError extends DomainError extends Error`), so
the cleanest fix is changing the meta argument from
`{code: ...}`to the error reference itself — zero constructed-Error
gymnastics. Pre-Turn-9 alternative pattern (mirror Turn 4 verbatim
with`new Error(\`bg_invalid_coords: ${code}\`)`) was considered and
rejected as less consistent. (3) **L502 `handleLocation: subscriber
threw`** + (4) **L547 `handleGeofence: subscriber threw`** — fan-out
loop defensive catches in `handleLocation`/`handleGeofence`. `e`was already a real`Error`here (a synchronously-throwing subscriber
callback), so flip-only — change`logger.warn`to`logger.error`and
the rawMeta channel preserves the reference identity through to`recordError`. The fan-out loop's resilience invariant (one bad
subscriber doesn't take down the others) is preserved; the new
telemetry just makes the bug visible. **Cleanup-best-effort site at
L465 (`removeAllListeners failed (non-fatal)`) stays at warn** —
tagged with `// stays warn — best-effort cleanup`comment per Turn
8's pattern. **Adapter ↔ hook duplicate noise** — pre-checklist Q4
chose to leave both layers at error. The 4 chain-fatal adapter`LOG.error`sites (L206/L228/L247/L280) are matched by 4 hook-side`LOG.error`sites in`useGpsLifecycle.ts` (L187/L222/L201/L318); on
an SDK init failure both fire. Different scope names
(`'YeRide:BgGeolocation'`vs`'YeRide:GpsLifecycle'`) group as
separate Firebase Console issues — the adapter scope carries the raw
SDK throw, the hook scope carries the wrapped `NetworkError`with`cause`chain. Useful triage signal; slight dashboard noise is the
documented tradeoff and can be revisited after field telemetry.
**Mock-side helper.** The pre-Turn-9 SDK mock at`jest.setup.ts`captured the location callback (first arg to`BackgroundGeolocation.onLocation`) but ignored the optional second
arg (the numeric-error callback). Turn 9 extends `mockBgListeners`with a`locationError`bucket, updates the`onLocation`factory to
capture the optional`onError`arg, and exposes`**emitLocationError(code: number)`alongside`**emitLocation`/`**emitGeofence`. Subscription `.remove()`tears both callbacks out
of their respective buckets so a single`.remove()`doesn't leak
the error callback. **Five new regression tests** in`BackgroundGeolocationClient.test.ts`under a new describe block`'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn
9)'`: (a) headline `onLocation SDK error code`test — drives`**emitLocationError(1)`, asserts message-substring `code=1`+`bg_geolocation_onlocation_error`(loose enough for cosmetic edits
but tight enough to catch removal of the code from the message), and
asserts`name === 'YeRide:BgGeolocation'`. (b) routine-status sanity
check — codes 0 and 499 stay at info, breadcrumbs DO record but
`getRecordedErrors()`is empty. (c) invalid-coords test — emits`latitude: 999`and asserts the recorded ValidationError's`code`field is`'coordinates_lat_out_of_range'`(NOT`'coordinates_invalid_latitude'`— the actual code from the entity;
caught by running the test). (d) location subscriber-threw — registers
a throwing subscriber alongside a peer; emits an event; asserts
reference identity on the recorded Error AND that the peer DID receive
the event (fan-out resilience). (e) geofence subscriber-threw — same
shape. Each test wraps the body in`try {...} finally {
LOG.removeTransport(transport) }`per Turn 4 / Turn 8 hygiene
pattern. **Audit re-verified** — post-Turn-9 distribution is 13/13
LOG sites at error (was 9), 1 at warn (the cleanup-best-effort site,
explicitly tagged), 8 at info.`useGpsLifecycle`and`FirestoreLocationRepository`stay as Turn 8 left them; the latter's
4 plain-object`LOG.warn`sites for DTO-parse / stream / getLastKnown
failures are flagged for the Phase 10 cross-cutting Firestore mapper
telemetry audit. Acceptance: **181 suites / 1573 tests** (+0 suites /
+5 tests over Turn 8's 181/1568, within the kickoff's "+4 to +8
tests" estimate band — at the floor, since 4 of the 5 new tests are
the headline flips and the 5th is the routine-status sanity check
that pins the bifurcation in the SDK error callback). **No native
rebuild required** — pure JS/TS work; no new dependencies; no plugin
patches; no DI container changes; no cross-repo work. Manual smoke
checklist documented in`docs/PHASE_9_TURN_9.md`§ "Smoke checklist
(user-driven)" — the cleanest L348 driver is OS-Settings-revoke the
location permission while online; L502/L547 paths require a`**DEV**`-gated debug shortcut to drive against a real device.

**Phase 9 Turn 8 closed.** GPS lifecycle telemetry — the next
surface to spend Turn 6's rawMeta-channel contract. Two
`LOG.warn → LOG.error` flips land in
`src/presentation/hooks/useGpsLifecycle.ts`'s location-subscription
effect: (1) L245 → L254 (`UserLocation.create failed`) — the SDK
adapter normalizes `coords.speed` and `Coordinates.create` rejects
bad lat/lng before events reach this hook, so a failure here means
an upstream contract broke; recording lights up Firebase Console
when a logic bug fires. (2) L250 → L266 (`updateLocation mutation
failed` in the `useUpdateLocationMutation` `onError`) — fires after
`FirestoreLocationRepository`'s 3-retry backoff exhausts and the
mutation `mutationFn` re-throws the wrapped `NetworkError`; the
location pipeline is dead until the next delivery and that's
degraded operation worth a non-fatal. Both sites already pass
real `Error` instances (`ValidationError` / `NetworkError`, both
extending `DomainError` extends `Error`), so the rawMeta channel's
`extractError(rawMeta ?? meta)` resolves directly without
constructed-Error wrappers (unlike Turn 4's non-OK NavRouteStatus
site). Three cleanup-best-effort sites that intentionally stay at
warn (L172 `stop returned error` on disable, L286
`removePickupGeofence error` on trip flip, L319-L322 teardown
errors on unmount) get one-line `// stays warn — best-effort
cleanup` comments so the level choice is visible to a future
reader. The `permission not granted` path (L207) stays at info
per the kickoff's pre-checklist Q2 — user explicitly declined the
OS dialog, matches Turn 4's terms-declined precedent. **Audit
findings.** Walked `BackgroundGeolocationClient.ts` (13 LOG sites:
9 already at error, 4 at warn — `removeAllListeners` cleanup,
`handleLocation: invalid coords` defensive guard with non-Error
meta, fan-out `subscriber threw` defensive catch, `onLocation:
error` SDK numeric error code) and `FirestoreLocationRepository.ts`
(5 LOG sites: 1 at error already, 4 at warn — per-attempt retry
log, two `subscribeToX` doc-validation paths, `getLastKnown
failed`). The repo-side L73 `LOG.error` already fans out cleanly
because the wrapped `NetworkError` is then re-thrown by the
mutation's `mutationFn` and lands at L266's hook-side log — so
the user-facing Crashlytics event records once at the hook
boundary (cleaner scope grouping). Pre-checklist Q3 confirmed:
leave the repo alone. The 4 SDK-adapter candidates and 4
Firestore-repo candidates each require either constructed-Error
wrapping (Turn 4's NavRouteStatus pattern) or a coordinated
audit pass across multiple repositories (rideMapper / userMapper
/ vehicleMapper all log the same `subscribeToX` shape). Both
deferred — the audit is the "thorough, found nothing else worth
flipping" outcome the kickoff explicitly named as legitimate.
Two new telemetry tests in
`src/presentation/hooks/__tests__/useGpsLifecycle.test.tsx` under
a new describe block `'telemetry — recordError fan-out via
rawMeta channel (Phase 9 turn 8)'`: the L254 test emits
`speed: -1` (the fake adapter passes events through verbatim, so
`UserLocation.create`'s `user_location_invalid_speed` rejection
fires without monkey-patching the entity) and asserts
`validationRecord.error.code === 'user_location_invalid_speed'`
(not reference identity, since the entity factory instantiates a
fresh ValidationError per call); the L266 test seeds
`locations.mockUpdateError(networkErr)` and emits a valid event,
then asserts `recorded.find(r => r.error === seededError)`
(reference identity proves the rawMeta channel preserved the
original `NetworkError` through `sanitizeForLogging`). Each test
asserts `validationRecord.name === 'YeRide:GpsLifecycle'` so
Firebase Console groups non-fatals correctly. Each test wraps
the body in `try/finally { LOG.removeTransport(transport) }`
following Turn 4's pattern. Acceptance: **181 suites / 1568
tests** (+0 suites / +2 tests over Turn 7's 181/1566 — at the
floor of the kickoff's "+2 to +4 tests" estimate band). **No
native rebuild required** — pure JS/TS work; no new
dependencies; no plugin patches; no DI container changes; no
cross-repo work. Manual smoke checklist documented in
`docs/PHASE_9_TURN_8.md` § "Smoke checklist (user-driven)" —
airplane-mode-mid-trip drives the L266 path; the L254 path is
genuinely hard to drive against a real device because it fires
only on an upstream contract violation (the unit test covers the
wire-up; field firing would represent a real bug).

**Phase 9 Turn 7 closed.** Two visible-on-screen receipt stubs that
the Turn 4 smoke surfaced are wired up. (1) Card brand + last-4 on
the RideReceipt payment row — the receipt VM joins
`farePayment.paymentMethodId` against `useListPaymentMethodsQuery`'s
wallet cache. The Stripe webhook server already writes
`pi.payment_method` to the payment doc as `paymentMethodId` (see
`yeride-stripe-server/stripe/routes.js:138`); the rewrite just wasn't
reading it. `TripPayment` gains a nullable `paymentMethodId:
PaymentMethodId | null` field; `TripPaymentDocSchema` extends to
accept the optional wire field; `tripPaymentMapper.toDomain` parses
it via `PaymentMethodId.create` with `LOG.warn` + null fallback
(legacy-doc resilience pattern from `userMapper`). The receipt VM
surfaces `paymentBrand: CardBrand | null` + `paymentLast4: string |
null` on cache hit, both null on cache miss; the screen renders a
per-brand glyph + "Brand •••• last4" line on hit, "Charged to your
card on file" on miss. (2) The disabled "Email receipt" button is
gone — replaced with a small "A receipt is emailed automatically
when your charge clears" note. Stripe sends emailed receipts
automatically via the `receiptEmail` parameter on `/direct-charge`
(`yeride-functions/lib/payments.js:454`); the legacy yeride app
never had an in-app email-receipt trigger, so the disabled button
was a stub for a feature that didn't exist anywhere. The new shared
`CardBrandBadge` component at
`src/presentation/components/payment/CardBrandBadge.tsx` renders
per-brand PNG glyphs (visa / mastercard / amex / discover / diners

- generic `card.png` fallback for jcb / unionpay / unknown). Brand
  PNGs ported from legacy yeride — zero new deps, zero native
  rebuild, zero risk of Fabric componentProvider regression mirroring
  Phase 9 Turn 1's react-native-maps patch (the alternative
  `react-native-svg` path was considered but the visual outcome at
  receipt-row size is identical). `WalletCardRow` was refactored to
  import the shared `CardBrandBadge` + `formatBrand` helper instead
  of its inline `BrandBadge` + duplicate `formatBrand`. The
  `emailReceipt` no-op stub on `useRideReceiptViewModel` is removed
  from the return surface. `nativewind-env.d.ts` extended with
  `*.png` / `*.jpg` / `*.jpeg` / `*.gif` ambient module declarations
  (numeric Metro asset id) so static PNG imports typecheck. Five test
  fixture files updated for the new required `paymentMethodId` field
  on `TripPayment` (`paymentMethodId: null` added to existing fare /
  tip / refund fixtures). Acceptance: **181 suites / 1566 tests**
  (+1 suite / +34 tests over Turn 4 smoke fix #2 baseline at
  180/1532). New CardBrandBadge.test.tsx suite (11 tests) is the +1
  suite delta; the +34 test delta is composed of 11 CardBrandBadge +
  5 mapper paymentMethodId-parse + 5 receipt VM cache-join + 4
  receipt screen Phase 9 Turn 7 payment row + ~9 baseline drift
  across data/domain/driver chunks. **No native rebuild required**
  for Turn 7 — pure JS/TS work; no new dependencies; no plugin
  patches; no DI container changes.

**Phase 9 Turn 4 smoke fix #2 closed.** `TripPayment.amount`
unit-mismatch fix. The user-driven smoke surfaced a 100x display
bug after the receipt-schema fix landed and the `tipDriver` Cloud
Function patch deployed: a $5 fare and $5 tip rendered as `$500.00`
each, totalling `$1000.00`. Root cause:
`src/data/mappers/tripPaymentMapper.ts:43` was reading
`doc.amount` via `Money.fromMajor(doc.amount, 'USD')` — treating it
as dollars. But the Stripe webhook server
(`yeride-stripe-server/stripe/routes.js:132`) writes the raw
`pi.amount` from the Stripe Charge / PaymentIntent, which is ALWAYS
integer cents (Stripe API contract). The DTO comment claiming
"PLAIN NUMBER IN DOLLARS" was a documentation lie. Exact 100x:
`amount: 500` (cents = $5.00) → `Math.round(500 * 100)` = 50000
minor units → `format()` = `"$500.00"`. Fix: single-shape
extension at the DTO + mapper layer. `TripPaymentDoc.amount` field
gets `.int()` to enforce the Stripe contract; comment rewritten to
say "INTEGER CENTS — Stripe-native unit." Mapper switches from
`Money.fromMajor` to `Money.create` (the integer-minor-units
constructor); JSDoc warns against the reverted path. The
`amountInDollars` sibling on the wire stays unmapped — cents-as-
integer is the source of truth (avoids float-imprecise round-
trips). All other consumers of `TripPayment.amount` work at the
domain layer where `Money` arithmetic operates on minor units
internally — the bug was contained at the parse boundary; the tip-
flow submit path (which sends a plain dollar amount up the wire,
multiplied by 100 inside the deployed callable) was always
correct. Three new regression tests in `tripPaymentMapper.test.ts`
including the headline `amount=500 (cents) → '$5.00'` pinning.
Existing fixture amounts converted to integer cents. Acceptance:
**180 suites / 1532 tests** (+0 suites / +3 tests over smoke fix
#1's 180/1529). Manual smoke re-run end-to-end against
`yeapp-stage`: $5 fare → `$5.00`, $5 tip → `$5.00`, total
`$10.00`. Receipt persists, tip flow succeeds. **Phase 9
functionally closed for the trip flow.** Commit `825d165` on top
of `d23f331`.

**Phase 9 Turn 4 smoke fix closed.** Receipt-schema gap closed.
Manual smoke surfaced after Turn 4 shipped: driver taps Request
Payment → rider's RideReceipt renders briefly → blanks out and
shows "We couldn't find that receipt." Same family as Phase 8 Turn
3 sub-turn 5b — Phase-3 latent bug where the deployed payment
pipeline writes on-disk shapes the rewrite's DTO doesn't accept.
Specifically, the deployed pipeline transitions trip docs through
`payment_requested → completed → payment_intent → closed` within
seconds — `'payment_intent'` written by `yeride-functions/lib/payments.js`
after `processPayment` initiates the Stripe charge, and `'closed'`
(co-written with top-level `closedAt` ISO timestamp) by
`yeride-stripe-server/stripe/routes.js` after the Stripe
`charge.succeeded` webhook fires. Neither was in the rewrite's
`RideDocSchema.status` enum. Schema validation rejected with
`{code: 'invalid_value', path: 'status'}`, `toDomainOrCorrupt`
returned `Result.err`, the live `observeRide` callback emitted
`null`, the receipt VM's post-mount `ride === null` branch fired
the not-found message. Pinpointed by the user's Metro log line
`[YeRide:FirestoreRide] ride doc failed schema validation`. Fix:
`RideDocSchema.status` enum gains `'payment_intent'` + `'closed'`;
new top-level `closedAt: ISO_DATE.nullish()` declared (mirrors
`canceledAt` pattern from Phase 8 Turn 3 5b — Zod default would
strip silently, but declaring it makes it visible in
`topLevelKeys` diagnostics); `rideMapper.toDomain`'s status-
normalization ternary refactored into a switch with two new arms
(`'payment_intent' → 'payment_requested'`, `'closed' → 'completed'`).
Both terminal-from-rider's-POV; the legacy app conflates them
under one rider-facing screen. Building distinct domain states for
"settled" vs "in flight" is Phase 10 cutover-prep work. Four new
regression tests in `rideMapper.test.ts` including a regression
guard against the new switch interfering with the canonical
`'completed'` direct-write path. Companion cross-repo work
(commit `13f247a` in `yeride-functions`, deployed by user to
`yeapp-stage`): `tipDriver` callable's precondition check widened
from strict `tripData.status !== "completed"` to
`["completed", "payment_intent", "closed"].includes(tripData.status)` —
the brief milliseconds-wide window where status is exactly
`'completed'` was effectively never hittable by a human tap; the
legacy yeride app likely exhibited the same bug silently. Webhook-
side double-tip guard (`payment.tipStatus === "succeeded"`) still
prevents double-tipping after the precondition widens. CHANGELOG
entry: `2.13.1 - tipDriver post-completion status window`.
Acceptance: **180 suites / 1529 tests** (+0 suites / +4 tests over
Phase 9 Turn 5's 180/1525). Commit `d23f331` on top of `8963683`.
No native rebuild required.

**Phase 9 Turn 5 closed.** Passenger-snapshot Stripe gap closed —
the long-deferred Phase 6 polish item that's been recorded in memory
since `Rider.stripeCustomerId` first landed. Surfaced by a real-user
tip-flow report ("Connection trouble — your tip didn't go through")
and traced to the deployed `processPaymentForTrip` Cloud Function
hard-requiring `passenger.stripeCustomerId` (validator at
`yeride-functions/lib/payments.js:43-45`) plus reading
`passenger.defaultPaymentMethod` as an `{id, type}` object (server
calls `tripData.passenger.defaultPaymentMethod?.id` for
`/direct-charge`'s `paymentMethodId` argument and
`tripData.passenger.defaultPaymentMethod?.type` for cash-vs-card
branching). Trip writes from the rewrite never satisfied either —
`PassengerSnapshot` had no `stripeCustomerId` field at all and wrote
`defaultPaymentMethod` as a bare id string. Failure modes spanned:
(a) `tipDriver` callable returning `code: 'internal'` → mapped to
`NetworkError` → "Connection trouble" banner (the loud failure that
surfaced this); (b) `onTripUpdated` Firestore trigger calling
`processPayment(event)` on both `'payment_requested'` and
`'completed'` status flips, with the catch block intentionally NOT
flipping to `payment_failed` ("let webhook be authoritative") —
silent failure leaving every rewrite-completed trip with a stranded
`payment.error` field, the receipt UI showing "Total updates as soon
as your charge clears." indefinitely, and the driver unpaid (the
silent and most consequential mode); (c) `cancelTrip` callable
returning `code: 'internal'` for late-rider / mid-trip cancellation
paths that incur a Stripe charge. The fix touches five files across
the four layers: `PassengerSnapshot.ts` (entity gains
`stripeCustomerId: StripeCustomerId | null` and changes
`defaultPaymentMethod` shape from `string | null` to
`PassengerPaymentMethod | null` where `PassengerPaymentMethod = {id:
PaymentMethodId; type: 'card' | 'cash'}`); `RideDoc.ts`
(`PassengerDocSchema` gains the new field; the
`PassengerDefaultPaymentMethodSchema` preprocess accepts three
on-disk shapes — canonical `{id, type}`, legacy yeride's full Stripe
`PaymentMethod` object, and rewrite-pre-Turn-5 bare-string
back-compat — and emits canonical only); `rideMapper.ts`
(`passengerToDomain` parses both fields defensively with
`LOG.warn` + null fallback on malformed ids, mirroring `userMapper`'s
contract; `passengerToDoc` writes canonical wire shape); the
RouteSelect VM (plumbs `user.stripeCustomerId` and `{id:
defaultPaymentMethodId, type: 'card' as const}` into
`PassengerSnapshot.create`; trims three of four gap-warning blocks,
keeping only the soft "rider has no card on file" warning since the
legacy app surfaces the same UX). Twenty-four test files updated:
the three fixture-using files
(`PassengerSnapshot.test.ts` / `rideMapper.test.ts` / `Ride.test.ts`)
got new `{id: PaymentMethodId.create(...), type: 'card'}` +
`stripeCustomerId: StripeCustomerId.create(...)` fixtures, the other
twenty got a single-line `stripeCustomerId: null,` addition (done
via one `perl -i -0pe` sweep against the
`avatarUrl: null,\n    defaultPaymentMethod: null,` pattern). Six
new tests added — three on `PassengerSnapshot.test.ts` (cash-typed
path) and five on `rideMapper.test.ts` (canonical round-trip,
legacy object form, bare-string back-compat, two malformed-id
fallbacks). End-of-Turn-5 acceptance: **180 suites / 1525 tests**
(+0 suites / +6 tests over Turn 4's 180/1519). Typecheck, lint,
format, and test all green. **No native rebuild required** for Turn
5 — pure JS/TS work; no new dependencies; no plugin patches.
Pre-Turn-5 trip docs (`yeapp-stage` trips currently with stranded
`payment.error`) won't auto-recover; documented option is to write
them off as test data and rely on the cutover to fresh `yeapp-prod`
since the legacy yeride co-existence rule still holds for going-
forward writes (legacy reads our canonical `{id, type}` shape via
its existing dual-read path; rewrite reads legacy's full-object
shape via the DTO preprocess).

**Phase 9 Turn 4 closed.** DriverNavigation polish + SDK telemetry,
spending the rawMeta channel that Turn 6 landed. Two ships, both
in-band of the kickoff scope. (1) `useDriverMonitorViewModel`'s
foreground location push effect (lines ~263-289 of the pre-Turn-4
file: `lastWrittenCoordsRef` ref + the `useEffect` that deduped a
per-coordinate write to `locations/{userId}`) is removed. The
`useUpdateLocationMutation` import + the `useCurrentUserId` import +
the `UserLocation` + `Coordinates` imports + the `driverLocation`
arg field on `DriverMonitorViewModelArgs` all go with it; the
`DriverMonitorScreen` call site updates to `useDriverMonitorViewModel({
rideId })`. The Phase 7 Turn 2 `useGpsLifecycle` hook (mounted exactly
once at AppContent) is now the single source of location writes — its
location-subscription path fires `useUpdateLocationMutation.mutate(...)`
per SDK delivery, gated by AppContent's `enabled` predicate (driver
with `stripeChargesEnabled && stripePayoutsEnabled`) which already
covers the same window the legacy `gpsStart(200)` gate did. The
harmless double-write that landed in Phase 7 is gone with no
end-user-visible behavior change. The VM JSDoc renumbers paragraphs
(was 7, now 6) and gains a closing paragraph documenting the
lifecycle hand-off. (2) Five chain-fatal `logger.warn` sites flip to
`logger.error` so the rawMeta channel fans them out to `recordError`:
nav VM lines 202 (`setDestinations failed`) / 213 (`non-OK route
status`) / 225 (`startGuidance failed`) + monitor VM lines 418 (`terms
dialog failed`) / 434 (`navigation init failed`). Four of the five
already passed `Result.err.error` (a `DomainError`) so reference
identity flows directly through to `recordError`. The fifth (`non-OK
route status`) constructs an `Error` at the LOG site
(`new Error(\`navigation_route_status: ${status}
(subKind=${subKind})\`)`) so Crashlytics can group reports by the
underlying `NavRouteStatus`value. Cleanup-best-effort sites (teardown`stopGuidance`/`cleanup`errors at nav VM lines 278 / 282) and the
deliberate-user-choice site (terms-declined-by-user at monitor VM line
428) intentionally stay at their existing levels — declining is not
an error, and teardown failures don't affect the next trip. Each new`LOG.error`site has a regression test (3 nav VM + 2 monitor VM) that
attaches a`CrashlyticsLogTransport`to the singleton`LOG`, drives
the VM through the failure path, and asserts on
`fakeCrash.getRecordedErrors()`— proves reference identity (or
constructed-Error message substring for the route-status site) AND the
correct`name` field (`'YeRide:DriverNavigationVM'`/`'YeRide:DriverMonitorVM'`). Pattern mirrors `Logger.test.ts:244-267`.
The `useNavigationSdkConnector`hook was audited and found to have no
error paths — pure controller bridge with two debug-level
breadcrumbs, intentionally untouched. End-of-Turn-4 acceptance:
**180 suites / 1519 tests** (+0 suites / +4 tests over Turn 6's
180/1515 — 5 new telemetry tests minus 1 dropped foreground-push
dedup test; at the lower end of the kickoff's "+3 to +9 tests"
estimate band). **No native rebuild required** for Turn 4 — pure
JS/TS work; no new dependencies; no plugin patches. Manual smoke
checklist for the user is documented in`docs/PHASE_9_TURN_4.md` §
"Smoke checklist (user-driven)" — confirms the foreground-push
removal didn't regress driver-monitor map polylines / pickup-geofence
flip / odometer reads.

**Phase 9 Turn 6 closed.** Observability cleanup grab-bag covering
the two follow-ups Turn 3's close logged. (1) The
`recordError`-via-`LOG`-sanitize gap surfaced in 3b is fixed by a
parallel `rawMeta` channel through the logger pipeline:
`LogTransport.log` extends additively from `(level, scope, message,
meta?)` to `(level, scope, message, meta?, rawMeta?)`; `Logger.write`
passes the original (un-sanitized) `meta` through as `rawMeta` so
`CrashlyticsLogTransport.extractError(rawMeta ?? meta)` survives the
`sanitizeForLogging` step that strips `Error` instances to plain
`{name, message, stack}` objects. `ConsoleTransport` ignores
`rawMeta` (text output must not leak PII). The kickoff considered
preserve-Error-through-sanitize and audit-and-fix-call-sites; the
parallel-channel won because (a) creates a real PII leak surface
(`error.message` on Stripe / Cloud Function rejections embeds
tokens + URLs) and (c) is brittle (silent regression on every new
`LOG.error('scope', e)` site). Headline regression test in
`Logger.test.ts` proves end-to-end: `LOG.error('scope',
errorInstance)` reaches `recordError` with reference identity
preserved (pre-fix this test would fail). (2) `<ErrorBoundary/>`
shipped at `src/presentation/components/error/ErrorBoundary.tsx` —
function-component wrapper around an inner class component
(React's `componentDidCatch` is class-only). Wrapper reads
`useCrashReporting()` and passes the adapter into the class as a
prop. `componentDidCatch` fires
`crashReporting.recordError(error, 'ErrorBoundary')` + a
`crashReporting.log(...)` breadcrumb carrying the React component
stack; both wrapped in try/catch + LOG-fallback so a synchronous
SDK throw doesn't break the fallback render. Reset semantics: the
"Try again" CTA bumps a `resetCount` in the wrapper passed as `key`
to the inner class — React responds by unmounting + remounting,
clearing `caughtError` and re-rendering children fresh
(React-recommended pattern over conditionally clearing internal
state). Mounted in `App.tsx` between `<ContainerProvider/>` and
`<AppContent/>` (so `useCrashReporting()` resolves) — documented
trade-off: a throw inside the container's `useMemo` would land
above the boundary, acceptable since `buildContainer()` has no
failure modes today. Fallback UI hides debug details
(`error.name: error.message`) in production builds — only `__DEV__`
shows them. Opportunistic third ship: ESLint
`boundaries/element-types` migrated to v6 `boundaries/dependencies`
with the new object-selector schema (same five `from → allow`
rules, same enforcement semantics) — silences the deprecation
warning that's been emitted since the v6 plugin upgrade in Phase 9
Turn 1. Acceptance: **180 suites / 1515 tests** (+1 suite / +16
tests over Turn 3 close at 179/1499 — at the lower end of the
kickoff's "+2 to +4 / +15 to +25" estimate band; most new tests
landed in the existing logger suites rather than new ones).
Brittle-React-double-invocation note in the "if children still
throw after Try again" test: assert
`recordErrorCalls > initialCount` rather than `=== 2` because
React 19 in dev may double-invoke `componentDidCatch` to surface
buggy error-handling logic. **No native rebuild required** for
Turn 6 — pure JS/TS work. RNFirebase modular-API migration
deferred per kickoff Q3 (its own turn or Phase 10 cutover prep).

**Phase 9 Turn 3 closed.** Sub-turn 3c shipped the only piece of UI
surface in the entire turn: a `<DevToolsSection/>` component with
three buttons (Toggle Crashlytics collection on / Record non-fatal
error / Force crash) wired to `useCrashReporting()` directly,
mounted under both rider and driver Activity placeholder screens
and gated on `__DEV__` (production builds drop the section via
early-return — buttons never reachable outside a dev / dev-client
build). All four kickoff pre-checklist decisions landed on the
recommended option: inline section in BOTH placeholders (rider AND
driver smoke without role-switching), in-app collection toggle
button (no rebuild for the dev smoke), Debug build OK (Release-only
dSYM symbolication is a Phase 10 cutover concern), iPhone real
device + Pixel emulator. The `<DevToolsSection/>` is the single
documented exception to the `<ContainerProvider/>` JSDoc's "screens
and view-models DO NOT consume `useCrashReporting()` directly" rule
— direct invocation of the SDK methods is the entire point. The
force-crash button calls `crashReporting.crash()` with no
confirmation dialog (the SDK is intentionally unrecoverable after
`crash()`); the fake's `crash()` flips a `crashed: true` flag
instead of throwing so Jest tests can assert via `didCrash()`
without the worker dying. End-of-3c delta: **+3 suites / +9 tests**
(176/1490 → ~181/~1516). **No native rebuild required** for 3c —
pure JS/TS work; the 3a SDK plugin block + the
`withCrashlyticsUploadSymbols` plugin already landed during 3b
verification (verified at session start: `Podfile.lock` contains
`FirebaseCrashlytics 12.10.0` + `RNFBCrashlytics 24.0.0`; pbxproj
contains the Release-only `[firebase_crashlytics] Upload dSYMs`
build phase). Manual Firebase Console smoke is user-driven and runs
after this commit lands (steps documented in
`docs/PHASE_9_TURN_3.md` § "Manual smoke (deferred to user)").
**Combined Turn 3 delta**: +8 suites / +108 tests across the three
sub-turns (Turn 2 close 169/1391 → Turn 3 close ~181/~1516). The
recordError-via-LOG-sanitize gap surfaced in 3b is logged for Turn
6 cleanup; the global error handler (3b) covers the most common
case (uncaught throws bypass the logger sanitize), so the gap
doesn't affect 3c's smoke coverage. **Smoke finding (May 3 2026,
Debug build on real iPhone)**: the "Force crash" button taps DO
reach the SDK (4 deprecation warnings for `crash` confirm the
adapter call path), BUT the app keeps running because RN's Debug
bridge wraps every `RCT_EXPORT_METHOD` call in a `@try/@catch`
that captures the SDK's `@throw [NSException ...]` from
`crashlytics().crash()` and routes it to the redbox instead of
letting it propagate to the OS crash handler. Known RN-on-Debug
limitation, not a wiring bug — Release builds don't have this
catch and the @throw kills the process normally. Decision: defer
fatal-crash verification to Phase 10's Release-build cutover; the
non-fatal `recordError` path proves the entire upload pipeline
(buffers locally + uploads on its own pipeline, not via @throw),
and verifying that one user-driven step closes the smoke. Full
finding + Phase 10 follow-up considerations documented in
`docs/PHASE_9_TURN_3.md` § "Manual smoke result — Debug-build
force-crash limitation".

**Phase 9 turn 3 sub-turn 3b shipped.** The 3a Crashlytics SDK seam
now has live consumers. New presentation-layer hook
`useCrashReportingLifecycle({user, env})` mounted once at AppContent:
fires `setCollectionEnabled(!__DEV__)` on first mount (one-shot via
`useRef` guard), then `setUserId(user.id)` + `setAttributes({role,
env})` on each identity transition (composite-key dedup of `<id>|<env>`
so an env-toggle for the same user re-tags cleanly), and
`setUserId(null)` on sign-out. New sibling hook
`useGlobalErrorHandler` (kickoff decision (c)) wraps
`ErrorUtils.setGlobalHandler` to fire
`crashReporting.recordError(error, 'GlobalErrorHandler')` (and
`crashReporting.log('Fatal JS error')` when `isFatal === true`)
before chaining to the previous handler — synchronous cleanup
restores the previous handler on unmount. `<ContainerProvider/>`
gained a `value`-keyed runtime-attachment hop:
`LOG.addTransport(new CrashlyticsLogTransport(value.crashReporting))`
on mount, `LOG.removeTransport(transport)` on cleanup; safe in
fakes-only builds (the fake records breadcrumbs to memory). Three
deviations from the kickoff prediction: (a) **no ESLint
boundaries-rule override needed** — the `CrashReportingService`
interface lives in `@domain/services`, not `@data/services`, so
neither hook crosses a layer boundary (precedent: Phase 9 Turn 2's
`usePushTokenRegistration` follows the same shape, no override);
(b) lifecycle args are object-style (`{user, env}`) for parity with
`useGpsLifecycle`'s `UseGpsLifecycleArgs`; (c) the global error
handler is a sibling hook rather than inline in AppContent. Real
production gap surfaced and logged for Turn 6 cleanup: the
`CrashlyticsLogTransport`'s `recordError` fan-out path can't fire
through the `LOG.error(...)` pipeline because `Logger.write` runs
`sanitizeForLogging(meta)` which converts `Error` instances to plain
`{name, message, stack}` objects before the transport's
`extractError` sees them — so `instanceof Error` fails. Breadcrumb
fan-out works fine; only `recordError` is affected. The transport's
own unit tests bypass the logger (call `transport.log(...)`
directly), which is why this was missed in 3a. Either fix in Turn 6
by preserving `instanceof Error` through sanitize (PII risk on
`error.message`), passing a parallel un-sanitized meta channel, or
having call sites that want recordError fan-out call the adapter
directly via `useCrashReporting()`. End-of-3b delta: **+3 suites
/ +23 tests** (173/1467 → 176/1490). **No native rebuild required**
for 3b — pure JS/TS work; the prebuild requirement still stands for
3c. Sub-turn 3c (dev-only force-crash entry point + manual Firebase
Console smoke against `yeapp-stage`) closes Phase 9 Turn 3.

**Phase 9 turn 3 sub-turn 3a shipped.** Crashlytics SDK seam fully wired
behind a single composition-root, Container-mounted slot. The
`CrashReportingService` domain interface (6 methods: collection
toggle / user id / attributes / record-error / log breadcrumb / sync
force-crash); the real `FirebaseCrashlyticsAdapter` (three-state lazy
singleton cache with sticky-failure mode; 5 mapped error codes); the
programmable `FakeCrashReportingService` (seed/spy/failNext/reset
seams); the multi-transport `Logger` refactor (new `CompositeTransport`

- `addTransport`/`removeTransport` so the Crashlytics transport can
  attach at runtime once the DI container resolves); the
  `CrashlyticsLogTransport` (every level → breadcrumb buffer; error
  level + Error meta → `recordError`; failure-isolated `void` async
  fan-out). Custom keys are `role` + `env` (legacy parity, NOT
  service-area / vehicle id as the kickoff guessed). Native config:
  `@react-native-firebase/crashlytics@^24.0.0` (matches the existing
  RNFirebase 24.x stack), the SDK Expo plugin block + the ported
  `plugins/withCrashlyticsUploadSymbols.js` (Release-only Xcode build
  phase running `${PODS_ROOT}/FirebaseCrashlytics/run`). Container slot
  unobserved by every consumer until 3b, so a fake-backed production
  wiring is safe — every Container code path is exercised today.
  End-of-3a delta: **+4 suites / +76 tests** (169/1391 → 173/1467).
  **`npm run prebuild` is required before the next iOS / Android build**
  so the SDK plugin's native config lands (iOS dSYM upload phase +
  Android FCM `firebase_crashlytics_collection_enabled` manifest meta).
  Sub-turns 3b (lifecycle hook + `<ContainerProvider/>` runtime
  attachment + global JS error handler) and 3c (dev-only force-crash
  entry point + manual smoke against Firebase Console) still pending.

**Phase 9 turn 2 shipped.** Push notifications operational end-to-end.
Three sub-turns: 2a wired the domain + data plumbing for `pushToken`
(branded value object, `PushNotificationService` interface, fake,
DI seam, snapshot-builder VMs sourcing from `user.pushToken` instead
of baking `null`); 2b installed `expo-notifications@~55.0.22`, built
the real `ExpoNotificationsAdapter`, shipped `RegisterPushToken` use
case + `usePushTokenRegistration` hook + `NotificationPermissionSheet`
soft-ask UX; 2c shipped `HandleNotificationResponse` use case +
`useNotificationResponseHandler` hook + tap routing via the shared
`navigationRef`. The deployed `yeride-functions/lib/notifications.js`
needs zero changes — it routes Expo-wrapped tokens via
`Expo.isExpoPushToken()`, and the rewrite emits Expo-wrapped tokens
exactly the way legacy yeride does (`getExpoPushTokenAsync({projectId})`
against EAS project `yeride-next`, projectId
`adb0a788-bf99-4a60-9424-f23266127854`). Real-device smoke on iPhone
17 simulator against `yeapp-stage` proved registration writes the
token to `users/{uid}.pushToken` within seconds of sign-in
(`Container using ExpoNotificationsAdapter` log line confirms env-aware
DI selection of the real adapter over the fake fallback). End-of-Turn-2
delta: **+8 suites / +117 tests** (161/1274 → 169/1391). **`npm run
prebuild` is required before the next iOS / Android build** so the
`expo-notifications` plugin's native config (iOS `aps-environment`
entitlement, Android FCM default-icon meta-data, `'remote-notification'`
in `UIBackgroundModes`) lands. Manual two-device delivery + tap-routing
smoke is still the user's local validation step (iOS sim doesn't
deliver pushes — the registration half is what's proven so far).

**Phase 9 turn 1 shipped.** First Phase 9 turn lands the iOS Apple
Maps Fabric escape that closed Phase 8 surfaced. The rewrite's
`<Map/>` now uses `provider={PROVIDER_GOOGLE}` on both platforms
(was `provider={Platform.OS === 'ios' ? undefined : 'google'}`); under
Expo SDK 55 + RN 0.83.6 New Arch, the react-native-maps@1.24 Apple
Maps view manager (`AIRMap`) doesn't get picked up by the Fabric →
Paper interop, leaving every iOS map screen rendering a pink
"Unimplemented component: <RNMapsMapView>" placeholder. Switching to
the Google view manager (`AIRGoogleMap`) sidesteps the registration
failure entirely. To make it compile + register, `plugins/withNavigationSdk.js`
gained: (a) a three-branch Podfile mod that emits
`pod 'react-native-maps/Google', :path => '../node_modules/react-native-maps'`
(replacing the previous strip-only behavior — the strip was correct
about Expo's emit being broken but never provided a working
replacement); (b) iOS podspec patch path corrected from the
no-longer-existing `react-native-google-maps.podspec` to the unified
`react-native-maps.podspec` so the upstream `GoogleMaps '9.3.0'`
inside the Google subspec actually gets bumped to `10.7.0` (matching
the Navigation SDK's pin); (c) `eventPatchFiles` list extension
fixing stale `.m` extensions to `.mm` for AirGoogleMaps Manager +
Map and adding the missing `AirMaps/AIRMap.mm` (silent Phase 8 no-op
that would have surfaced as a runtime bridge-event mismatch once the
Google subspec activated); **(d) react-native-maps' `package.json`
`codegenConfig.ios.componentProvider` patched to add the 4 missing
Fabric component mappings (`RNMapsMapView`, `RNMapsGoogleMapView`,
`RNMapsMarker → RNMapsMarkerView`, `RNMapsGooglePolygon → RNMapsGooglePolygonView`).
This is the bit that actually makes Fabric register the components
at runtime — without it, the app's auto-generated
`RCTThirdPartyComponentsProvider.mm` lists Stripe / screens /
safe-area / nav-sdk components but contains zero entries for
react-native-maps, and `NSClassFromString` returns nil for both
Apple and Google view managers regardless of which subspec is
compiled in.** Surfaced during the first device-build attempt: with
only (a)-(c) in place, the iOS sim still rendered the placeholder
but with the component name flipped from `<RNMapsMapView>` to
`<RNMapsGoogleMapView>` (proving the JS provider flip worked but
the runtime registration was still empty). Also added
`__mocks__/react-native-maps.tsx` as a manual Jest mock so consumer
tests can render `<Map/>` — inline `jest.mock` factories inside
`.tsx` test files collide with NativeWind's babel plugin's
`_ReactNativeCSSInterop` injection, but manual mocks at
`<rootDir>/__mocks__/<pkg>` bind correctly. **`npm run prebuild` is
required** before the next iOS / Android build so the package.json
patch (along with the Podfile emit and podspec patch) re-applies;
the user must then run `(cd ios && pod install)` locally to
regenerate the codegen output (`RCTThirdPartyComponentsProvider.mm`)
with the new componentProvider entries, plus a clean Xcode build
before `npm run ios` to relink with the regenerated codegen. Phase 9
turn 1 delta: **+1 suite / +6 tests** (3 new Map.test.tsx tests + 3
surplus from previously intermittent tests stabilizing under the
global mock), lands at **161 suites / 1274 tests** (Phase 8 close
160/1268 → Phase 9 turn 1 161/1274).

**Phase 8 closed.** Across three turns Phase 8 shipped the full
driver-side Google Navigation SDK integration: the data-layer SDK
seam + adapter + fake + DI wiring + custom Expo plugin (turn 1) →
the App-root `<NavigationProvider/>` mount + `useNavigationSdkConnector`

- 5-arm `useDriverNavigationViewModel` + `DriverNavigationScreen` +
  "Open Navigation" CTAs on EnRouteToPickupView / StartedView (turn 2)
  → first device-build smoke driving the whole flow end-to-end on
  iPhone 17 simulator + Pixel 10 Pro emulator against `yeapp-stage`
  Firestore (turn 3). Net delta across the phase: **+10 suites / +97
  tests** (152/1171 → 160/1268). Three Phase-3 latent bugs that
  escaped unit-test coverage were surfaced and patched as the smoke
  exercised the real Cloud Functions and on-disk doc shapes:
  `CloudFunctionsService.cancelTrip` was sending `code` while the
  deployed function reads `reason`; the rewrite's `RideDocSchema`
  didn't accept the legacy flat cancel-doc shape (status
  `'passenger_canceled'` + top-level string `cancelReason`); and
  `useCurrentLocation` blocked on a fresh GPS fix that the
  FusedLocationProvider doesn't always promote from a single
  Extended-Controls injection. Each fix carries regression coverage.
  **No native plugin patches were required beyond Turn 1's set** —
  the legacy patch reservoir (Firebase BoM 34.0.0 pin, Compose
  Compiler classpath, kotlin-stdlib 2.0.21 force) was inspected and
  intentionally not ported (the kotlin-stdlib force is explicitly
  NOT to be ported under Expo SDK 55 — see plugin JSDoc).

**Phase 8 turn 3 shipped.** Manual end-to-end smoke driven on a
real device: signed-in driver accepts a real `awaiting_driver`
ride from `yeapp-stage` Firestore → DriverMonitor renders with
the green driver→pickup polyline → "Open Navigation" tapped on
EnRouteToPickupView → terms dialog displays on first launch (Turn
2's `<NavigationProvider/>` config working) → driver accepts →
`<NavigationView/>` mounts full-screen with turn-by-turn voice
guidance → simulated drive to pickup → arrival auto-pops back to
DriverMonitor (1.2s arrival overlay shows before `goBack`) →
AtPickupView displays (Phase 7 turn 3's geofence auto-flip held)
→ Start ride → second `<NavigationView/>` for the dropoff leg
with the rider's selected `routeToken` forwarded → arrival
auto-pops → Request payment. The full driver navigation surface
proved out against the real SDK with the legacy-faithful init+terms
chain ordering in `useDriverMonitorViewModel.onLaunchNavigation`.
Caveat: iOS has a separate Apple Maps Fabric registration regression
(`<RNMapsMapView>` unimplemented across every screen using
`<Map/>`); the Phase 8 nav surface uses `<NavigationView/>` (Google
Navigation SDK's own native view, separate from `react-native-maps`)
so it doesn't block. Phase 9 follow-up logged. Phase 8 turn 3
delta: **+0 suites / +8 tests** (each incidental fix carries its
own regression coverage), lands at **160 suites / 1268 tests**.

**Phase 8 turn 2 shipped.** The driver Google-Navigation surface is
end-to-end now. `<NavigationProvider/>` is mounted at App root with
the legacy terms-dialog config + `TaskRemovedBehavior.CONTINUE_SERVICE`
(matches legacy yeride). The new `useNavigationSdkConnector` hook is
mounted exactly once on `DriverMonitorScreen` — it calls the SDK's
`useNavigation()` context hook to read the shared
`{navigationController, ...listenerSetters}` and pushes them into
`NavigationSdkClient` via `setController`. On unmount it pushes
`{controller: null, listeners: null}` to disconnect. The connector is
deliberately scoped to DriverMonitor (not lifted to AppContent) so the
adapter stays disconnected for non-driver flows. The new
`useDriverMonitorViewModel.onLaunchNavigation()` runs the
legacy-faithful init+terms chain (`navigationSdk.init()` → on
`'navigation_terms_not_accepted'` show dialog → on accept retry init
→ on init success `navigation.navigate('DriverNavigation', ...)`)
BEFORE pushing the navigation screen — sidesteps the legacy
`getCurrentActivity()` null-after-`<NavigationView/>` Android quirk.
Init failures (other than user-declined terms) surface a Toast warn;
no external-Maps fallback this phase. The new
`useDriverNavigationViewModel` is a 5-arm tagged-union state machine
(`uninitialized | initializing | guiding | arrived | error` with 5
error sub-kinds) that runs `setDestinations` → `startGuidance` after
the screen flips `onMapReady`, surfaces the full `NavRouteStatus` →
`error.subKind` mapping, auto-flips to `'arrived'` on
final-destination arrival, and exposes `onEndNavigation` + `onRetry`
(retry uses a `retryNonce` dep tick to re-trigger the chain effect
without listing `state.kind` as a dep — the latter created a
self-cancelling race the test suite caught on first run). The new
`DriverNavigationScreen` hosts `<NavigationView/>` filling the
viewport, a bottom-pinned "End Navigation" CTA, a `<StateOverlay/>`
during non-guiding arms (spinner / error+retry / brief "Arrived"
panel), and an auto-pop `useEffect` keyed on `vm.hasArrived` that
schedules `navigation.goBack()` after a 1.2s delay (guarded by a
`hasNavigatedAwayRef` against double-pop). `EnRouteToPickupView`
(pickup leg) and `StartedView` (dropoff leg) gain "Open navigation"
CTAs gated on `isLaunchingNavigation`; the dropoff-leg path forwards
`ride.routePreference?.routeToken` (when present) to the SDK so the
rider's Routes-API selection drives turn-by-turn. Phase 8 turn 2
delta: **+5 suites / +47 tests** over Turn 1's 155/1213 (+8 suites /
+89 tests over Phase 7's close at 152/1171), lands at **160 suites /
1260 tests**. **No native config changes** this turn (Turn 1's
`withNavigationSdk.js` plugin landed everything); `npm run prebuild`
is a no-op for this turn's scope.

**Phase 7 closed.** Across three turns Phase 7 brought the full
background-GPS pipeline online: the single SDK seam
(`BackgroundGeolocationClient` + 11-method fake) + Android Maven
plugin patch (turn 1) → AppContent-only `useGpsLifecycle` hook +
`useGpsStore` Zustand mirror + pickup-geofence registration driven
by a live `observeRide` overlay (turn 2) → rider banner event-driven
off `useGpsLastGeofenceEvent`, driver `arrivedAtPickup` derived from
`useGpsIsInsidePickupGeofence()`, real-odometer reads from
`useGpsCurrentOdometer()` powering Start ride + Request payment
(turn 3). Net delta across the phase: **+6 suites / +78 tests**
(146 → 152, 1093 → 1171). Legacy footguns avoided: synchronous
unsubscribe (no async cleanup), listener-level dedup of the SDK's
2-3× delivery, deferred view-model swap-ins until the lifecycle
contract was stable.

**Phase 7 turn 3 shipped.** The two view-models that have been
carrying placeholder geofence / odometer plumbing since Phase 3
(rider) and Phase 4 (driver) are now fully wired to the live GPS
pipeline. `useRideMonitorViewModel`'s `EvaluateExitWarning`
foreground-tick is gone; in its place a single `useEffect` keyed on
`useGpsLastGeofenceEvent()` flips
`useGeofenceUiStore.pickupExitWarningVisible` based on
`'pickup'`-identifier ENTER / EXIT events, with a `timestampMs`-keyed
`useRef` replay guard and a status gate that only fires while
`status === 'dispatched'`. `useDriverMonitorViewModel.arrivedAtPickup`
is now derived: `useGpsIsInsidePickupGeofence() || manualOverride`.
The manual override stays as resilience (GPS drift, cellular dead
zones) and sticks across a subsequent EXIT once flipped, so a
transient drift mid-pickup doesn't bounce the UI back to en-route;
the override resets when the ride leaves `'dispatched'`. The
`stubOdometerMeters` helper is retired — `useGpsCurrentOdometer()`
feeds both `Start ride` and `Request payment` mutations, so the
Cloud Function's fare math sees real GPS distance instead of
`pickup + 1`. The `useCurrentLocation` foreground hook stays in
place (RiderHome / DriverHome / RouteSearch still use it for the
initial map centre); the rider VM just no longer imports it.
Documented deferral: the driver VM's own `lastWrittenCoordsRef`-
deduped foreground location push (lines 218-248) now overlaps with
the lifecycle hook's per-delivery write — a harmless double-write
that Phase 9 polish can clean up after field telemetry on the
SDK-driven path lands. Phase 7 turn 3 delta: **+0 suites / +9
tests** (both swaps land in existing test files), lands at
**152 suites / 1171 tests** (Turn 2 close 152/1162 → Turn 3
152/1171).

**Phase 7 turn 2 shipped.** The single GPS-aware presentation hook
(`useGpsLifecycle`) is mounted exactly once at AppContent. The
SDK lifecycle (init / permission / start / stop), the location and
geofence subscriptions, the pickup-geofence (re-)registration, and
the synchronous chain-ordered teardown all live inside one
`AppContent.tsx`-only hook. View-models read GPS state via cheap
`useGpsStore` selector hooks (`useGpsCurrentLocation`,
`useGpsCurrentOdometer`, `useGpsLastGeofenceEvent`,
`useGpsIsInsidePickupGeofence`, `useGpsPermissionStatus`). The
`enabled` predicate mirrors the legacy `gpsStart(200)` gate: rider
with `defaultPaymentMethodId !== null`, driver with
`stripeChargesEnabled && stripePayoutsEnabled`. Location events fan
out to `useUpdateLocationMutation.mutate(UserLocation)` (no JS-side
debounce — SDK's `distanceFilter: 200` is the rate limiter). A new
sibling `useActiveRideForGeofence(user)` hook discovers the active
ride via the role-appropriate `useInProgressRideQuery` /
`useInProgressDriverRideQuery` and overlays a live `observeRide`
subscription so a status flip (`'dispatched' → 'started'`)
reactively swaps the geofence in / out. Sign-out resets
`useGpsStore` (canonical reset point). The new `useBackgroundGeolocation()`
hook in `@presentation/di` is the sibling of `useUseCases()` —
exclusively consumed by `useGpsLifecycle`. ESLint boundaries-rule
override extended to include the two presentation-layer SDK seams
(`useGpsLifecycle.ts` + `useGpsStore.ts`) alongside the existing
`presentation/di/container.ts` exception. Phase 7 turn 2 delta:
**+4 suites / +38 tests**, lands at **152 suites / 1162 tests**
(Turn 1 close 148/1124 → Turn 2 152/1162). No view-model swap-ins
this turn — Turn 3 swaps `useRideMonitorViewModel`'s foreground
geofence tick for `useGpsLastGeofenceEvent()`, auto-flips
`useDriverMonitorViewModel.arrivedAtPickup` from
`useGpsIsInsidePickupGeofence()`, and replaces `stubOdometerMeters`
with `useGpsCurrentOdometer()`.

**Phase 7 turn 1 shipped.** The single SDK seam over
`react-native-background-geolocation@4.19.4` is in. Eleven methods
(`init`, `start`, `stop`, `addPickupGeofence`, `removePickupGeofence`,
`removeAllGeofences`, `subscribeToLocation`, `subscribeToGeofence`,
`getOdometer`, `resetOdometer`, `requestAuthorizationIfNeeded`,
`removeAllListeners`) all `Result`-returning, all listener-deduped
internally (the SDK fires events 2-3× per crossing — adapter dedupes
by `(lat,lng,ts,odometer)` for location and `(identifier,action,rideId)`
for geofences). Bare `'pickup'` identifier with `extras.rideId`
(legacy parity, kickoff decision C). `FakeBackgroundGeolocationClient`
mirrors the real surface 1:1 with `seed*` / `emit*` / `failNext` /
`spies` seams. Container exposes `bgGeolocation` alongside `useCases`;
`TestContainerProvider` gains an optional `bgGeolocation?: FakeBackgroundGeolocationClient`
prop. `jest.setup.ts` carries a global SDK mock with a per-bucket
listener registry (`__emitLocation` / `__emitGeofence` test helpers).
A custom Expo config plugin `plugins/withBackgroundFetchMaven.js`
injects `${project(':react-native-background-fetch').projectDir}/libs`
into `android/build.gradle`'s `allprojects.repositories` block —
required because the SDK's own plugin only registers its own libs/
flatdir, and modern npm hoists the sibling `react-native-background-fetch`
to top-level `node_modules/`. Without that plugin,
`app:processDebugResources` fails with "Could not find
com.transistorsoft:tsbackgroundfetch:1.0.4". `BG_GEOLOCATION_LICENSE_KEY`
plumbed via the Expo plugin block at BUILD time only (kickoff decision
A — no runtime read; SDK degrades to time-limited debug mode without).
**`npm run android` succeeds** on a Pixel 10 Pro emulator post-prebuild
with the new plugin block + Maven plugin patch in place. Phase 7
turn 1 delta: **+2 suites / +31 tests**, lands at **148 suites / 1124
tests** (Phase 6 close 146/1093 → Turn 1 148/1124).

**Phase 6 closed.** Across five turns Phase 6 added the entire
payments / Stripe Connect / tipping surface: branded Stripe IDs +
payment value objects + `StripeServerService` interface (turn 1) →
`StripeServerHttpAdapter` + `tipDriver` callable + 13 use cases + DI
wiring (turn 2) → rider Wallet + AddPaymentMethod modal with first
Stripe-SDK surface (turn 3) → driver Earnings + Stripe Connect
onboarding via `expo-web-browser` (turn 4) → tip flow on RideReceipt
(turn 5). Net delta across the phase: **+31 suites / +216 tests**
(115 → 146, 877 → 1093). Legacy yeride co-existence preserved via
dual-read / dual-write on the User-doc Stripe shape in `userMapper`.

**Phase 6 turn 5 shipped.** The tip flow is real now. Riders on a
completed trip see an inline `<TipSelector/>` between the fare
breakdown and the Payment placeholder; pick a $1 / $3 / $5 preset OR a
whole-dollar custom amount up to $99, submit, and watch the local
"Tip $X added — thank you!" banner give way to a live `'tip'`
`TripPayment` row in the fare breakdown once the Cloud Function's
webhook fires. The new `useProcessTipMutation` lives in
`payment.queries.ts` (no cache invalidation — the parent receipt VM's
`useFirestoreSubscription(observeTripPayments)` is the source of
truth). The new `useTipFlowViewModel` is a six-arm tagged union
(`hidden | idle | selected | submitting | submitted | error`) with
local validation ($1 floor, $99 ceiling, whole-dollar) + an
idempotent-submit guard + a structural `instanceof` error classifier
for the four error sub-kinds. `formatMoney` re-homed from
`presentation/features/driver/utils/` to `presentation/utils/` so both
sides import from a neutral location (the old path is a 1-line
re-export shim — virtiofs blocks `unlink()`). `useRideReceiptViewModel`
swapped its one-shot `useRideQuery` for a live
`useFirestoreSubscription(observeRide)` so a `'payment_failed' →
'completed'` flip server-side lights up the selector without a
re-navigation. Phase 6 arc: **+3 suites / +25 tests** this turn,
lands at **146 suites / 1093 tests** (Turn 4's 143/1068 → Turn 5's
146/1093).

**Phase 6 turn 4 shipped.** The driver Earnings tab is real now.
`expo-web-browser@~55.0.14` joined the dep set. A new
`getDeepLinkScheme()` / `buildDeepLink()` helper in `@shared/env` reads
`Constants.expoConfig?.scheme` so the Stripe Connect `returnUrl`
(`{scheme}://stripe-return`) is env-aware. The `payment` query-key
scope grew three new factories (`balance`, `payouts`,
`balanceTransactions` — all keyed on `StripeAccountId`); seven new
TanStack hooks landed in the same `payment.queries.ts` file (the
kickoff Q3 confirmation: keep co-located rather than fork into
`connect.queries.ts`). The new `useStripeConnectOnboarding` hook lives
in a freshly-created `src/presentation/features/driver/hooks/` directory
and orchestrates the multi-step `EnsureConnectAccount → CreateLink →
WebBrowser.openAuthSessionAsync → RefreshConnectAccountStatus` flow,
firing a Toast success on the `pending → enabled` flip. The driver
Earnings tab is now `DriverEarningsScreen` consuming the new
`useDriverEarningsViewModel`'s six-arm tagged-union state
(unconfigured / loading / no_account / pending / enabled / error); the
`'disabled'` arm is intentionally folded into `'pending'` per the
kickoff Q1 confirmation (no backend disabled detection yet). Refresh
strategy: `useFocusEffect` + `AppState 'change' → 'active'` listener +
manual pull-to-refresh, with a `useRef`-stabilized callback to avoid an
infinite update loop under the test mock for `useFocusEffect` (and as
the right invariant in production where `useMutation` returns an
unstable object reference). Express dashboard reach via
`useCreateAccountLoginLinkMutation` + `WebBrowser.openBrowserAsync`.
`DriverEarningsPlaceholderScreen` retained as a deprecation stub —
sandbox virtiofs blocks `unlink()`. Tip flow on RideReceipt remains
pending (Turn 5).

| Phase                       | Scope                                                                                                                                              | Status |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Phase 6 turn 4              | Driver Earnings + Stripe Connect onboarding                                                                                                        | ✅     |
| Phase 6 turn 5              | Tip flow on RideReceipt + Phase 6 cleanup                                                                                                          | ✅     |
| Phase 7 turn 1              | `BackgroundGeolocationClient` adapter + fake + DI                                                                                                  | ✅     |
| Phase 7 turn 2              | `useGpsLifecycle` + AppContent integration                                                                                                         | ✅     |
| Phase 7 turn 3              | RideMonitor + DriverMonitor swap-ins + Phase 7 close                                                                                               | ✅     |
| Phase 8 turn 1              | `NavigationSdkClient` adapter + fake + DI wiring                                                                                                   | ✅     |
| Phase 8 turn 2              | `useDriverNavigationViewModel` + screen + DriverMonitor integration                                                                                | ✅     |
| Phase 8 turn 3              | First device-build smoke (iOS + Android) + Phase 8 close                                                                                           | ✅     |
| Phase 9 turn 1              | iOS Apple Maps Fabric escape — `<Map/>` flipped to PROVIDER_GOOGLE                                                                                 | ✅     |
| Phase 9 turn 2              | Push notifications — Expo registration + tap routing                                                                                               | ✅     |
| Phase 9 turn 3a             | Crashlytics SDK seam — adapter + fake + DI + multi-transport logger                                                                                | ✅     |
| Phase 9 turn 3b             | Crashlytics lifecycle hook + global error handler + transport mount                                                                                | ✅     |
| Phase 9 turn 3c             | Dev-only force-crash entry point + Firebase Console smoke                                                                                          | ✅     |
| Phase 9 turn 6              | rawMeta channel + `<ErrorBoundary/>` + boundaries-rule migration                                                                                   | ✅     |
| Phase 9 turn 4              | DriverNavigation polish + SDK telemetry + foreground-push removal                                                                                  | ✅     |
| Phase 9 turn 5              | Passenger-snapshot Stripe gap close — `stripeCustomerId` + canonical `{id, type}` defaultPaymentMethod shape                                       | ✅     |
| Phase 9 turn 4 smoke fix    | Receipt schema accepts `'payment_intent'` / `'closed'` wire statuses + tipDriver post-completion window patch (cross-repo, deployed)               | ✅     |
| Phase 9 turn 4 smoke fix #2 | `TripPayment.amount` is integer cents, not dollars — manual smoke validated end-to-end                                                             | ✅     |
| Phase 9 turn 7              | Receipt UX polish — card brand + last-4 wallet-cache join + email-button stub removal + shared CardBrandBadge component                            | ✅     |
| Phase 9 turn 8              | GPS lifecycle telemetry — 2 LOG.warn → LOG.error flips routing UserLocation.create + updateLocation-mutation failures to recordError               | ✅     |
| Phase 9 turn 9              | SDK-adapter telemetry — 4 LOG.warn → LOG.error flips in BackgroundGeolocationClient (onLocation error code + invalid coords + 2× subscriber-threw) | ✅     |

**Phase 6 turn 3 shipped.** First Stripe-SDK surface in the rewrite.
`@stripe/stripe-react-native@0.63.0` installed (Expo SDK 55 picked
0.63 over the kickoff's `~0.51` estimate); the SDK's Expo plugin
block plus `stripePublishableKey` `extra` field added to
`app.config.ts`. `<StripeProvider/>` mounted as the outermost provider
in `App.tsx` via a `MaybeStripeProvider` wrapper that no-ops cleanly
when the publishable key is unset (loud `LOG.warn` at boot; Wallet VM
degrades to `'unconfigured'`). Five TanStack hooks
(`useEnsureStripeCustomerMutation`, `useCreateSetupIntentMutation`,
`useListPaymentMethodsQuery`, `useSetDefaultPaymentMethodMutation`,
`useDetachPaymentMethodMutation`) added under a new `payment`
query-key scope. The rider Wallet tab now renders the live list:
`WalletScreen` consumes `useWalletViewModel`'s six-arm tagged union
(unconfigured / loading / no_customer / empty / ready / error) and
renders rows via `WalletCardRow`; per-card `inFlight` Sets keep
set-default vs. detach state independent so a slow mutation on one row
doesn't lock out interaction on another; Alert-confirmed delete pops
three message variants for default-and-only / default-with-siblings /
non-default. The `AddPaymentMethod` modal route was added to
`RiderStackParamList` with `presentation: 'modal'`; the screen wires
`<CardForm/>` and `useStripe().confirmSetupIntent` through
`useAddPaymentMethodViewModel` (lazy `EnsureStripeCustomer` on first
card-add per kickoff decision; `Canceled` from `confirmSetupIntent` is
silent; `card_declined` / `network` / `unknown` error arms with
distinct UX copy). `WalletPlaceholderScreen` is retained as a
deprecation stub — sandbox virtiofs blocks `unlink()`. **`npm run
prebuild` required before the next iOS / Android build** so the Stripe
SDK's plugin mods (entitlements plist + Google Pay AndroidManifest
meta) land. Driver Earnings + tip flow still pending — Turns 4-5.

| Phase                 | Scope                                                                                                                                              | Status                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0                     | Tooling + scaffolding                                                                                                                              | ✅ Complete                    |
| 1                     | Auth + user identity                                                                                                                               | ✅ End-to-end on real Firebase |
| 2                     | Domain + data layer (service area, routes, ride, location, FareCalculator)                                                                         | ✅ End of Phase 2: 422 tests   |
| 3 turn 1              | Phase 3 foundations: domain additions, store scaffolding                                                                                           | ✅                             |
| 3 turn 2              | RouteSearch + RouteSelect screens — rider can pick origin/dest + service tier                                                                      | ✅                             |
| 3 turn 3              | RiderHome + role-based routing, end-to-end ride creation                                                                                           | ✅                             |
| 3 turn 4a             | RideMonitor scaffolding + early-status views (awaiting/dispatched)                                                                                 | ✅                             |
| 3 turn 4b             | Late-status views (started/completed/payment_failed) + chat stub + geofence tick                                                                   | ✅                             |
| 3 turn 5              | RideReceipt + Phase 3 cleanup                                                                                                                      | ✅                             |
| 4 turn 1              | Phase 4 foundations: DriverNavigator + tabs + driver-status store                                                                                  | ✅                             |
| 4 turn 2              | DriverHome — map + ListAvailableRides cards + GPS toggle                                                                                           | ✅                             |
| 4 turn 3              | DriverDispatch — incoming-ride accept/decline                                                                                                      | ✅                             |
| 4 turn 4a             | DriverMonitor scaffold + en-route / at-pickup status views                                                                                         | ✅                             |
| 4 turn 4b             | DriverMonitor late-status views + Start-ride / RequestPayment mutations                                                                            | ✅                             |
| 4 turn 5              | Phase 4 cleanup + CLAUDE.md driver-side fold-in                                                                                                    | ✅                             |
| 5 turn 1              | Vehicle domain + DTO + mappers + in-memory fakes                                                                                                   | ✅                             |
| 5 turn 2              | Real adapters (Firestore + Storage + NHTSA) + 9 use cases + DI wiring                                                                              | ✅                             |
| 5 turn 3              | VehicleList + VehicleRegistration screens                                                                                                          | ✅                             |
| 5 turn 4              | VehiclePhotos + VehicleDetails + retire `'vehicle-stub'`                                                                                           | ✅                             |
| 6 turn 1              | Stripe domain + DTO patch (legacy nested `stripe` shape) + in-memory fake                                                                          | ✅                             |
| 6 turn 2              | `StripeServerHttpAdapter` + `tipDriver` callable + 13 use cases + DI wiring                                                                        | ✅                             |
| 6 turn 3              | Rider Wallet + AddPaymentMethod screens (Stripe SDK, CardForm, setup-intent)                                                                       | ✅                             |
| 6 turn 4              | Driver Earnings + Connect onboarding (`WebBrowser` flow, balance/payouts)                                                                          | ✅                             |
| 6 turn 5              | Tip flow on RideReceipt + Phase 6 cleanup (`useProcessTipMutation`, live ride)                                                                     | ✅                             |
| 7 turn 1              | `BackgroundGeolocationClient` + fake + DI wiring + Maven plugin patch                                                                              | ✅                             |
| 7 turn 2              | `useGpsLifecycle` + AppContent lifecycle + onLocation→UpdateUserLocation                                                                           | ✅                             |
| 7 turn 3              | RideMonitor + DriverMonitor swap-ins + Phase 7 close                                                                                               | ✅                             |
| 8 turn 1              | `NavigationSdkClient` adapter + fake + DI wiring + Expo plugin port                                                                                | ✅                             |
| 8 turn 2              | `useDriverNavigationViewModel` + screen + DriverMonitor integration                                                                                | ✅                             |
| 8 turn 3              | First device-build smoke (iOS + Android) + 3 Phase-3 incidental fixes + close                                                                      | ✅                             |
| 9 turn 1              | iOS Apple Maps Fabric escape — `<Map/>` flipped to PROVIDER_GOOGLE                                                                                 | ✅                             |
| 9 turn 2a             | `PushToken` VO + `pushToken` on User entity + `PushNotificationService` interface                                                                  | ✅                             |
| 9 turn 2b             | `expo-notifications` install + `ExpoNotificationsAdapter` + `RegisterPushToken` + soft-ask                                                         | ✅                             |
| 9 turn 2c             | `HandleNotificationResponse` + tap routing via `navigationRef` + Phase 9 turn 2 close                                                              | ✅                             |
| 9 turn 3a             | Crashlytics SDK seam: domain + adapter + fake + DI + logger refactor                                                                               | ✅                             |
| 9 turn 3b             | `useCrashReportingLifecycle` + AppContent integration + global JS error handler                                                                    | ✅                             |
| 9 turn 3c             | Force-crash dev entry point + Firebase Console smoke + Phase 9 turn 3 close                                                                        | ✅                             |
| 9 turn 4              | DriverNavigation polish + SDK telemetry + foreground-push removal                                                                                  | ✅                             |
| 9 turn 5              | Passenger-snapshot Stripe gap close — `stripeCustomerId` + canonical `{id, type}` defaultPaymentMethod shape                                       | ✅                             |
| 9 turn 4 smoke fix    | Receipt schema accepts `'payment_intent'` / `'closed'` wire statuses + tipDriver post-completion window patch (cross-repo, deployed)               | ✅                             |
| 9 turn 4 smoke fix #2 | `TripPayment.amount` is integer cents, not dollars — manual smoke validated end-to-end                                                             | ✅                             |
| 9 turn 6              | rawMeta channel + `<ErrorBoundary/>` + boundaries/dependencies migration                                                                           | ✅                             |
| 9 turn 7              | Receipt UX polish — card brand + last-4 wallet-cache join + email-button stub removal + shared CardBrandBadge component                            | ✅                             |
| 9 turn 8              | GPS lifecycle telemetry — 2 LOG.warn → LOG.error flips routing UserLocation.create + updateLocation-mutation failures to recordError               | ✅                             |
| 9 turn 9              | SDK-adapter telemetry — 4 LOG.warn → LOG.error flips in BackgroundGeolocationClient (onLocation error code + invalid coords + 2× subscriber-threw) | ✅                             |
| 9 turn 10+            | Future Phase 9 polish (per-brand SVG glyphs / cross-cutting Firestore mapper audit / permission-denied UX / RNFirebase / receipt PDF)              | Pending                        |
| 10                    | Cutover from legacy yeride                                                                                                                         | Pending                        |

End of Phase 7 turn 3 / Phase 7 close acceptance: **152 test suites
/ 1171 tests passing** (+9 tests over Turn 2's 152/1162; suite count
unchanged because both view-model swaps land in existing test
files); typecheck, lint, format, and test all green. The rewrite's
two GPS-aware view-models are now fully composed against the live
SDK pipeline. A signed-in rider on a `'dispatched'` ride who walks
out of the pickup area sees the "you've left your pickup area"
banner trigger from a real `BackgroundGeolocation.onGeofence` EXIT
event (no foreground poll); walking back in dismisses the banner
automatically. A signed-in driver who accepts a ride and drives
into the 200m pickup geofence sees `AtPickupView` automatically
replace `EnRouteToPickupView` — no manual button tap required (the
button retained as a resilience override; once tapped, sticks
across a subsequent EXIT to absorb GPS drift). When the driver
taps `Start ride` or `Request payment`, the entity-level transitions
receive real GPS-derived odometer values from
`useGpsCurrentOdometer()` (sourced from
`useGpsLifecycle`'s SDK location subscription), so the Cloud
Function's server-side fare math runs against actual trip distance
instead of the legacy `pickup + 1` placeholder. The
`useCurrentLocation` foreground hook stays in place (still used by
RiderHome / DriverHome / RouteSearch for initial map centre); the
rider VM just no longer imports it. The driver VM's own
`lastWrittenCoordsRef`-deduped foreground location push remains as
a documented Phase 9 cleanup item — currently a harmless
double-write with the lifecycle hook's per-delivery write to the
same `locations/{userId}` Firestore doc. Phase 8 (Google Navigation
SDK driver in-app navigation) is the next phase; kickoff staged at
`docs/PHASE_8_KICKOFF.md`.

End of Phase 4 acceptance: **81 test suites / 568 tests passing**;
typecheck + lint + format + test all green. Driver can sign in → go
online → accept an offer → land on DriverMonitor → flip to at-pickup
→ start ride → request payment → either land on the
`payment_requested` spinner and auto-redirect on `completed`, or land
on the `payment_failed` card and tap "Close trip" → return to
DriverHome. Cancel from any cancel-eligible status uses the full
per-reason `DriverCancelReasonSheet`.

End of Phase 5 turn 2 acceptance: **97 test suites / 708 tests passing**
(+10 suites / +47 tests over Phase 5 turn 1's 87/661); typecheck, lint,
format, and test all green. The 9 vehicle-management use cases are
wired through the DI container against real Firestore + Storage +
NHTSA adapters in production builds, in-memory fakes + real keyless
NHTSA in dev / test builds, and `InMemoryVehicleRepository` /
`InMemoryVehiclePhotoRepository` / `FakeVinDecoderService` overridable
via `TestContainerProvider`.

End of Phase 5 turn 3 acceptance: **102 test suites / 772 tests passing**
(+5 suites / +64 tests over Phase 5 turn 2's 97/708); typecheck, lint,
format, and test all green. A signed-in driver can open Profile → tap
"My vehicles" → see their list (or empty-state CTA) → tap "Add vehicle"
→ enter a VIN → see the decoded preview (or fall through to manual
entry on no-match / network error) → confirm → land back on the list
with the new vehicle marked active (first-vehicle auto-active).
Activate a non-active card by tapping it; trash + Alert-confirm
soft-deletes. Manual-entry vehicles run through `VehicleClassifier`
(luxury → xl → crossover → sedan compact/mid-size → wagon → coupe/
hatchback → economy) and get the same `eligibleServices` list the
NHTSA path produces.

End of Phase 5 turn 4 acceptance (closes Phase 5): **107 test suites /
799 tests passing** (+5 suites / +27 tests over Phase 5 turn 3's
102/772); typecheck, lint, format, and test all green. The list-card
tap now pushes `VehicleDetails` instead of activating; set-active moved
to the detail screen. From details a driver can flip active, push
`VehiclePhotos`, or Alert-confirm delete. `VehiclePhotos` runs a 5-tile
grid (front / back / left / right / interior) via
`expo-image-picker.launchImageLibraryAsync` → `UploadVehiclePhotos`; per-tile
upload state is isolated through a local `PerTileFlags` map alongside a
single `useUploadVehiclePhotosMutation`. The `'vehicle-stub'` literal
in `useDriverHomeViewModel` is gone — drivers without an active vehicle
see an empty-state "Register a vehicle" CTA in place of the online
toggle, and `useDriverActiveVehicleQuery` surfaces the active vehicle's
stock photo on DriverHome when present. `expo-image-picker@~55.0.19`
joins the dep set; permission strings live in `app.config.ts` and a
fresh `npm run prebuild` is required before the next iOS / Android
build.

End of Phase 6 turn 1 acceptance: **115 test suites / 877 tests passing**
(+8 suites / +78 tests over Phase 5 turn 4's 107/799); typecheck, lint,
format, and test all green. No new deps, no native config changes, no
DI-container changes. The 11-method `StripeServerService` interface +
the 4 payment value objects + 3 branded Stripe IDs are in place; the
`FakeStripeServerService` covers every method with seed/spy/failNext
seams and idempotent `createCustomer` mirroring the real
`/customers-create` endpoint. Critical hygiene fix: `userMapper` now
reads the legacy nested `users/{uid}.stripe = { id, charges_enabled,
payouts_enabled }` shape that existing legacy drivers actually have on
disk, falling back from the canonical flat fields when those are
absent, and writes BOTH shapes for legacy yeride co-existence under
`setDoc { merge: true }`.

End of Phase 6 turn 2 acceptance: **132 test suites / 1000 tests passing**
(+17 suites / +123 tests over Phase 6 turn 1's 115/877); typecheck,
lint, format, and test all green. The real `StripeServerHttpAdapter`
(11 methods, fetch-based, Bearer-authed, retry-with-backoff on 5xx +
transport throws via the new shared `retryWithBackoff` helper) is wired
through the DI container alongside `CloudFunctionsService.tipDriver`;
both fall back to `FakeStripeServerService` / `FakeCloudFunctionsService`
when env (`STRIPE_SERVER_URL` + `STRIPE_SERVER_API_KEY`) is missing.
Thirteen authorization-aware payment use cases ship: 4 rider-side
(`EnsureStripeCustomer`, `CreateSetupIntent`, `ListPaymentMethods`,
`SetDefaultPaymentMethod`, `DetachPaymentMethod`), 7 driver-side
(`EnsureStripeConnectAccount`, `CreateConnectOnboardingLink`,
`CreateAccountLoginLink`, `RefreshConnectAccountStatus`,
`GetDriverBalance`, `ListDriverPayouts`, `ListBalanceTransactions`),
and `ProcessTip` (rider-side, $1 floor, whole-dollar requirement,
Money → dollars conversion at the boundary). New `PaymentCallableService`
domain interface keeps `ProcessTip` from importing data-layer types.
`Rider.stripeCustomerId` and `Driver.stripeAccountId` are now branded;
`Rider` gains `defaultPaymentMethodId: PaymentMethodId | null`, which
`useRouteSelectViewModel` plumbs into `PassengerSnapshot.defaultPaymentMethod`
so `completeTrip` charges the right card on trip completion.
`PaymentMethod.expiry` softened to nullable (the legacy server doesn't
expose `exp_month` / `exp_year`); the value object's `isExpired(now)`
returns `false` when expiry is unknown. Four immutable User-entity
helpers added (`setStripeCustomerId`, `setDefaultPaymentMethodId`,
`setStripeAccountId`, `setStripeAccountFlags`). `userMapper`
gracefully falls back to `null` (with `LOG.warn`) on malformed Stripe
ids — never crashes hydration on a single bad doc.

End of Phase 7 turn 2 acceptance: **152 test suites / 1162 tests passing**
(+4 suites / +38 tests over Phase 7 turn 1's 148/1124 — at the high
end of the kickoff's "≥20 tests" estimate band but every test maps
to a documented behavior); typecheck, lint, format, and test all
green. `useGpsStore` (the Zustand mirror of the SDK's location +
geofence streams) ships with six fields, five action methods, and
six selector hooks (`useGpsCurrentLocation`, `useGpsCurrentOdometer`,
`useGpsCurrentSpeed`, `useGpsLastGeofenceEvent`,
`useGpsIsInsidePickupGeofence`, `useGpsPermissionStatus`). The
`useGpsLifecycle` hook (mounted exactly once at AppContent — never
in a screen / VM) owns the SDK lifecycle: idempotent
`init({ distanceFilter: 200, debug: __DEV__ })` on first
`enabled === true`, one-shot `requestAuthorizationIfNeeded()`,
`start()` / `stop()` per `enabled`, location subscription that fans
into `useGpsStore.setLocation` AND fires
`useUpdateLocationMutation.mutate(UserLocation)` per delivery,
geofence subscription that pushes into `useGpsStore.setGeofenceEvent`
(which derives `isInsidePickupGeofence` from `event.action`),
synchronous chain-ordered teardown
`stop → removeAllGeofences → removeAllListeners` on unmount. Pickup
geofence registration: `useActiveRideForGeofence(user)` resolves the
active ride via `useInProgressRideQuery` /
`useInProgressDriverRideQuery` (per role) plus a live `observeRide`
overlay so a `'dispatched' → 'started'` flip reactively swaps the
geofence in / out; AppContent passes the result to
`useGpsLifecycle.activeRideForGeofence`. The `enabled` predicate
mirrors the legacy `gpsStart(200)` gate: rider with
`defaultPaymentMethodId !== null`, driver with
`stripeChargesEnabled && stripePayoutsEnabled`. Sign-out resets
`useGpsStore` (canonical reset point — the lifecycle hook's
`enabled === false` path stops the SDK but leaves the store alone
so a brief flicker doesn't drop the user's last known location).
The new `useBackgroundGeolocation()` hook in `@presentation/di` is
the sibling of `useUseCases()`; `useGpsLifecycle` is its sole
consumer. **No JS-side debounce** on location writes (kickoff
decision 4 — SDK's `distanceFilter: 200` is the canonical rate
limiter; the `FirestoreLocationRepository`'s 3-retry backoff handles
transient failures). ESLint boundaries-rule override extended to
include `useGpsLifecycle.ts` + `useGpsStore.ts` alongside
`presentation/di/container.ts` — these are the presentation-layer
SDK seams (kickoff decisions 2 + 3, architectural exception
documented inline). No view-model swap-ins this turn — Turn 3
swaps `useRideMonitorViewModel`'s foreground geofence tick for
`useGpsLastGeofenceEvent()`, auto-flips
`useDriverMonitorViewModel.arrivedAtPickup` from
`useGpsIsInsidePickupGeofence()`, and replaces
`stubOdometerMeters` with `useGpsCurrentOdometer()`. **No native
config changes** this turn (Turn 1's prebuild already landed
everything); a fresh `npm run prebuild` is not required to ship
Turn 2.

End of Phase 7 turn 1 acceptance: **148 test suites / 1124 tests passing**
(+2 suites / +31 tests over Phase 6's close at 146/1093 — slightly above
the kickoff's "+12 to +18" estimate band but every test maps to a
documented behavior); typecheck, lint, format, and test all green.
`react-native-background-geolocation@^4.19.4` joins the dep set; the SDK
Expo plugin block + the new `plugins/withBackgroundFetchMaven.js` config
plugin landed in `app.config.ts`. `BG_GEOLOCATION_LICENSE_KEY` plumbed
into `.env.development` + `.env.example`; consumed at BUILD time only by
the SDK plugin (kickoff decision A — no runtime read; SDK degrades to
time-limited debug mode without). iOS `infoPlist` extended with
`UIBackgroundModes: ['location','fetch']` +
`BGTaskSchedulerPermittedIdentifiers` + `NSMotionUsageDescription`. The
single SDK seam `BackgroundGeolocationClient` (11 methods, all
`Result`-returning, listener-deduped by `(lat,lng,ts,odometer)` for
location and `(identifier,action,rideId)` for geofences) is wired
through the DI container alongside `useCases` as `Container.bgGeolocation`.
Bare `'pickup'` geofence identifier with `extras.rideId` (legacy parity,
kickoff decision C). `FakeBackgroundGeolocationClient` mirrors the real
surface 1:1 with `seed*` / `emit*` / `failNext` / `spies` seams.
`TestContainerProvider` gains an optional
`bgGeolocation?: FakeBackgroundGeolocationClient` prop. `jest.setup.ts`
carries a global SDK mock with a per-bucket listener registry +
`__emitLocation` / `__emitGeofence` / `__reset` test helpers.
**Critical Android resolution fix:** the `withBackgroundFetchMaven.js`
custom Expo config plugin injects
`${project(':react-native-background-fetch').projectDir}/libs` into
`android/build.gradle`'s `allprojects.repositories`, required because
the SDK's own plugin only registers its own libs/ flatdir and modern
npm hoists the sibling `react-native-background-fetch` to top-level
`node_modules/` where its local `repositories { maven { url './libs' } }`
isn't visible to `:app:debugRuntimeClasspath`'s transitive resolution.
Without it, `app:processDebugResources` fails with
`Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`. `npm run
android` succeeds on Pixel 10 Pro post-prebuild. **`npm run prebuild`
is required before the next iOS / Android build** so the SDK Expo
plugin lands native config (background modes + permission strings +
license bake) and the Maven plugin lands the additional repo.

End of Phase 6 turn 4 acceptance: **143 test suites / 1068 tests passing**
(+6 suites / +37 tests over Phase 6 turn 3's 137/1031, in line with the
kickoff's "+5 to +6 suites, +35 to +45 tests" target band); 1 suite
intentionally skipped (sandbox-leftover scratch). typecheck, lint,
format, and test all green. `expo-web-browser@~55.0.14` joins the dep
set; auto-linked, no Expo plugin block. The new `getDeepLinkScheme()` /
`buildDeepLink()` env helper reads `Constants.expoConfig?.scheme` so
the Stripe Connect `returnUrl` is env-aware. The `payment` query-key
scope adds `balance(accountId)`, `payouts(accountId, days, limit)`,
`balanceTransactions(accountId, days, limit)`; seven new TanStack hooks
land in the same `payment.queries.ts` file. The new
`useStripeConnectOnboarding` side-effect-launcher hook lives in
`src/presentation/features/driver/hooks/` and orchestrates the full
onboarding flow (`EnsureConnectAccount → CreateLink → openAuthSession
→ RefreshStatus`), firing a `Toast.show` success on the
`pending → enabled` flip. The Earnings tab is now `DriverEarningsScreen`
consuming `useDriverEarningsViewModel`'s six-arm tagged-union state.
Refresh strategy: `useFocusEffect` + `AppState 'change' → 'active'` +
manual pull-to-refresh, with a `useRef`-stabilized refresh callback to
prevent an infinite update loop under unstable `useMutation` return
identity. Express-dashboard reach via `useCreateAccountLoginLinkMutation`

- `WebBrowser.openBrowserAsync`. The `'disabled'` status arm is
  intentionally folded into `'pending'` (no backend disabled detection
  yet — future scope). `DriverEarningsPlaceholderScreen` retained as a
  deprecation stub. **`npm run prebuild` is not strictly required for
  `expo-web-browser` alone** (auto-linked); the Stripe SDK plugin's
  prebuild requirement from Turn 3 still stands.

End of Phase 6 turn 3 acceptance: **137 test suites / 1031 tests passing**
(+5 suites / +31 tests over Phase 6 turn 2's 132/1000); typecheck,
lint, format, and test all green. `@stripe/stripe-react-native@0.63.0`
joins the dep set; the Expo plugin block (`merchantIdentifier`
placeholder; Apple Pay / Google Pay disabled this phase) and the
`stripePublishableKey` `extra` field added to `app.config.ts`. A
`getStripePublishableKey()` env helper joins `@shared/env`. App.tsx
mounts `<StripeProvider/>` via a `MaybeStripeProvider` wrapper that
no-ops cleanly when the key is unset (loud `LOG.warn` at boot; Wallet
VM degrades to `'unconfigured'`). The SDK-shipped jest mock is wired
globally in `jest.setup.ts` so every test file picks it up; per-test
overrides via `(useStripe as jest.MockedFunction<typeof useStripe>)
.mockReturnValue(...)`. Five TanStack hooks
(`useEnsureStripeCustomerMutation`, `useCreateSetupIntentMutation`,
`useListPaymentMethodsQuery`, `useSetDefaultPaymentMethodMutation`,
`useDetachPaymentMethodMutation`) added under a new `payment` query-
key scope (`payment.methodsByCustomer(StripeCustomerId)`). The Wallet
tab now mounts `WalletScreen` (replacing `WalletPlaceholderScreen`
which is retained as a deprecation stub — sandbox virtiofs blocks
`unlink()`); the screen consumes `useWalletViewModel`'s six-arm
tagged-union state. Per-card `inFlight: { setDefault: Set<string>,
detach: Set<string> }` Sets carried in component-local `useState`,
mirroring the `useVehiclePhotosViewModel` `PerTileFlags` pattern.
Alert-confirmed delete with three message variants for default-and-
only / default-with-siblings / non-default. The `AddPaymentMethod`
modal route was added to `RiderStackParamList` with
`presentation: 'modal'`; `AddPaymentMethodScreen` wires `<CardForm/>` +
`useStripe().confirmSetupIntent` through `useAddPaymentMethodViewModel`
(lazy `EnsureStripeCustomer` on first card-add per kickoff decision;
`Canceled` from `confirmSetupIntent` is silent; `card_declined` /
`network` / `unknown` error arms with distinct UX copy via
`mapStripeError`). `WalletCardRow` uses a text-only `BrandBadge`
(per-brand glyph assets deferred to Phase 9); `expiry` line hidden
when `null`. **`npm run prebuild` is required before the next iOS /
Android build** so the Stripe SDK's plugin mods land (entitlements
plist + Google Pay AndroidManifest meta).

## Tech stack

| Category          | Choice                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime           | React Native 0.83.6, React 19.2                                                                                                            |
| Framework         | Expo SDK 55 (dev client)                                                                                                                   |
| Language          | TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                           |
| Backend           | Firebase 24.x (Auth + Firestore + Functions + Storage) — same `yeapp-stage` project as legacy in dev/stage; fresh `yeapp-prod` at cutover  |
| Cloud Functions   | `us-east1` (matches legacy deployment)                                                                                                     |
| Maps              | Google Routes API + Maps SDK (same keys as legacy)                                                                                         |
| State             | Zustand v5 (client state) + TanStack Query v5 (server cache)                                                                               |
| Forms             | React Hook Form + Zod                                                                                                                      |
| Navigation        | React Navigation 7 (typed param lists)                                                                                                     |
| Styling           | NativeWind 4 + Tailwind 3.4 ("Honey and the Bee" tokens)                                                                                   |
| Tests             | Jest + jest-expo + @testing-library/react-native                                                                                           |
| Payments          | `@stripe/stripe-react-native@0.63.0` (Phase 6 turn 3) — `<StripeProvider/>` mounted from `App.tsx`; `useStripe()` for `confirmSetupIntent` |
| Architecture lint | eslint-plugin-boundaries (legacy `boundaries/element-types` rule)                                                                          |

## Architecture: four layers

```
src/
├── domain/         ← entities, value objects, repository INTERFACES, errors, services
│   ├── entities/   ← value objects + entities (User, Money, Coordinates, ServiceArea,
│   │                 RideService, Route, Ride, RideStatus, UserLocation, TripEvent,
│   │                 TripPayment, ChatMessage, Vehicle, PaymentMethod, Payout,
│   │                 BalanceTransaction, StripeAccountStatus, branded IDs, snapshots, …)
│   ├── repositories/ ← AuthRepository, UserRepository, ServiceAreaRepository,
│   │                 RideRepository, LocationRepository (interfaces only)
│   ├── services/   ← RoutesService (interface), FareCalculator (pure-math implementation)
│   ├── errors/     ← DomainError + 6 subtypes (Validation, Authorization, NotFound, Conflict, Payment, Network)
│   └── shared/     ← Result<T,E>, brand<T,K> helpers
├── app/            ← use cases (35 of them across 6 bounded contexts:
│   │                 auth, serviceArea, route, ride, location, trip-tracking)
│   └── usecases/<bounded-context>/
├── data/           ← concrete adapters (Firebase + fetch)
│   ├── dto/        ← Zod schemas matching legacy Firestore docs
│   ├── mappers/    ← bidirectional / read-only Doc ↔ domain mappers
│   ├── repositories/ ← Firestore* concrete repos
│   └── services/   ← GoogleRoutesService, CloudFunctionsService
├── presentation/   ← screens, view-models, navigation, stores, DI
│   ├── di/         ← container.ts (the composition root)
│   ├── stores/     ← Zustand stores (useSessionStore, useServiceAreaStore,
│   │                 useTripDraftStore, useGeofenceUiStore, useChatUiStore)
│   ├── navigation/ ← RootNavigator, AuthNavigator, VerifyEmailNavigator,
│   │                 RiderNavigator, RiderTabsNavigator, DriverNavigator
│   ├── features/   ← rider/{screens,components,view-models}, auth/, …
│   └── AppContent.tsx, App.tsx
└── shared/         ← logger, env, testing fakes (cross-layer utilities)
```

**Layer dependency rule (enforced by eslint-plugin-boundaries):**

```
presentation → app → domain
data        → domain        (data implements domain interfaces)
shared      → domain        (only — shared is the ground floor)
```

`presentation` cannot import from `data`; `app` cannot import from
`presentation` or `data`; `domain` imports nothing else. The DI container
in `src/presentation/di/container.ts` is the single composition root that
wires data adapters into use cases — boundaries-rule overrides for that
file are listed in `eslint.config.js`.

## Code conventions (locked in across Phases 0–3)

### Result over throw

Every operation that can fail in an expected way returns
`Result<T, DomainError>` and never throws. Use `Result.ok` / `Result.err`
factories. Programming errors (network catastrophes, broken SDK state)
still throw; domain failures don't.

```ts
async signIn(args: { email: Email; password: string }):
  Promise<Result<UserId, NotFoundError | AuthorizationError>> {
  if (!found) return Result.err(new NotFoundError({ code: 'auth_user_not_found', ... }));
  return Result.ok(uid);
}
```

### Branded IDs

`UserId`, `RideId`, `ServiceAreaId`, `RideServiceId` are branded strings
(`Brand<string, 'UserId'>`) so the type system rejects passing one where
the other is expected. Always `.create()` to construct, returning
`Result<X, ValidationError>`.

### Value objects with `Result`-returning factories

`Money`, `Coordinates`, `Email`, `PhoneNumber`, `PersonName`, `Address`,
`SavedPlace`, `Endpoint`, `PassengerSnapshot`, `DriverSnapshot`, etc. all
use private constructors + `static create(props)` factories returning
Result. They're immutable — every "evolve" method returns a new
instance.

### Immutable entities with transition methods

`Ride` is the canonical example. Every state transition is a method
returning `Result<Ride, ValidationError>` that produces a new entity:

```ts
ride.dispatch({ driver, pickupDirections, at }); // awaiting_driver → dispatched
ride.start({ odometerMeters, at }); // dispatched → started
ride.requestPayment({ odometerMeters, at }); // started → payment_requested
ride.markCompleted(); // payment_requested → completed
ride.cancel({ reason, by, at, odometerMeters }); // any active → cancelled
```

Illegal transitions (e.g. completing a not-yet-started ride) return
`Result.err(ValidationError({code: 'ride_illegal_transition', ...}))`
rather than throwing.

### Repository pattern with lazy-required adapters

`buildContainer()` in `src/presentation/di/container.ts` decides between
real adapters (`FirebaseAuthRepository`, `FirestoreRideRepository`, etc.)
and in-memory fakes (`InMemoryAuthRepository`, …) based on
`Constants.expoConfig.extra.firebaseConfigured`. **All adapter imports
inside `buildContainer` use `require()` lazily** so:

- A fakes-only build never bundles `@react-native-firebase/*` (which
  would crash at module-load time without config files).
- The test environment never tries to load native modules.

```ts
if (isFirebaseConfigured()) {
  const data = require('@data/repositories/FirestoreRideRepository') as { … };
  return makeUseCases({ rides: new data.FirestoreRideRepository(), … });
}
const testing = require('@shared/testing') as { … };
return makeUseCases({ rides: new testing.InMemoryRideRepository(), … });
```

### Cloud Function callables hidden behind repositories

`requestPayment` and `cancel` on `RideRepository` route through
`CloudFunctionsService` (`completeTrip` / `cancelTrip` callables in
`us-east1`) but the use cases don't know — same interface as the
direct-write methods. The split between direct Firestore writes and
Cloud Function calls is an implementation detail of the data layer, not
a domain concern.

### Permissive DTO parsing, canonical writes

DTOs accept legacy field aliases (`seat` alongside `seatCapacity`,
`polyline` alongside `encodedPolyline`, missing optional fields) so the
rewrite reads any legacy document. Writes use the canonical (newer)
field shapes — but trip writes use Firestore `setDoc { merge: true }` so
fields the rewrite doesn't track yet (`lastSeenByRiderAt`,
`messages` subcollection) are preserved.

### Subscription-shaped use cases

`ObserveAuthState`, `ObserveRide`, `SubscribeToUserLocation`, etc. are
subscription-shaped (return synchronous unsubscribe), not
request/response. Don't try to force them into `execute(): Promise<…>`.

The legacy `subscribeToUserLocation` returned a Promise — explicitly
rewritten to synchronous unsubscribe to fix the React effect-cleanup
footgun. Never reintroduce async-unsubscribe.

### Role-gated use-case boundaries

`CancelRideByRider` enforces the rider-allowed set (`changed_mind`,
`driver_no_show`, …) and rejects driver-only codes (`passenger_no_show`).
`CancelRideByDriver` enforces the symmetric driver set. The `Ride`
entity's `cancel` method is symmetric on `by` because the entity doesn't
know who's calling — the role check belongs at the use case (the audit
boundary), not in the entity.

### Pricing in `Money` minor units

Every fare / price / fee field is a `Money` value object (USD minor
units). Math runs in minor units so we never accumulate floating-point
error. Wire-format conversions (legacy stores dollars as plain numbers)
happen at the mapper boundary only. `Money.fromMajor(2.5, 'USD')` →
`{minorUnits: 250, currency: 'USD'}`.

### Logging

Never `console.*` directly. Use `LOG.extend('ModuleName')` from
`@shared/logger`. Levels map to native console methods correctly
(important: `LOG.info` shows as `INFO`, not `WARN` — fixed in Phase 1
follow-up).

```ts
import { LOG } from '@shared/logger';
const logger = LOG.extend('RIDE');
logger.info('dispatched', { tripId, driverId });
logger.error('updateLocation failed', e);
```

PII protection: `sanitizeForLogging(meta)` is wired into the logger
transport — passing a User object to `meta` automatically redacts
email/phone/payment.

### Async / Result composition

Use `if (!r.ok) return r;` early-return pattern; don't use `.then`
chains. Use cases run server-side validation + auth before any side
effect, and sequence results explicitly:

```ts
const userR = await this.users.getById(id);
if (!userR.ok) return userR;
const updatedR = userR.value.updatePhone(newPhone);
if (!updatedR.ok) return updatedR;
return this.users.update(updatedR.value);
```

### View-model hooks per screen (Phase 3)

Every screen has a sibling `useXxxViewModel.ts` hook in
`src/presentation/features/<area>/view-models/` that owns the screen's
orchestration: pulls use cases off the DI container, wires TanStack
Query for server state, reads/writes the relevant Zustand store(s),
maps domain `Result` values to flat UI props (loading/error/data
discriminated unions), and exposes typed callbacks. Screens stay dumb —
no `useUseCases()` calls, no Firebase imports, no Result-unwrapping.

Test view-models in isolation with the in-memory repository fakes via
`TestContainerProvider`; screens get rendered tests that supply the
view-model output as props.

### Zustand vs. TanStack Query — split of concerns

Strict split, never mix:

- **TanStack Query** owns _server state_ (anything fetched or
  subscribed via a use case) — list of available rides, the current
  Ride doc, route catalog, payment methods. Query keys mirror use case
  args.
- **Zustand stores** own _client/UI state_ only — the trip-draft a
  rider is composing pre-CreateRide (`useTripDraftStore`), chat
  open/closed flag (`useChatUiStore`), geofence-warning banner
  visibility (`useGeofenceUiStore`), session identity bag
  (`useSessionStore`), the resolved active service area
  (`useServiceAreaStore`).

Do not put server-fetched ride data in Zustand. Do not put pure UI
flags in TanStack Query.

### Status-router pattern for live trip surfaces

Both `RideMonitorScreen` (rider) and `DriverMonitorScreen` (driver) use
a status-router: a single switch on `Ride.status` selects which
bottom-sheet view component renders. Rider views: `AwaitingDriverView`,
`DispatchedView`, `StartedView`, `CompletedView`, `PaymentFailedView`.
Driver views (Turn 4a): `EnRouteToPickupView`, `AtPickupView`. The
driver side splits server status `'dispatched'` into the en-route ↔
at-pickup distinction via a derived `arrivedAtPickup` value
(`useGpsIsInsidePickupGeofence() || manualOverride`, Phase 7 turn 3)
— UI-only, no server write. Each view is independently
testable, gets the `Ride` + callbacks as props, and never reads from
the store directly. Adding a new ride status = add a `RideStatus`
literal + add one component + extend the router. Don't grow a single
god-component.

## Data co-existence with legacy yeride

**Critical decision (REFACTOR_PLAN.md §7 Decision 6):** dev + stage
share the same `yeapp-stage` Firebase project as the legacy app, and
trips/users/locations live in the SAME Firestore collections. The
rewrite reads what legacy writes and vice versa. This means:

- DTO schemas must accept every legacy field shape we've ever seen.
- Doc writes must include canonical fields the legacy app reads (e.g.
  bake `seat: 4` AND `seatCapacity: 4` on ride-service snapshots).
- Trip writes use `setDoc { merge: true }` so we don't clobber fields
  the rewrite doesn't track yet.
- Cloud Functions are deployed once and called by both apps — keep
  function signatures byte-identical.
- **Driver Stripe Connect state lives in two shapes on disk** — legacy
  yeride writes the FULL `stripe.accounts.create` response spread into
  `users/{uid}.stripe = { id, charges_enabled, payouts_enabled, … }`,
  while the rewrite emits both that nested shape AND canonical flat
  fields (`stripeAccountId / stripeChargesEnabled / stripePayoutsEnabled`).
  `userMapper` reads either, prefers flat, and writes both. Don't drop
  the dual-write until legacy yeride is retired (Phase 10).

Production (post-cutover): fresh `yeapp-prod` Firebase project, only the
new app writes to it.

## Critical files

| File                                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REFACTOR_PLAN.md`                                                                | Phased migration roadmap, decisions, target architecture                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/PHASE_1_TURN_2.md`                                                          | What shipped through Phase 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/PHASE_3_TURN_{1..5,4A,4B}.md`                                               | Phase 3 turn-by-turn record — read newest first when picking up rider/UI work                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/PHASE_4_KICKOFF.md` + `docs/PHASE_4_TURN_{1,2,3,4A,4B,5}.md`                | Phase 4 turn-by-turn record — read newest first when picking up driver/UI work                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/PHASE_5_KICKOFF.md` + `docs/PHASE_5_TURN_{1,2,3,4}.md`                      | Phase 5 turn-by-turn record — read newest first when picking up vehicle work                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/PHASE_6_KICKOFF.md` + `docs/PHASE_6_TURN_{1,…}.md`                          | Phase 6 turn-by-turn record — read newest first when picking up payments / Stripe / tipping work                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/PHASE_7_KICKOFF.md` + `docs/PHASE_7_TURN_{1,…}.md`                          | Phase 7 turn-by-turn record — read newest first when picking up background-GPS / geofence work                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/PHASE_8_KICKOFF.md` + `docs/PHASE_8_TURN_{1,…}.md`                          | Phase 8 turn-by-turn record — read newest first when picking up Google Navigation SDK work                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/PHASE_9_KICKOFF.md` + `docs/PHASE_9_TURN_{1,2,…}.md`                        | Phase 9 turn-by-turn record — read newest first when picking up push-notifications / Crashlytics / polish work                                                                                                                                                                                                                                                                                                                                                                                      |
| `app.config.ts`                                                                   | Env-aware Expo config; threads Firebase + Maps API keys via `extra`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scripts/patch-podfile.js`                                                        | THREE Podfile fixes for `@react-native-firebase` 24.x under `useFrameworks: 'static'` (see Troubleshooting)                                                                                                                                                                                                                                                                                                                                                                                         |
| `eslint.config.js`                                                                | Boundaries rule + per-file overrides (DI container, logger, testing fakes)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/presentation/di/container.ts`                                                | The composition root — single place where all repo + service wiring lives                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/presentation/navigation/RootNavigator.tsx`                                   | Top-level switch between Auth/VerifyEmail/Rider/Driver based on session + role                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/presentation/features/rider/screens/RideMonitorScreen.tsx`                   | Live-trip surface (rider side); map + bottom-sheet status-router. Most-touched rider UI screen                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`                | Live-trip surface (driver side); same status-router pattern. Most-touched driver UI screen                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`       | Status-router state machine + Start / RequestPayment / Cancel mutations + terminal-redirect rule                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/presentation/components/trip/{Cancel,DriverCancelReason}Sheet.tsx`           | Per-reason cancel pickers — rider-allowed vs. driver-allowed code sets (`isRiderCode` / `isDriverCode`)                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/domain/entities/Ride.ts`                                                     | The trip aggregate + state machine. Most-touched domain entity                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/data/repositories/FirestoreRideRepository.ts`                                | Largest data adapter — direct writes + Cloud Function delegation + geo-filter                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/data/services/CloudFunctionsService.ts`                                      | `httpsCallable` wrapper for `completeTrip` / `cancelTrip` / `tipDriver` (us-east1)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/data/services/StripeServerHttpAdapter.ts`                                    | Phase 6 turn 2 — fetch-based 11-method Stripe microservice adapter; Bearer-authed; Idempotency-Key on `createCustomer`; retry-with-backoff on 5xx + transport throws                                                                                                                                                                                                                                                                                                                                |
| `src/data/services/_shared/retryWithBackoff.ts`                                   | Phase 6 turn 2 — generic retry helper with `{attempts, delaysMs, shouldRetry, sleep?}` policy. Inject `sleep` in tests to skip wall-clock                                                                                                                                                                                                                                                                                                                                                           |
| `src/domain/services/PaymentCallableService.ts`                                   | Phase 6 turn 2 — domain seam over server-side payment callables. Just `tipDriver` for now; `CloudFunctionsService` + `FakeCloudFunctionsService` both satisfy structurally                                                                                                                                                                                                                                                                                                                          |
| `src/app/usecases/payment/ProcessTip.ts`                                          | Phase 6 turn 2 — Money → dollars at the boundary, $1 floor, whole-dollar requirement, passenger-ownership check                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/shared/testing/FakeCloudFunctionsService.ts`                                 | Phase 6 turn 2 — programmable fake covering `completeTrip` / `cancelTrip` / `tipDriver` with seed/spy/failNext seams                                                                                                                                                                                                                                                                                                                                                                                |
| `src/shared/env/stripeServer.ts`                                                  | Phase 6 turn 2 — `getStripeServerConfig()` reads `STRIPE_SERVER_URL` + `STRIPE_SERVER_API_KEY` from `extra`; both required as a unit                                                                                                                                                                                                                                                                                                                                                                |
| `src/shared/testing/InMemoryRideRepository.ts`                                    | Full-fidelity fake with seed/spy seams + Haversine geo-filter                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/domain/entities/Vehicle.ts`                                                  | Vehicle aggregate + status state machine; VIN as identity                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/domain/services/VehicleClassifier.ts`                                        | Pure-math manual-entry classifier + `computeEligibleServices` (parity with NHTSA path)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/data/repositories/FirestoreVehicleRepository.ts`                             | write-batch cross-aggregate writes + per-VIN fan-out subscribe                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/presentation/features/driver/view-models/useVehicleRegistrationViewModel.ts` | Tagged-union form state machine; 400ms VIN debounce; manual / decoded / conflict branches                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts`       | Per-tile upload state machine — `inFlight` / `errors` keyed on `VehiclePhotoType` + `useUploadVehiclePhotosMutation` via `mutateAsync`                                                                                                                                                                                                                                                                                                                                                              |
| `src/presentation/features/driver/view-models/useVehicleDetailsViewModel.ts`      | Read-only detail VM — composes `useVehicleQuery` + setActive / delete mutations + `Alert.alert` confirmation                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/presentation/queries/vehicle.queries.ts`                                     | All vehicle TanStack hooks — VIN decode + register / setActive / delete / upload mutations + byVin / activeForDriver reads                                                                                                                                                                                                                                                                                                                                                                          |
| `src/domain/services/StripeServerService.ts`                                      | 11-method interface over the YeRide Stripe microservice (Phase 6 turn 1) — covers customers, setup intents, payment methods, Connect, balance, payouts, balance transactions                                                                                                                                                                                                                                                                                                                        |
| `src/shared/testing/FakeStripeServerService.ts`                                   | Programmable in-memory `StripeServerService` with seed seams, spy bookkeeping, `failNext` priming, idempotent `createCustomer` (Phase 6 turn 1)                                                                                                                                                                                                                                                                                                                                                     |
| `src/data/dto/UserDoc.ts` + `src/data/mappers/userMapper.ts`                      | Driver doc accepts BOTH legacy nested `stripe: { id, charges_enabled, payouts_enabled }` AND canonical flat fields; mapper writes both shapes for legacy yeride co-existence                                                                                                                                                                                                                                                                                                                        |
| `src/presentation/App.tsx`                                                        | Phase 6 turn 3 — `MaybeStripeProvider` wraps the navigator above `<QueryClientProvider/>`; no-ops when publishable key is unset                                                                                                                                                                                                                                                                                                                                                                     |
| `src/presentation/queries/payment.queries.ts`                                     | Phase 6 turn 3 — five rider-side hooks (`useEnsureStripeCustomerMutation`, `useCreateSetupIntentMutation`, `useListPaymentMethodsQuery`, `useSetDefaultPaymentMethodMutation`, `useDetachPaymentMethodMutation`)                                                                                                                                                                                                                                                                                    |
| `src/presentation/features/rider/view-models/useWalletViewModel.ts`               | Phase 6 turn 3 — six-arm tagged-union (unconfigured / loading / no_customer / empty / ready / error) + per-card inFlight Sets + Alert-confirmed delete with three message variants                                                                                                                                                                                                                                                                                                                  |
| `src/presentation/features/rider/view-models/useAddPaymentMethodViewModel.ts`     | Phase 6 turn 3 — orchestrates EnsureStripeCustomer → CreateSetupIntent → confirmSetupIntent. `Canceled` is silent; `card_declined` / `network` / `unknown` error arms via `mapStripeError`                                                                                                                                                                                                                                                                                                          |
| `src/presentation/features/rider/screens/WalletScreen.tsx`                        | Phase 6 turn 3 — view-model-driven; pull-to-refresh; replaces `WalletPlaceholderScreen` (retained as a stub since virtiofs blocks unlink)                                                                                                                                                                                                                                                                                                                                                           |
| `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx`              | Phase 6 turn 3 — modal route; `<CardForm/>` + Save CTA + inline error banner with dismiss                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/presentation/features/rider/components/WalletCardRow.tsx`                    | Phase 6 turn 3 — text-only `BrandBadge` + last4 + optional expiry + default-checkmark + trash. Per-row in-flight via parent props                                                                                                                                                                                                                                                                                                                                                                   |
| `jest.setup.ts`                                                                   | Wires `@stripe/stripe-react-native/jest/mock` globally so view-model tests can `(useStripe as jest.MockedFunction<typeof useStripe>).mockReturnValue(...)` per test                                                                                                                                                                                                                                                                                                                                 |
| `src/shared/env/scheme.ts`                                                        | Phase 6 turn 4 — `getDeepLinkScheme()` / `buildDeepLink(path)` reads `Constants.expoConfig?.scheme` for env-aware Stripe Connect `returnUrl` (`{scheme}://stripe-return`). Lazy-require pattern, mockable in tests                                                                                                                                                                                                                                                                                  |
| `src/presentation/features/driver/hooks/useStripeConnectOnboarding.ts`            | Phase 6 turn 4 — multi-step onboarding launcher: `EnsureConnectAccount → buildDeepLink → CreateConnectOnboardingLink → WebBrowser.openAuthSessionAsync → RefreshConnectAccountStatus`. Toast on `pending→enabled` flip. `'success'`/`'cancel'` refresh; `'dismiss'` silent                                                                                                                                                                                                                          |
| `src/presentation/features/driver/view-models/useDriverEarningsViewModel.ts`      | Phase 6 turn 4 — six-arm tagged-union (unconfigured / loading / no_account / pending / enabled / error). `useRef`-stabilized refresh callback prevents infinite update loop under unstable `useMutation` identity. `useFocusEffect` + `AppState` 'active' + pull-to-refresh fan-out                                                                                                                                                                                                                 |
| `src/presentation/features/driver/screens/DriverEarningsScreen.tsx`               | Phase 6 turn 4 — view-model-driven layout per arm. Pull-to-refresh on `pending`/`enabled`; loud error block on `unconfigured`. Replaces `DriverEarningsPlaceholderScreen` (retained as a deprecation stub since virtiofs blocks unlink)                                                                                                                                                                                                                                                             |
| `src/presentation/utils/formatMoney.ts`                                           | Phase 6 turn 5 — re-homed from `features/driver/utils/` so rider + driver surfaces share a single neutral location. `Intl.NumberFormat`-based USD formatter. The driver-side path is now a 1-line re-export shim                                                                                                                                                                                                                                                                                    |
| `src/presentation/features/rider/view-models/useTipFlowViewModel.ts`              | Phase 6 turn 5 — six-arm tagged union (`hidden / idle / selected / submitting / submitted / error`). $1 floor + $99 ceiling + whole-dollar local validation; idempotent-submit guard; `instanceof` error classifier (`validation / network / unauthorized / unknown`). Live `'submitted' → 'hidden'` transition driven by parent VM's `useFirestoreSubscription(observeTripPayments)` — no fixed-duration auto-hide                                                                                 |
| `src/presentation/features/rider/components/TipSelector.tsx`                      | Phase 6 turn 5 — pure prop-driven over `useTipFlowViewModel.state`. Header + three preset chips ($1/$3/$5) + Custom toggle; number-pad TextInput on custom mode; per-kind error band with Dismiss; "Tip $X" CTA via `formatMoney` (or spinner during `submitting`); thank-you strip on `submitted`. Returns `null` on `hidden`                                                                                                                                                                      |
| `src/presentation/features/rider/view-models/useRideReceiptViewModel.ts`          | Phase 6 turn 5 — swapped one-shot `useRideQuery` for live `useFirestoreSubscription(observeRide)` so a `'payment_failed' → 'completed'` flip lights up the TipSelector without re-navigation. `hasRideEmitted` guards `isLoading` so post-mount `ride === null` is "doc deleted", not "still loading". Existing surface (`{ride, payments, fareTotal, ...}`) preserved — 6 receipt-VM tests still pass unchanged                                                                                    |
| `src/data/services/BackgroundGeolocationClient.ts`                                | Phase 7 turn 1 — single SDK seam over `react-native-background-geolocation@4.19.4`. 11 `Result`-returning methods. Listener-level dedup by `(lat,lng,ts,odometer)` for location and `(identifier,action,rideId)` for geofences. Bare `'pickup'` identifier with `extras.rideId`. SDK throws → `NetworkError`/`AuthorizationError` at the boundary. Domain types `BgLocationEvent`/`BgGeofenceEvent`/`BgPermissionStatus` exported alongside                                                         |
| `src/shared/testing/FakeBackgroundGeolocationClient.ts`                           | Phase 7 turn 1 — full-fidelity in-memory fake mirroring the real adapter 1:1. Same dedup logic. Programmable seams: `seedAuthorization` / `seedOdometer` / `emitLocation` / `emitGeofence` / `emitMultiFire*` / `failNext({method,error})` / `spies` / `getActiveGeofence` / `isEnabled` / `isInitialized` / `reset`. Pattern matches `FakeStripeServerService` / `FakeCloudFunctionsService`                                                                                                       |
| `plugins/withBackgroundFetchMaven.js`                                             | Phase 7 turn 1 — custom Expo config plugin. Injects `${project(':react-native-background-fetch').projectDir}/libs` into `android/build.gradle`'s `allprojects.repositories`. Required because the SDK's own plugin only registers its own libs/, and modern npm hoists the sibling `react-native-background-fetch` to top-level `node_modules/`. Without it, `app:processDebugResources` fails with "Could not find com.transistorsoft:tsbackgroundfetch:1.0.4". Idempotent via `mergeContents` tag |
| `jest.setup.ts`                                                                   | Phase 7 turn 1 — also mocks `react-native-background-geolocation` globally with `mock`-prefixed names (Jest hoisting rule). Per-bucket listener registry + `__emitLocation` / `__emitGeofence` / `__reset` test helpers. SDK constants exposed (`DESIRED_ACCURACY_HIGH`, `LOG_LEVEL_*`, `AUTHORIZATION_STATUS_*`) so the adapter's import-time references resolve cleanly                                                                                                                           |
| `app.config.ts`                                                                   | Phase 7 turn 1 — adds the `react-native-background-geolocation` Expo plugin block (license consumed at BUILD time only via `BG_GEOLOCATION_LICENSE_KEY`), the new `withBackgroundFetchMaven` plugin entry, and the iOS infoPlist additions (`UIBackgroundModes: ['location','fetch']`, `BGTaskSchedulerPermittedIdentifiers`, `NSMotionUsageDescription`). `npm run prebuild` required after edits                                                                                                  |
| `src/presentation/stores/useGpsStore.ts`                                          | Phase 7 turn 2 — Zustand mirror of the SDK's location + geofence streams. Six fields (permissionStatus, currentLocation, currentSpeed, currentOdometerMeters, lastGeofenceEvent, isInsidePickupGeofence). `setGeofenceEvent` auto-derives `isInsidePickupGeofence` from `event.action`; `setIsInsidePickupGeofence(false)` is the deregistration escape hatch. Six selector hooks. Mounting rule: `useGpsLifecycle` is the only writer; everyone else reads via the selector hooks                  |
| `src/presentation/hooks/useGpsLifecycle.ts`                                       | Phase 7 turn 2 — single GPS-aware presentation hook, AppContent-only. Five effects: SDK lifecycle (init/permission/start/stop), location subscription → store + `useUpdateLocationMutation`, geofence subscription → store, pickup-geofence (re-)registration via `activeRideForGeofence`, synchronous chain-ordered teardown `stop → removeAllGeofences → removeAllListeners`. `useRef`-guarded init + permission flags. No JS-side debounce — SDK's `distanceFilter: 200` is the rate limiter     |
| `src/presentation/hooks/useActiveRideForGeofence.ts`                              | Phase 7 turn 2 — pure read-only resolver for the geofence target. Two-stage: discovery via the role-appropriate `useInProgressRideQuery` / `useInProgressDriverRideQuery`, live overlay via `observeRide` so a `'dispatched' → 'started'` flip reactively swaps the geofence in / out. Returns `{rideId, pickupCoords}` only when `ride.status === 'dispatched'`                                                                                                                                    |
| `src/presentation/AppContent.tsx`                                                 | Phase 7 turn 2 — also mounts `useGpsLifecycle` once. Computes `enabled` via `isRegistrationComplete(user)` (rider needs `defaultPaymentMethodId !== null`; driver needs `stripeChargesEnabled && stripePayoutsEnabled` — mirrors the legacy `computeTargetRoute` gate). Resolves `activeRideForGeofence` via `useActiveRideForGeofence(user)`. Resets `useGpsStore` on `'unauthenticated'` transition (canonical reset point)                                                                       |
| `src/presentation/di/ContainerProvider.tsx`                                       | Phase 7 turn 2 — adds the sibling `useBackgroundGeolocation()` hook alongside `useUseCases()`. Same throw-outside-provider contract. `useGpsLifecycle` is the sole consumer                                                                                                                                                                                                                                                                                                                         |
| `eslint.config.js`                                                                | Phase 7 turn 2 — boundaries-rule override extended to include `useGpsLifecycle.ts` + `useGpsStore.ts` alongside `presentation/di/container.ts`. These are the presentation-layer SDK seams (kickoff decisions 2 + 3) — same architectural exception as the DI composition root                                                                                                                                                                                                                      |
| `src/data/services/NavigationSdkClient.ts`                                        | Phase 8 turn 1 — single SDK seam over `@googlemaps/react-native-navigation-sdk@0.14.1`. 8 `Result`-returning methods (`init`, `showTermsAndConditionsDialog`, `setDestinations`, `startGuidance`, `stopGuidance`, `cleanup`, `subscribeToArrival`, `setController`). Listener-level dedup of arrivals by `(waypointKey, isFinal)`. Non-OK `RouteStatus` mapped to `Result.ok<NavRouteStatus>` (domain outcomes); `init`'s status string-enum mapped to `Result<true, AuthorizationError             | NetworkError>` |
| `src/shared/testing/FakeNavigationSdkClient.ts`                                   | Phase 8 turn 1 + turn 2 — programmable in-memory fake mirroring the real adapter 1:1. Seam set: `seedTermsAccepted` / `seedRouteStatus` / `failNext({method, error})` / `emitArrival` / `emitMultiFireArrival` / `setController` (Phase 8 turn 2 spy) / read-only introspection (`getActiveDestinations`, `isInitialized`, `isGuiding`, `getArrivalSubscriberCount`) / `reset`. `setController` parameter is `unknown` so the union with the real adapter stays callable from the connector hook    |
| `plugins/withNavigationSdk.js`                                                    | Phase 8 turn 1 — custom Expo config plugin (minimum patch set per kickoff decision 3): Android `coreLibraryDesugaringEnabled` + `play-services-maps` exclusion + `kotlin-stdlib:2.0.21` alignment + AAR-metadata check disable; iOS `react-native-google-maps.podspec` patches (GoogleMaps 10.7.0 alignment + `RCTDirectEventBlock` fix on `onMapReady`) + Podfile CDN fallback + strip Expo's orphan `react-native-google-maps` pod line                                                           |
| `src/presentation/App.tsx`                                                        | Phase 8 turn 2 — adds `<NavigationProvider/>` from the SDK between `MaybeStripeProvider` and `<QueryClientProvider/>`. Always mounted (no "unconfigured" branch). Terms-dialog config matches legacy yeride: `{title: 'Navigation Terms', companyName: 'YeRide', showOnlyDisclaimer: true}` + `TaskRemovedBehavior.CONTINUE_SERVICE`                                                                                                                                                                |
| `src/presentation/features/driver/hooks/useNavigationSdkConnector.ts`             | Phase 8 turn 2 — calls the SDK's `useNavigation()` context hook to read the shared `{navigationController, ...listenerSetters}` and pushes them into the adapter via `setController`. On unmount, pushes `{controller: null, listeners: null}`. Mounting rule: exactly once on `DriverMonitorScreen` — not at AppContent (too broad) and not at the navigation screen (too narrow; legacy `getCurrentActivity()` quirk requires init-in-parent)                                                     |
| `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`    | Phase 8 turn 2 — 5-arm tagged-union state machine (`uninitialized                                                                                                                                                                                                                                                                                                                                                                                                                                   | initializing   | guiding | arrived | error`) with 5 error sub-kinds. Drives `setDestinations`→`startGuidance`after`onMapReady`; final-destination arrival auto-flips to `'arrived'`; `onEndNavigation`+`onRetry`. State-machine race avoidance: chain effect's gate reads `state.kind`via a`stateRef`, and `onRetry`bumps a`retryNonce`dep tick to re-fire the chain (listing`state.kind` as a dep self-cancels) |
| `src/presentation/features/driver/screens/DriverNavigationScreen.tsx`             | Phase 8 turn 2 — hosts `<NavigationView style={{flex:1}} onMapReady={...}/>`, a bottom-pinned "End Navigation" CTA, a `<StateOverlay/>` during non-guiding arms (spinner / error+retry / brief "Arrived" panel), and an auto-pop `useEffect` keyed on `vm.hasArrived` (1.2s delay; `hasNavigatedAwayRef` guards against double-pop). Validates route-param coords at the screen boundary and renders an inline error if invalid                                                                     |
| `eslint.config.js`                                                                | Phase 8 turn 2 — boundaries-rule override block extended to include `useNavigationSdkConnector.ts` + `useDriverNavigationViewModel.ts` alongside `useGpsLifecycle.ts` / `useGpsStore.ts`. Same architectural exception: presentation-layer SDK seams allowed to import data-layer `Nav*` types                                                                                                                                                                                                      |
| `jest.setup.ts`                                                                   | Phase 8 turn 2 — extends the SDK module mock with a `useNavigation` export (returns a shared `mockSharedNavigation` instance) + `__getSharedNavigation` / `__resetSharedNavigation` test helpers. Connector hook tests use these to assert reference identity across re-renders without mounting a real `<NavigationProvider/>`                                                                                                                                                                     |

## Build & deployment

### Local dev

```bash
npm run start         # Metro dev server (--dev-client)
npm run prebuild      # expo prebuild --clean + node scripts/patch-podfile.js
npm run ios           # iOS simulator
npm run android       # Android emulator
```

`prebuild` is gated on the Firebase config files in
`firebase/config/<env>/`. With files: real Firebase wired. Without
files: in-memory fakes, with a `LOG.warn` at boot.

### Verify gates

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format:check   # prettier --check .
npm test               # jest
npm run verify         # all four in sequence
```

All four must be green before commit. CI runs the same.

### Env vars

Live in `.env.development` / `.env.stage` / `.env.production`. Currently
configured:

- `EXPO_PUBLIC_APP_ENV` — required, one of dev/stage/production
- `EXPO_PUBLIC_USE_FIREBASE` — toggles real-vs-fakes (also respects
  config-file presence)
- `GOOGLE_MAPS_APIKEY_ANDROID` / `GOOGLE_MAPS_APIKEY_IOS` — read at
  build time, threaded through `app.config.ts` `extra`. NOT prefixed
  with `EXPO_PUBLIC_*` so they don't ship in the bundle string blob.

## Common tasks

### Adding a use case

1. New file in `src/app/usecases/<context>/<UseCaseName>.ts`.
2. Constructor takes whatever repos / services it needs.
3. `execute(args): Promise<Result<T, DomainError>>` (or sync for
   subscription-shaped).
4. Wire into `src/presentation/di/container.ts`'s `UseCases` interface
   - `makeUseCases()` body.
5. Tests in `__tests__/<UseCaseName>.test.ts` using
   `InMemory<X>Repository` fakes from `@shared/testing`.

### Adding a domain entity

1. New file in `src/domain/entities/<Name>.ts`.
2. Private constructor + `static create(props): Result<X, ValidationError>`
   factory.
3. Tests in `__tests__/<Name>.test.ts` covering happy path + every
   validation rejection (one assertion per `code` string).
4. Re-export via `src/domain/entities/index.ts` only if multiple files
   need it (most stay direct-imported).

### Adding a Firestore repository

1. Define the interface in `src/domain/repositories/<X>Repository.ts`.
2. Build the in-memory fake first in
   `src/shared/testing/InMemory<X>Repository.ts` — exercise the contract.
3. Build the real adapter in
   `src/data/repositories/Firestore<X>Repository.ts` (and a `<X>Doc.ts`
   schema + bidirectional mapper if persistence is needed).
4. Wire into the DI container with a lazy `require()`.
5. Add an optional override to `TestContainerProvider`.

## Troubleshooting

### iOS build: modular-headers + RNFirebase under static frameworks

`@react-native-firebase` 24.x's Obj-C wrappers do `#import <React/...>`
which Clang rejects under `useFrameworks: 'static'`. Three coupled fixes
applied by `scripts/patch-podfile.js`:

1. `Podfile.properties.json`: `ios.buildReactNativeFromSource: "true"`
   so React-Core builds from source (the prebuilt binary has no module
   map).
2. `Podfile`: `$RNFirebaseAsStaticFramework = true` at top level.
3. `Podfile`: `use_modular_headers!` inside the target.

If a NEW pod errors with non-modular include, add a targeted
`pod 'X', :modular_headers => true` to the patch script.

### Android: `compileSdkVersion 35` AAR-metadata error

AndroidX libs pulled in transitively (browser/core/core-ktx 1.17+)
require `compileSdk >= 36`. Fixed in `app.config.ts` `expo-build-properties`
block: `compileSdkVersion: 36, targetSdkVersion: 35`. Bumping `compileSdk`
only opens new APIs at compile time; runtime behavior stays at sdk 35.

### Firebase Auth on Android: `auth/internal-error` on signInWithEmailAndPassword

Driver/dev keystore SHA-1 not registered with the Firebase Android app
for `tech.yeapp.yeridenext.dev`. Get SHA-1 via:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

Add it in Firebase Console → Project Settings → your Android app → Add
fingerprint, re-download `google-services.json`, replace in
`firebase/config/<env>/`, re-run `npm run prebuild && npm run android`.

### Logger says WARN for an info message

Don't use `console.*` directly anywhere except `src/shared/logger/Logger.ts`.
Use `LOG.extend('Module').info(...)`. The transport correctly routes
each level — if you see WARN tags on info messages, something is calling
`console.warn` directly somewhere it shouldn't be.

### Firestore `.get()` hangs but `onSnapshot` works

Firebase BoM 34.10.0 has gRPC stream stability issues. Legacy yeride
pins to BoM 34.0.0 in its `withNavigationSdk.js`. We don't pin yet; if
this surfaces, look at the legacy plugin for the fix. Watch for it
during heavy `getDoc` use in the rider UI work.

### iOS RCTFatal on boot: "missing usage descriptions" / `EXBaseLocationRequester getPermissions`

`expo-location` hard-fails (`RCTFatal`) the first time
`requestForegroundPermissionsAsync()` is called if the iOS Info.plist
is missing `NSLocationWhenInUseUsageDescription` /
`NSLocationAlwaysAndWhenInUseUsageDescription`. Crashes the entire app
on boot because `useCurrentLocation` mounts on every map-bearing
screen.

The strings ARE configured in `app.config.ts` under the `expo-location`
plugin block — but only a fresh `npm run prebuild` writes them into
`ios/<app>/Info.plist`. If you edited the plugin block (or the iOS
native folder was generated before the plugin was added) the plist
falls out of sync.

Fix paths:

1. **Canonical**: `npm run prebuild` to regenerate the iOS native tree
   (also re-runs `pod install` and the `patch-podfile.js` Podfile
   fixes). Required before the next iOS rebuild.
2. **Quick unblock** (between prebuilds): manually patch
   `ios/<AppName>/Info.plist` with both `NSLocationWhenInUseUsageDescription`
   and `NSLocationAlwaysAndWhenInUseUsageDescription` keys using the
   same strings the plugin block configures. The next `npm run prebuild`
   produces identical content, so the patch is idempotent.

A native rebuild (`npm run ios`) is required either way — a JS reload
won't pick up the plist change.

## AI best practices

### Do

- Use `Result.ok` / `Result.err` for all expected failures.
- Read `REFACTOR_PLAN.md` and the most recent `docs/PHASE_*.md` before
  starting a turn — they document scope decisions and deferred work.
- Match legacy field shapes exactly (read the legacy
  `src/api/firebase/<X>.js` source before writing a DTO/mapper for that
  collection).
- Build the in-memory fake repository BEFORE the real Firestore one;
  the contract is firmer that way.
- Use synchronous unsubscribe for all subscriptions.
- For new screens: write a `useXxxViewModel` hook alongside it, keep
  the screen body dumb (props in, JSX out), and test the view-model in
  isolation against in-memory repository fakes via
  `TestContainerProvider`.
- Server state goes in TanStack Query; client/UI state goes in Zustand.
  Don't mix.
- When in doubt about a legacy quirk, check the legacy
  `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` — it captures most
  of the trial-and-error history.
- Always update `eslint.config.js` boundaries overrides if introducing a
  cross-layer import (only do this for legitimate composition-root
  files).

### Don't

- Don't `console.*` outside the logger.
- Don't `throw` for domain failures — return `Result.err`.
- Don't put business logic in repositories. Logic belongs in entities or
  domain services.
- Don't import data-layer types into domain. Domain knows nothing.
- Don't put presentation code (Zustand stores, navigation, screens) in
  app/use cases.
- Don't forget the DI container is the only place lazy-`require()` is
  acceptable. Everywhere else uses static imports.
- Don't skip the verify gates before committing.
- Don't return promises from subscription methods (legacy footgun
  explicitly fixed).
- Don't put fetched ride/route/payment data in a Zustand store — that's
  what TanStack Query is for. Don't put a UI flag (banner-visible,
  sheet-open) in TanStack Query — that's what Zustand is for.
- Don't grow `RideMonitorScreen` or `DriverMonitorScreen` into a
  god-component. New ride status = add a `RideStatus` literal + a new
  `<Status>View` component + one case in the relevant side's
  status-router. Each view stays prop-driven and independently
  testable.

### Driver-side specifics (Phase 4)

A handful of patterns are specific to the driver-side surfaces. Read
these before touching `useDriverHomeViewModel`,
`useDriverDispatchViewModel`, `useDriverMonitorViewModel`, or any of
the four driver status views.

- **Driver mode mirror.** `useDriverStatusStore` carries a
  `mode: 'offline' | 'online_idle' | 'dispatched' | 'on_trip'` flag.
  `useDriverMonitorViewModel` mirrors `Ride.status` into this flag so
  DriverHome / the tabs / a future Earnings surface don't have to
  re-derive from the in-progress ride query at every read. New ride
  status that the driver should see = update the mirror's switch in
  the VM. `cancelled` always maps to `'online_idle'` (driver re-joins
  the queue); `started` / `payment_requested` / `payment_failed` /
  `completed` all map to `'on_trip'`.
- **Client-side `arrivedAtPickup` derivation (Phase 7 turn 3).**
  Server status `'dispatched'` is split into UI states
  `'en_route_to_pickup'` and `'at_pickup'` via a derived value in
  `useDriverMonitorViewModel`:
  `useGpsIsInsidePickupGeofence() || manualOverride`. The geofence
  half is event-driven by `useGpsLifecycle`'s pickup-geofence
  registration (mounted at AppContent). The manual override
  (`onArriveAtPickup` / `onBackToEnRoute`) remains as resilience for
  GPS drift / cellular dead zones; once tapped, sticks across a
  subsequent EXIT so a transient drift mid-pickup doesn't bounce the
  UI back to en-route. The override resets when the ride leaves
  `'dispatched'`. There's no server-side `at_pickup` state — UI-only
  (legacy parity). Don't reintroduce a stored
  `useState<boolean>` for `arrivedAtPickup` — the OR-derivation is
  the canonical pattern.
- **Real odometer at start / request-payment (Phase 7 turn 3).** The
  VM reads `useGpsCurrentOdometer()` (a cheap `useGpsStore` selector
  hook) and passes the value to both `useStartRideMutation` and
  `useRequestPaymentMutation`. The Cloud Function's server-side fare
  math now sees real GPS distance. Pre-first-delivery default is
  `0`; the entity's `Ride.start({odometerMeters: 0})` accepts that
  (any non-negative finite reading is a valid first odometer); the
  monotonicity check on `Ride.requestPayment` requires
  `odometerMeters >= pickupTiming.odometerMeters` — in practice the
  SDK has fired multiple deliveries between Start ride and Request
  payment so the values ratchet upward. Don't call
  `bgGeolocation.getOdometer()` at click time — the staleness of
  the store value (≤200m / ~30s old per the SDK's `distanceFilter`)
  is preferred over an `await` on the user-facing tap.
- **Terminal-redirect rule.** `useDriverMonitorViewModel` resets the
  stack to `DriverTabs` on `'cancelled'` and `'completed'`.
  `'payment_failed'` intentionally does NOT redirect — the driver
  stays on the failure card and taps "Close trip" themselves
  (`navigation.reset` from the screen). The `redirectedRef` ref guards
  against re-firing across re-renders. If you add a new terminal
  status, decide deliberately whether it auto-redirects; don't blanket
  add to the effect.
- **Two cancel-sheet variants.**
  `presentation/components/trip/CancelReasonSheet` is rider-side
  (gated on `isRiderCode`); `DriverCancelReasonSheet` is driver-side
  (gated on `isDriverCode`). They diverge on the available code list
  (`driver_no_show` rider-only; `passenger_no_show` driver-only) and
  on copy. Both build the `CancellationReason` value object and hand
  it to `onConfirm` — the parent owns submission. Both have an
  explicit `onPress={() => undefined}` on the inner card Pressable to
  absorb press-bubbling under `@testing-library/react-native`'s
  `fireEvent.press` AND to avoid a latent dismiss-on-card-tap touch
  bug in production.
- **DriverMonitor map polyline rules.** The map keeps a fixed pool of
  always-mounted children (the `<Map/>` component's invariant). Drive
  visibility via props:
  - Green driver→pickup polyline (`pickupRoute`): visible during
    server status `'dispatched'`. Hidden in every other state.
  - Gold pickup→dropoff polyline (`selectedRoute`): visible during
    `'started'` / `'payment_requested'` / `'payment_failed'` /
    `'completed'`. Both pickup and dropoff markers stay mounted
    across late-status transitions so the map doesn't visibly redraw.

### Vehicle-side specifics (Phase 5)

Patterns to know before touching `useVehicleListViewModel`,
`useVehicleRegistrationViewModel`, `useVehiclePhotosViewModel`,
`useVehicleDetailsViewModel`, or the DriverHome empty-state branch.

- **Active-vehicle source-of-truth is `useCurrentUserQuery`.** The
  driver's active VIN lives on `user.activeVehicleId`, not on a Zustand
  store. `useDriverStatusStore.activeVehicleId` is a UI mirror set by
  `goOnline(seedId)` and only valid while online — do not reach for it
  to derive list highlights or detail-screen `isActive`. After
  `setActive` / `delete` mutations succeed, the queries layer
  invalidates `user.current` so the next render sees the updated
  pointer.
- **List card tap pushes details, not activate.** `DriverVehicleCard`
  takes `onSelect`, not `onActivate`. The active highlight on the card
  is informational only — set-active is reachable from
  `VehicleDetailsScreen` via `useVehicleDetailsViewModel.onSetActive`,
  which gates on `vehicle.status === 'approved' && !isActive`.
- **VehiclePhotos per-tile state is split across two stores.** Server
  state (URLs already attached) lives in `vehicle.photos[type]` from
  `useVehicleQuery`; local UI state (which tiles are uploading or
  errored) lives in a `useState`-driven `PerTileFlags` map keyed on
  `VehiclePhotoType`. The render-time derivation in `deriveTile`
  composes these into the `VehiclePhotoTileState` tagged union. Don't
  mirror photo URLs into local state — the byVin invalidation after a
  successful upload is the canonical mechanism for the
  idle/uploading → attached transition.
- **Per-tile mutation isolation, single hook.** `useVehiclePhotosViewModel`
  fires a single `useUploadVehiclePhotosMutation` via `mutateAsync`
  per tile. Five concurrent uploads use the same hook instance; the
  per-tile `inFlight` / `errors` flags carry the lifecycle. Don't
  refactor to one hook per `VehiclePhotoType` — that brittles the VM
  against tile-set changes and is no easier to test.
- **`expo-image-picker` permission gate.** `requestMediaLibraryPermissionsAsync`
  runs before `launchImageLibraryAsync` on every tap. Permission
  denial → tile error rather than a silent no-op so the user sees
  what happened. `app.config.ts` carries the iOS permission strings;
  if those are missing, the first picker call hard-fails (RCTFatal,
  same family as the legacy `expo-location` issue).
- **No active vehicle → no online toggle.** `useDriverHomeViewModel`
  exposes `noActiveVehicle: boolean` derived from
  `user.activeVehicleId === null` (driver-role only).
  `DriverHomeScreen` renders an empty-state prompt with a "Register a
  vehicle" CTA in that branch; the online toggle is hidden entirely.
  `onToggleOnline` is itself a no-op when `noActiveVehicle === true`
  — defense in depth on top of the screen guard, not a substitute for
  it. The `'vehicle-stub'` literal is gone; never reintroduce it.
- **Stock photo surfacing on DriverHome.** `useDriverActiveVehicleQuery`
  composes `useCurrentUserQuery` + `GetVehicle` and returns the active
  Vehicle aggregate (or `null`). DriverHome surfaces
  `activeVehicle.stockPhoto ?? activeVehicle.photos.front` as a
  thumbnail in the bottom card while offline. When the legacy
  `activeVehicleId` is malformed (not a real VIN), the query returns
  `null` defensively rather than crashing — log + null is the right
  call here, the screen renders the bottom-card without a thumbnail.

## Quick reference

### File locations

```
Auth use cases             → src/app/usecases/auth/*.ts            (~14)
Service-area use cases     → src/app/usecases/serviceArea/*.ts     (3)
Routes use cases           → src/app/usecases/route/*.ts           (2: ComputeRoutes, EstimateFare)
Ride lifecycle use cases   → src/app/usecases/ride/*.ts            (~13)
Location use cases         → src/app/usecases/location/*.ts        (2)
Trip-tracking use case     → src/app/usecases/trip-tracking/*.ts   (1)
Vehicle use cases          → src/app/usecases/vehicle/*.ts         (9)

Auth repository            → src/data/repositories/FirebaseAuthRepository.ts
User repository            → src/data/repositories/FirestoreUserRepository.ts
ServiceArea repository     → src/data/repositories/FirestoreServiceAreaRepository.ts
Ride repository            → src/data/repositories/FirestoreRideRepository.ts (largest)
Location repository        → src/data/repositories/FirestoreLocationRepository.ts (3-retry backoff)
Vehicle repository         → src/data/repositories/FirestoreVehicleRepository.ts (write-batch + fan-out subscribe)
Vehicle photos repository  → src/data/repositories/FirebaseStorageVehiclePhotoRepository.ts

Routes service             → src/data/services/GoogleRoutesService.ts
Cloud Functions            → src/data/services/CloudFunctionsService.ts (us-east1; tipDriver added in phase 6 turn 2)
BackgroundGeolocation seam → src/data/services/BackgroundGeolocationClient.ts (phase 7 turn 1 — 11 methods, listener-deduped, bare 'pickup' identifier)
FakeBackgroundGeolocationClient → src/shared/testing/FakeBackgroundGeolocationClient.ts (phase 7 turn 1 — programmable in-memory)
withBackgroundFetchMaven plugin → plugins/withBackgroundFetchMaven.js (phase 7 turn 1 — Android Maven repo for tsbackgroundfetch AAR)
NHTSA VIN decoder          → src/data/services/NhtsaVinDecoderService.ts (keyless vPIC + SafetyRatings)
VehicleClassifier (domain) → src/domain/services/VehicleClassifier.ts (manual-entry classifier — phase 5 turn 3)
StripeServerService (domain) → src/domain/services/StripeServerService.ts (interface only — phase 6 turn 1)
StripeServerHttpAdapter    → src/data/services/StripeServerHttpAdapter.ts (phase 6 turn 2 — fetch-backed real impl)
expo-image-picker          → expo-image-picker@~55.0.19 (phase 5 turn 4 — library picker for VehiclePhotos)
@stripe/stripe-react-native → @stripe/stripe-react-native@0.63.0 (phase 6 turn 3 — Wallet UI: CardForm + confirmSetupIntent)
expo-web-browser           → phase 6 turn 4 (Connect onboarding — openAuthSessionAsync)

Stripe IDs (branded)       → src/domain/entities/{StripeCustomerId,StripeAccountId,PaymentMethodId}.ts
Payment value objects      → src/domain/entities/{PaymentMethod,Payout,BalanceTransaction,StripeAccountStatus}.ts
Payment use cases          → src/app/usecases/payment/*.ts                (13 — phase 6 turn 2)
                              EnsureStripeCustomer, CreateSetupIntent, ListPaymentMethods,
                              SetDefaultPaymentMethod, DetachPaymentMethod,
                              EnsureStripeConnectAccount, CreateConnectOnboardingLink,
                              CreateAccountLoginLink, RefreshConnectAccountStatus,
                              GetDriverBalance, ListDriverPayouts, ListBalanceTransactions,
                              ProcessTip
PaymentCallableService     → src/domain/services/PaymentCallableService.ts (interface — phase 6 turn 2)
StripeServerHttpAdapter    → src/data/services/StripeServerHttpAdapter.ts (real impl — phase 6 turn 2)
retryWithBackoff helper    → src/data/services/_shared/retryWithBackoff.ts (phase 6 turn 2)
FakeCloudFunctionsService  → src/shared/testing/FakeCloudFunctionsService.ts (phase 6 turn 2)

Session store              → src/presentation/stores/useSessionStore.ts
Service-area store         → src/presentation/stores/useServiceAreaStore.ts
Trip-draft store           → src/presentation/stores/useTripDraftStore.ts (pre-CreateRide draft)
Geofence-UI store          → src/presentation/stores/useGeofenceUiStore.ts (banner visibility)
GPS store                  → src/presentation/stores/useGpsStore.ts (phase 7 turn 2 — SDK location/geofence mirror; selector hooks for VMs)
Chat-UI store              → src/presentation/stores/useChatUiStore.ts (open flag, lastReadAt)
GPS lifecycle hook         → src/presentation/hooks/useGpsLifecycle.ts (phase 7 turn 2 — AppContent-only; init/permission/start/stop + location+geofence subs + chain teardown)
Active-ride-for-geofence   → src/presentation/hooks/useActiveRideForGeofence.ts (phase 7 turn 2 — discovers + live-overlays the dispatched ride)
useBackgroundGeolocation   → src/presentation/di/ContainerProvider.tsx (phase 7 turn 2 — sibling of useUseCases())

Root navigator             → src/presentation/navigation/RootNavigator.tsx
Auth / VerifyEmail navs    → src/presentation/navigation/{AuthNavigator,VerifyEmailNavigator}.tsx
Rider stack + tabs         → src/presentation/navigation/{RiderNavigator,RiderTabsNavigator}.tsx
Driver stack               → src/presentation/navigation/DriverNavigator.tsx
                              (DriverTabs, DriverDispatch, DriverMonitor, UserProfile,
                               Vehicles, VehicleRegistration, VehicleDetails, VehiclePhotos)

Rider screens              → src/presentation/features/rider/screens/*.tsx
                              RiderHome, RouteSearch, RouteSelect, RideMonitor, RideReceipt,
                              ActivityPlaceholder, Wallet, AddPaymentMethod
Rider components           → src/presentation/features/rider/components/
                              WalletCardRow (phase 6 turn 3 — text-only BrandBadge + last4 + expiry + default-checkmark + trash)
                              TipSelector (phase 6 turn 5 — preset chips + custom + CTA + error band; tip flow on RideReceipt)
Rider status-views         → src/presentation/features/rider/components/
                              {AwaitingDriver,Dispatched,Started,Completed,PaymentFailed}View.tsx
Rider view-models          → src/presentation/features/rider/view-models/use*ViewModel.ts
                              (incl. useWalletViewModel, useAddPaymentMethodViewModel — phase 6 turn 3;
                               useTipFlowViewModel — phase 6 turn 5)
Shared presentation utils  → src/presentation/utils/*.ts
                              formatMoney (phase 6 turn 5 — re-homed from features/driver/utils)
Payment queries            → src/presentation/queries/payment.queries.ts
                              Rider-side (5 hooks — phase 6 turn 3): useEnsureStripeCustomerMutation,
                               useCreateSetupIntentMutation, useListPaymentMethodsQuery,
                               useSetDefaultPaymentMethodMutation, useDetachPaymentMethodMutation
                              Driver-side (7 hooks — phase 6 turn 4): useEnsureStripeConnectAccountMutation,
                               useCreateConnectOnboardingLinkMutation, useRefreshConnectAccountStatusMutation,
                               useDriverBalanceQuery, useDriverPayoutsQuery, useBalanceTransactionsQuery,
                               useCreateAccountLoginLinkMutation
                              Tip flow (1 hook — phase 6 turn 5): useProcessTipMutation
                               (no cache invalidation — receipt VM's live observeTripPayments lands the row)

Driver screens             → src/presentation/features/driver/screens/*.tsx
                              DriverHome, DriverDispatch, DriverMonitor,
                              DriverNavigation (phase 8 turn 2 — Google Nav SDK turn-by-turn),
                              DriverActivityPlaceholder, DriverEarnings (phase 6 turn 4),
                              VehicleList, VehicleRegistration, VehicleDetails, VehiclePhotos
                              (DriverEarningsPlaceholderScreen retained as a deprecation stub)
Driver status-views        → src/presentation/features/driver/components/
                              {EnRouteToPickup,AtPickup,Started,PaymentRequested,
                               Completed,PaymentFailed}View.tsx
Driver components          → src/presentation/features/driver/components/
                              DriverRideCard, DriverRideCardStack,
                              DriverVehicleCard, VinEntryStep, DecodedPreviewStep, ManualEntryStep,
                              VehiclePhotoTile, VehiclePhotoGrid,
                              PayoutRow, BalanceTransactionRow (phase 6 turn 4)
Driver hooks               → src/presentation/features/driver/hooks/*.ts (phase 6 turn 4)
                              useStripeConnectOnboarding (multi-step onboarding launcher)
                              useNavigationSdkConnector (phase 8 turn 2 — pushes SDK controller into adapter)
Driver utils               → src/presentation/features/driver/utils/*.ts
                              formatMoney (1-line re-export shim — phase 6 turn 5 moved the canonical
                               file to src/presentation/utils/formatMoney.ts; remove the shim in any
                               non-sandbox checkout)
Driver view-models         → src/presentation/features/driver/view-models/use*ViewModel.ts
                              (incl. useVehicleListViewModel, useVehicleRegistrationViewModel,
                               useVehicleDetailsViewModel, useVehiclePhotosViewModel,
                               useDriverEarningsViewModel — phase 6 turn 4;
                               useDriverNavigationViewModel — phase 8 turn 2)
Driver cancel sheet        → src/presentation/components/trip/DriverCancelReasonSheet.tsx
                              (shared by every cancel-eligible driver status view)
Vehicle queries            → src/presentation/queries/vehicle.queries.ts
                              (decode + register + setActive + delete + upload mutations;
                               byVin + activeForDriver one-shot reads; list subscription goes via VM directly)

Driver-status store        → src/presentation/stores/useDriverStatusStore.ts
                              (offline / online_idle / dispatched / on_trip + activeVehicleId)

DI container               → src/presentation/di/container.ts
TestContainerProvider      → src/shared/testing/TestContainerProvider.tsx
```

### Import paths (TS path aliases)

```ts
import { ... } from '@domain/entities/...';
import { ... } from '@domain/repositories';
import { ... } from '@domain/services';
import { ... } from '@app/usecases/...';
import { ... } from '@data/repositories/...';
import { ... } from '@data/mappers/...';
import { ... } from '@presentation/...';
import { ... } from '@shared/logger';
import { ... } from '@shared/env';
import { ... } from '@shared/testing';
```

---

**End of CLAUDE.md.** When in doubt, read the most recent
`docs/PHASE_*.md` for what shipped (latest: `PHASE_9_TURN_7.md`),
then ask.
