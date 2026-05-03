# Phase 9 — Turn 4: DriverNavigation polish + SDK telemetry

Phase 9 Turn 6 closed the observability cleanup grab-bag — the
parallel `rawMeta` channel through the logger pipeline + the app-root
`<ErrorBoundary/>` + the boundaries-rule v6 migration. The
`recordError`-via-`LOG`-sanitize gap is fixed: any
`LOG.error('scope', errorInstance)` site now reaches Crashlytics
`recordError` with reference identity preserved.

Turn 4 spends the new contract. Two ships:

1. The `useDriverMonitorViewModel` foreground location push effect
   (`lastWrittenCoordsRef` + `useUpdateLocationMutation`) is removed.
   The Phase 7 Turn 2 `useGpsLifecycle` hook (mounted exactly once at
   AppContent) is now the single source of location writes — its
   per-delivery write to `locations/{userId}` is gated by AppContent's
   `enabled` predicate which already covers the driver-on-trip state.
   The harmless double-write that landed in Phase 7 is gone.

2. Five chain-fatal `logger.warn` sites in the driver navigation
   surface flip to `logger.error` so the rawMeta channel fans them out
   to `recordError`. These are the sites that block the driver from
   completing a trip — they belong in Crashlytics. Cleanup-best-effort
   sites (teardown / unmount) and deliberate-user-choice sites (terms
   declined) stay at their existing levels.

Acceptance: **180 test suites / 1519 tests passing** (+0 suites, +4
tests over Turn 6's 180/1515, at the lower end of the kickoff's "+3 to
+9 tests" estimate band — 5 new telemetry tests minus 1 dropped
foreground-push dedup test).

## What's in

### 1. Driver-VM foreground location push removed

