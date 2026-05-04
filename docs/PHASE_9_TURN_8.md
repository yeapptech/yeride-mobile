# Phase 9 — Turn 8: GPS lifecycle telemetry

Phase 9 Turn 7 closed the Receipt UX polish (card brand + last-4
wallet-cache join, email-button stub removal, shared `CardBrandBadge`).
Manual smoke confirmed the trip flow end-to-end against `yeapp-stage`,
and the `tipDriver` server-side post-completion-window patch is
deployed.

Turn 8 spends the rawMeta-channel contract that Turn 6 landed on the
GPS pipeline. The `useGpsLifecycle` hook (mounted exactly once at
AppContent) is the next surface to fan its chain-fatal failure paths
out to Crashlytics `recordError`. Two `LOG.warn → LOG.error` flips
land here; the SDK adapter and Firestore location repository are
audited but not modified — the audit found candidate sites that are
genuinely worth telemetry but each requires either constructed-Error
wrapping or a coordinated audit pass that's out-of-band for this
turn's scope, and the kickoff explicitly named that "audit was
thorough, found nothing else worth flipping" outcome as legitimate.

Acceptance: **181 test suites / 1568 tests passing** (+0 suites,
+2 tests over Turn 7's 181/1566, at the floor of the kickoff's
"+2 to +4 tests" estimate band).

## Pre-checklist answers (from kickoff)

All four pre-checklist questions answered with the Recommended
option:

1. **Flip surface** — L245 + L250 only. Cleanup-best-effort sites
   (L170, L283, L317-L320) stay at warn.
2. **Permission-denied path** — stay info. User-choice path,
   matches Turn 4's terms-declined precedent.
3. **Firestore repo exhaustion log** — already covered downstream
   at L250 once that flip lands; leave the repo alone.
4. **Scope width** — useGpsLifecycle telemetry only. Foreground-push
   removal cleanup and permission-denied UX deferred to separate
   turns where they get full attention.

## What's in

### 1. Two `LOG.warn → LOG.error` flips in `useGpsLifecycle`

| Site                                 | Old    | New         | Why                                                                                                                                                                                                                          |
| ------------------------------------ | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useGpsLifecycle.ts:L254` (was L245) | `warn` | **`error`** | `UserLocation.create` rejected — logic-bug signal. The SDK adapter normalizes `coords.speed` and `Coordinates.create` rejects bad lat/lng before events reach this hook, so a failure here means an upstream contract broke. |
| `useGpsLifecycle.ts:L266` (was L250) | `warn` | **`error`** | `useUpdateLocationMutation` `onError` — the wrapped `NetworkError` after `FirestoreLocationRepository`'s 3-retry backoff exhausts. Location pipeline is dead until the next delivery; degraded operation worth a non-fatal.  |

Both sites already pass real `Error` instances — `locR.error` is a
`ValidationError` (extends `DomainError` extends `Error`); the
mutation `onError`'s `e` is the re-thrown `NetworkError` from
`location.queries.ts:31`'s `mutationFn`. The rawMeta channel
(`extractError(rawMeta ?? meta)`) resolves both to reference identity
without needing constructed-Error wrappers (unlike Turn 4's non-OK
NavRouteStatus site).

Inline JSDoc at each flipped site explains the level choice. Three
cleanup-best-effort sites that intentionally stay at warn (L172,
L286, L319-L322) get one-line `// stays warn — best-effort cleanup`
comments so the level choice is visible to a future reader.

### 2. Two new telemetry tests

Added to `src/presentation/hooks/__tests__/useGpsLifecycle.test.tsx`
under a new describe block
`'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 8)'`:

- `UserLocation.create failure → recordError fires with the ValidationError reference` —
  drives the path by emitting a location event with `speed: -1`
  (the fake adapter passes events through verbatim, so this
  exercises `UserLocation.create`'s `user_location_invalid_speed`
  rejection without monkey-patching the entity). Asserts on
  `validationRecord.error.code === 'user_location_invalid_speed'`
  rather than reference identity since each test instantiates a
  fresh `ValidationError` inside the entity factory — what matters
  is the recordError sees a real `Error` instance carrying the
  validation code, not whether the test owns the reference.
- `updateLocation mutation failure → recordError fires with the NetworkError reference` —
  seeds `locations.mockUpdateError(networkErr)` and emits a valid
  location event. The mutation `mutationFn` re-throws the seeded
  error; the `onError` callback fires; L250's flipped `LOG.error`
  reaches the transport. Asserts reference identity
  (`recorded.find(r => r.error === seededError)`) — proves the
  rawMeta channel preserves the original `NetworkError` through
  `sanitizeForLogging` rather than passing a sanitized stand-in.

