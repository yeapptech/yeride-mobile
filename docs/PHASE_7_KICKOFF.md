# Phase 7 Kickoff Prompt — Background GPS + geofence-exit warnings

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 7.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Phase 6 just closed:
the entire payments / Stripe Connect / tipping surface is end-to-end
(rider Wallet + AddPaymentMethod, driver Earnings + Connect onboarding,
tip flow on RideReceipt). 13 authorization-aware payment use cases are
wired through the DI container. End of Phase 6 acceptance: **146 suites
/ 1093 tests passing**.

Your job this session is to start **Phase 7: Background GPS +
geofence-exit warnings**. Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered architecture,
   conventions, file map. The "Project status" table now shows Phase 6
   complete and Phase 7 Next.
2. `REFACTOR_PLAN.md` — Phase 7 scope (§ "Phase 7 — Background GPS").
3. `docs/PHASE_6_TURN_5.md` (most recent) — what closed Phase 6, with
   the Phase-6-arc summary at the end.
4. The rewrite's existing GPS / geofence touchpoints. Read in this
   order:
   - `src/presentation/hooks/useCurrentLocation.ts` — foreground-only
     location hook. Comment block already calls out "Phase 7's
     responsibility: `BackgroundGeolocationClient` + `useGpsLifecycle`".
     Phase 7 builds those two pieces.
   - `src/app/usecases/trip-tracking/EvaluateExitWarning.ts` — pure
     domain predicate (geofence radius `200m`, matches legacy
     driver-side). Already shipped (Phase 3 turn 4b). Phase 7 plugs it
     into the live background listener instead of the foreground tick.
   - `src/presentation/stores/useGeofenceUiStore.ts` — sticky banner
     state for `pickupExitWarningVisible`. Already shipped. Phase 7
     re-wires the source of truth from foreground reads to the
     background SDK's `onGeofence` events (event-driven, not poll-tick).
   - `src/app/usecases/location/UpdateUserLocation.ts` and
     `SubscribeToUserLocation.ts` — the writes-to-Firestore +
     subscribes-from-Firestore use cases. Already shipped. Phase 7
     wires `BackgroundGeolocationClient.onLocation` → debounced
     `UpdateUserLocation`.
   - `src/data/repositories/FirestoreLocationRepository.ts` — already
     shipped, with the 3-retry exponential backoff (legacy parity).
   - `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`
     — currently runs the geofence tick from the foreground
     `useCurrentLocation` hook during `'dispatched'`. Phase 7 swaps
     this for a `useGpsLifecycle` subscription that also works when
     the app is backgrounded.
   - `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
     — has two Phase-7 hooks already documented in CLAUDE.md:
     1. The client-side `arrivedAtPickup` boolean — Phase 7 auto-flips
        this on the pickup-geofence-enter event (replaces the manual
        "Arrived at pickup" button).
     2. The `stubOdometerMeters` derivation — Phase 7 swaps the stub
        for a real GPS odometer reading from `useGpsLifecycle` for
        the `Start ride` and `Request payment` mutations.
   - `AppContent.tsx` — the rewrite's app shell. Currently no GPS
     lifecycle. Phase 7 wires `useGpsLifecycle` start/stop here based
     on auth state + role + active-trip status (mirrors legacy
     `gpsStart(200)` / `gpsStop()` pattern).
5. Legacy app:
   - `/Users/papagallo/yeapptech/dev/yeride/src/api/gps/gpsLocation.js`
     — the full SDK wrapper. ~150 lines. Read end-to-end. Critical
     config flags: `reset: true` (force re-apply on every launch),
     `desiredAccuracy: DESIRED_ACCURACY_HIGH`, `distanceFilter: 200`
     for active trips, `stopOnTerminate: true`, `startOnBoot: false`,
     `locationAuthorizationRequest: 'Always'`. The
     `backgroundPermissionRationale` block carries the iOS / Android
     copy that lands in the system permission dialog.
   - `/Users/papagallo/yeapptech/dev/yeride/AppContent.js` — the
     legacy app shell's GPS lifecycle. Search for `gpsStart` /
     `gpsStop` / `BackgroundGeolocation.onLocation` /
     `BackgroundGeolocation.onGeofence`. Critical patterns to mirror:
     - GPS starts AFTER auth completes AND user-doc loaded AND email
       verified (i.e. `RiderTabs` / `DriverTabs` is the active stack,
       not Auth/VerifyEmail).
     - GPS stops on logout — **synchronously enough that the
       background pipeline is shut before navigation reset**.
     - The `onLocation` and `onGeofence` listeners fire 2-3× per
       physical update (SDK quirk). The legacy app deduplicates with
       a ref-based key (lat,lng,timestamp tuple). Mirror this
       exactly — do not poll, do not throttle by ms, dedupe by event
       identity.
   - `/Users/papagallo/yeapptech/dev/yeride/src/rider/screens/RideMonitor.js`
     — UI / UX reference for the rider's geofence-exit warning banner
     (sticky, dismiss button, "you've left your pickup area" copy).
   - `/Users/papagallo/yeapptech/dev/yeride/src/driver/screens/DriverMonitor.js`
     — UI / UX reference for the driver's auto-arrived-at-pickup
     transition.
   - `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` — search the
     "GPS" section for the full set of legacy gotchas:
     `stopOnTerminate: true` + `reset: true` requirement, the iOS
     `Always` permission rationale, the "`subscribeToUserLocation` is
     async — fix the cleanup footgun" lesson (already corrected in
     the rewrite's `SubscribeToUserLocation` to a synchronous-
     unsubscribe shape).
6. SDK reference:
   - `react-native-background-geolocation@^4.19.4` — pin matches
     legacy. The SDK's
     [README](https://github.com/transistorsoft/react-native-background-geolocation)
     covers the lifecycle (`ready` → `start` → events → `stop`),
     geofence registration (`addGeofences([{identifier, latitude,
longitude, radius, notifyOnEntry, notifyOnExit}])`), and the
     iOS / Android native config.
   - License-key handling — the SDK is **license-keyed for
     production builds**. The legacy app holds the key; we'll plumb
     it through `extra.backgroundGeolocationLicense` per the existing
     env pattern (mirrors `STRIPE_PUBLISHABLE_KEY` from Phase 6 turn
     3). Without a key, the SDK runs in time-limited debug mode —
     fine for dev / stage, blocks production.
7. Native config references:
   - iOS: `Info.plist` needs `NSLocationAlwaysAndWhenInUseUsageDescription`
     + `NSLocationWhenInUseUsageDescription` strings (the rewrite
     already has these from Phase 3's `expo-location` plugin block —
     reuse the same strings or supersede with background-specific
     copy). `UIBackgroundModes` needs `location` + `fetch`.
   - Android: `AndroidManifest.xml` needs `ACCESS_BACKGROUND_LOCATION`
     + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` permissions,
     plus a foreground-service notification channel (the SDK's plugin
     handles most of this auto-magic on `npm run prebuild`).