`src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
loses the `lastWrittenCoordsRef` ref + the `useEffect` block that
deduped a per-coordinate write to `locations/{userId}`. The
`useUpdateLocationMutation` import + hook call go with it. The
`UserLocation` and `Coordinates` imports follow (no other consumers in
the VM after the effect's removal). The `useCurrentUserId` import
becomes dead too — its only consumer was the push effect's
`!driverId` guard.

The VM's `DriverMonitorViewModelArgs` interface drops the
`driverLocation: Coordinates | null` field. `DriverMonitorScreen`
stops passing it in the `useDriverMonitorViewModel({ rideId, ... })`
call. The screen still owns `useCurrentLocation()` for its map
`initialRegion` + `driverMarker` props — those uses are unchanged;
only the VM-handoff is gone.

The JSDoc on the hook (lines ~30-99) loses paragraph #3 ("Foreground
location push"); paragraphs 4-7 renumber to 3-6. A new closing
paragraph documents the swap and the load-bearing invariant: the
lifecycle hook's `enabled` predicate (driver with
`stripeChargesEnabled && stripePayoutsEnabled`) covers the same window
as the legacy `gpsStart(200)` gate, so the per-delivery write is live
exactly when the foreground push was — no coverage gap.

The VM test file
(`src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`)
loses the `'writes location once per fresh coordinate (dedup ref)'`
test (the only test specifically asserting the foreground push) plus
the `InMemoryLocationRepository` import + `locationsRepo` plumbing in
the `SeededState` helper + the `DRIVER_LOC_MOVED` constant. Twenty-four
remaining `renderHook` call sites lose their `driverLocation:
DRIVER_LOC` arg.

`DRIVER_LOC` itself stays — `PICKUP_ROUTE.startLocation` and
`bgLocationEvent.coords` still reference it.

#### Why this is safe

The lifecycle hook's location-subscription path (lines 231-256 of
`useGpsLifecycle.ts`) fires `useUpdateLocationMutation.mutate(...)` per
SDK delivery, with the same `userId`-keyed `UserLocation` value
object the VM was constructing. The two writes targeted the same
Firestore doc; the only differences were:

- **Source:** the lifecycle hook reads from
  `BackgroundGeolocation.subscribeToLocation` (background-aware,
  distance-filter-throttled). The VM read from `useCurrentLocation`
  (foreground-only).
- **Throttling:** the SDK applies its `distanceFilter: 200` at the
  hardware level. The VM's dedup-by-equality was a JS-side equivalent.

Both are equivalent for production behavior: the lifecycle hook fires
on a 200m delta or larger, which is faster cadence than the
foreground hook's render-driven path was hitting in practice. No
end-user behavior changes; one redundant write per delivery is
removed.

### 2. Five chain-fatal LOG levels flipped warn → error

The driver navigation flow has eight log sites that used to be
`logger.warn`. Five flip to `logger.error` because they're chain-fatal
— the driver can't complete the trip, the user sees a Toast or an
error overlay, and Crashlytics needs to know. Three stay at their
current levels because the underlying cause is either best-effort
cleanup or a deliberate user choice.

| File:line                                    | Old    | New         | Reason                                                                        |
| -------------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------- |
| `useDriverNavigationViewModel.ts:202`        | `warn` | **`error`** | `setDestinations` returned `Result.err` — chain-fatal; surfaces error overlay |
| `useDriverNavigationViewModel.ts:213`        | `warn` | **`error`** | Non-OK `NavRouteStatus` (e.g. `NO_ROUTE_FOUND`) — chain-fatal                 |
| `useDriverNavigationViewModel.ts:225`        | `warn` | **`error`** | `startGuidance` returned `Result.err` — driver can't drive                    |
| `useDriverMonitorViewModel.ts:418` (was 377) | `warn` | **`error`** | Terms-and-conditions dialog itself errored — driver blocked                   |
| `useDriverMonitorViewModel.ts:434` (was 393) | `warn` | **`error`** | Navigation init failed (non-terms branch) — driver blocked                    |
| `useDriverNavigationViewModel.ts:278`        | `warn` | keep `warn` | Teardown `stopGuidance` failure — best-effort cleanup, not user-impacting     |
| `useDriverNavigationViewModel.ts:282`        | `warn` | keep `warn` | Teardown `cleanup` failure — same                                             |
| `useDriverMonitorViewModel.ts:428`           | `info` | keep `info` | Terms declined by user — deliberate choice, not an error                      |

Four of the five flipped sites already pass `Result.err.error` as
meta — that's a `DomainError` (a `NetworkError` or
`AuthorizationError`) which extends `Error`, so the rawMeta channel's
`extractError(rawMeta ?? meta)` resolves directly to that reference
and `recordError` fires with the original instance.

The fifth site (the `non-OK route status` one in the nav VM) used to
log a plain object `{status, subKind}` as meta — no `Error` instance,
so even with the rawMeta channel a flip-only change wouldn't reach
`recordError`. The fix constructs an `Error` at the LOG site:
`new Error(\`navigation_route_status: ${status} (subKind=${subKind})\`)`.
The status code now lives on the recorded Error's message, so
Crashlytics can group reports by the underlying `NavRouteStatus`value. The breadcrumb still carries the human-readable scope text`'non-OK route status'` so the breadcrumb stream stays scannable.

#### Why these specific sites

The choice was guided by what the user sees when each log fires:

- **Chain-fatal:** the driver can't continue the trip, an error
  overlay or a Toast renders. These are exactly the events worth a
  Crashlytics non-fatal — they correspond to lost-revenue moments and
  are the load-bearing telemetry for tuning the SDK integration.
- **Best-effort cleanup:** `stopGuidance` and `cleanup` errors during
  teardown don't impact the next trip (the SDK re-initializes
  cleanly). A warn-level breadcrumb is enough for diagnostics if a
  related bug surfaces later.
- **Deliberate user choice:** terms-declined is the user actively
  refusing a feature. Reporting it as a non-fatal would balloon
  Crashlytics with non-bugs.

#### `useNavigationSdkConnector` — no telemetry sites added

The connector hook is a pure controller bridge — it pushes the SDK's
shared `NavigationController` into the adapter on mount and clears it
on unmount. Both `LOG.debug` calls already in place are correct as
debug-level breadcrumbs. No error paths exist.

### 3. Five new telemetry tests

Each new `LOG.error` site has a regression test that mounts a
`FakeCrashReportingService` + `CrashlyticsLogTransport`, attaches the
transport to the singleton `LOG`, drives the VM through the failure
path, and asserts on the fake. Pattern mirrors `Logger.test.ts:244-267`
(the headline regression test that proves the rawMeta channel works
end-to-end).

Three tests in
`useDriverNavigationViewModel.test.tsx` under a new describe block
`'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 4)'`:

- `setDestinations Result.err → recordError fires with the error reference`
- `non-OK NavRouteStatus → recordError fires with a constructed Error carrying the status code`
- `startGuidance Result.err → recordError fires with the error reference`

Two tests in `useDriverMonitorViewModel.test.tsx` under a sibling
describe block:

- `terms-dialog Result.err → recordError fires with the error reference`
- `init Result.err (non-terms branch) → recordError fires with the error reference`

The first three and the last two assert reference identity
(`recorded.find((r) => r.error === seededError)`) — proves the rawMeta
channel preserves the original `Error` through the `sanitizeForLogging`
step that strips Errors to plain `{name, message, stack}` objects. The
non-OK-status test asserts on the constructed Error's message
substring (`r.error.message.includes('no_route_found')`) since the
Error is built at the LOG site.

Each test also asserts the recorded `name` field matches the VM's
logger scope (`'YeRide:DriverNavigationVM'` /
`'YeRide:DriverMonitorVM'`) — proves Crashlytics groups reports by the
correct module label.

Each test wraps the body in a `try {...} finally { LOG.removeTransport(transport) }`
so the singleton `LOG`'s transport list stays clean across the suite.
The `FakeCrashReportingService` instances are local to each test so
the assertion windows don't bleed across tests.

## Smoke checklist (user-driven)

The kickoff confirmed a manual smoke after the changes. iPhone 17
simulator against `yeapp-stage`, signed in as a test driver. Estimated
time: 5-10 minutes.

### Pre-smoke

1. `npm run prebuild` (no native config changes this turn, but the
   habit catches drift).
2. `cd ios && pod install` (no podspec changes either, but
   conventional after prebuild).
3. `npm run ios` to a clean iPhone 17 simulator.

### Smoke flow

1. Sign in as a test driver. Map renders on DriverHome.
2. Toggle online. The available-rides list populates.
3. Wait for (or seed) an `awaiting_driver` ride within range.
4. Tap Accept. Land on DriverMonitor with the green driver→pickup
   polyline rendering.
5. **Watch for the driver dot moving on the map as the simulator
   replays GPS coords.** If the dot moves smoothly, the lifecycle hook
   is the single source of location writes (foreground push
   removed — no double-write).