Each test asserts the recorded `name` field matches the hook's
logger scope (`'YeRide:GpsLifecycle'`) so Firebase Console groups
non-fatals correctly. Each test wraps the body in
`try {...} finally { LOG.removeTransport(transport) }` so the
singleton `LOG`'s transport list stays clean across the suite.
Pattern mirrors `Logger.test.ts:244-267` and Turn 4's nav VM
telemetry tests.

### 3. Audit findings (out-of-scope but documented)

The audit walked `useGpsLifecycle.ts`, `BackgroundGeolocationClient.ts`,
and `FirestoreLocationRepository.ts` for silent failure paths and
warn-level sites that arguably deserve `recordError` fan-out.

#### `useGpsLifecycle.ts`

11 LOG sites total:

- 4 already at `LOG.error` (init / requestAuthorization / start /
  addPickupGeofence — chain-fatal entry points). All pass real
  `Error` instances; rawMeta channel works today.
- 5 at `LOG.warn`:
  - 2 flipped this turn (L245 → L254, L250 → L266).
  - 3 stay warn — `stop returned error` on disable (L172),
    `removePickupGeofence error` on trip flip (L286), teardown errors
    on unmount (L319-L322). All cleanup-best-effort; the next session's
    re-init recovers cleanly.
- 1 at `LOG.info` — `permission not granted` (L207). Stays info per
  pre-checklist Q2; user explicitly declined the OS dialog.

No silent failure paths. Hook is fully covered.

#### `BackgroundGeolocationClient.ts`

13 LOG sites total:

- 9 at `LOG.error` — every `init`/`start`/`stop`/geofence/odometer/
  permission catch maps to `Result.err(NetworkError | AuthorizationError)`
  with `cause` carrying the original throw. The hook's L186/L201/L222/L301
  log at error too, so each adapter-side failure produces a duplicate
  Crashlytics non-fatal. **Slight noise**; the duplicates carry
  different scope names (`'YeRide:BgGeolocation'` vs
  `'YeRide:GpsLifecycle'`) so Firebase Console groups them under
  separate issues. Could be deduped in a future turn by demoting the
  adapter-side log to `LOG.debug` — but the adapter-side LOG is a
  legitimate breadcrumb on the `'YeRide:BgGeolocation'` scope and
  removing it would lose adapter-internal context. Logged for
  follow-up consideration.
