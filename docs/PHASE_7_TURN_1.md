# Phase 7 — Turn 1: `BackgroundGeolocationClient` adapter + fake + DI wiring

The single SDK seam over `react-native-background-geolocation@4.19.4`
is in. Eleven methods (`init`, `start`, `stop`, `addPickupGeofence`,
`removePickupGeofence`, `removeAllGeofences`, `subscribeToLocation`,
`subscribeToGeofence`, `getOdometer`, `resetOdometer`,
`requestAuthorizationIfNeeded`, `removeAllListeners`) all
`Result`-returning, all listener-deduped, all exercised by
`FakeBackgroundGeolocationClient` and the Jest SDK mock. The
adapter's wired through the DI container alongside `useCases`; no
view-model changes yet. Turn 2 builds `useGpsLifecycle` on top of it.

End of turn: **148 suites / 1124 tests passing**, **+2 suites / +31
tests** on top of Phase 6's close at 146/1093 — slightly above the
kickoff's "+12 to +18" estimate band but every test maps to a
documented behavior of the adapter or the fake. typecheck + lint +
format + test all green. **`npm run android` succeeded** on a Pixel
10 Pro emulator with the SDK + new license-keyed plugin block in
place; the Container boot log confirms `BackgroundGeolocationClient`
wired in alongside Firebase / Stripe / Maps.

## What's in

### 1. SDK install + native config

`react-native-background-geolocation@^4.19.4` joined the dep set
(legacy parity, version pinned). `BG_GEOLOCATION_LICENSE_KEY` env
var added to `.env.development` + `.env.example`; consumed at BUILD
time only via the SDK's Expo plugin block in `app.config.ts` —
**there is no runtime read**. The license is baked into the native
bundle by the plugin's prebuild mod and the `BackgroundGeolocationClient`
class never sees it.

`app.config.ts` extended:

- **iOS `infoPlist`**: `UIBackgroundModes: ['location', 'fetch']` +
  `BGTaskSchedulerPermittedIdentifiers: ['com.transistorsoft.fetch',
'com.transistorsoft.customtask']` + `NSMotionUsageDescription`. The
  foreground location-permission strings continue to come from the
  existing `expo-location` plugin block — they cover both surfaces.
- **Plugin block**: `['react-native-background-geolocation', { license:
process.env.BG_GEOLOCATION_LICENSE_KEY ?? '' }]` (legacy parity
  shape).
- **Custom config plugin**: `plugins/withBackgroundFetchMaven.js` —
  injects a `maven { url "${project(':react-native-background-fetch').projectDir}/libs" }`
  entry into the project-level `android/build.gradle` `allprojects.repositories`
  block. Required because the SDK's own plugin only registers its
  own `libs/` flatdir, and modern npm hoists the sibling
  `react-native-background-fetch` package to the top-level
  `node_modules/` where the fetch subproject's local
  `repositories { maven { url './libs' } }` declaration isn't
  visible to the transitive resolution at `:app:debugRuntimeClasspath`
  scope. Without this plugin, `app:processDebugResources` fails
  with `Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`.
  See `Risks surfaced` below for the full diagnosis.

`npm run prebuild` is required after this turn so the SDK's Expo
plugin lands its native config — same family as Phase 6 Turn 3's
Stripe SDK prebuild requirement.

### 2. `BackgroundGeolocationClient` adapter

`src/data/services/BackgroundGeolocationClient.ts`. Eleven methods
all returning `Result<…, NetworkError | AuthorizationError>` (or
synchronous unsubscribe for the two subscription-shaped methods).

Critical design decisions:

- **Listener-level dedup**. The SDK fires `onLocation` and `onGeofence`
  2-3× per physical update (legacy CLAUDE.md note about the
  multi-fire pattern). The adapter registers ONE underlying SDK
  listener per stream, dedupes consecutive identical events via a
  `(lat,lng,timestamp,odometer)` ref-key for location and
  `(identifier,action,rideId)` for geofences, and fans out to all
  registered subscribers. Subscribers compose freely; calling the
  disposer from the last subscriber tears down the SDK listener.

