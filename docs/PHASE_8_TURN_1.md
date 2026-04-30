# Phase 8 — Turn 1: NavigationSdkClient adapter + fake + DI wiring + Expo plugin port

The single SDK seam over `@googlemaps/react-native-navigation-sdk@0.14.1`
is in. Eight `Result`-returning methods (`init`,
`showTermsAndConditionsDialog`, `setDestinations`, `startGuidance`,
`stopGuidance`, `cleanup`, `subscribeToArrival`, plus the
controller-injection `setController` seam). Listener-level dedup of the
SDK's potential multi-fire by `(waypointKey, isFinal)`. The
`NavigationSessionStatus` and `RouteStatus` SDK enums are mapped to
domain-shaped tagged unions (`NavRouteStatus`, `NavInitError`) per
kickoff decision 2 — non-OK route statuses come back as
`Result.ok(<status>)` because they're domain outcomes, not infrastructure
failures. `FakeNavigationSdkClient` mirrors the real surface 1:1 with
`seed*` / `emit*` / `failNext` / `spies` / `reset` seams. Container
exposes `navigationSdk` alongside `useCases` and `bgGeolocation`;
`TestContainerProvider` gains an optional `navigationSdk?:
FakeNavigationSdkClient` prop. New sibling hook
`useNavigationSdk()` lives next to `useUseCases()` /
`useBackgroundGeolocation()` with the same throw-outside-provider
contract. `jest.setup.ts` carries a global SDK mock with
`__makeController` / `__makeListeners` factories + per-bucket listener
registries (`arrival` plus forward-compat `routeChanged` /
`trafficUpdated` per decision 5) + `__emitArrival` / `__reset` test
helpers. Custom Expo config plugin `plugins/withNavigationSdk.js`
ships the **minimum patch set** per decision 3: Android core library
desugaring + `play-services-maps` exclusion + `kotlin-stdlib:2.0.21`
alignment + AAR-metadata check disable; iOS `react-native-google-maps`
podspec alignment to `GoogleMaps 10.7.0` + RCTDirectEventBlock
event-type fix on `onMapReady` + CocoaPods CDN fallback + strip the
orphan `pod 'react-native-google-maps'` line that Expo's `withMaps`
emits. The Firebase BoM 34.0.0 pin and the MapView constructor /
onPause NPE patches from legacy yeride are deferred until Turn 3's
device-build smoke catches them. **`npm run prebuild` is required
before the next iOS / Android build** so the SDK's native config
takes effect.

End of Turn 1 acceptance: **155 suites / 1213 tests passing** (+3
suites / +42 tests over Phase 7 turn 3's 152/1171 — slightly above
the kickoff's "+12 to +18 tests" band but every test maps to a
documented behavior). typecheck, lint, format, and test all green.

## What's in

### 1. `NavigationSdkClient` adapter (the SDK seam)

`src/data/services/NavigationSdkClient.ts`. Class-based wrapper around
the SDK's React-hook-tied surface. Exposes seven domain methods, all
`Result`-returning, all SDK throws caught at the boundary and mapped to
`NetworkError` / `AuthorizationError`.

Key design decisions:

- **Controller-injection seam.** The SDK's primary surface is
  `useNavigationController()` (a React hook that returns a
  `NavigationController` plus a bag of setter functions like
  `setOnArrival`). Our adapter is class-based and lives in the DI
  container — the React hook can't be the constructor. Solved with a
  `setController({controller, listeners})` method: Turn 2's
  presentation-layer connector hook (mounted by
  `DriverNavigationScreen`) will call `useNavigationController` and
  push the result in. On unmount, the connector calls
  `setController({controller: null, listeners: null})`. Methods invoked
  while no controller is connected return
  `Result.err(NetworkError({code: 'navigation_sdk_not_connected'}))` so
  misuse is loud rather than silent — except for `stopGuidance` and
  `cleanup`, which tolerate the no-controller state and resolve `Ok` so
  cleanup paths after disconnect don't surface false errors.

