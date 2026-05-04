# Phase 9 — Turn 9: SDK-adapter telemetry flips

Phase 9 Turn 8 closed the GPS lifecycle telemetry — two
`LOG.warn → LOG.error` flips in `useGpsLifecycle.ts` route
`UserLocation.create` failures and post-retry mutation exhaustion
through Crashlytics `recordError` via the rawMeta channel. Turn 8's
audit catalogued 4 candidate sites in `BackgroundGeolocationClient.ts`
that were deferred because each required either constructed-Error
wrapping (Turn 4's NavRouteStatus pattern) or coordinated cross-repo
work.

Turn 9 spends the rawMeta channel on those four sites. Three different
shapes of intervention land in one file, plus the mock-side helper to
drive the previously-untestable SDK error-callback path.

Acceptance: **181 test suites / 1573 tests passing** (+0 suites / +5
tests over Turn 8's 181/1568, within the kickoff's "+4 to +8 tests"
estimate band).

## Pre-checklist answers (from kickoff)

All four pre-checklist questions answered with the Recommended option:

1. **Flip surface** — All four candidate sites: L348 `onLocation: error`,
   L480 `handleLocation: invalid coords`, L502 + L547 subscriber-threw.
2. **L348 Error shape** — Code-in-message:
   `new Error(\`bg_geolocation_onlocation_error: code=${errorCode}\`)`.
   Crashlytics groups by name+message so distinct numeric codes each
   form their own Firebase Console issue (useful triage signal — code
   1 = permission denied, code 408 = timeout, etc).
3. **L480 Error shape** — Pass `coordsR.error` directly. The
   `ValidationError` from `Coordinates.create` is already a real
   `Error` instance (extends `DomainError` extends `Error`); the rawMeta
   channel fans it out to `recordError` with the validation `code` on
   the reference. No constructed-Error wrapper needed.
4. **Adapter ↔ hook duplicate noise** — Leave both at error. Different
   scope names (`'YeRide:BgGeolocation'` vs `'YeRide:GpsLifecycle'`)
   group under separate Firebase Console issues, useful for triage
   (the adapter scope carries the raw SDK throw; the hook scope
   carries the wrapped `NetworkError` with `cause` chain). Slight
   dashboard noise is acceptable; can be revisited after field
   telemetry shows whether it's an actual problem.

## What's in

### 1. Four `LOG.warn → LOG.error` flips in `BackgroundGeolocationClient.ts`

| Site                                    | Old    | New         | Shape                             | Why                                                                                                                                                                                                                                                |
| --------------------------------------- | ------ | ----------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L348 `onLocation: error`                | `warn` | **`error`** | Constructed `Error` with code     | SDK platform-level failure of the location pipeline (permission denied, network unavailable, timeout). The original meta `{code}` is a plain object — without a constructed wrapper the rawMeta channel skips `recordError`.                       |
| L480 `handleLocation: invalid coords`   | `warn` | **`error`** | Pass `coordsR.error` (real Error) | SDK contract violation — platform's GPS subsystem fed us NaN or out-of-range lat/lng. Extremely rare but if it fires it's a real platform-level bug. `ValidationError` is already an `Error` instance; flow as-is.                                 |
| L502 `handleLocation: subscriber threw` | `warn` | **`error`** | Pass `e` (real Error)             | A synchronously-throwing subscriber is a domain-side bug — the registered hook/VM callback threw inside the SDK fan-out. The throwing subscriber doesn't know its callback was firing into the SDK; without telemetry the bug goes nowhere useful. |
| L547 `handleGeofence: subscriber threw` | `warn` | **`error`** | Pass `e` (real Error)             | Same shape as L502 on the geofence stream. Same rationale.                                                                                                                                                                                         |

The 9 already-at-error chain-fatal entry points (init / start / stop /
addPickupGeofence / removePickupGeofence / removeAllGeofences /
getOdometer / resetOdometer / requestPermission) carry their existing
behavior. Per pre-checklist Q4, the duplicate-non-fatal noise (4 of
those 9 have hook-side `LOG.error` counterparts in `useGpsLifecycle`)
is left in place — different scopes group under separate Firebase
issues for useful triage.

Inline JSDoc at each flipped site explains the level choice. The
remaining cleanup-best-effort site at L465 (`removeAllListeners failed
(non-fatal)`) gets a `// stays warn — best-effort cleanup` comment so
the level choice is visible to a future reader.

### 2. Mock-side helper: `__emitLocationError(code)`

The pre-Turn-9 `jest.setup.ts` SDK mock captured the first arg passed
to `BackgroundGeolocation.onLocation()` (the location callback) but
ignored the second arg (the error callback the SDK invokes with
numeric error codes). To drive L348 in tests, the mock now:

- Captures the optional `onError` second arg into a new
  `mockBgListeners.locationError` bucket.
- Returns a Subscription whose `.remove()` tears BOTH callbacks out
  of their respective buckets (location-listener removal must clean
  up the error-listener too).
- Exposes `__emitLocationError(code: number)` alongside
  `__emitLocation` and `__emitGeofence`. Mirror of the existing
  helper-naming convention.
- The `__reset()` helper clears the new bucket alongside the
  existing ones.

### 3. Five new regression tests

Added to `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
under a new `describe` block
`'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 9)'`:

- **`onLocation SDK error code → recordError fires with a constructed Error carrying the code`**
  — drives `__emitLocationError(1)`, asserts the recorded Error's
  message contains `'code=1'` and `'bg_geolocation_onlocation_error'`,
  and asserts the recorded `name === 'YeRide:BgGeolocation'`. Loose
  message-substring assertion follows Turn 4's NavRouteStatus
  precedent (cosmetic edits OK; removal of the code from the message
  would be caught).
- **`routine onLocation status (code 0 / 499) does NOT fire recordError`**
  — sanity check that codes 0 (OK) and 499 (client cancelled) stay at
  info level and do NOT recordError; breadcrumbs DO record (helpful
  for triage if a later error fires). Pins the routine-vs-failure
  bifurcation in the SDK error callback.
- **`invalid coords from SDK → recordError fires with the ValidationError carrying the validation code`**
  — emits a location event with `latitude: 999` (out-of-range),
  asserts `Coordinates.create` rejection flows through, asserts the
  recorded Error's `code` field is `'coordinates_lat_out_of_range'`,
  and asserts subscribers received NOTHING (defensive guard fires
  before fan-out).
- **`location subscriber throws → recordError fires with the thrown Error (fan-out continues)`**
  — registers two location subscribers, one of which throws; emits
  an event; asserts reference identity on the recorded Error
  (`r.error === seededError`), asserts the peer subscriber DID
  receive the event (fan-out resilience), and asserts the throwing
  subscriber was called once before throwing.
- **`geofence subscriber throws → recordError fires with the thrown Error (fan-out continues)`**
  — same shape on the geofence stream.

Each test wraps the body in
`try {...} finally { LOG.removeTransport(transport) }` so the
singleton `LOG`'s transport list stays clean across the suite.
Pattern mirrors `Logger.test.ts:244-267` and Turn 4's nav VM
telemetry tests.

### 4. Audit findings (re-verified)

The audit re-walked the same surface Turn 8 walked: 13 LOG sites in
`BackgroundGeolocationClient.ts`. Post-Turn-9 distribution:

- **13 at `LOG.error`** (was 9): the 9 already-at-error chain-fatal
  entry points + the 4 sites flipped this turn.
- **1 at `LOG.warn`**: `removeAllListeners failed (non-fatal)` at
  L483 — cleanup-best-effort, tagged with explicit
  `// stays warn — best-effort cleanup` comment per Turn 8's pattern.
- **8 at `LOG.info`**: deliberate decisions for routine status
  (init/start/stop happy path, addPickupGeofence/removePickupGeofence
  registered, routine onLocation status codes 0/499, ignoring unknown
  geofence actions).

`useGpsLifecycle.ts` stays as Turn 8 left it (4 chain-fatal at error,
2 cleanup-best-effort + 1 trip-flip cleanup at warn, 1 user-choice at
info). `FirestoreLocationRepository.ts` stays as Turn 8 left it (1 at
error covering the post-retry exhaustion path, 4 at warn for
per-attempt retry log + DTO-parse / stream / getLastKnown failures
— flagged as Phase 10 cross-cutting Firestore mapper telemetry audit
candidates).

## What's out (deferred to follow-up turns)

- **Cross-cutting Firestore mapper telemetry audit.** `subscribeToX:
doc failed schema validation` shows up in 4-5 repositories
  (locations / rides / users / vehicles / payments). Coordinated
  audit pass; Phase 10 cutover prep candidate. Turn 8's audit and
  Turn 9's audit both flagged this; the constructed-Error pattern
  needed for plain-object meta would multiply across mappers.

- **Permission-denied UX.** Wire a `Linking.openSettings()` CTA
  for riders/drivers who decline the OS dialog. Cross-cuts UI;
  needs a dialog/banner component and screen integration in
  DriverHome / RiderHome. Separate turn.

- **RNFirebase modular-API migration.** Mechanical refactor across
  every RNFirebase consumer. Phase 10 cutover-prep task.

- **Receipt PDF download.** Phase 9 polish item, unchanged from
  Turn 8.

- **Per-brand SVG glyphs.** Deferred from Turn 7.

- **Webhook-side cardBrand+last4 write.** Cross-repo work in
  `yeride-stripe-server`. Out-of-band.

- **Adapter ↔ hook duplicate non-fatal noise.** Per pre-checklist
  Q4, left in place. Revisit after field telemetry shows whether
  the dashboard noise is bothersome enough to justify demoting
  adapter chain-fatal logs to debug.

## Risks surfaced (still observability scope)

### Constructed-Error message format defines Crashlytics grouping

The L348 site builds an `Error` whose message is
`bg_geolocation_onlocation_error: code=${errorCode}`. Crashlytics
groups non-fatals by the recorded Error's `name` + `message` first
characters — so the message format effectively defines the grouping
key. A future change to the message string would silently re-group
existing reports under a new identifier. Same caveat as Turn 4's
`navigation_route_status:` site.

If grouping ever needs to change, write a Crashlytics-tracked task
to migrate; don't just edit the message string. The regression test
asserts on a substring match (`code=1`, `bg_geolocation_onlocation_error`)
which is loose enough to survive cosmetic edits but tight enough to
catch removal of either component.

### `validationRecord` reference identity caveat (carried from Turn 8)

The `invalid coords` test asserts on `r.error.code ===
'coordinates_lat_out_of_range'` rather than reference identity, because
`Coordinates.create` instantiates a fresh `ValidationError` per call —
the test doesn't own the reference. A future refactor of
`Coordinates.create` to a const-error-per-code pattern would silently
let the test pass under a wrong-code mapping (the assertion checks
code presence, not the specific error value). Unlikely — Result-based
factories typically allocate per-call — but worth noting.

### Test-singleton hygiene (carried from Turn 4 / Turn 8)

The five new tests attach `CrashlyticsLogTransport` to the singleton
`LOG` and detach in `try/finally`. Same hygiene risk as prior turns:
a future test that forgets the `finally` would leak the transport
into subsequent tests in the same Jest worker. Documented inline in
the describe-block JSDoc.

### Mock-side `__emitLocationError` is now part of the test surface

The new `__emitLocationError(code)` helper joins
`__emitLocation` / `__emitGeofence` in the SDK mock's loud-namespaced
test API. Tests that drive the SDK error path now have a stable seam,
but the helper's signature (numeric code only) is tied to the SDK's
on-the-wire shape. A future SDK upgrade that changes the error
callback signature would need a coordinated mock update.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + chunked `npm test` all green.

**181 test suites / 1573 tests** passing.

Delta vs. Phase 9 Turn 8 close baseline (181 suites / 1568 tests):
**+0 suites / +5 tests**. Within the kickoff's "+4 to +8 tests"
estimate band; new tests land in the existing
`BackgroundGeolocationClient.test.ts` so suite count is unchanged.

Test-suite breakdown verified across 7 chunks:

| Chunk pattern                                                                              | Suites | Tests |
| ------------------------------------------------------------------------------------------ | -----: | ----: |
| `src/(shared\|presentation/(di\|hooks\|components))`                                       |     31 |   291 |
| `src/presentation/features/rider`                                                          |     14 |   109 |
| `src/presentation/features/driver`                                                         |     24 |   172 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent)` |      7 |    55 |
| `src/(domain\|app)`                                                                        |     88 |   662 |
| `src/data`                                                                                 |     16 |   278 |
| `src/presentation/__tests__/AppContent`                                                    |      1 |     6 |
| **Total**                                                                                  |    181 |  1573 |

End-of-Turn-9 acceptance criteria, all met:

1. ✅ Four `LOG.warn → LOG.error` flips landed in
   `BackgroundGeolocationClient.ts` (L348, L480, L502, L547 in
   pre-edit line numbers). Each flipped site has inline JSDoc
   explaining the level choice + Error shape decision.
2. ✅ The cleanup-best-effort site at L465 (now L483 post-edit)
   gets a `// stays warn — best-effort cleanup` comment.