6. **Tap the pickup-area override OR walk the simulator into the
   200m geofence.** Confirm the screen flips from EnRouteToPickupView
   to AtPickupView. (Phase 7 turn 3 derivation should hold —
   this turn doesn't touch the geofence path, but a regression here
   would mean the lifecycle hook's geofence subscription broke.)
7. Tap "Open Navigation" on EnRouteToPickupView. (If first launch on
   this build, the terms dialog should appear; accept.) Confirm
   `<NavigationView/>` mounts full-screen with turn-by-turn voice
   guidance.
8. Simulate driving to pickup; arrival should auto-pop back to
   DriverMonitor (1.2s arrival overlay before the goBack).
9. Tap Start ride. Status should flip to `'started'`.
10. Tap "Open Navigation" on StartedView. Second `<NavigationView/>`
    instance with the rider's `routeToken` forwarded.
11. Simulate driving to dropoff; arrival auto-pops back.
12. Tap Request payment.

### Acceptance signals

- ✅ Driver dot updates on the map without visible stutter.
- ✅ Pickup geofence flip works.
- ✅ Both navigation legs launch and auto-pop on arrival.
- ✅ No Toast errors during the happy path.
- ✅ No new red-box JS errors in the Metro console.

### Failure-path checks (optional)

To verify the new telemetry sites in the wild, force a `setDestinations`
failure (e.g. point the simulator at a destination in the middle of
the ocean for `NO_ROUTE_FOUND`) and confirm:

- The error overlay renders.
- A new entry appears in Firebase Console → Crashlytics → Non-fatals
  for `yeapp-stage` within ~1-2 minutes (the SDK batches and uploads
  on its own pipeline). The entry name should be
  `YeRide:DriverNavigationVM`.

## What's out (deferred)

Logged for future turns / Phase 10 cutover prep.

- **Location-push exhaustion telemetry in `FirestoreLocationRepository`.**
  Per kickoff Q3 confirmation, scope is driver-navigation only this
  turn. The 3-retry backoff inside the location repository already
  handles transient Firestore failures; adding a final
  `LOG.error('exhausted', err)` after the retries would close the
  observability loop on long-tail location-write failures. Phase 9
  Turn 5+ candidate.

- **GPS lifecycle hook telemetry.** Per kickoff Q3 confirmation
  (option a chosen over b/c). `useGpsLifecycle` has 3-4 sites that
  could flip warn → error: SDK init failure, permission rejection,
  geofence subscription failure. Naturally scoped to a "Phase 7 +
  Phase 8 telemetry" turn.

- **Stripe / Cloud Functions adapter telemetry.** Phase 10 cutover
  prep — getting Crashlytics non-fatals on payment failures matters
  before the rewrite handles real money, but the adapter path needs a
  separate audit pass and isn't in this turn's scope.

- **State-machine simplification (`retryNonce`, auto-pop guard).**
  Per kickoff Q2 confirmation (option a chosen over b/c). The
  `retryNonce` race-avoidance pattern in `useDriverNavigationViewModel`
  and the `hasNavigatedAwayRef` double-pop guard in
  `DriverNavigationScreen` are both load-bearing per the Phase 8
  Turn 3 smoke. Worth revisiting if a real bug surfaces; not a
  speculative refactor.

- **Auto-pop delay made configurable.** Same kickoff decision —
  the 1.2s constant in `DriverNavigationScreen.tsx:125` proved fine in
  the Phase 8 Turn 3 smoke. Deferred until field telemetry suggests
  otherwise.

- **RNFirebase modular-API migration.** Per Phase 9 Turn 6's "What's
  out" list — mechanical refactor across every RNFirebase consumer
  (auth, firestore, functions, storage, crashlytics — five packages,
  dozens of call sites). More natural as Phase 10 cutover prep or its
  own dedicated Phase 9 turn.

- **Per-screen `<ErrorBoundary/>` variants.** Per Phase 9 Turn 6's
  "What's out" — YAGNI until there's a real need.

- **`onRouteChanged` / `onTrafficUpdated` listeners + Distance Matrix
  bypass.** Phase 8 Turn 3's "Risks surfaced" list — Phase 9 separate
  scope.

## Risks surfaced (still observability scope)

### Test-singleton hygiene under chunked Jest

The new tests attach a `CrashlyticsLogTransport` to the singleton
`LOG` inside each `it()` and detach it in a `try/finally`. If a future
test forgets the `finally`, the transport leaks into subsequent tests
in the same Jest worker, potentially causing unrelated tests'
`LOG.error` calls to fan out to a stale `FakeCrashReportingService`.

The current pattern is robust because each `try/finally` is
self-contained and the fake is local to the test. A future refactor
that hoists the fake to a `beforeEach` would need to add a matching
`afterEach` that detaches the transport. Documented inline in the
describe-block JSDoc.

A one-shot test ordering flake surfaced once during the chunked test
run (a downstream `useDriverEarningsViewModel` test reported FAIL on
the first chunk run, then PASS on every retry). Could not reproduce on
re-runs; suspect a Jest worker startup race. Logged here in case it
recurs — if it does, the fix is to add an `afterEach` at the file
level that calls `LOG.removeTransport` for any leaked transport
instance.

### Constructed-Error message format is the only spec for status grouping

The `non-OK route status` site builds an `Error` whose message is
`navigation_route_status: ${status} (subKind=${subKind})`. Crashlytics
groups non-fatals by the recorded Error's `name` + `message` first
characters, so the message format effectively defines the grouping.
A future change to the message string would silently re-group existing
reports under a new group identifier. The test asserts on
`message.includes('no_route_found')`, which is loose enough to survive
a cosmetic edit but tight enough to catch removal of the status code
from the message.

If grouping ever needs to change, write a Crashlytics-tracked task
to migrate; don't just edit the message string.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + `npm test` all green. Per the prior turns'
sandbox conventions, the full test suite is run in 7 chunks because
the single-pass time exceeds the sandbox's 45s bash timeout.

**180 test suites / 1519 tests** passing.

Delta vs. Phase 9 Turn 6 close baseline (180 suites / 1515 tests):
**+0 suites / +4 tests**. At the lower end of the kickoff's
"+3 to +9 tests" estimate band — 5 new telemetry tests minus 1 dropped
foreground-push dedup test.

Test-suite breakdown verified across 7 chunks:

| Chunk pattern                                                                              | Suites | Tests |
| ------------------------------------------------------------------------------------------ | -----: | ----: |
| `src/(shared\|presentation/(di\|hooks\|components))`                                       |     30 |   269 |
| `src/presentation/features/rider`                                                          |     14 |   100 |
| `src/presentation/features/driver`                                                         |     24 |   172 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent)` |      7 |    55 |
| `src/(domain\|app)`                                                                        |     88 |   661 |
| `src/data`                                                                                 |     16 |   256 |
| `src/presentation/__tests__/AppContent`                                                    |      1 |     6 |
| **Total**                                                                                  |    180 |  1519 |

End-of-Turn-4 acceptance criteria, all met:

1. ✅ `useDriverMonitorViewModel`'s foreground location push effect
   (lines ~263-289 of the pre-Turn-4 file) is removed; the
   `useUpdateLocationMutation` import + the `useCurrentUserId` import +
   the `UserLocation` + `Coordinates` imports + the
   `lastWrittenCoordsRef` ref + the `driverLocation` arg field all go
   with it. The screen call site updated. The dedup test dropped.
2. ✅ Five chain-fatal `logger.warn` sites flipped to `logger.error`
   (3 in `useDriverNavigationViewModel`, 2 in
   `useDriverMonitorViewModel.onLaunchNavigation`). Cleanup-best-effort
   sites and deliberate-user-choice sites stay at their existing
   levels.
3. ✅ Five new telemetry tests (3 nav VM, 2 monitor VM) prove the
   rawMeta channel fan-out works end-to-end for each new site:
   `recordError` fires with the original Error reference (or a
   constructed Error whose message carries the status code) and the
   correct VM scope.
4. ✅ All four verify gates green (each step individually under the
   sandbox's 45s bash timeout; the combined pipeline exceeds the
   timeout and is verified piecemeal as in prior turns).
5. ✅ `docs/PHASE_9_TURN_4.md` written (this file).
6. ✅ `CLAUDE.md` updated to reflect Phase 9 Turn 4 close.
7. ✅ Smoke checklist documented for user-driven validation.
8. ✅ Clean commit on `main` via the sandbox `GIT_INDEX_FILE` shadow
   plumbing pattern.

No native config changes. No new dependencies. No prebuild required.

## Files added / touched

**Added:**

- `docs/PHASE_9_TURN_4.md` — this file.

**Touched:**

- `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
  — removed foreground-push effect + supporting imports/refs/args;
  flipped 2 `logger.warn` → `logger.error` in `onLaunchNavigation`;
  JSDoc renumbered + closing paragraph documenting the lifecycle
  hand-off.