- 4 at `LOG.warn`:
  - `removeAllListeners failed (non-fatal)` — cleanup; stays warn.
  - `handleLocation: invalid coords from SDK` — defensive guard.
    Meta is plain `{code: coordsR.error.code}`, not an `Error`.
    Constructing an Error at the LOG site would let the rawMeta
    channel fan out (Turn 4's NavRouteStatus pattern), but SDK
    contract violations here are platform-level bugs (Android/iOS
    GPS subsystem misreporting) — extremely rare. Logged for
    follow-up.
  - `handleLocation/handleGeofence: subscriber threw` — fan-out loop
    defensive catch. Subscribers are domain-side callbacks; a throw
    means a hook bug. Could flip to error with reference-passed `e`
    (it is a real Error here). Different blast radius from the hook
    boundary — the subscriber that threw doesn't necessarily know
    its callback was firing into the SDK. Logged for follow-up.
  - `onLocation: error` — SDK error code (numeric like `1` for
    location-services-disabled, `408` for timeout). Constructing
    an Error at the LOG site to carry the code would enable
    Crashlytics grouping by SDK error code. Useful telemetry but
    the scope is platform-level OS conditions, not application
    bugs. Logged for follow-up.

#### `FirestoreLocationRepository.ts`

5 LOG sites total:

- 1 at `LOG.error` — `updateLocation failed after retries` (L73).
  Meta is `lastError` (typed `unknown`). `lastError` is the underlying
  Firestore SDK rejection — usually an Error instance with a `code`
  field, but the `unknown` typing means the rawMeta channel sees an
  Error reference at runtime. The wrapped `NetworkError` is then
  re-thrown by the mutation's `mutationFn` and lands at L266's
  hook-side error log, which DOES record. So the repo-side
  `LOG.error` already fans out cleanly today; the user-facing
  Crashlytics event records once at the hook boundary (the cleaner
  scope grouping). Pre-checklist Q3 confirmed: leave the repo
  alone.
- 4 at `LOG.warn`:
  - `updateLocation failed, retrying` — per-attempt; the final
    exhaustion at L73 is the canonical record. Stays warn.
  - `subscribeToLocation: doc failed schema validation` /
    `entity construction` — DTO parse failure. Meta is plain object
    (`{userId, code: parsed.error.code}`), not an Error. Constructing
    an Error to carry the validation code would surface bad-doc
    rates in Firebase Console; useful but cross-cuts every
    Firestore repository (rideMapper / userMapper / vehicleMapper
    all log the same shape). Audit pass for Phase 10 cutover prep.
  - `subscribeToLocation stream error` — Firestore stream callback.
    Plain object meta. Same audit-pass scope.
  - `getLastKnown failed` — same shape.

#### Net audit verdict

The hook is well-covered after this turn's two flips. The SDK
adapter and Firestore repo have additional candidate sites but
each requires either constructed-Error wrapping or a coordinated
audit pass across multiple repositories. Pre-checklist Q3
explicitly chose to defer the repo-side instrumentation; the
adapter-side and cross-cutting Firestore audit are logged below
as follow-ups.

## What's out (deferred to follow-up turns)

- **Foreground-push removal cleanup.** `useDriverMonitorViewModel`
  no longer has a foreground location-push effect after Turn 4 —
  re-checked during Turn 8's audit. The Turn 4 doc's claim of a
  remaining "harmless double-write" predates the Turn 4 removal
  itself; the cleanup is already in. (Phase 7 docs in `CLAUDE.md`'s
  status block correctly reflect this — only the Turn 4 closing
  doc carried the stale text.)

- **Permission-denied UX.** Wire a `Linking.openSettings()` CTA
  for riders/drivers who decline the OS dialog. Cross-cuts UI;
  needs a dialog/banner component and screen integration in
  DriverHome / RiderHome. Separate turn.

- **SDK adapter telemetry flips.** The 4 audit candidates in
  `BackgroundGeolocationClient` (handleLocation invalid coords,
  subscriber-threw, onLocation error code) — each a small flip
  but the value depends on whether SDK-platform-level bugs
  actually fire in production. Worth checking field telemetry
  after this turn lands before instrumenting more.

- **Cross-cutting Firestore mapper telemetry audit.**
  `subscribeToX: doc failed schema validation` shows up in 4-5
  repositories (locations / rides / users / vehicles / payments).
  Coordinated audit pass; Phase 10 cutover prep candidate.

- **RNFirebase modular-API migration.** Mechanical refactor
  across every RNFirebase consumer — five packages, dozens of
  call sites. Phase 10 cutover-prep task.

- **Receipt PDF download.** Phase 9 polish item per Turn 7's
  "what's out" list.

- **Per-brand SVG glyphs.** Deferred from Turn 7; the PNG glyphs
  are visually identical at receipt-row size.

- **Webhook-side cardBrand+last4 write.** `yeride-stripe-server`
  cross-repo work to populate the trip-payment doc directly so
  the receipt VM doesn't have to wallet-join. Out-of-band.

## Risks surfaced (still observability scope)

### Adapter-side and hook-side LOG.error duplication

After this turn, an SDK init failure produces two Crashlytics
non-fatals:

- One under scope `'YeRide:BgGeolocation'` from the adapter's
  `logger.error('init failed', e)` at L206.
- One under scope `'YeRide:GpsLifecycle'` from the hook's
  `logger.error('init failed', initR.error)` at L186.

Firebase Console groups by scope, so each shows up as a separate
issue. Helpful for triage (the adapter scope carries the raw SDK
throw; the hook scope carries the wrapped `NetworkError`) but
slightly noisy on the dashboard. Could be addressed by demoting
the adapter-side log to `debug` — the cost is losing the
adapter-internal breadcrumb when a hook-side log doesn't fire
(e.g. an init failure during adapter-instance construction
before the hook subscribes). Tradeoff documented; no change this
turn.

### `validationRecord` reference identity caveat

The first new test asserts `validationRecord.error.code ===
'user_location_invalid_speed'` rather than reference identity. This
is correct because `UserLocation.create` instantiates a fresh
`ValidationError` per call; the test doesn't own the reference.
A future change to `UserLocation.create` that reused a singleton
ValidationError per error code would silently let the test pass
under a wrong code mapping (the assertion checks code presence,
not the specific error value). This is unlikely — Result-based
factories typically allocate per-call — but worth noting if a
contributor refactors to a const-error pattern.

### Test-singleton hygiene (carried from Turn 4)

The two new tests attach a `CrashlyticsLogTransport` to the
singleton `LOG` and detach it in a `try/finally`. Same hygiene
risk as Turn 4: a future test that forgets the `finally` would
leak the transport into subsequent tests in the same Jest worker.
Documented inline in the describe-block JSDoc.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + chunked `npm test` all green. Per the prior
turns' sandbox conventions, the full test suite is run in 7 chunks
because the single-pass time exceeds the sandbox's 45s bash
timeout.

**181 test suites / 1568 tests** passing.

Delta vs. Phase 9 Turn 7 close baseline (181 suites / 1566 tests):
**+0 suites / +2 tests**. At the floor of the kickoff's "+2 to +4
tests" estimate band — the audit-was-thorough-found-nothing
outcome the kickoff explicitly named as legitimate.

Test-suite breakdown verified across 7 chunks:

| Chunk pattern                                                                              | Suites | Tests |
| ------------------------------------------------------------------------------------------ | -----: | ----: |
| `src/(shared\|presentation/(di\|hooks\|components))`                                       |     31 |   291 |
| `src/presentation/features/rider`                                                          |     14 |   109 |
| `src/presentation/features/driver`                                                         |     24 |   172 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent)` |      7 |    55 |
| `src/(domain\|app)`                                                                        |     88 |   662 |
| `src/data`                                                                                 |     16 |   273 |
| `src/presentation/__tests__/AppContent`                                                    |      1 |     6 |
| **Total**                                                                                  |    181 |  1568 |

End-of-Turn-8 acceptance criteria, all met:

1. ✅ Two `LOG.warn → LOG.error` flips landed in `useGpsLifecycle.ts`
   (L245 → L254, L250 → L266 in line numbers after the edit). Both
   sites pass real `Error` instances; the rawMeta channel fans them
   out cleanly without constructed-Error wrappers.
2. ✅ Three cleanup-best-effort sites (L172, L286, L319-L322) get
   inline `// stays warn — best-effort cleanup` comments so the
   level choice is visible.