3. ✅ `jest.setup.ts` SDK mock extended with `mockBgListeners.locationError`
   bucket + `__emitLocationError(code)` test helper. Subscription's
   `.remove()` tears both callbacks out of their buckets.
4. ✅ Five new regression tests prove `recordError` fan-out works
   end-to-end for each flipped site, plus a sanity check that
   routine status codes (0, 499) stay at info.
5. ✅ Audit findings re-verified for `BackgroundGeolocationClient`,
   `useGpsLifecycle`, and `FirestoreLocationRepository`. Cross-cutting
   Firestore mapper audit deferred to Phase 10 cutover prep.
6. ✅ All four verify gates green (each step individually under
   the sandbox's 45s bash timeout; chunked test run as in prior
   turns).
7. ✅ `docs/PHASE_9_TURN_9.md` written (this file).
8. ✅ `CLAUDE.md` updated to reflect Phase 9 Turn 9 close.
9. ✅ Smoke checklist documented for user-driven validation.
10. ✅ Clean commit on `main` via the sandbox `GIT_INDEX_FILE`
    shadow plumbing pattern.

No native config changes. No new dependencies. No prebuild
required. No DI container changes. No cross-repo work.

## Smoke checklist (user-driven)

The smoke for this turn requires deliberately driving SDK error
paths. Three of the four sites can be reached by user action; the
fourth (subscriber-threw) is hard to drive without a debug shortcut.
Estimated time: 10-15 minutes.