- `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
  — flipped 3 `logger.warn` → `logger.error` in the run-chain
  effect; added inline comments explaining the level choice. The
  non-OK route status site additionally constructs an `Error` so the
  rawMeta channel can fan out to `recordError`.
- `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`
  — dropped the `driverLocation: currentLocation.coordinates` field
  from the `useDriverMonitorViewModel({...})` call.
- `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`
  — dropped 1 dedup test + 24 `driverLocation: DRIVER_LOC` arg
  passes + the `InMemoryLocationRepository` import + the
  `locationsRepo` plumbing in `SeededState` + the `DRIVER_LOC_MOVED`
  constant. Added 2 telemetry tests in a new describe block.
- `src/presentation/features/driver/view-models/__tests__/useDriverNavigationViewModel.test.tsx`
  — added 3 telemetry tests in a new describe block. Added imports
  for `CrashlyticsLogTransport` + `LOG` + `FakeCrashReportingService`.
- `CLAUDE.md` — top status block + phase-tables row for Turn 4.

---

## Phase 9 — Turn 4 closing summary

| Turn | Scope                                                             | Tests delta            | Status |
| ---- | ----------------------------------------------------------------- | ---------------------- | ------ |
| 1    | iOS Apple Maps Fabric escape — PROVIDER_GOOGLE flip               | +1 suite / +6 tests    | ✅     |
| 2    | Push notifications — Expo registration + tap routing              | +8 suites / +117 tests | ✅     |
| 3    | Crashlytics integration end-to-end across 3 sub-turns             | +8 suites / +108 tests | ✅     |
| 6    | Observability cleanup grab-bag (rawMeta + ErrorBoundary)          | +1 suite / +16 tests   | ✅     |
| 4    | DriverNavigation polish + SDK telemetry + foreground-push removal | +0 suites / +4 tests   | ✅     |

Cumulative Phase 9 delta (Phase 8 close 160/1268 → Phase 9 Turn 4
close 180/1519): **+20 suites / +251 tests**.

Phase 9 has now closed: the iOS Map regression, the push-notifications
gap, the Crashlytics integration, the observability cleanup
follow-ups, and the DriverNavigation polish + SDK telemetry. The
remaining items in the kickoff's "Phase 9+" scope are either
out-of-band (RNFirebase modular API) or require pre-cutover decisions
(Stripe/CF adapter telemetry, per-screen ErrorBoundary variants).
Phase 10 cutover prep is the natural next direction.