- **`init()` status mapping.** The SDK's `init()` returns
  `Promise<NavigationSessionStatus>` (a string enum: `'ok' |
'notAuthorized' | 'termsNotAccepted' | 'networkError' |
'locationPermissionMissing' | 'unknownError'`). The adapter maps each:
  - `OK` → `Result.ok(true)`
  - `TERMS_NOT_ACCEPTED` → `AuthorizationError({code:
'navigation_terms_not_accepted'})` — Turn 2's VM `terms_pending` arm
    branches on this.
  - `NOT_AUTHORIZED` → `AuthorizationError({code:
'navigation_api_not_authorized'})` — Cloud Console hasn't enabled
    the Navigation SDK API.
  - `LOCATION_PERMISSION_MISSING` → `AuthorizationError({code:
'navigation_location_permission_missing'})`.
  - `NETWORK_ERROR` → `NetworkError({code:
'navigation_init_network_error'})`.
  - `UNKNOWN_ERROR` and any unknown future SDK status →
    `NetworkError({code: 'navigation_init_unknown_error'})`.

- **`setDestinations()` returns `Result.ok<NavRouteStatus>` for
  non-OK SDK statuses** (per kickoff decision 2). NO_ROUTE_FOUND is a
  domain outcome the VM should branch on differently from a network
  failure; surfacing both as Result.err would force the VM to inspect
  the error code to differentiate. SDK throws (transport failure)
  still come back as `Result.err(NetworkError)`.