### Pre-smoke

1. `npm run prebuild` (no native config changes; habit catches
   drift).
2. `cd ios && pod install` (no podspec changes; conventional after
   prebuild).
3. `npm run ios` to a clean iPhone 17 simulator OR `npm run android`
   to a Pixel 10 Pro emulator.

### Smoke flow — L348 path (onLocation SDK error code)

The cleanest way to drive the L348 path is to revoke the location
permission while the app is foregrounded with GPS active.

1. Sign in as a test driver. Toggle online (drives `gpsStart`).
2. Open OS Settings → YeRide Next → Location → "Never" (iOS) or
   "Don't allow" (Android).
3. Return to the app within ~30 seconds. The SDK fires `onError`
   with code 1 (permission denied) on the next location attempt.
4. L348 logs at error; the constructed Error message
   `bg_geolocation_onlocation_error: code=1` reaches Crashlytics.
5. Restore permission via OS Settings.

### Smoke flow — L502 / L547 path (subscriber threw)

Hard to drive without a debug shortcut — subscribers are domain-side
hooks and view-models that don't normally throw. Two options:

**Option A — debug shortcut (developer build only):**

Add a temporary `subscribeToLocation((event) => { throw new Error('smoke-test'); })`
call in a `__DEV__`-gated effect. Confirm L502 fires when GPS
delivers an event. Remove the shortcut after smoking.