## Starting state — what's already built

- **Domain.** `Coordinates` value object, `UserLocation` entity,
  `EvaluateExitWarning` use case (radius `200m`, pure-domain
  predicate). Phase 7 doesn't add new domain types — it wires the
  existing ones to a live event source.
- **Data.** `FirestoreLocationRepository` (3-retry backoff on writes),
  `SubscribeToUserLocation` and `UpdateUserLocation` use cases. No
  background-SDK adapter yet — Phase 7 creates `BackgroundGeolocationClient`.
- **Presentation.** `useCurrentLocation` (foreground-only) + the
  `useRideMonitorViewModel`'s foreground geofence tick during
  `'dispatched'` + the `useGeofenceUiStore` banner state. The driver
  side has the `arrivedAtPickup` flag and the `stubOdometerMeters`
  derivation that Phase 7 replaces with real signals.
- **No package, no native config.** Phase 7 adds
  `react-native-background-geolocation@^4.19.4` + the SDK's Expo
  plugin block + the iOS / Android permission strings + the license
  key plumbing.

So Phase 7 spans data + presentation + native: a new SDK adapter
(`BackgroundGeolocationClient`), a new presentation hook
(`useGpsLifecycle`), AppContent lifecycle wiring, two driver-side
auto-derivations replacing manual / stub flags, plus the
once-only-prebuild-required native plugin install.