- **`setDestinations()` shape.** Takes a domain `NavSetDestinationsArgs`
  with `waypoints: readonly NavWaypoint[]` (each carrying `coords` or
  `placeId` plus optional `title`). When `routeToken` is provided
  (rider's selected route from `RoutesService`), the adapter builds
  `routeTokenOptions`; otherwise builds `routingOptions` with
  `avoidFerries: true` default + `avoidTolls` / `avoidHighways`
  passthrough. The two SDK options are mutually exclusive — `routeToken`
  wins.

- **Listener-level dedup.** `subscribeToArrival(cb)` exposes a
  multi-subscriber facade over the SDK's single-slot `setOnArrival`. A
  `Set<callback>` holds all subscribers; the underlying SDK listener is
  registered once when the first subscriber joins, fans events to every
  subscriber, and is cleared (`setOnArrival(null)`) when the last
  subscriber leaves. Dedup key is `(waypointKey, isFinal)` where
  `waypointKey = placeId ?? "lat,lng" ?? title` so back-to-back
  arrivals at different waypoints (multi-stop trips, future scope)
  don't collapse into one event. Subscribers registered before any
  controller is connected get the SDK listener applied at the next
  `setController()` call.

- **`cleanup()` is best-effort.** Always tears down internal subscriber
  state regardless of SDK throws. Calls `stopGuidance` first
  (tolerating throws), then `cleanup()` on the controller. Idempotent;
  safe to call after disconnect.

- **`stopGuidance` is tolerant of the no-controller state.** Resolves
  `Result.ok(true)` rather than `not_connected`, so cleanup chains in
  view-models can call it without an extra null-check.

- **Forward-compat `RouteStatus` mapping.** The mapper's `default` arm
  returns `'unknown'` rather than throwing, so a newer SDK upgrade with
  added enum values doesn't crash the adapter.

### 2. `FakeNavigationSdkClient` (the in-memory mirror)

`src/shared/testing/FakeNavigationSdkClient.ts`. Programmable fake
mirroring the real surface 1:1, minus the controller-injection seam
(the fake doesn't need to bridge to a real SDK). Pattern matches
`FakeBackgroundGeolocationClient` /
`FakeStripeServerService` /
`FakeCloudFunctionsService`:

- `seed*` helpers: `seedTermsAccepted(bool)`,
  `seedRouteStatus(NavRouteStatus)`.
- `emit*` helpers: `emitArrival(event)` (with same dedup key as the
  real adapter), `emitMultiFireArrival(event, count)` for testing the
  SDK's "fires twice on the boundary" reality.
- `failNext({method, error})` one-shot failure injection. Method union
  is `'init' | 'showTermsAndConditionsDialog' | 'setDestinations' |
'startGuidance' | 'stopGuidance' | 'cleanup'`. The `init` method
  accepts both `NetworkError` and `AuthorizationError` since
  `NavInitError` is the union.
- `spies`: read-only call history (call counts +
  `setDestinationsCalls` arg array + subscribe / dispose counts).
- `reset()` wipes seed + spy + subscriber state and restores defaults.
- Read-only introspection: `getActiveDestinations()`,
  `isInitialized()`, `isGuiding()`, `getArrivalSubscriberCount()`.
- `cleanup()` failure path still tears down in-memory state — mirrors
  the real adapter's best-effort cleanup behaviour.

### 3. DI wiring

`src/presentation/di/container.ts`:

- New `Container.navigationSdk:
NavigationSdkClientType | FakeNavigationSdkClientType` field
  alongside `useCases` and `bgGeolocation`.
- New `buildNavigationSdkClient()` lazy `require`-based builder. Sits
  next to `buildBackgroundGeolocationClient()`. Unconditional in
  production — the SDK gracefully reports
  `NavigationSessionStatus.NOT_AUTHORIZED` via `init()` if the Maps
  Platform project doesn't have the Navigation SDK API enabled, so a
  missing config doesn't crash module-load.
- Both branches of `buildContainer()` (Firebase-configured + fakes-only)
  set `navigationSdk` in the returned `Container`.

`src/presentation/di/ContainerProvider.tsx`:

- New `useNavigationSdk()` sibling hook with same
  throw-outside-provider contract as `useUseCases()` /
  `useBackgroundGeolocation()`. Mounting rule documented in JSDoc:
  consumed exclusively by the Phase 8 Turn 2 connector hook in
  `DriverNavigationScreen`.

`src/presentation/di/index.ts` — re-export `useNavigationSdk`.

`src/shared/testing/TestContainerProvider.tsx` — adds optional
`navigationSdk?: FakeNavigationSdkClient` override slot. Defaults to a
fresh `FakeNavigationSdkClient()` when omitted.

`src/shared/testing/index.ts` — re-exports `FakeNavigationSdkClient` +
the type aliases (`FakeNavigationSdkMethod`, `FakeNavigationSdkSpies`,
`NavArrivalEvent`, `NavInitError`, `NavRouteStatus`,
`NavSetDestinationsArgs`, `NavTermsResult`).

### 4. Global jest mock

`jest.setup.ts`. Pattern matches the existing
`react-native-background-geolocation` mock from Phase 7 turn 1:

- The string-enum constants the adapter reads at module-load:
  `RouteStatus.*` (verbatim string values like `'OK'`,
  `'NO_ROUTE_FOUND'`), `NavigationSessionStatus.*` (verbatim like
  `'ok'`, `'termsNotAccepted'`), `TravelMode.*` (numeric),
  `TaskRemovedBehavior.*` (numeric).
- `__makeController()` factory — returns a fresh `NavigationController`
  shape with every method as a `jest.fn()` with sensible default
  resolved values. Tests prime per-call behaviour with
  `.mockResolvedValueOnce(...)` / `.mockRejectedValueOnce(...)`.
- `__makeListeners()` factory — returns the listener-setter bag with
  `setOnArrival` wiring callbacks into a per-bucket registry.
- Per-bucket listener registries: `arrival`, plus forward-compat
  `routeChanged` and `trafficUpdated` (per kickoff decision 5 — costs
  nothing now, avoids reshuffling when Phase 9 polish lands).
- `__emitArrival(event)` / `__reset()` test helpers.
- React surfaces (`NavigationProvider`, `NavigationView`,
  `useNavigationController`) stubbed with no-op renderers / a default
  `useNavigationController` return — keeps any future VM test that
  imports the SDK indirectly clean at module-load.

### 5. Expo plugin: `plugins/withNavigationSdk.js`

Minimum patch set per decision 3. Three sub-plugins composed into one:

- `withNavigationSdkAndroid` (`withAppBuildGradle`):
  1. `coreLibraryDesugaringEnabled true` in `compileOptions`.
  2. `coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'`
     dependency.
  3. App-level `configurations.all { exclude group: ..., module:
'play-services-maps' }` to prevent duplicate Maps SDK classes (Nav
     SDK bundles its own).
  4. `resolutionStrategy.force(...)` for `kotlin-stdlib:2.0.21` (and
     four module variants) to stop Nav SDK's transitive
     `kotlin-stdlib:2.1.x` from breaking RN 0.83.6's Kotlin compile.
  5. `tasks.matching { 'checkDebugAarMetadata' /
'checkReleaseAarMetadata' }.configureEach { enabled = false }` —
     Nav SDK 7.3+ AAR metadata declares minAgpVersion 8.10.0, RN
     0.83.6 ships AGP 8.8.2; the check is metadata-only.

- `withNavigationSdkIos` (`withDangerousMod`):
  1. Patch `react-native-maps/react-native-google-maps.podspec` to
     align `GoogleMaps == 10.7.0` + `Google-Maps-iOS-Utils == 7.0.0`
     (Nav SDK's `GoogleNavigation` requires 10.7.0).
  2. Patch `onMapReady` event registrations across react-native-maps
     iOS files to use `RCTDirectEventBlock` instead of
     `RCTBubblingEventBlock` — Nav SDK registers `onMapReady` as a
     direct event; in dev builds RN refuses two registrations with
     different bubble flags for the same event name.

- `withNavigationSdkPodfile` (`withPodfile`):
  1. Add `source 'https://github.com/CocoaPods/Specs.git'` as a CDN
     fallback for jsdelivr HTTP/2 framing errors.
  2. Strip the `# @generated begin react-native-maps` block emitted by
     Expo's built-in `withMaps` (it injects
     `pod 'react-native-google-maps', :path => …` but
     react-native-maps@1.23+ no longer ships that podspec). Belt +
     suspenders: also drop any orphan
     `pod 'react-native-google-maps'` line outside an `@generated`
     block.

**Carry-forwards / no-ops in the rewrite** (called out in the plugin
header):

- `playServicesLocationVersion = "21.0.1"` is already pinned by
  `./plugins/withPlayServicesLocationVersion.js` (Phase 7 turn 2 fix
  for the IncompatibleClassChangeError on the GPS shutdown path). NOT
  duplicated here.
- The Compose Compiler Gradle classpath legacy yeride needs for the
  Stripe SDK isn't ported. Phase 6's Stripe integration in the
  rewrite hasn't required it; if a build under the Navigation SDK
  scope catches a Compose-compiler error, port the legacy block then.
- Legacy yeride's `setMetalRendererEnabled:` removal patch on
  `AIRGoogleMapManager.m` isn't needed — the rewrite is already on
  react-native-maps@1.24.0 which dropped the call.

`app.config.ts` — registers `./plugins/withNavigationSdk.js` after
`./plugins/withPlayServicesLocationVersion.js`. The SDK does NOT ship
its own `app.plugin.js` (verified by inspecting
`node_modules/@googlemaps/react-native-navigation-sdk/`), so the local
plugin covers everything.

### 6. Tests (+3 suites / +42 tests)

**`src/data/services/__tests__/NavigationSdkClient.test.ts` — 25 tests.**
Routes through the global SDK mock from `jest.setup.ts` via
`require('@googlemaps/react-native-navigation-sdk')` (NOT
`jest.requireActual` — that bypasses the mock and crashes on
TurboModule init). Per-test pattern: `sdk.__makeController()` +
`sdk.__makeListeners()` to get fresh mocks, prime per-call behaviour
with `.mockResolvedValueOnce(...)` / `.mockRejectedValueOnce(...)`,
push into the adapter via `setController({controller, listeners})`,
exercise the surface, drive arrival deliveries with
`sdk.__emitArrival(event)`. Five describe blocks:

- `without a connected controller` (4 tests) — every method that
  requires a controller returns `navigation_sdk_not_connected`;
  `stopGuidance` and `cleanup` resolve `Ok` for cleanup-path
  friendliness.
- `init` (4 tests) — happy path; `TERMS_NOT_ACCEPTED` →
  `AuthorizationError`; `NOT_AUTHORIZED` → `AuthorizationError`; SDK
  throws → `NetworkError`.
- `showTermsAndConditionsDialog` (3 tests) — accepted; declined (NOT
  an error); SDK throws → `NetworkError`.
- `setDestinations` (5 tests) — routing-options shape with
  travelMode/avoidTolls/avoidFerries forwarding; routeToken-options
  shape (mutually-exclusive over routing-options); non-OK route status
  → `Result.ok(<status>)` (domain outcome); SDK throws → `NetworkError`;
  empty waypoint list rejected locally without calling the SDK.
- `startGuidance / stopGuidance` (2 tests) — happy + SDK-throw paths.
- `cleanup` (3 tests) — happy path clears listeners + calls SDK
  cleanup; tolerates `stopGuidance` throw and continues to cleanup;
  `controller.cleanup()` throw → `Result.err`.
- `subscribeToArrival` (4 tests) — single underlying SDK listener
  across multiple subscribers; events fan to all + dedup of identical
  fires; disposer removes subscriber + clears SDK listener when last
  subscriber leaves; subscribers registered before `setController()`
  get the SDK listener applied at connect time.

**`src/shared/testing/__tests__/FakeNavigationSdkClient.test.ts` —
14 tests.** Five describe blocks:

- `seed helpers` (3 tests) — `seedTermsAccepted` / `seedRouteStatus`
  control next-call returns; default route-status `'ok'` stores active
  destinations.
- `failNext` (3 tests) — one-shot priming; `cleanup` failure still
  tears down in-memory state; `AuthorizationError` works for
  `init` failNext (matches the `NavInitError` union).
- `emitArrival + dedup` (4 tests) — fans to subscribers; dedup
  consecutive fires; distinct waypoints are distinct events; disposer
  zeroes subscriber count.
- `spies` (1 test) — every spy field records correctly across one
  full lifecycle.
- `reset` (1 test) — wipes seed + spy + subscriber state and restores
  defaults.
- `introspection helpers` (2 tests) — `isInitialized` flips on
  successful init; `isGuiding` tracks start/stop/cleanup transitions.

**`src/presentation/di/__tests__/useNavigationSdk.test.tsx` — 3 tests.**

- Throws when called outside `<ContainerProvider/>`.
- Returns the injected `FakeNavigationSdkClient` when wrapped in
  `TestContainerProvider`.
- Default `TestContainerProvider` provides a fresh
  `FakeNavigationSdkClient` instance.

## Why this turn doesn't include

- **View-model + screen + DriverMonitor integration.** Per kickoff
  scope: Turn 1 is data-layer-only. Turn 2 builds
  `useDriverNavigationViewModel` (with the connector hook that calls
  `useNavigationController` and pushes the controller into the
  adapter), the `DriverNavigationScreen` itself, the
  `DriverMonitor.onLaunchNavigation` callback, the "Open Navigation"
  CTAs in `EnRouteToPickupView` / `StartedView`, and the
  `DriverNavigation` route on `DriverNavigator`.

- **Firebase BoM 34.0.0 pin.** Required in legacy yeride to fix gRPC
  stream stability while a Navigation session is active. The rewrite
  isn't pinned today (Phase 7 didn't need it). Defer until Turn 3's
  device-build smoke catches it — if `.get()` calls hang under an
  active navigation session, port the legacy plugin patch verbatim.

- **MapView constructor `super.onCreate` / `super.onResume` patch.**
  Legacy fix for an NPE on remount-after-logout while Nav SDK is
  loaded. The rewrite's auth-flow remount path differs from legacy;
  defer until the device build catches the crash.

- **MapView `onPause(LifecycleOwner)` NPE swallow.** Legacy defends
  against NPEs when the image-picker / camera Activity pauses
  MainActivity while a Map view is partially-initialized. The rewrite's
  vehicle-photos flow uses image-picker; possible to surface, but
  defer until first reproducible crash.

- **Compose Compiler Gradle classpath.** Legacy needs it for the
  Stripe SDK; rewrite's Stripe integration (Phase 6 turn 3) hasn't
  caught a Compose-compiler error yet. Port if seen during the Turn 3
  build.

- **`subscribeToTimeAndDistance` adapter method** (legacy
  `setOnRemainingTimeOrDistanceChanged` for Distance Matrix bypass).
  Out of Phase 8 entirely per kickoff "out" list — Phase 9 polish.

- **`onRouteChanged` / `onTrafficUpdated` listener wiring.** Reserved
  buckets in the jest mock for forward-compat per decision 5 but no
  adapter-level subscribe methods this turn. Out of Phase 8 entirely.

- **License-key plumbing.** Unlike `BG_GEOLOCATION_LICENSE_KEY`, the
  Navigation SDK uses Google Maps Platform billing — no separate
  license. The Maps API keys the rewrite already has (under
  `GOOGLE_MAPS_APIKEY_*` env vars + `withGoogleMapsApiKey.js`) work
  for the Navigation SDK provided the Navigation SDK API is enabled
  on the Cloud Console project. Manual step before Turn 3 device
  smoke.

## Risks surfaced

### Pre-Turn-3 manual steps

The Cloud Console project hosting the Maps API keys needs the
"Navigation SDK for Android" + "Navigation SDK for iOS" APIs enabled
before the Turn 3 device-build smoke. If they're not, `init()` returns
`NavigationSessionStatus.NOT_AUTHORIZED` → `AuthorizationError({code:
'navigation_api_not_authorized'})`. The error is loud at the VM layer,
but the smoke can't proceed without enabling.

### `npm run prebuild` required before next iOS / Android build

The Expo plugin block landed in `app.config.ts`. The native config
(podspec patches, Android Gradle additions, app-level
play-services-maps exclusion) only takes effect after `npm run
prebuild` regenerates `ios/` and `android/`. CI / EAS builds run
prebuild automatically; local devices need a manual run.

### Worker-process leak warning at end of `npm test`

Pre-existing from Phase 7 turn 1 — the BG SDK fake's listener buckets
retain references after tests finish. The new Navigation SDK fake
follows the same pattern; no new leakage but the warning persists.
Non-fatal; flagged for Phase 9 polish.

### Adapter coupling to React-hook-tied SDK surface

The `setController` seam adds an indirection that view-model tests
(Turn 2) won't be able to test through (the fake exposes the
post-`setController` surface directly). Acceptable — the seam is
exclusively used by Turn 2's connector hook, which itself is
unit-testable via Turn 2's view-model harness.