3. ✅ Two new telemetry tests prove `recordError` fan-out works
   end-to-end for each new site: ValidationError code surfaces
   correctly and NetworkError reference identity is preserved.
4. ✅ Audit findings documented for `BackgroundGeolocationClient`
   (4 candidate sites, deferred) and `FirestoreLocationRepository`
   (4 candidate sites, deferred). Hook is fully covered.
5. ✅ All four verify gates green (each step individually under
   the sandbox's 45s bash timeout; chunked test run as in prior
   turns).
6. ✅ `docs/PHASE_9_TURN_8.md` written (this file).
7. ✅ `CLAUDE.md` updated to reflect Phase 9 Turn 8 close.
8. ✅ Smoke checklist documented for user-driven validation.
9. ✅ Clean commit on `main` via the sandbox `GIT_INDEX_FILE`
   shadow plumbing pattern.

No native config changes. No new dependencies. No prebuild
required. No DI container changes. No cross-repo work.

## Smoke checklist (user-driven)

The smoke for this turn is largely "trigger an offline scenario
and confirm the non-fatal lands in Firebase Console." Estimated
time: 5-10 minutes.

### Pre-smoke

1. `npm run prebuild` (no native config changes; habit catches
   drift).
2. `cd ios && pod install` (no podspec changes; conventional
   after prebuild).
3. `npm run ios` to a clean iPhone 17 simulator OR `npm run
android` to a Pixel 10 Pro emulator.

### Smoke flow — L250 path (NetworkError post-retry exhaustion)

The `FirestoreLocationRepository`'s 3-retry backoff (1s + 2s + 4s
delays) means a successful exhaustion takes ~7 seconds. Two ways
to drive it:

**Option A — airplane mode mid-trip:**

1. Sign in as a test driver. Toggle online.
2. Wait for or seed an `awaiting_driver` ride within range.
3. Tap Accept; land on DriverMonitor with the polyline.
4. Toggle airplane mode on the device. Wait ~10-15s for the next
   `BackgroundGeolocation.onLocation` delivery.
5. The 3-retry backoff exhausts; the mutation `onError` fires;
   L266 logs at error.
6. Toggle airplane mode off. The next delivery succeeds (no
   replay of the failed one — the SDK already moved past it).

**Option B — Firestore offline persistence disabled + simulated
network down (test environment only):**

1. Set `Firestore.disableNetwork()` from a debug shortcut.
2. Drive a location event delivery.
3. After ~7s, `LOG.error` fires.
4. `Firestore.enableNetwork()`; subsequent deliveries succeed.

### Smoke flow — L254 path (ValidationError logic-bug signal)