- **Single-shared `'pickup'` identifier** (kickoff decision C, legacy
  parity). The SDK's `addGeofence` overwrite-on-add semantics
  replace any existing `'pickup'` registration, so Turn 2's
  per-trip registration logic doesn't need an explicit "remove
  before add" dance. The dynamic `rideId` rides on `extras.rideId`;
  `BgGeofenceEvent.rideId` reconstructs from extras at delivery
  time, falling back to `null` if extras went missing in the
  round-trip.

- **Idempotent `init` / `start` / `stop`**. `init` short-circuits if
  already initialized; `start` checks `getState().enabled` first
  (legacy `gpsStart` pattern); `stop` is unconditionally callable
  and clears dedup keys. `init` passes `reset: true` to
  `BackgroundGeolocation.ready` so persisted-config drift across
  installs is forced clean on every launch — without this,
  `stopOnTerminate: true` can be silently masked by an older
  install's saved state. The legacy `backgroundPermissionRationale`
  block is rewritten with rewrite-branded copy.

- **Error mapping at the SDK boundary**. SDK throws on `ready` /
  `start` / `stop` / geofence ops → `NetworkError` with `cause`
  carrying the original. `requestAuthorizationIfNeeded` returns
  `Result.ok('denied')` for user denial (not an error — the user is
  allowed to say no); only an SDK throw during the prompt
  computation produces `AuthorizationError`. Authorization status
  is mapped through a small enum-to-string-union helper
  (`'always' | 'when_in_use' | 'denied' | 'undetermined'`).

- **Domain types exported** alongside the class: `BgLocationEvent`,
  `BgGeofenceAction`, `BgGeofenceEvent`, `BgPermissionStatus`,
  `BackgroundGeolocationClientInitArgs`. The SDK's raw `Location` /
  `GeofenceEvent` types stay inside the data layer; consumers only
  see the domain-shaped events. `BgLocationEvent.coords` is a
  domain `Coordinates` value object (constructed via
  `Coordinates.create` and dropped on validation failure with a
  warn log); speed is `null` when the SDK reports `-1` (sentinel for
  "no GPS lock"); odometer is the cumulative session distance.

- **`removeAllListeners` safety net**. AppContent's logout handler
  in Turn 2 calls `stop()` + `removeAllGeofences()` + `removeAllListeners()`
  synchronously enough that the next login starts with no stale
  state.

### 3. `FakeBackgroundGeolocationClient` (in-memory fake)

`src/shared/testing/FakeBackgroundGeolocationClient.ts`. Surface
mirrors the real adapter 1:1 — same method names, same Result
shapes, same listener-level dedup logic implemented identically so
dedup tests against the fake exercise the same predicate.

Programmable seams:

- **Seed**: `seedAuthorization(status)` sets what
  `requestAuthorizationIfNeeded` returns next. `seedOdometer(meters)`
  primes `getOdometer`. Both are plain setters with sane defaults
  (`'always'`, `0`).
- **Spy**: `.spies` getter exposes `initCalls`, `startCalls`,
  `stopCalls`, `addPickupGeofenceCalls`,
  `removePickupGeofenceCalls`, `removeAllGeofencesCalls`,
  `removeAllListenersCalls`, `getOdometerCalls`,
  `resetOdometerCalls`, `requestAuthorizationCalls`. Read-only
  bookkeeping for assertions.
- **Emit**: `emitLocation(event)`, `emitGeofence(event)`,
  `emitMultiFireLocation(event, count)`, `emitMultiFireGeofence(event, count)`.
  Dedup runs at emit time so the multi-fire helpers exercise the
  real-adapter dedup behaviour.