## Scope decisions (locked at kickoff)

These were resolved before the kickoff doc was written. Don't re-debate
them mid-phase — propose follow-ups in the deferred list instead.

1. **`react-native-background-geolocation@^4.19.4` for the background
   pipeline.** Same major / minor as legacy. The SDK's Expo plugin is
   auto-linked via `expo install`; native config (iOS background
   modes, Android foreground service + notification channel) lands
   through the plugin's prebuild mods.
2. **`BackgroundGeolocationClient` is the single seam to the SDK.** No
   other layer talks to the SDK directly. The adapter lives in
   `src/data/services/BackgroundGeolocationClient.ts` (data layer, not
   domain — it's a concrete SDK wrapper). Domain code never imports
   `react-native-background-geolocation`.
3. **`useGpsLifecycle` is the single presentation seam.** All
   GPS-aware view-models compose this hook (or read its emitted
   coordinates / odometer / geofence events). Screens never call
   `BackgroundGeolocation.start()` / `.stop()` directly — and never
   mount the SDK listeners themselves.
4. **AppContent owns lifecycle.** GPS starts when the user reaches
   `RiderTabs` / `DriverTabs` (post-email-verify, post-Stripe-onboarding-
   if-applicable). GPS stops on logout, on app-kill (per
   `stopOnTerminate: true`), and intentionally **does not auto-start
   on boot** (per `startOnBoot: false`, mirrors legacy). This matches
   legacy's contract — a user who force-quits the app has explicitly
   opted out of background tracking.
5. **Listener-level dedup.** `BackgroundGeolocationClient` exposes a
   `subscribeToLocation(callback)` and `subscribeToGeofence(callback)`
   API. Each registers ONE listener with the SDK and dedupes 2-3×
   delivery via a ref-keyed `(lat,lng,timestamp)` tuple — the legacy
   pattern. Multiple subscribers from the presentation layer share
   the single underlying SDK listener.
6. **Geofence registration is per-trip.** When a ride enters
   `'dispatched'`, register a pickup geofence with
   `notifyOnEntry: true, notifyOnExit: true, radius: 200`. When the
   ride leaves any active state, deregister. Identifier:
   `pickup-{rideId}` so multiple co-existing trips (rare but
   possible) don't clash. The trip's dropoff endpoint is NOT
   geofenced this phase — driver-only geofence is pickup, exactly as
   legacy.
7. **Driver auto-flip arrivedAtPickup on pickup-geofence enter.** The
   manual "Arrived at pickup" button on `AtPickupView` becomes a
   no-op (kept visible-but-disabled with the geofence as the
   preferred trigger; manual override stays as a fallback if GPS
   reports the driver outside the geofence). Phase 7 adds the
   auto-flip; the manual button is retained for resilience.
8. **Real odometer for `Start ride` and `Request payment`**. The
   `useGpsLifecycle` hook exposes a `currentOdometerMeters` (from
   `BackgroundGeolocation.getOdometer()`) that
   `useDriverMonitorViewModel` reads at the moment of mutation.
   Replaces `stubOdometerMeters: 0 + 1`. The Cloud Function's
   server-side fare math now sees real distance.
9. **Battery + Doze handling.** Out of Phase 7's scope beyond what
   the SDK provides natively. The SDK's adaptive-sampling already
   ramps `distanceFilter` based on motion detection; Phase 9 polish
   can layer aggressive Doze-aware tuning on top.
10. **No `subscribeToUserLocation` regression.** The rewrite's
    `SubscribeToUserLocation` returns a synchronous unsubscribe (the
    legacy footgun was explicitly fixed). Don't reintroduce
    Promise-shaped unsubscribe.

## Scope (in / out)

**In:**

- **Data layer**:
  - `src/data/services/BackgroundGeolocationClient.ts` — fetch-style
    interface around `react-native-background-geolocation`. Methods:
    `init({licenseKey, distanceFilter})`, `start()`, `stop()`,
    `addPickupGeofence({rideId, location, radiusMeters})`,
    `removePickupGeofence(rideId)`, `subscribeToLocation(cb)`,
    `subscribeToGeofence(cb)`, `getOdometer()`,
    `requestAuthorizationIfNeeded()`. Each returns a `Result` /
    synchronous unsubscribe per layer convention.
  - `src/shared/testing/FakeBackgroundGeolocationClient.ts` —
    in-memory fake with seed/spy/emit seams. `seedAuthorization`,
    `seedOdometer`, `emitLocation`, `emitGeofence`. Drives every
    `useGpsLifecycle` test without touching the real SDK.
  - DI container gains `bgGeolocation: BackgroundGeolocationClient`
    arg, threaded through `makeUseCases({...})`. Production branch
    lazy-`require`s the real adapter; fakes branch wires the fake.

- **App layer**: no new use cases. `UpdateUserLocation` (existing)
  becomes the consumer of `BackgroundGeolocationClient.onLocation`
  events — wired through the AppContent lifecycle, not a new
  use-case.

- **Presentation layer**:
  - `src/presentation/hooks/useGpsLifecycle.ts` — the single
    GPS-aware hook. Owns:
    - SDK lifecycle (start/stop based on auth + role + active-trip).
    - Permission flow (`requestAuthorizationIfNeeded` → permission
      state → "Open Settings" CTA prop for screens to render).
    - Listener-level dedup for `onLocation` and `onGeofence`.
    - Pickup-geofence registration based on the active ride doc.
    - Exposed surface:
      `{ permissionStatus, currentLocation, currentOdometerMeters,
isInsidePickupGeofence, lastGeofenceEvent }`.
    - Synchronous unsubscribe on unmount; cleanup is a single
      synchronous function (legacy footgun explicitly avoided).
  - `useRideMonitorViewModel` swap: replace the foreground
    `useCurrentLocation` + `EvaluateExitWarning` poll-tick with
    `useGpsLifecycle().lastGeofenceEvent`. The exit-warning banner
    in `useGeofenceUiStore` is now event-driven instead of
    poll-driven.
  - `useDriverMonitorViewModel` swap: replace the manual
    `arrivedAtPickup` button trigger with `useGpsLifecycle()
.isInsidePickupGeofence` (auto-true on pickup-geofence enter,
    auto-false on exit). Manual button stays as a fallback override.
    Replace `stubOdometerMeters` with `useGpsLifecycle()
.currentOdometerMeters` for `start` and `requestPayment` mutations.
  - `AppContent` integration: instantiate `useGpsLifecycle` at the
    AppContent level, gate start/stop on the same conditions as
    legacy (auth ready + user-doc loaded + email verified +
    Stripe-customer-or-Connect-account ready). Logout calls
    `bgGeolocation.stop()` synchronously before navigation reset.

- **Wiring**:
  - `package.json` adds `react-native-background-geolocation@^4.19.4`.
    Install via `npx expo install`.
  - `app.config.ts` registers the SDK's Expo plugin block and
    extends:
    - `extra.backgroundGeolocationLicense` from
      `process.env.BG_GEOLOCATION_LICENSE_KEY`.
    - The iOS `infoPlist.UIBackgroundModes` array gains `location`
      and `fetch`.
    - The iOS background permission strings (re-use Phase 3's
      `expo-location` plugin copy or supersede with
      background-specific phrasing).
    - The Android foreground-service permissions land via the SDK
      plugin's prebuild mods (no manual Android edits needed beyond
      the `prebuild`).
  - `npm run prebuild` is **required** before the next iOS / Android
    build — same family as the Stripe SDK plugin's prebuild
    requirement from Phase 6 turn 3.
  - `scripts/patch-podfile.js` may need a new modular-headers pin
    for the `react-native-background-geolocation` pod under
    `useFrameworks: 'static'`. First iOS `pod install` is the
    canonical smoke; if it fails with non-modular include errors,
    extend the patch.

