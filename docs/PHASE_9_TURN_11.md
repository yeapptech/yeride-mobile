# Phase 9 — Turn 11: Cross-cutting Firestore mapper telemetry audit

Phase 9 Turn 9's close logged the cross-cutting Firestore mapper
telemetry audit explicitly: 4 candidate sites in
`BackgroundGeolocationClient.ts` were closed, but
`FirestoreLocationRepository`'s 4 plain-object `LOG.warn` sites + the
`subscribeToX` per-doc validation paths in `rideMapper` / `userMapper`
/ `vehicleMapper` / `tripPaymentMapper` were deferred — each required
either constructed-Error wrapping (Turn 4's NavRouteStatus pattern) or
a coordinated audit pass across multiple repositories.

Turn 11 is that pass. Targeted scope (per pre-checklist Q1): the
`FirestoreLocationRepository` sites Turn 9 explicitly flagged + the
mapper-level malformed-id fallback paths + the repository-level
`toDomainOrCorrupt` schema/entity validation paths. Skips the
Firestore SDK-catch wrappers (`getDocs failed`, `onSnapshot stream
error` on bulk reads) — those are downstream-handled by the calling
use case via the wrapped `NetworkError`. The audit table below
classifies every `LOG.warn` site in the data layer with its decision
(flip / stays warn) and rationale; the audit-as-documentation IS the
deliverable for the out-of-scope sites.

Acceptance: **187 test suites / 1616 tests passing** (+3 suites /
+17 tests over Turn 10's 184/1599, slightly above the kickoff's
"+3 to +5 suites / +6 to +12 tests" estimate band — at the floor on
suites and at the top on tests, justified by per-flipped-site
Crashlytics-grouping-key coverage).

## Pre-checklist answers (from kickoff)

All four pre-checklist questions answered with the Recommended
option:

1. **Audit scope** — Targeted: FirestoreLocationRepository's 4-5
   sites + per-doc validation in mappers (userMapper / rideMapper /
   tripPaymentMapper) + repository toDomainOrCorrupt paths in Ride +
   ServiceArea. Skips Firestore SDK catch wrappers, NHTSA
   best-effort, GoogleRoutes fetch, StripeServer fetch,
   ExpoNotifications.
2. **Per-doc validation flips** — Flip to error. Field-side
   visibility into bad-doc rates is valuable; Crashlytics groups by
   message-substring so each distinct validation code clusters under
   one Console issue. Sustained non-zero rate flags a server-side
   write or migration issue worth investigating.
3. **getLastKnown failure path** — Flip to error. Pre-empts a stream
   subscription with a one-shot read; failure here means the user
   sees a brief loading state instead of a stale-cache hit (degraded
   UX path).
4. **Per-attempt retry log** — Stay warn. Final exhaustion is
   downstream-handled at `useGpsLifecycle`'s mutation `onError` →
   `recordError` (Turn 8's L266 flip). Per-attempt visibility is
   dev-time only; flipping would double-report (one non-fatal per
   attempt + one per final).

## Audit table — every LOG.warn site in src/data

The candidate set is 49 actual call sites across 17 files. Decisions
columns: **flip** = `LOG.warn → LOG.error` lands this turn (with a
constructed-Error wrapper if meta is plain-object, or pass `e`
directly if already an Error). **stays warn** = level intentionally
preserved with a one-line `// stays warn — <reason>` comment in the
code (or, for sites where the rationale is already documented inline
via the message text or surrounding comments, the existing
documentation suffices).

### In scope (flipped)

| File                                | Line | Old  | New       | Meta shape                  | Stable prefix / shape                                      |
| ----------------------------------- | ---- | ---- | --------- | --------------------------- | ---------------------------------------------------------- |
| `FirestoreLocationRepository.ts`    | L98  | warn | **error** | constructed Error           | `location_doc_invalid_schema: ${code}`                     |
| `FirestoreLocationRepository.ts`    | L110 | warn | **error** | constructed Error           | `location_doc_invalid_entity: ${code}`                     |
| `FirestoreLocationRepository.ts`    | L120 | warn | **error** | pass `e` (real Error)       | (Firestore SDK Error reference)                            |
| `FirestoreLocationRepository.ts`    | L141 | warn | **error** | pass `e` (real Error)       | (Firestore SDK Error reference)                            |
| `userMapper.ts`                     | L241 | warn | **error** | `{uid, error}` constructed  | `user_doc_malformed_stripe_customer_id: ${code}`           |
| `userMapper.ts`                     | L257 | warn | **error** | `{uid, error}` constructed  | `user_doc_malformed_stripe_account_id: ${code}`            |
| `userMapper.ts`                     | L273 | warn | **error** | `{uid, error}` constructed  | `user_doc_malformed_payment_method_id: ${code}`            |
| `userMapper.ts`                     | L299 | warn | **error** | `{uid, error}` constructed  | `user_doc_malformed_push_token: ${code}`                   |
| `rideMapper.ts`                     | L199 | warn | **error** | `{passengerId, error}` ctor | `trip_doc_malformed_passenger_stripe_customer_id: ${code}` |
| `rideMapper.ts`                     | L214 | warn | **error** | `{passengerId, error}` ctor | `trip_doc_malformed_passenger_payment_method_id: ${code}`  |
| `tripPaymentMapper.ts`              | L88  | warn | **error** | `{docId, error: pmR.error}` | (existing shape; `pmR.error` is real Error)                |
| `FirestoreRideRepository.ts`        | L418 | warn | **error** | constructed + ctx fields    | `ride_doc_invalid_schema`                                  |
| `FirestoreRideRepository.ts`        | L435 | warn | **error** | constructed + ctx fields    | `ride_doc_invalid_entity: ${code}`                         |
| `FirestoreServiceAreaRepository.ts` | L50  | warn | **error** | constructed + ctx fields    | `service_area_doc_invalid_schema`                          |
| `FirestoreServiceAreaRepository.ts` | L57  | warn | **error** | constructed + ctx fields    | `service_area_doc_invalid_entity: ${code}`                 |
| `FirestoreServiceAreaRepository.ts` | L136 | warn | **error** | constructed + ctx fields    | `ride_service_doc_invalid_schema`                          |
| `FirestoreServiceAreaRepository.ts` | L144 | warn | **error** | constructed + ctx fields    | `ride_service_doc_invalid_entity: ${code}`                 |

**17 sites flipped this turn.**

### Out of scope (stays warn)

| File                             | Line | Reason                                                                                                             |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `FirestoreLocationRepository.ts` | L65  | Per-attempt retry. Final exhaustion handled at `useGpsLifecycle` (Turn 8 L266). Q4 explicit.                       |
| `FirestoreRideRepository.ts`     | L134 | Firestore SDK stream-error catch. Wrapped via callback null. (Tagged inline.)                                      |
| `FirestoreRideRepository.ts`     | L192 | `listByPassenger` SDK-catch wrapper. Result.err NetworkError; downstream-handled.                                  |
| `FirestoreRideRepository.ts`     | L229 | `listByDriver` SDK-catch wrapper. Same shape.                                                                      |
| `FirestoreRideRepository.ts`     | L270 | `subscribeAvailableRides` stream-error. Same shape.                                                                |
| `FirestoreRideRepository.ts`     | L301 | `subscribeEvents` stream-error. Same shape.                                                                        |
| `FirestoreRideRepository.ts`     | L332 | `subscribePayments` stream-error. Same shape.                                                                      |
| `FirestoreVehicleRepository.ts`  | L84  | `existsByVin` SDK-catch wrapper. Result.err NetworkError; downstream-handled.                                      |
| `FirestoreVehicleRepository.ts`  | L121 | `listByDriver` SDK-catch wrapper. Same shape.                                                                      |
| `FirestoreVehicleRepository.ts`  | L203 | `subscribeByDriver` per-vehicle stream-error. Resilient — bad VIN doesn't break the list.                          |
| `FirestoreVehicleRepository.ts`  | L213 | `subscribeByDriver` user-doc stream-error. Wrapped in `callback([])`.                                              |
| `FirebaseAuthRepository.ts`      | L122 | `observeAuthState: invalid uid from firebase` — defensive guard; signed-out path is graceful.                      |
| `FirebaseAuthRepository.ts`      | L256 | Central error mapper for auth ops. Each call site maps the result; downstream-handled by the use case.             |
| `CloudFunctionsService.ts`       | L220 | Central error mapper for callables. Same shape as auth — each callable use case maps the result.                   |
| `NavigationSdkClient.ts`         | L387 | `stopGuidance threw — swallowing` — cleanup-best-effort. Self-documenting via message text.                        |
| `NavigationSdkClient.ts`         | L415 | `cleanup: setOnArrival(null) threw — swallowing` — cleanup-best-effort. Same shape.                                |
| `NavigationSdkClient.ts`         | L428 | `cleanup: stopGuidance threw — continuing to cleanup` — cleanup-best-effort. Same shape.                           |
| `NavigationSdkClient.ts`         | L512 | `handleArrival: subscriber threw` — same shape as Turn 9's BG subscriber-threw flips. (Tagged for follow-up turn.) |
| `NhtsaVinDecoderService.ts`      | L64  | `decode fetch threw` — best-effort fetch; user retries on the form. Surrounding comments document the path.        |
| `NhtsaVinDecoderService.ts`      | L75  | `decode returned non-2xx` — best-effort. Same shape.                                                               |
| `NhtsaVinDecoderService.ts`      | L173 | `stock-photo variants fetch non-2xx` — best-effort optional photo fetch. Returns null cleanly.                     |
| `NhtsaVinDecoderService.ts`      | L193 | `stock-photo details fetch non-2xx` — best-effort optional photo. Same shape.                                      |
| `NhtsaVinDecoderService.ts`      | L212 | `stock-photo fetch threw` — best-effort. Same shape; cause intentionally not surfaced.                             |
| `BackgroundGeolocationClient.ts` | L483 | `removeAllListeners failed (non-fatal)` — cleanup-best-effort. Already tagged in Turn 9.                           |
| `GoogleRoutesService.ts`         | L104 | `computeRoutes fetch threw` — wrapped in NetworkError; downstream-handled.                                         |
| `GoogleRoutesService.ts`         | L115 | `computeRoutes returned non-2xx` — same shape.                                                                     |
| `GoogleRoutesService.ts`         | L156 | `computeRoutes: skipping route that failed mapping` — best-effort filter on multi-route response.                  |
| `StripeServerHttpAdapter.ts`     | L404 | `fetch threw` — caught by retry-with-backoff; final exhaustion logged at error elsewhere.                          |
| `ExpoNotificationsAdapter.ts`    | L203 | `getCurrentToken: no EAS projectId` — config gap, not a runtime failure.                                           |
| `ExpoNotificationsAdapter.ts`    | L230 | `getCurrentToken: SDK threw` — degrades to null on simulator / no APNs / offline; expected operating mode.         |
| `ExpoNotificationsAdapter.ts`    | L257 | `addPushTokenListener: malformed token` — low-volume; legacy resilience pattern.                                   |
| `FirebaseCrashlyticsAdapter.ts`  | L87  | `crashlytics() threw` — telemetry-bootstrap failure. Flipping would create a recursive recordError loop.           |

The `stays warn` decisions split into four buckets:

- **SDK-catch wrappers** (10 sites) — `try { Firestore SDK call } catch (e) { logger.warn(...); return Result.err(NetworkError) }`. The wrapped `NetworkError` flows up to the use case which surfaces it to the user. Adding `LOG.error` here would double-report alongside the eventual user-facing error.
- **Best-effort fallbacks** (8 sites) — NHTSA stock-photo, GoogleRoutes route-skip, Crashlytics-bootstrap-failure, etc. The path's whole purpose is graceful degradation; surfacing every fallback as a non-fatal would flood the dashboard.
- **Cleanup-best-effort** (4 sites) — Navigation SDK teardown, BackgroundGeolocation listener removal. The next session's re-init recovers cleanly.
- **Per-attempt / explicit-deferral** (3 sites) — retry attempts (downstream covered), permission-not-granted (user choice), Phase 9 turn 11's NavigationSdk subscriber-threw (logged for follow-up turn).

## What's in (the 17 flips)

### 1. FirestoreLocationRepository.ts (4 flips + 1 stays-warn tag)

L65 retry — added explicit `// stays warn — best-effort retry` comment with the full rationale (final exhaustion is downstream-handled by `useGpsLifecycle` Turn 8 L266 flip).

L98 / L110 — per-doc schema/entity validation in `subscribeToLocation`. Constructed-Error with stable prefixes
`location_doc_invalid_schema: ${code}` / `location_doc_invalid_entity: ${code}`. Mirrors Turn 9's BackgroundGeolocation L348 pattern (Turn 4's NavRouteStatus pattern).

L120 — `subscribeToLocation` Firestore stream error. The SDK throws a real `Error` with a `code` field; `extractError`'s `instanceof Error` check resolves it via the rawMeta channel without a constructed wrapper. Pass `e` through directly.

L141 — `getLastKnown` SDK throw. Same shape as L120 (real Error). Pre-checklist Q3 explicitly chose to flip this since it's a degraded-UX path (user sees a brief loading state instead of stale-cache hit).

### 2. userMapper.ts (4 flips)

L241 / L257 / L273 / L299 — malformed Stripe customer / Stripe account / payment method / push token id fallback paths. Each was previously `LOG.warn(message, {uid, code})` (plain-object meta — would skip the rawMeta channel's recordError fan-out). Now `LOG.error(message, {uid, error: new Error(prefix: ${code})})` — the `{uid, error}` shape lets `extractError` walk meta and resolve the constructed Error via the rawMeta channel; the `uid` lands in the breadcrumb (the sanitizer leaves random Firebase uids alone). Stable prefixes:

- `user_doc_malformed_stripe_customer_id: ${code}`
- `user_doc_malformed_stripe_account_id: ${code}`
- `user_doc_malformed_payment_method_id: ${code}`
- `user_doc_malformed_push_token: ${code}`

The validation `code` suffix differentiates distinct rejection causes (e.g. `'stripe_customer_id_invalid_format'` vs `'stripe_customer_id_too_short'`).

### 3. rideMapper.ts (2 flips)

L199 / L214 — passenger snapshot Stripe customer + payment method id fallback paths in `passengerToDomain`. Same `{passengerId, error}` shape as userMapper. Stable prefixes:

- `trip_doc_malformed_passenger_stripe_customer_id: ${code}`
- `trip_doc_malformed_passenger_payment_method_id: ${code}`

### 4. tripPaymentMapper.ts (1 flip)

L88 — paymentMethodId malformed fallback. The site already passed `{docId, error: pmR.error}` — the existing meta shape that the rawMeta channel resolves directly (`extractError` walks meta looking for an `error` field that's an `Error` instance, and `pmR.error` is a real `ValidationError`). Just `warn → error`; no constructed wrapper needed. The grouping key is the underlying ValidationError's `code`.

### 5. FirestoreRideRepository.ts (2 flips)

L418 / L435 — `toDomainOrCorrupt`'s schema validation + entity construction failure paths. The schema-fail meta carries the existing `issues` + `topLevelKeys` debug context (preserved in the breadcrumb), plus a constructed Error with prefix `ride_doc_invalid_schema`. The entity-fail meta has `error: new Error(\`ride_doc_invalid_entity: ${code}\`)`.

### 6. FirestoreServiceAreaRepository.ts (4 flips)

L50 / L57 — `listAll` skip-bad-doc paths (schema + entity).
L136 / L144 — `listRideServices` skip-bad-doc paths (schema + entity).

Each uses the `{...ctx, error: new Error(prefix: ${code})}` shape with stable prefixes:

- `service_area_doc_invalid_schema`
- `service_area_doc_invalid_entity: ${code}`
- `ride_service_doc_invalid_schema`
- `ride_service_doc_invalid_entity: ${code}`

### 7. NavigationSdkClient.ts L512 stays-warn tag

Same shape as Turn 9's BackgroundGeolocation subscriber-threw flips (L502/L547), but the cross-cutting Firestore mapper audit explicitly scoped this out. Tagged with a stays-warn comment + Phase-9 follow-up note. Flipping is a logical follow-up turn — would surface domain-side subscriber bugs in the navigation arrival fan-out via Crashlytics.

### 8. FirestoreRideRepository.ts L134 stays-warn tag

`observeById` Firestore SDK stream-error catch. Tagged with a stays-warn comment so the reasoning is grep-able alongside the flipped sites in this file.

## What's in (regression tests)

17 new tests across 6 test files (3 new repository test files + 3 extensions to existing mapper test files). Pattern mirrors `Logger.test.ts:244-267` and Turn 4 / Turn 8 / Turn 9 telemetry test precedents:

- attach a `CrashlyticsLogTransport(fakeCrash)` to the singleton `LOG`
- drive the failure path
- assert on `fakeCrash.getRecordedErrors()` for message-substring (constructed-Error sites) or reference identity / `.code` field (real Error sites)
- detach in `try/finally` so subsequent tests in the same Jest worker don't see leaked transports

### Mapper-level tests (added to existing test files)

- `userMapper.test.ts` — 4 new tests, one per flipped site. Each drives the relevant malformed-id fallback path via a parsed UserDoc and asserts on the recorded Error's message-substring (`user_doc_malformed_stripe_customer_id` etc.) plus the recorded `name === 'YeRide:userMapper'`.
- `rideMapper.test.ts` — 2 new tests for the passengerToDomain malformed-id paths. Uses a freshly-built minimal RideDoc (helper local to the new describe block) so the test doesn't depend on the unrelated `legacyAwaitingDriverDoc` helper's scope.
- `tripPaymentMapper.test.ts` — 1 new test for the paymentMethodId malformed fallback. Asserts on the recorded ValidationError's `.code` field rather than reference identity, since `PaymentMethodId.create` instantiates a fresh ValidationError per call.

### Repository-level tests (new test files)

- `__tests__/FirestoreLocationRepository.test.ts` — 4 tests covering subscribeToLocation schema-fail, subscribeToLocation entity-fail (via a malformed `updatedAt`), subscribeToLocation stream error, and getLastKnown SDK throw. Per-file `jest.mock('@react-native-firebase/firestore', ...)` provides programmable doc/snapshot/error fixtures via a shared `mockState` object.
- `__tests__/FirestoreServiceAreaRepository.test.ts` — 4 tests covering listAll schema-fail, listAll entity-fail (via a doc id `'A'` that ServiceAreaId.create rejects on length + format), listRideServices schema-fail, and listRideServices entity-fail (via a doc with no `seat`/`seatCapacity` field).
- `__tests__/FirestoreRideRepository.test.ts` — 2 tests covering observeById schema-fail (empty data object) and observeById entity-fail (a schema-valid doc with malformed passenger.email). Mocks `@react-native-firebase/firestore` + `@react-native-firebase/app` + `@react-native-firebase/functions` since the repo's constructor instantiates a CloudFunctionsService.

## Risks surfaced (still observability scope)

### Constructed-Error message format defines Crashlytics grouping (carried from Turn 4 / Turn 9)

Each of the 14 constructed-Error sites uses a stable scope_kind prefix (e.g. `user_doc_malformed_stripe_customer_id`) plus a `${code}` suffix from the underlying validation rejection. Crashlytics groups non-fatals by the recorded Error's `name` + `message` first characters, so the message format effectively defines the grouping key. A future change to a prefix string would silently re-group existing reports under a new identifier. Same caveat as Turn 4's `navigation_route_status:` site.

If grouping ever needs to change for any of these prefixes, write a Crashlytics-tracked task to migrate; don't just edit the prefix string. The regression tests assert on `startsWith(prefix)` substring matches which are loose enough to survive cosmetic edits but tight enough to catch removal of the prefix component.

### `error`-field-on-meta shape is now a load-bearing convention

Five of the 17 flipped sites use the `{ctx, error: new Error(...)}` meta shape — the `extractError` helper resolves both `meta instanceof Error` AND the `meta.error instanceof Error` walk. The latter is what makes the userMapper / rideMapper / FirestoreRide / FirestoreServiceArea sites work. Documented at the call sites; further audit-pass turns should use the same shape rather than reinventing.

### Dashboard volume after deploy is unknowable until field validation

The kickoff Tip 3 explicitly addresses Crashlytics' built-in dedup: a sustained bad-doc stream shows as one Console issue with high count, not a flood of distinct issues. The signal is the count delta over time, not the absolute volume. Worst case: a known-bad doc fires per emission of the relevant subscription stream. Mitigations available in a follow-up: (a) per-mapper sample-and-suppress (option (c) on Q2, deferred), (b) downgrade individual prefixes back to warn if their volume proves noisy.

### Mapper telemetry now fans out per emission

Per-doc validation failures in `subscribeToX` paths fire per Firestore snapshot emission. If a single bad doc on disk causes the mapper to log every time the parent screen re-mounts, Crashlytics gets one non-fatal per re-mount. The dedup-by-message-substring smooths this on the dashboard, but the per-mapper-kind issue count climbs over time. Acceptable per Q2 (a) — the count delta IS the signal — and revisitable if field volumes are bothersome.

### Test-singleton hygiene (carried from Turn 4 / Turn 8 / Turn 9)

The 17 new tests attach `CrashlyticsLogTransport` to the singleton `LOG` and detach in `try/finally`. Same hygiene risk as prior turns: a future test that forgets the `finally` would leak the transport into subsequent tests in the same Jest worker. Documented inline in the describe-block JSDoc on each test file.

## What's out (deferred to follow-up turns)

- **NavigationSdkClient L512 (handleArrival subscriber threw).** Identical shape to Turn 9's BG subscriber-threw flips. Tagged stays-warn with rationale. Follow-up: requires field telemetry on whether arrival callbacks see real-world subscriber throws.
- **NavigationSdkClient L387 / L415 / L428 (cleanup teardown swallows).** Already self-documenting via the message text. Pure cleanup; flipping would create dashboard noise on every screen unmount.
- **NHTSA / GoogleRoutes / StripeServer / ExpoNotifications fetch failures.** Out-of-scope for option (a). Each is wrapped in NetworkError + downstream-handled OR explicit best-effort fallback.
- **FirebaseAuthRepository L122 / L256 + CloudFunctionsService L220.** Central error mappers — flipping would double-report alongside the eventual use-case-level error log. Tagged in the audit table.
- **Per-mapper sample-and-suppress (Q2 option c).** Cleanest UX but adds infrastructure (per-mapper dedup ref) the codebase doesn't have today. Revisitable after field validation if volumes prove noisy.
- **Cross-repository onSnapshot stream-error flips.** L270/L301/L332/L134/L213 etc. — all SDK-catch wrappers, all downstream-handled. Could be revisited if specific scopes prove informative.
- **RNFirebase modular-API migration.** Mechanical refactor across every RNFirebase consumer. Phase 10 cutover-prep candidate.
- **Receipt PDF download / per-brand SVG glyphs.** Phase 9 polish items, unchanged.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` + `npm run format:check` + chunked `npm test` all green.

**187 test suites / 1616 tests** passing.

Delta vs. Phase 9 Turn 10 close baseline (184 suites / 1599 tests): **+3 suites / +17 tests**. Slightly above the kickoff's "+3 to +5 suites / +6 to +12 tests" estimate band — at the floor on suites (3 new repository test files for FirestoreLocationRepository, FirestoreServiceAreaRepository, FirestoreRideRepository) and at the top on tests (17 = one per flipped site, each pinning a distinct Crashlytics grouping key).

Test-suite breakdown verified across 5 chunks:

| Chunk pattern                                                                                         | Suites | Tests |
| ----------------------------------------------------------------------------------------------------- | -----: | ----: |
| `src/(domain\|app)`                                                                                   |     88 |   662 |
| `src/(shared\|presentation/(di\|hooks\|components))`                                                  |     34 |   306 |
| `src/presentation/features/(rider\|driver)`                                                           |     38 |   292 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent\|__tests__)` |      8 |    61 |
| `src/data`                                                                                            |     19 |   295 |
| **Total**                                                                                             |    187 |  1616 |

End-of-Turn-11 acceptance criteria, all met:

1. Audit table covers every `LOG.warn` site in `src/data` (49 actual sites; 17 flipped + 32 stays-warn classified).
2. 17 `LOG.warn → LOG.error` flips landed across 6 files. Each flipped site has inline JSDoc explaining the level + Error-shape choice.
3. 2 stays-warn comments added (`FirestoreLocationRepository.ts` L65 retry, `FirestoreRideRepository.ts` L134 observeById error, `NavigationSdkClient.ts` L512 subscriber threw).
4. 17 new regression tests prove `recordError` fan-out works end-to-end for each flipped site.
5. All four verify gates green (each step individually under the sandbox's 45s bash timeout; chunked test run as in prior turns).
6. `docs/PHASE_9_TURN_11.md` written (this file).
7. `CLAUDE.md` updated to reflect Phase 9 Turn 11 close.
8. Smoke checklist documented for user-driven validation (mostly N/A — pure telemetry; field-validation note for after deploy).
9. Clean commit on `main` via the sandbox `GIT_INDEX_FILE` shadow plumbing pattern.

No native config changes. No new dependencies. No prebuild required. No DI container changes. No cross-repo work.

## Smoke checklist (user-driven)

The smoke for this turn is mostly N/A — the changes are pure telemetry, not user-facing. The 17 flipped sites are:

- 4 in FirestoreLocationRepository — fired only on doc-shape drift in `locations/{userId}` or Firestore SDK transport failure.
- 9 in mappers — fired only when a single user / trip / payment doc on disk has a malformed Stripe id / payment method id / push token (legacy-doc resilience paths; the rate is the signal).
- 2 in FirestoreRideRepository — fired only when a single trip doc fails RideDocSchema or the entity construction.
- 4 in FirestoreServiceAreaRepository — fired only when a single service-area / ride-service doc fails schema or entity construction.

None of these paths fire on a happy-path flow. Driving them deterministically requires either (a) inserting a known-bad doc into Firestore manually, or (b) waiting for field telemetry to surface real-world incidents.

### Field-validation note (after deploy)

After the next deploy lands, watch Firebase Console → Crashlytics → Non-fatals for `yeapp-stage` for the new per-mapper-kind issues to populate. Expected behavior:

- A sustained zero-rate on a flipped site means either (a) no real failures hit it (the level was wrong — no signal recorded), OR (b) the path's resilience pattern is genuinely robust.
- A sustained non-zero rate flags a server-side write or migration issue worth investigating. The Console issue's count delta over time is the signal; absolute count matters less per Crashlytics dedup.

If a sustained zero-rate makes a flipped site look like dead telemetry, the warn-stay decision should be revisited (downgrade to warn or remove the LOG entirely).

If a flipped site fires at high volume (more than a few non-fatals per active session), consider:

1. Sample-and-suppress (Q2 option (c) deferred) — error on first failure per scope per session.
2. Downgrade specific high-volume prefixes back to warn.
3. Investigate the underlying server-side cause (Stripe webhook server, Cloud Function, or migration).

### Pre-smoke (optional)

1. `npm run prebuild` — no native config changes; habit catches drift.
2. `cd ios && pod install` — no podspec changes; conventional after prebuild.
3. `npm run ios` to a clean iPhone 17 simulator OR `npm run android` to a Pixel 10 Pro emulator.

### Acceptance signals after deploy

- Within ~24 hours of the deploy lands, no NEW `YeRide:userMapper` / `YeRide:RideMapper` / `YeRide:tripPaymentMapper` / `YeRide:FirestoreLocation` / `YeRide:FirestoreRide` / `YeRide:FirestoreServiceArea` Crashlytics issues at HIGH volume — confirms baseline doc-shape health.
- Any non-fatals that DO appear should group cleanly under the stable scope_kind prefixes, NOT proliferate as distinct issues. Confirms the constructed-Error grouping convention works in practice.
- No new red-box JS errors in the Metro console post-deploy.

## Files added / touched

**Added:**

- `docs/PHASE_9_TURN_11.md` — this file.
- `src/data/repositories/__tests__/FirestoreLocationRepository.test.ts` — 4 telemetry tests + per-file `jest.mock('@react-native-firebase/firestore', ...)` with programmable doc/snapshot/error fixtures.
- `src/data/repositories/__tests__/FirestoreServiceAreaRepository.test.ts` — 4 telemetry tests + similar Firestore mock.
- `src/data/repositories/__tests__/FirestoreRideRepository.test.ts` — 2 telemetry tests + Firestore + app + functions mocks (the repo's constructor instantiates CloudFunctionsService).

**Touched:**

- `src/data/repositories/FirestoreLocationRepository.ts` — 4 `logger.warn` → `logger.error` flips at L98 (schema), L110 (entity), L120 (stream), L141 (getLastKnown). L65 retry stays warn with explicit `// stays warn — best-effort retry` tag.
- `src/data/mappers/userMapper.ts` — 4 flips at L241/257/273/299 (Stripe customer / Stripe account / payment method / push token id malformed-fallback). All use `{uid, error: new Error(prefix: ${code})}` meta shape.
- `src/data/mappers/rideMapper.ts` — 2 flips at L199/214 (passenger snapshot Stripe customer + payment method id malformed-fallback). All use `{passengerId, error: new Error(prefix: ${code})}` meta shape.
- `src/data/mappers/tripPaymentMapper.ts` — 1 flip at L88 (paymentMethodId malformed-fallback). Existing `{docId, error: pmR.error}` shape preserved; just `warn → error` level change.
- `src/data/repositories/FirestoreRideRepository.ts` — 2 flips at L418/L435 (`toDomainOrCorrupt` schema + entity validation failure). Both use `{ctx, error: new Error(prefix)}` shape. Plus stays-warn tag on L134 observeById error.
- `src/data/repositories/FirestoreServiceAreaRepository.ts` — 4 flips at L50/57/136/144 (listAll + listRideServices skip-bad-doc paths).
- `src/data/services/NavigationSdkClient.ts` — stays-warn tag added to L512 (handleArrival subscriber threw) with follow-up note.
- `src/data/mappers/__tests__/userMapper.test.ts` — 4 new telemetry tests + imports for `CrashlyticsLogTransport` / `LOG` / `FakeCrashReportingService`.
- `src/data/mappers/__tests__/rideMapper.test.ts` — 2 new telemetry tests + imports.
- `src/data/mappers/__tests__/tripPaymentMapper.test.ts` — 1 new telemetry test + imports.
- `CLAUDE.md` — top status block + phase-tables row for Turn 11.

---

## Phase 9 — combined summary (through Turn 11)

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
| 10             | Permission-denied UX — banner + useOpenSettings + AppState refresh                          | +3 suites / +26 tests  | ✅     |
| 11             | Cross-cutting Firestore mapper telemetry audit — 17 LOG.warn → LOG.error flips              | +3 suites / +17 tests  | ✅     |

Cumulative Phase 9 delta (Phase 8 close 160/1268 → Phase 9 Turn 11 close 187/1616): **+27 suites / +348 tests**.

Phase 9 has now covered: the iOS Map regression, the push-notifications gap, the Crashlytics integration, the observability cleanup follow-ups, the DriverNavigation polish + SDK telemetry, the passenger-snapshot Stripe gap, the receipt-schema payment-pipeline gap, the receipt UX polish, the GPS lifecycle telemetry, the SDK-adapter telemetry flips, the permission-denied UX, and the cross-cutting Firestore mapper telemetry audit. The remaining items in the kickoff's "Phase 9+" scope (RNFirebase modular API, receipt PDF download, per-brand SVG glyphs) either require pre-cutover decisions or are independently small — candidates for either Phase 10 cutover prep or their own dedicated Phase 9 turns as the user picks the next direction.