- **failNext**: `failNext({method, error})` primes the next call to
  `method` to return `Result.err(error)`. One-shot; subsequent
  calls behave normally. Per-method scoped (priming
  `requestAuthorizationIfNeeded` doesn't affect `start`, etc.).
- **Introspection**: `getActiveGeofence()`, `isEnabled()`,
  `isInitialized()` for tests that want to assert state-machine
  consequences without wiring through the spy bookkeeping.
- **Reset**: `reset()` wipes seed + spy + failure state; safe to
  call from `beforeEach`.

Pattern matches `FakeStripeServerService` / `FakeCloudFunctionsService`
exactly so the existing testing-fake muscle memory carries over.

### 4. Jest SDK mock

`jest.setup.ts` extended with a global mock for
`react-native-background-geolocation` so `BackgroundGeolocationClient`
itself is testable without a real RN runtime. Three pieces:

1. Every method as a `jest.fn()` with a sensible default-resolved
   value — `ready`, `start`, `stop`, `getState`, `addGeofence`,
   `removeGeofence`, `removeGeofences`, `getOdometer`,
   `resetOdometer`, `requestPermission`, `removeAllListeners`,
   `setConfig`, `getCurrentPosition`, `getProviderState`.
2. SDK constants the adapter reads at module-load —
   `DESIRED_ACCURACY_HIGH`, `LOG_LEVEL_VERBOSE`, `LOG_LEVEL_ERROR`,
   `AUTHORIZATION_STATUS_*`. Without these, the import-time
   `BackgroundGeolocation.DESIRED_ACCURACY_HIGH` reference would be
   `undefined` and break the `ready({...})` config object.
3. A `__listeners` registry exposing `__emitLocation` /
   `__emitGeofence` / `__reset` test helpers. Each `on*()`
   registration appends the callback to a per-bucket array and
   returns a `{ remove }` Subscription; `__emit*` fans out to every
   registered callback.

All mock-internal names are `mock`-prefixed (`mockBg`,
`mockBgListeners`, `mockMakeSubscription`, `MockBgListeners`) per
Jest's hoisting prefix rule for `jest.mock()` factory closures.

### 5. DI container + TestContainerProvider + testing index

`Container` interface gained a `bgGeolocation` field alongside
`useCases` — exposed as a sibling rather than wrapped in a use case
because `useGpsLifecycle` (Turn 2) drives the SDK directly.
`buildContainer()` adds an unconditional `buildBackgroundGeolocationClient()`
lazy-require helper that instantiates the real adapter. The SDK
degrades to time-limited debug mode without a license, fine for
dev / stage smokes; release builds set `BG_GEOLOCATION_LICENSE_KEY`
and the plugin bakes the value at build time.

`TestContainerProvider` gained an optional
`bgGeolocation?: FakeBackgroundGeolocationClient` prop, defaulting
to a fresh fake. Turn 2's view-model tests will inject seeded fakes
through this slot — same shape as the existing `cloudFunctions`
override.

`src/shared/testing/index.ts` re-exports
`FakeBackgroundGeolocationClient` + the seven supporting types
(`BgLocationEvent`, `BgGeofenceEvent`, `BgGeofenceAction`,
`BgPermissionStatus`, `FakeBgGeofenceRecord`, `FakeBgMethod`,
`FakeBgSpies`).

### 6. Tests (+31 across two suites)

**`BackgroundGeolocationClient.test.ts` — 21 tests.**

- `init`: SDK `ready` called with `reset: true` + the legacy config
  flags verbatim; idempotent (second call is a no-op); SDK throw
  → `NetworkError`.
- `start`: short-circuits on already-enabled state; invokes SDK
  `start` when disabled.
- `stop`: invokes SDK + clears dedup keys.
- `addPickupGeofence`: registers identifier `'pickup'` with
  `extras.rideId`, the supplied radius, `notifyOnEntry/notifyOnExit:
true`; SDK throw → `NetworkError`.
- `subscribeToLocation`: ONE underlying SDK listener regardless of
  subscriber count; 3 multi-fires dedupe to a single emission;
  distinct timestamps fan through; disposer is synchronous and
  re-subscribing after the last dispose registers a fresh SDK
  listener; null-speed sentinel handling.
- `subscribeToGeofence`: dedup by `(identifier,action,rideId)`;
  ENTER + EXIT for the same rideId are distinct events;
  `extras.rideId` missing → `event.rideId === null`; unknown
  actions (e.g. `'DWELL'`) ignored without emission.
- `getOdometer`: SDK numeric → `Result.ok`.
- `requestAuthorizationIfNeeded`: SDK enum → string-union mapping.

**`FakeBackgroundGeolocationClient.test.ts` — 10 tests.**

- `emitLocation` fans out; `emitMultiFireLocation` dedupes.
- `emitGeofence` dedupes by `(identifier,action,rideId)`;
  ENTER+EXIT distinct.
- `seedOdometer` round-trip; `seedAuthorization` round-trip.
- `addPickupGeofence` + `removePickupGeofence` flips the active-
  geofence record; spy entries recorded.
- `start` + `stop` flips `isEnabled`.
- `failNext` is one-shot; per-method scoped (priming one method
  doesn't affect another).
- `reset()` wipes seed + spy + failure state.
- Disposer is synchronous and idempotent (calling twice is safe).
- `removeAllListeners` clears both location and geofence subscriber
  buckets.

## Why this turn doesn't include

- **`useGpsLifecycle` hook + `AppContent` integration** — Turn 2.
  The adapter is the data-layer seam; the lifecycle owner lives in
  presentation.
- **Wiring `BackgroundGeolocation.onLocation` →
  `UpdateUserLocation`** with a 5s / 50m debounce — Turn 2.
- **`useRideMonitorViewModel` foreground-tick → background-event
  swap** — Turn 3.
- **`useDriverMonitorViewModel` `arrivedAtPickup` auto-flip + real-
  odometer swap** — Turn 3.
- **Driver-side EXIT warnings** ("you're leaving without starting
  / completing") — explicitly out of Phase 7 scope per kickoff.
  Legacy has them; rewrite Phase 9 polish can layer them in.
- **License-runtime helper** in `@shared/env` — confirmed
  unnecessary; legacy plumbs the license via the Expo plugin block
  at build time and the SDK's `ready()` call never reads a runtime
  override (kickoff decision A).

## Risks surfaced

### `react-native-background-fetch` Maven resolution

`app:processDebugResources` failed on the first `npm run android`
with `Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`.
Diagnosis:

- The SDK's own Expo plugin (`androidPlugin.js`'s `applyMavenUrl`)
  injects exactly ONE Maven URL into `android/build.gradle`'s
  `allprojects.repositories` block:
  `${project(':react-native-background-geolocation').projectDir}/libs`.
  That covers `tslocationmanager:3.7.0` (which lives in the SDK's
  own `libs/`).
- `tsbackgroundfetch:1.0.4` lives in the **sibling**
  `react-native-background-fetch` package's `libs/` flatdir. The
  fetch subproject's own build.gradle has its own
  `repositories { maven { url './libs' } }` block — but that's
  scoped to the fetch subproject's resolution, not visible to
  `:app:debugRuntimeClasspath`'s transitive resolution.
- In legacy yeride this was masked by npm nesting
  `react-native-background-fetch` inside the SDK's own
  `node_modules/`. Modern npm in the rewrite hoists fetch to the
  top-level `node_modules/`, breaking the nesting workaround.

Fix: a small custom Expo config plugin
`plugins/withBackgroundFetchMaven.js` mirroring the SDK plugin's
`applyMavenUrl` shape but targeting the fetch package. Idempotent
via `mergeContents` tag (`'react-native-background-fetch-maven'`).
Registered in `app.config.ts` immediately after the SDK plugin so
the merge anchor lands inside the same repos block.

For this turn we also patched the existing `android/build.gradle`
directly so the user could rebuild without a clean prebuild — the
patch tag matches the plugin tag, so the next `expo prebuild
--clean` regenerates the same block via the plugin and the
`mergeContents` merger sees the existing block as already-present
and skips clean.

### Sandbox `npm install` husky postinstall

The husky postinstall script tripped on the sandbox virtiofs
`unlink()` block (same family as the prior phases'
deprecation-stub footgun). The actual package extraction succeeded
before husky ran, so `node_modules/react-native-background-geolocation/`
landed cleanly. This affected the install step only; the build,
typecheck, lint, and tests are unaffected.

### React 19 `defaultProps` inspection

The SDK's TypeScript exports include several class-style React
elements that COULD use `defaultProps` and trip the React 19
removal documented in legacy CLAUDE.md. Quick survey of
`node_modules/react-native-background-geolocation/src/declarations/`
turned up no `defaultProps` references on function components;
only `BackgroundGeolocation` namespace-level static methods. Safe
in this turn — re-verify if Turn 2's `useGpsLifecycle` needs to
mount the SDK's optional `BackgroundFetch` HeadlessTask.

### Adapter is real-runtime untested

Test coverage is against the global jest mock and the in-memory
fake — never the real `react-native-background-geolocation` SDK.
The first integration smoke comes in Turn 2 when AppContent
exercises `init` → `start` → real `onLocation` events on a
device. The Pixel 10 Pro emulator boot in this turn confirms the
SDK loads + the Container wires; it doesn't yet exercise live
events.

### Pre-existing `useCurrentLocation` runtime error

A `[YeRide:useCurrentLocation] refresh failed` line appeared in
the device logs after the successful build. Stack trace is
`construct.js → wrapNativeSuper.js → CodedError` — `expo-modules-core`'s
standard error-class constructor failing inside the foreground
location request. The hook is the Phase 3 foreground-only path,
untouched by Turn 1. Likely a permission state on the emulator;
the app continues to bundle and the Container finishes wiring.
Turn 2's `useGpsLifecycle` will cover the background path
end-to-end and this foreground hook will be progressively
deprecated as Turn 3's view-model rewrites land.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at
end of turn. **148 test suites / 1124 tests** (+2 suites / +31
tests over Phase 6 Turn 5's 146/1093). `npm run android` builds
and installs on Pixel 10 Pro emulator; the Container boot log
prints `Container using ... + BackgroundGeolocationClient` confirming
the real adapter wired in alongside Firebase / Stripe / Maps.

A future Turn 2 has, at this point:

1. The single SDK seam to drive (`BackgroundGeolocationClient`
   exposed from the Container as `bgGeolocation`).
2. A full-fidelity in-memory fake to test against
   (`FakeBackgroundGeolocationClient` available via
   `TestContainerProvider`'s new prop).
3. The native config it needs (background modes, permission
   strings, Maven repo for the AAR, license plumbing) baked in by
   `app.config.ts` + the two Expo plugin blocks. `npm run prebuild`
   in any non-sandbox checkout regenerates everything cleanly.

## Files added / touched this turn

**Added:**

- `src/data/services/BackgroundGeolocationClient.ts`
- `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
- `src/shared/testing/FakeBackgroundGeolocationClient.ts`
- `src/shared/testing/__tests__/FakeBackgroundGeolocationClient.test.ts`
- `plugins/withBackgroundFetchMaven.js`
- `docs/PHASE_7_TURN_1.md` (this file)

**Touched:**

- `package.json` — `react-native-background-geolocation@^4.19.4`
- `.env.development`, `.env.example` — `BG_GEOLOCATION_LICENSE_KEY`
- `app.config.ts` — Expo plugin block, iOS infoPlist additions,
  `withBackgroundFetchMaven` registration
- `jest.setup.ts` — global SDK mock with listener registry
- `src/presentation/di/container.ts` — `bgGeolocation` field on
  `Container`, `buildBackgroundGeolocationClient` helper, lazy
  require, log line
- `src/shared/testing/TestContainerProvider.tsx` — optional
  `bgGeolocation` prop with fake default
- `src/shared/testing/index.ts` — re-exports
- `android/build.gradle` — manual Maven patch (plugin will
  regenerate on next prebuild, idempotent via shared tag)
- `CLAUDE.md` — Phase 7 Turn 1 acceptance + arc summary