**Option B — defer.** The unit tests prove the wire-up; real-field
firing represents a contributor bug worth Crashlytics surfacing.

### Smoke flow — L480 path (invalid coords from SDK)

This path is genuinely hard to drive against a real device — fires
only on a platform-level GPS subsystem bug. Pre-checklist Q1
explicitly chose this site because it's a logic-bug signal worth
recording, not because it's expected to fire often. The unit test
covers the wire-up.

### Acceptance signals

- ✅ Within ~1-2 minutes of the L348 permission-denial test, a
  non-fatal appears in Firebase Console → Crashlytics → Non-fatals
  for `yeapp-stage` under issue name `YeRide:BgGeolocation` with
  message `bg_geolocation_onlocation_error: code=1`.
- ✅ The breadcrumb stream above the non-fatal includes
  `[YeRide:BgGeolocation] onLocation: error` and recent location
  / geofence deliveries.
- ✅ A SECOND non-fatal MAY also appear under issue name
  `YeRide:GpsLifecycle` if the location pipeline subsequently
  exhausts the 3-retry backoff (hook-side L266 from Turn 8). This
  is the documented duplicate-noise behavior per pre-checklist Q4
  — distinct scope names group separately, useful for triage.
- ✅ No new red-box JS errors in the Metro console.

### Failure-path checks (optional)