This path is genuinely hard to drive against a real device — it
fires only on an upstream contract violation. Pre-checklist Q1
explicitly chose this site because it's a logic-bug signal worth
recording, not because it's expected to fire often. The unit test
covers the wire-up; field firing would represent a real bug.

### Acceptance signals

- ✅ Within ~1-2 minutes of the airplane-mode test, a non-fatal
  appears in Firebase Console → Crashlytics → Non-fatals for
  `yeapp-stage` under issue name `YeRide:GpsLifecycle`.
- ✅ The non-fatal carries the `NetworkError` message (`'Could
not write location after 3 retries'`).
- ✅ The breadcrumb stream above the non-fatal includes `[YeRide:
GpsLifecycle] updateLocation mutation failed`.
- ✅ No new red-box JS errors in the Metro console.

### Failure-path checks (optional)

- Permission denial: revoke the location permission via OS
  Settings; re-launch the app. The hook's L207 logs at info (per
  pre-checklist Q2); confirm NO non-fatal appears for the
  permission decline.
- Cleanup teardown errors: not testable from outside; the
  cleanup-best-effort sites stay at warn precisely because they
  don't manifest user-visible failures.

## Files added / touched

**Added:**

- `docs/PHASE_9_TURN_8.md` — this file.

**Touched:**

- `src/presentation/hooks/useGpsLifecycle.ts` — flipped 2
  `logger.warn` → `logger.error` in the location-subscription
  effect (lines 254 + 266 after edit). Added inline JSDoc at
  each flipped site explaining the level choice. Added one-line
  `// stays warn — best-effort cleanup` comments to 3
  intentionally-warn sites (L172, L286, L319-L322) for future
  reader visibility.
- `src/presentation/hooks/__tests__/useGpsLifecycle.test.tsx` —
  added 2 telemetry tests in a new describe block. Added imports
  for `CrashlyticsLogTransport` + `LOG` from `@shared/logger`
  and `FakeCrashReportingService` from `@shared/testing`.
- `CLAUDE.md` — top status block + phase-tables row for Turn 8.

---

## Phase 9 — combined summary (through Turn 8)

| Turn           | Scope                                                                                       | Tests delta            | Status |
| -------------- | ------------------------------------------------------------------------------------------- | ---------------------- | ------ |
| 1              | iOS Apple Maps Fabric escape — PROVIDER_GOOGLE flip                                         | +1 suite / +6 tests    | ✅     |
| 2              | Push notifications — Expo registration + tap routing                                        | +8 suites / +117 tests | ✅     |
| 3              | Crashlytics integration end-to-end across 3 sub-turns                                       | +8 suites / +108 tests | ✅     |
| 6              | Observability cleanup (rawMeta channel + ErrorBoundary + boundaries-rule v6)                | +1 suite / +16 tests   | ✅     |
| 4              | DriverNavigation polish + SDK telemetry + foreground-push removal                           | +0 suites / +4 tests   | ✅     |
| 5              | Passenger-snapshot Stripe gap close                                                         | +0 suites / +6 tests   | ✅     |
| 4 smoke fix    | Receipt schema accepts `'payment_intent'` / `'closed'` wire statuses (cross-repo, deployed) | +0 suites / +4 tests   | ✅     |
| 4 smoke fix #2 | `TripPayment.amount` is integer cents, not dollars                                          | +0 suites / +3 tests   | ✅     |
| 7              | Receipt UX polish — card brand + last-4 + email-button stub removal + CardBrandBadge        | +1 suite / +34 tests   | ✅     |
| 8              | GPS lifecycle telemetry — 2 LOG.warn → LOG.error flips + audit                              | +0 suites / +2 tests   | ✅     |

Cumulative Phase 9 delta (Phase 8 close 160/1268 → Phase 9 Turn 8
close 181/1568): **+21 suites / +300 tests**.

Phase 9 has now closed: the iOS Map regression, the
push-notifications gap, the Crashlytics integration, the
observability cleanup follow-ups, the DriverNavigation polish + SDK
telemetry, the passenger-snapshot Stripe gap, the receipt-schema
payment-pipeline gap, the receipt UX polish, and the GPS lifecycle
telemetry. The remaining items in the kickoff's "Phase 9+" scope
(SDK adapter telemetry flips, cross-cutting Firestore mapper audit,
permission-denied UX, RNFirebase modular API, receipt PDF download)
either require pre-cutover decisions or are independently small —
candidates for either Phase 10 cutover prep or their own dedicated
Phase 9 turns as the user picks the next direction.
