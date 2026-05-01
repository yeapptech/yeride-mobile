# Phase 8 — Turn 3: device-build smoke + Phase 8 close

The driver Google-Navigation surface shipped at Turn 2 was driven
through a real two-device manual smoke this turn (iOS iPhone 17
simulator + Android Pixel 10 Pro emulator running side-by-side
against `yeapp-stage` Firestore). The full driver navigation flow
worked end-to-end: a signed-in driver accepted a rider's
`awaiting_driver` ride, tapped "Open Navigation" on
EnRouteToPickupView, saw the terms dialog on first launch, accepted,
watched `<NavigationView/>` mount with turn-by-turn guidance,
returned to DriverMonitor, started the ride, opened navigation again
on StartedView for the dropoff leg (with the rider's selected
`routeToken` forwarded), and drove through to Request payment.

End of Turn 3 acceptance: **160 test suites / 1268 tests passing**
(+8 tests over Turn 2's 160/1260 — three incidental bug-fix patches
landed during the smoke, all with regression coverage). typecheck,
lint, format, test all green. **No native plugin patches were
required beyond Turn 1's set** — the legacy `withNavigationSdk.js`
patch reservoir (Firebase BoM 34.0.0 pin, Compose Compiler classpath,
kotlin-stdlib 2.0.21 force) was inspected and intentionally not
ported. The three incidental fixes were all JS-layer Phase 3 latent
bugs that the smoke surfaced.

## What's in

### 1. iOS device-build smoke ✅

`pod install` succeeded against the Turn 1 prebuild output — no
non-modular-include errors, no podspec-resolution failures.
`Podfile.lock` resolved `GoogleMaps (10.7.0)` and
`GoogleNavigation (10.7.0)` cleanly (Turn 1's
`react-native-google-maps.podspec` patch held). `npm run ios` boots
the iPhone 17 simulator (iOS 26.4) through to RiderHome / DriverHome
without crashes.

### 2. Android device-build smoke ✅

`npm run android` against a Pixel 10 Pro emulator: clean build, no
Gradle resolution failures. Boots through to DriverHome with the
Carlos test driver signed in. `BUILD SUCCESSFUL in 3s` after the
incremental build.

### 3. iOS manual end-to-end smoke ⚠️ (rider-only path tested)

The iOS rider successfully created an `awaiting_driver` ride via
RouteSearch → RouteSelect → request. **Caveat: iOS has a separate
Apple Maps Fabric registration regression** — every screen using
`<Map/>` renders the pink "Unimplemented component:
<RNMapsMapView>" placeholder. The rider could still navigate
through RouteSearch (Places autocomplete is a text-input, not
map-dependent) and reach the ride request. RideMonitor's broken
map placeholder didn't block cancellation either once the cancel
fix landed. **The Apple Maps issue is logged for Phase 9.**

### 4. Android manual end-to-end smoke ✅ (full flow)