- **Routine status codes (0 / 499):** no easy way to drive these
  outside the unit test. Confirmed at the unit level that they stay
  at info and do NOT recordError.
- **Cleanup teardown errors at L483:** not testable from outside;
  stays at warn precisely because it doesn't manifest user-visible
  failures.

## Files added / touched

**Added:**

- `docs/PHASE_9_TURN_9.md` — this file.

**Touched:**

- `src/data/services/BackgroundGeolocationClient.ts` — 4
  `logger.warn` → `logger.error` flips in `subscribeToLocation`
  (L348), `handleLocation` (L480, L502), and `handleGeofence`
  (L547). L348 constructs an `Error` carrying the SDK error code;
  L480 passes `coordsR.error` (`ValidationError`) directly; L502 +
  L547 pass `e` directly. Inline JSDoc at each site explains the
  level + Error-shape choice. Added one-line
  `// stays warn — best-effort cleanup` comment to the cleanup
  site at L465 (now L483 post-edit) for future-reader visibility.
- `jest.setup.ts` — extended `mockBgListeners` with a
  `locationError` bucket; updated the `onLocation` mock factory to
  capture the optional second arg; added `__emitLocationError(code)`
  test helper alongside `__emitLocation` / `__emitGeofence`;
  extended `__reset()` to clear the new bucket.
- `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  — added 5 telemetry tests in a new describe block. Added imports
  for `CrashlyticsLogTransport` + `LOG` from `@shared/logger` and
  `FakeCrashReportingService` from `@shared/testing`. Extended the
  `BgMock` interface with the new `__emitLocationError` field.
- `CLAUDE.md` — top status block + phase-tables row for Turn 9.

---

## Phase 9 — combined summary (through Turn 9)

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
| 9              | SDK-adapter telemetry flips — 4 LOG.warn → LOG.error flips                                  | +0 suites / +5 tests   | ✅     |

Cumulative Phase 9 delta (Phase 8 close 160/1268 → Phase 9 Turn 9
close 181/1573): **+21 suites / +305 tests**.

Phase 9 has now covered: the iOS Map regression, the
push-notifications gap, the Crashlytics integration, the
observability cleanup follow-ups, the DriverNavigation polish + SDK
telemetry, the passenger-snapshot Stripe gap, the receipt-schema
payment-pipeline gap, the receipt UX polish, the GPS lifecycle
telemetry, and the SDK-adapter telemetry flips. The remaining items
in the kickoff's "Phase 9+" scope (cross-cutting Firestore mapper
audit, permission-denied UX, RNFirebase modular API, receipt PDF
download, per-brand SVG glyphs) either require pre-cutover decisions
or are independently small — candidates for either Phase 10 cutover
prep or their own dedicated Phase 9 turns as the user picks the next
direction.