**Out (deferred — do not build in Phase 7):**

- **Battery-optimization / Doze-mode tuning beyond SDK defaults**.
  The SDK's adaptive sampling already handles motion-based ramping;
  aggressive Doze-aware tuning is Phase 9 polish.
- **Trip-end auto-detection via geofence** (e.g. "you arrived at
  dropoff, end the trip"). Legacy doesn't do this; rewrite doesn't
  either.
- **Dropoff-side geofence** (driver "you've arrived" toast, rider
  arrival ETA refinement). Out of Phase 7 — pickup-only matches
  legacy.
- **Push notification on geofence exit** (e.g. "your driver left
  your pickup area"). Out of Phase 7 — pure UI banner only.
- **Multi-trip geofence support** beyond identifier scoping. Phase 7
  registers one pickup geofence at a time per the active trip; if
  product wants multi-trip in the future, the identifier scoping
  already supports it but the lifecycle wiring would need extension.
- **Background-location HTTP sync** to a custom backend (the legacy
  `httpRootProperty` / `locationTemplate` block in `gpsLocation.js`
  is commented out). Locations write to Firestore via
  `UpdateUserLocation`, not the SDK's auto-sync.
- **Geofence persistence across app-kill**. With `stopOnTerminate:
true`, the SDK forgets registered geofences on kill. Re-registration
  happens when the app re-enters an active trip, driven by the
  ride-doc subscription. No extra persistence layer needed.

## Suggested turn breakdown (3 turns)

This phase is smaller than Phase 6 — most of the domain + data
scaffolding already exists. Three focused turns:

- **Turn 1 — `BackgroundGeolocationClient` adapter + fake + DI
  wiring.** Add the SDK + the Expo plugin block + the env helper for
  the license key. Implement `BackgroundGeolocationClient` against
  the SDK (init, start, stop, geofences, listeners, odometer,
  permission). Mirror in `FakeBackgroundGeolocationClient` with
  full seed/spy/emit seams. Wire DI. No view-model changes yet — pure
  data-layer + fake parity. Tests run against the fake only; real
  SDK exercised on the next iOS / Android build.

- **Turn 2 — `useGpsLifecycle` + AppContent integration.** Build the
  presentation hook with permission flow, listener-level dedup,
  pickup-geofence registration driven by the active ride. Lift GPS
  start/stop into AppContent. Wire `BackgroundGeolocationClient
.onLocation` → `UpdateUserLocation` (debounced — every 5 seconds OR
  every 50 meters, whichever fires first; matches legacy). View-model
  tests against the fake to confirm permission flow, start-on-tabs,
  stop-on-logout, geofence registration on `'dispatched'`,
  deregistration on terminal status.

- **Turn 3 — RideMonitor + DriverMonitor swap-ins + Phase 7 cleanup.**
  Swap `useRideMonitorViewModel`'s foreground tick for the live
  `useGpsLifecycle().lastGeofenceEvent`. Auto-flip
  `arrivedAtPickup` in `useDriverMonitorViewModel` from
  `useGpsLifecycle().isInsidePickupGeofence`. Replace
  `stubOdometerMeters` with the real reading. Update CLAUDE.md
  (Phase 7 → ✅, Phase 8 → Next). Write `docs/PHASE_7_TURN_*.md`
  records. Final `npm run verify` green. The first iOS / Android
  build with real SDK + license key is the manual integration smoke.

## Risks + mitigations

- **iOS modular-headers under `useFrameworks: 'static'`.** Same
  family as the existing `@react-native-firebase` and Stripe SDK
  fixes in `scripts/patch-podfile.js`. If `pod install` fails with
  non-modular include errors after the SDK lands, extend the patch
  with `pod 'rn-background-geolocation', :modular_headers => true`.
- **iOS background mode entitlements**. `UIBackgroundModes` must
  include `location` and `fetch`. Without these, the SDK fails
  silently on `start()` in a backgrounded app. Mitigation: include
  in the Expo plugin block + verify in the post-prebuild
  `Info.plist` before declaring Turn 1 done.
- **Android foreground-service notification channel**. The SDK's
  plugin auto-creates a channel; if the user manually disables it
  via system settings, location updates pause. Mitigation: surface
  a settings prompt if `subscribeToLocation` returns no events
  for >60s while the GPS hook reports `'enabled'`.
- **Permission denial UX**. iOS lets the user pick "While Using"
  (foreground only), "Always" (background), or "Don't Allow". The
  SDK's `requestAuthorizationIfNeeded` returns the granted level.
  Mitigation: `useGpsLifecycle.permissionStatus` exposes the
  granted level; screens render a "we need Always for trip
  tracking — open Settings" prompt when level is "While Using".
- **License-key gating**. Production builds require a license. Dev /
  stage runs in time-limited debug mode (the SDK throws after 30
  minutes if no key). Mitigation: hold the legacy license key in
  the rewrite's `BG_GEOLOCATION_LICENSE_KEY` env var; fall back to
  null in dev (the SDK's debug mode is fine for short runs).
- **Listener-level dedup**. `BackgroundGeolocation.onLocation` and
  `onGeofence` fire 2-3× per physical event. The legacy app
  deduplicates with a `(lat,lng,timestamp)` tuple. Mitigation:
  `BackgroundGeolocationClient`'s `subscribeToLocation` /
  `subscribeToGeofence` register ONE listener and dedupe internally;
  callers see deduped events only. Tests inject mock multi-fires via
  `FakeBackgroundGeolocationClient.emitLocation` to confirm dedup.
- **Geofence registration timing**. If a driver opens the app and
  immediately accepts a ride, the geofence registration must
  complete before the driver moves out of the pickup area or the
  enter event is missed. Mitigation:
  `BackgroundGeolocationClient.addPickupGeofence` returns a
  `Promise<Result>` that the driver-monitor VM awaits before
  considering the trip "active in GPS terms".
- **React 19 `defaultProps`**. The SDK is unlikely to use class
  components with defaultProps but verify on first render. If it
  does, upgrade the SDK or add a wrapper that sets the missing
  props explicitly (per the legacy CLAUDE.md's React 19 footgun
  note).
- **`AppState` foreground / background transitions**. The SDK
  manages its own foreground/background lifecycle, but
  `useGpsLifecycle` must NOT call `start()` again on every
  `AppState` 'active' event — the SDK rejects `start()` when
  already running. Mitigation: idempotent `start()` (check
  `getState().enabled` first; mirrors legacy `gpsStart`).
- **Cleanup on logout**. Logout must call `bgGeolocation.stop()` +
  deregister all geofences SYNCHRONOUSLY before navigation resets,
  or the next login may see lingering events from the previous
  session. Mitigation: `useGpsLifecycle` exposes a `stopAndClear()`
  method that AppContent's logout handler awaits before resetting.
- **Test mocking under jest**. The SDK's TurboModule registration
  fails outside RN runtime (same family as Stripe). Mitigation:
  jest-mock `react-native-background-geolocation` globally via
  `jest.setup.ts`, exposing the methods as `jest.fn()`s. The
  `BackgroundGeolocationClient` is exercised through the
  `FakeBackgroundGeolocationClient` in unit tests.
- **No new domain types**. Phase 7 deliberately doesn't add domain
  entities — it wires existing ones (`Coordinates`,
  `EvaluateExitWarning`, `UserLocation`) to a live event source.
  Resist the urge to model "geofence event" as a domain entity —
  it's a transient SDK signal, and the existing types cover the
  state we actually persist.

## Acceptance for end of Phase 7

- A signed-in rider on an active trip in `'dispatched'` who walks out
  of the pickup-area sees the "you've left your pickup area" banner
  appear within ~5 seconds of crossing the 200m radius (driven by
  `BackgroundGeolocation.onGeofence` exit event, no foreground
  poll). Walking back in dismisses the banner automatically. Dismiss
  affordance hides until the next exit event.
- A signed-in driver who accepts a ride and drives toward the pickup
  point sees the `AtPickupView` automatically replace
  `EnRouteToPickupView` once their location enters the pickup
  geofence — no manual button tap. Manual button retained as a
  fallback (visible-but-not-required).
- A driver who taps "Start ride" sees the trip transition with a
  real odometer reading from the SDK (typically `>0` since the
  driver has already moved during pickup). Tapping "Request payment"
  later uses the same odometer source — `Ride` entity's
  `requestPayment` monotonicity check passes against real GPS data
  rather than the `stubOdometerMeters: 0 + 1` placeholder.
- The user's `users/{uid}.location` doc receives Firestore writes
  every ~5s or every ~50m of motion (whichever fires first) while
  the app is foregrounded OR backgrounded — driven by
  `BackgroundGeolocation.onLocation` → `UpdateUserLocation`. The
  legacy app's debounce-and-retry pattern is preserved.
- Logout cleanly stops the SDK + deregisters geofences before the
  navigation reset. A subsequent login starts fresh — no stale
  events from the previous session.
- The SDK's `stopOnTerminate: true` + `startOnBoot: false` config
  is verified: force-quitting the app during an active trip stops
  background tracking (legacy parity).
- Test suite stays green; new view-model wiring + the
  `BackgroundGeolocationClient` adapter both have unit tests against
  fakes; the SDK is jest-mocked globally so no test pulls in the
  real native module. Net test gain: ≥35 tests (estimate; smaller
  than Phase 6 since the domain layer doesn't grow).
- `CLAUDE.md` updated; `docs/PHASE_7_TURN_*.md` records written.
- A first iOS + Android native build smoke (with `npm run prebuild`
  re-run) confirms permissions land + the SDK boots.

## Conventions (non-negotiable — same as Phases 3–6)

- `Result.ok` / `Result.err` for every expected failure. The SDK's
  errors are caught at the `BackgroundGeolocationClient` boundary
  and mapped to domain errors (`AuthorizationError` for permission
  denial, `NetworkError` for the SDK's transient failures, etc.).
- Build the in-memory fake first (Turn 1) before the real SDK
  adapter exercises the contract.
- Server state → TanStack Query. Client / UI state → Zustand. The
  GPS hook itself is neither — it's a transient stream from a
  side-effecting library; `useGpsLifecycle` exposes the latest
  values via `useState` driven by the fake's emit / SDK's listener
  callbacks.
- View-model tests for the new wiring use the
  `FakeBackgroundGeolocationClient` via `TestContainerProvider` (a
  new optional override slot mirrors the existing `cloudFunctions`
  pattern).
- Logger only: `LOG.extend('GPS')`. Never `console.*`.
- Every SDK call goes through `BackgroundGeolocationClient`. No
  scattered `BackgroundGeolocation.*` imports across the codebase.
- Subscription-shaped use cases use synchronous unsubscribe — the
  legacy `subscribeToUserLocation` returned a Promise and that's
  explicitly fixed in the rewrite. Don't regress.
- AppContent is the ONLY place that calls `gpsStart()` / `gpsStop()`
  (or their rewrite-named equivalents `useGpsLifecycle.start /
.stopAndClear`). Screens and view-models READ from the hook; they
  don't drive the lifecycle.
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring a turn done.

## Start with

Read `CLAUDE.md`, then the Phase 7 section of `REFACTOR_PLAN.md`,
then `docs/PHASE_6_TURN_5.md`, then the legacy
`src/api/gps/gpsLocation.js` end-to-end (it's not long), then the
legacy `AppContent.js`'s GPS lifecycle block (search for `gpsStart` /
`gpsStop` / `BackgroundGeolocation.onLocation`). Then read the
rewrite's `useCurrentLocation.ts` (note its existing comment about
Phase 7's responsibilities), `EvaluateExitWarning.ts`,
`useGeofenceUiStore.ts`, and `useDriverMonitorViewModel.ts` (the
`arrivedAtPickup` flag + `stubOdometerMeters` derivation). Then
propose **Turn 1 scope** as a numbered punch list (files to create,
files to touch, tests to add) and wait for confirmation before
writing code.

Tip: this kickoff has the same shape as Phase 6's kickoffs. Mirror
that structure for Phase 8's kickoff (Google Navigation SDK — driver
in-app navigation), which will be the next phase after Phase 7
closes.