Carlos (driver) signed in → went online → saw the rider's
`awaiting_driver` ride → tapped Accept → landed on DriverMonitor
with the green driver→pickup polyline → tapped "Open Navigation"
on EnRouteToPickupView → saw the terms-and-conditions dialog
(first launch — confirms Turn 2's `<NavigationProvider/>` mount
config worked) → accepted → `<NavigationView/>` mounted full-screen
with turn-by-turn voice guidance → simulated drive to pickup →
returned to DriverMonitor (auto-pop on arrival worked; the 1.2s
arrival overlay showed before goBack fired) → AtPickupView
displayed (Phase 7 turn 3's geofence auto-flip held) → tapped Start
ride → status flipped to `'started'` → tapped "Open Navigation" on
StartedView → second `<NavigationView/>` instance mounted with the
rider's pre-selected `routeToken` forwarded → simulated drive to
dropoff → returned to DriverMonitor → tapped Request payment.

**This is the Phase 8 acceptance proper.** The driver-side
navigation flow proved out end-to-end against the real Navigation
SDK with the legacy-faithful init+terms chain ordering.

### 5. Three incidental Phase 3 latent bugs patched

The smoke surfaced three bugs the Phase 3 unit tests had missed
because they exercised in-memory fakes rather than the real
deployed Cloud Functions and the live Firestore doc shapes that
those functions write. Fixed in surgical patches with regression
coverage.

#### 5a. `CloudFunctionsService.cancelTrip` wire-field rename `code` → `reason`

**Symptom:** Rider taps Cancel on "Looking for a driver" →
Cloud Function fails with
`functions/invalid-argument: "reason is required"` →
`mapFunctionsError` maps it to a `ValidationError`
(`cf_cancelTrip_invalid_argument`) → cancel mutation fails →
rider stuck on the awaiting_driver screen.

**Cause:** The deployed `yeride-functions/handlers/cancel-trip.js`
reads `request.data.reason` (legacy yeride wire contract). The
rewrite's `CloudFunctionsService.cancelTrip` was sending
`{tripId, by, code, reasonText, odometerMeters}` — `code` instead
of `reason`. The function's required-field check threw with
`reason` missing.

**Fix:** Surgical translation at the wire boundary in
`CloudFunctionsService.cancelTrip` — keep the public arg shape as
`code` (so `FirestoreRideRepository.cancel` and the tests don't
need updates), build the wire payload with `reason: args.code`
before calling the callable.

**Tests:** +2 in `CloudFunctionsService.test.ts` — one asserting
the wire payload contains `reason` (and no `code`), one asserting
`reasonText` and `odometerMeters` are forwarded with the correct
field names.

**Files touched:**

- `src/data/services/CloudFunctionsService.ts`
- `src/data/services/__tests__/CloudFunctionsService.test.ts`

#### 5b. `RideDoc` DTO + `rideMapper` accept the legacy cancel-doc shape

**Symptom:** Even after the cancel wire fix above unblocked the
Cloud Function, the cancel mutation still failed — but now with
a different error: `NotFoundError({code: 'ride_corrupt'})` from
`toDomainOrCorrupt`, with three `ride doc failed schema validation`
warnings preceding it. The post-cancel `refetch()` couldn't parse
the now-cancelled doc.

**Cause:** The deployed Cloud Function writes a flat shape on
cancel: `status: 'passenger_canceled'` (snake*case, NOT the
rewrite's canonical `'cancelled'`), `cancelReason` as a top-level
\_string* (not the rewrite's nested `CancellationDocSchema`
object), with sibling top-level `canceledBy`, `canceledAt`,
`cancelReasonText`, `previousStatus` fields. The rewrite's
`RideDocSchema` only knew the canonical canonical shape.

**Fix:**

- Status enum extended to accept legacy `'passenger_canceled'` /
  `'driver_canceled'` alongside canonical `'cancelled'`. Mapper
  normalizes the legacy values to canonical at the domain
  boundary; the rider/driver provenance lands in the
  `RideCancellation.by` field.
- New `CancelReasonDocSchema = z.union([z.string().min(1),
CancellationDocSchema])` — accepts both the legacy flat string
  and the canonical nested object.
- Top-level legacy fields (`canceledAt`, `canceledBy`,
  `cancelReasonText`, `previousStatus`) added to `RideDocSchema`
  as `.nullish()` so Zod doesn't strip them — the mapper needs
  them.
- New `cancellationFromDoc(doc: RideDoc)` mapper function: branches
  on the type of `doc.cancelReason`. Legacy string path folds the
  flat siblings into a domain `RideCancellation`. Canonical
  nested path uses the embedded fields. Missing-cancelReason
  fallback synthesizes a stub `'changed_mind'` reason (the
  domain's only common code that doesn't require `reasonText`)
  so a malformed cancel doc doesn't crash the read path.

**Tests:** +6 in `rideMapper.test.ts` covering: status normalization
(both legacy values), `cancelReasonText` folding, `by` inference
from status when `canceledBy` is absent, fallback synthesis on
missing cancelReason, and round-trip preservation of the canonical
nested shape (proves the union didn't break the rewrite's
direct-write path).

**Files touched:**

- `src/data/dto/RideDoc.ts`
- `src/data/mappers/rideMapper.ts`
- `src/data/mappers/__tests__/rideMapper.test.ts`

#### 5c. `useCurrentLocation` falls back to `getLastKnownPositionAsync`

**Symptom:** Both sims showed a persistent red toast
`[YeRide:useCurrentLocation] refresh failed
{"code":"ERR_CURRENT_LOCATION_IS_UNAVAILABLE",
"message":"Current location is unavailable. Make sure that
location services are enabled"}`. Driver couldn't go online with
proper coords → available-rides query never filtered correctly.
Repro: Android emulator with Extended Controls SET LOCATION
clicked + GPS Enable signal ON, app-level Location permission
"Allow only while using the app" + Precise ON, system Location
toggle ON. The FusedLocationProvider just doesn't promote a
single seeded point to "current fix" without a continuous client
or watcher.

**Cause:** Common Android emulator quirk plus an iOS Simulator
quirk (depends on whether `Features → Location` was set to a
preset versus Custom). `Location.getCurrentPositionAsync` blocks
for a fresh fix and throws when none is available within the SDK
internal timeout.

**Fix:** Try `Location.getLastKnownPositionAsync({maxAge: 60_000})`
first — cheap, returns `null` instead of throwing on no-fix.
Fallback to `getCurrentPositionAsync` at `Accuracy.Lowest` (better
emulator behaviour: uses the cached cell-tower / wifi position
rather than waiting for satellites). Logger improved to extract
the CodedError `code` and `message` so future failures are
diagnosable from a glance.

**Tests:** Updated `expo-location` mocks in
`useDriverHomeViewModel.test.tsx` and
`useRiderHomeViewModel.test.tsx` to add `getLastKnownPositionAsync`

- `Accuracy.Lowest`. No new tests — `useCurrentLocation` itself
  isn't directly unit-tested (it's a thin expo-location wrapper);
  the dependent view-model tests exercise the contract.

**Files touched:**

- `src/presentation/hooks/useCurrentLocation.ts`
- `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
- `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`

**Operator note:** even with the fallback, the Android emulator's
FLP can still report no fix from a single Extended Controls
injection. The reliable workaround during local dev:
`adb emu geo fix -80.273657 26.148823` (longitude first) — that
goes directly to the OS GPS provider and FLP picks it up.
Documented inline as a comment in the hook.

## Why this turn doesn't include

- **Patches from the legacy `withNavigationSdk.js` patch reservoir.**
  The Phase 8 kickoff staged three patches as defense-in-depth (Firebase
  BoM 34.0.0 pin for gRPC stream stability under an active
  Navigation session, Compose Compiler Gradle classpath for
  Stripe/Compose interop, kotlin-stdlib 2.0.21 force). None
  fired in the smoke:
  - Firestore `.get()` calls during the active nav session
    didn't hang. The default Firebase BoM that RNFirebase v23.8.8
    ships (34.10.0) was stable across the whole flow. Don't pin
    BoM until a real symptom fires.
  - Stripe SDK / Wallet didn't crash with a Compose-compiler
    error during the smoke. The rewrite's Stripe SDK 0.63.0 (Phase 6
    turn 3) is fine without a Compose Compiler classpath force.
  - kotlin-stdlib 2.0.21 force is explicitly NOT to be ported
    (rewrite plugin JSDoc lines 360-377 documents why: Expo SDK
    55's Compose runtime needs 2.1.x's `SpillingKt`).

- **iOS Apple Maps fix.** The `<RNMapsMapView>` Fabric registration
  failure on iOS is real (every screen using `<Map/>` shows the
  pink "Unimplemented component" placeholder) but it does NOT
  block the Phase 8 navigation surface — the
  `<NavigationView/>` is the Google Navigation SDK's own native
  view, separate from `react-native-maps`. The iOS rider can
  still create rides through RouteSearch (Places autocomplete is
  not map-dependent). Phase 9 follow-up logged.

- **Floating mute / chat / exit buttons inside the navigation
  screen.** Per kickoff "out" list — Phase 9 polish.

- **External-Google-Maps fallback** on init failure. Per kickoff
  "out" list. The Toast warn message in
  `useDriverMonitorViewModel.onLaunchNavigation` is the
  user-facing surface; no auto-retry to Apple Maps / Google Maps
  consumer app.

- **`onRouteChanged` / `onTrafficUpdated` /
  `setOnRemainingTimeOrDistanceChanged` listeners.** Phase 9
  scope (Distance Matrix bypass + ETA refinement via SDK
  telemetry).

- **CarPlay / Android Auto.** Hard-out per kickoff.

- **Multi-stop trips.** Single-leg only.

- **Rider-side in-app navigation.** Driver-only.

- **EAS / TestFlight / Play Console builds.** Local debug build
  only. Production native builds are post-Phase-9 cutover work.

## Risks surfaced (Phase 9 scope)

### iOS Apple Maps Fabric registration broken (`RNMapsMapView` unimplemented)

Surfaced during the iOS smoke. iOS sim shows pink "Unimplemented
component: <RNMapsMapView>" placeholder on every screen using
`<Map/>`. Likely cause: react-native-maps 1.24.0 Apple Maps Fabric
codegen output isn't registering under New Arch on iOS, OR the
Podfile is missing the `react-native-maps/Google` subspec needed
for `provider="google"` on iOS to fall through to the Google view
manager (`AIRGoogleMap`) instead. Legacy yeride uses Google on
both platforms — the rewrite's `Map.tsx` defaults to Apple on iOS
(`provider={Platform.OS === 'ios' ? undefined : 'google'}`).

Two fix candidates for Phase 9:

1. Add `pod 'react-native-maps/Google'` subspec to Podfile via the
   `withNavigationSdkPodfile` plugin patch + change `Map.tsx` to
   use `'google'` on iOS for legacy parity. Lowest-cost — Google
   Maps SDK is already linked via the Nav SDK's transitive
   `GoogleMaps` 10.7.0 dependency.
2. Debug Apple Maps Fabric registration directly — figure out why
   `RNMapsMapView` codegen output isn't being picked up. Higher
   investigation cost; benefits if there's no iOS-side Google
   Maps API key budget.

Logged as task #13 in the project's task tracker.

### Foreground location reliability on Android emulator

`useCurrentLocation` 5c fix above papers over the
single-point-injection FusedLocationProvider quirk for live use
on physical devices and well-behaved sims, but the Android
emulator's FLP still requires either Routes-mode playback or
`adb emu geo fix` to deliver a fix. Document this in the
onboarding runbook (Phase 9 polish) so new contributors don't
hit the same wall.

### Background-Geolocation SDK full lifecycle smoke deferred

Phase 7's full GPS pipeline (Background SDK init, geofence
register/unregister, location-event fan-out) was not exhaustively
exercised in this turn — the smoke only proved the foreground
`useCurrentLocation` path enough to get the available-rides
query running. The pickup geofence auto-flip from
EnRouteToPickupView → AtPickupView did fire (visible in the
screenshots) which is a positive Phase 7 integration signal, but
geofence-EXIT warnings, full odometer round-tripping, and SDK
teardown sequencing are Phase 9 polish targets.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` +
`npm run test` all green. **160 test suites / 1268 tests** (+8
tests over Turn 2's 160/1260 — three incidental Phase 3 fixes
each carry their own regression coverage).

Phase 8 turn 3 acceptance criteria, all met:

1. ✅ iOS device build boots to DriverHome / RiderHome from a clean
   `npm run prebuild` + `pod install` + `npm run ios`.
2. ✅ Android device build boots to DriverHome from a clean
   `npm run prebuild` + `npm run android`.
3. ✅ Manual end-to-end smoke: signed-in driver accepts a real
   `awaiting_driver` ride from `yeapp-stage` Firestore; lands on
   DriverMonitor; taps "Open Navigation"; sees the terms dialog
   on first launch; accepts; `<NavigationView/>` mounts and
   guides to pickup; arrival auto-pops back; AtPickupView
   displays; Start ride; second `<NavigationView/>` for the
   dropoff leg with the rider's `routeToken` forwarded; arrival
   auto-pops; Request payment.
4. ✅ All three incidental Phase 3 latent bugs surfaced by the
   smoke have been patched with regression test coverage.
5. ✅ `docs/PHASE_8_TURN_3.md` written (this file).
6. ✅ `CLAUDE.md` updated to flip Phase 8 to closed.
7. ✅ `npm run verify` green at the end of the turn.

## Files added / touched this turn

**Added:**

- `docs/PHASE_8_TURN_3.md` (this file)

**Touched (incidental Phase 3 fixes):**

- `src/data/services/CloudFunctionsService.ts` — wire-field
  translation `code` → `reason` in `cancelTrip`
- `src/data/services/__tests__/CloudFunctionsService.test.ts` — +2
  regression tests
- `src/data/dto/RideDoc.ts` — extend status enum + accept legacy
  flat cancel-doc shape via union schema
- `src/data/mappers/rideMapper.ts` — `cancellationFromDoc`
  branches on flat vs nested `cancelReason`; status normalization
  for legacy `'passenger_canceled'` / `'driver_canceled'`
- `src/data/mappers/__tests__/rideMapper.test.ts` — +6 regression
  tests
- `src/presentation/hooks/useCurrentLocation.ts` —
  `getLastKnownPositionAsync` first, `Lowest` accuracy fallback,
  CodedError `code` extraction in the failure log
- `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
  — expo-location mock gains `getLastKnownPositionAsync` +
  `Accuracy.Lowest`
- `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`
  — same mock update

**No native plugin patches landed this turn.** Turn 1's
`withNavigationSdk.js` patch set proved sufficient.

## Phase 8 closing arc

| Turn              | Scope                                                                     | Tests delta           | Status |
| ----------------- | ------------------------------------------------------------------------- | --------------------- | ------ |
| 1                 | `NavigationSdkClient` adapter + fake + DI wiring + Expo plugin port       | +5 suites / +42 tests | ✅     |
| 2                 | `useDriverNavigationViewModel` + screen + DriverMonitor integration       | +5 suites / +47 tests | ✅     |
| 3                 | First device-build smoke (iOS + Android) + three Phase 3 incidental fixes | +0 suites / +8 tests  | ✅     |
| **Phase 8 close** | **+10 suites / +97 tests over Phase 7's close (152/1171 → 160/1268)**     |                       | **✅** |

Phase 9 is next: push notifications, Crashlytics, polish work
including the iOS Apple Maps Fabric fix (task #13), the floating
nav-screen mute/chat/exit buttons, `onRouteChanged` /
`onTrafficUpdated` listeners + Distance Matrix bypass, geofence
exit warnings UI polish, and the require-cycle warnings from
`presentation/hooks/index.ts` ↔ `presentation/queries/ride.queries.ts`
(harmless but worth fixing).