### `setDestinations` returns Result.ok with non-OK status

This was an explicit kickoff decision (#2) — non-OK route statuses are
domain outcomes, not infrastructure errors. Risk: Turn 2 view-model
authors might forget to handle the non-OK arms and just check
`result.ok`. Mitigated by the tagged-union type — TypeScript's
exhaustiveness checking on a switch over `NavRouteStatus` will catch
unhandled cases at compile time.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` + `npm
run test` all green at end of turn. **155 test suites / 1213 tests**
(+3 suites / +42 tests over Phase 7 turn 3's 152/1171). The boundaries
deprecation warning is pre-existing.

Phase 8 turn 1 acceptance criteria, all met:

1. ✅ `NavigationSdkClient` adapter ships with all seven kickoff
   methods + the controller-injection seam, all `Result`-returning,
   listener-deduped, errors mapped at the boundary.
2. ✅ `FakeNavigationSdkClient` mirrors the real surface 1:1 with the
   full seed/spy/emit/failNext/reset seam set.
3. ✅ DI container exposes `navigationSdk` alongside `useCases` and
   `bgGeolocation`. `useNavigationSdk()` sibling hook follows the
   throw-outside-provider contract.
4. ✅ `TestContainerProvider` accepts a `navigationSdk` override slot.
5. ✅ `jest.setup.ts` mocks the SDK globally with the
   `__makeController` / `__makeListeners` / `__emitArrival` /
   `__reset` test helpers.
6. ✅ `plugins/withNavigationSdk.js` ships the minimum patch set.
7. ✅ `app.config.ts` registers the local plugin (no upstream
   `app.plugin.js` exists).
8. ✅ Test suite green; no view-model / screen changes this turn.
9. ✅ `docs/PHASE_8_TURN_1.md` written.

Pending for the device build (Turn 3 acceptance):

- Cloud Console: Navigation SDK API enabled for both platforms.
- `npm run prebuild` runs cleanly post-plugin-landing.
- iOS `pod install` succeeds with the patched podspec + GoogleMaps
  10.7.0 alignment.
- Android `gradle assembleDebug` succeeds with the
  play-services-maps exclusion + kotlin-stdlib alignment.
- App boots without TurboModule registration errors (rewrite already
  on New Arch — verify `newArchEnabled=true` in
  `android/gradle.properties` and `ios/Podfile.properties.json` does
  NOT set `"newArchEnabled": "false"`).

## Files added / touched this turn

**Added:**

- `src/data/services/NavigationSdkClient.ts`
- `src/data/services/__tests__/NavigationSdkClient.test.ts`
- `src/shared/testing/FakeNavigationSdkClient.ts`
- `src/shared/testing/__tests__/FakeNavigationSdkClient.test.ts`
- `src/presentation/di/__tests__/useNavigationSdk.test.tsx`
- `plugins/withNavigationSdk.js`
- `docs/PHASE_8_TURN_1.md` (this file)

**Touched:**

- `package.json` + `package-lock.json` — add
  `@googlemaps/react-native-navigation-sdk@0.14.1`
- `app.config.ts` — register `./plugins/withNavigationSdk.js`
- `src/presentation/di/container.ts` — add
  `Container.navigationSdk` field + `buildNavigationSdkClient()`
  builder + lazy-require wiring in both `buildContainer()` branches
- `src/presentation/di/ContainerProvider.tsx` — add
  `useNavigationSdk()` sibling hook
- `src/presentation/di/index.ts` — re-export `useNavigationSdk`
- `src/shared/testing/TestContainerProvider.tsx` — add optional
  `navigationSdk?: FakeNavigationSdkClient` override slot
- `src/shared/testing/index.ts` — re-export
  `FakeNavigationSdkClient` + the type aliases
- `jest.setup.ts` — global mock for
  `@googlemaps/react-native-navigation-sdk`
