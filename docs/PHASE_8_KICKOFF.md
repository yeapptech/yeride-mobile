# Phase 8 Kickoff Prompt — Google Navigation SDK (driver in-app navigation)

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 8.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Phase 7 just closed:
the background-GPS pipeline + pickup-geofence + real-odometer wiring
is end-to-end. AppContent owns the SDK lifecycle via
`useGpsLifecycle`; both rider and driver monitor view-models read GPS
state through `useGpsStore` selector hooks. End of Phase 7
acceptance: **152 suites / 1171 tests passing**.

Your job this session is to start **Phase 8: Google Navigation SDK
(driver in-app navigation)**. Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered architecture,
   conventions, file map. The "Project status" table now shows Phase 7
   complete and Phase 8 Next.
2. `docs/PHASE_7_TURN_3.md` (most recent) — what closed Phase 7, with
   the Phase-7-arc summary at the end.
3. `docs/PHASE_7_KICKOFF.md` — useful for scope-decision shape; mirror
   that structure when you write `docs/PHASE_8_KICKOFF.md` follow-ups
   per turn.
4. The rewrite's existing driver-side touchpoints. Read in this order:
   - `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`
     — the host screen for an active trip. The map + bottom-sheet
     status-router is here. Phase 8 adds an "Open Navigation" affordance
     during `'dispatched'` (route-to-pickup) and `'started'`
     (route-to-dropoff) states.
   - `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
     — already exposes `ride`, `arrivedAtPickup`, `currentOdometerMeters`.
     Phase 8 wires the in-app nav launcher: a callback that hands the
     active route + waypoints to a new `useDriverNavigationViewModel`.
   - `src/presentation/features/driver/components/EnRouteToPickupView.tsx`
     and `StartedView.tsx` — the two status views that get a "Navigate"
     CTA. Read both.
   - `src/data/services/BackgroundGeolocationClient.ts` — Phase 7's
     SDK seam pattern. Phase 8 mirrors the seam shape with
     `NavigationSdkClient` (init, terms-and-conditions gate, session
     management, terminate, addListener for arrived-at-waypoint
     events).
5. Legacy app — Navigation SDK is mature there:
   - `/Users/papagallo/yeapptech/dev/yeride/src/driver/screens/DriverNavigation.js`
     (~440 lines). The full UX: enter terms-and-conditions if
     unaccepted, init session, set destination(s), start guidance,
     handle "arrived at pickup" / "arrived at dropoff" callbacks, end
     navigation. Key contract notes: `getCurrentActivity()` returns
     `null` once `NavigationView` mounts, so all session init must
     happen in `DriverMonitor` BEFORE pushing `DriverNavigation`.
   - `/Users/papagallo/yeapptech/dev/yeride/plugins/withNavigationSdk.js`
     (~350 lines). The Expo config plugin that injects the Navigation
     SDK's Android wiring (`NavigationApi.create`, `MapsInitializer`,
     `MapView` constructor patches for `onCreate` / `onResume` race,
     `onPause` NPE swallow, Firebase BoM pin to 34.0.0 to fix gRPC
     `UNAVAILABLE` errors). Read end-to-end — most of these patches
     are non-obvious and were earned through field crashes.
   - `/Users/papagallo/yeapptech/dev/yeride/docs/plans/2026-03-04-google-navigation-sdk-design.md`
     (~330 lines). The design plan that landed the legacy integration.
     Required reading.
   - `/Users/papagallo/yeapptech/dev/yeride/docs/plans/2026-03-04-google-navigation-sdk-implementation.md`
     (~770 lines). The implementation plan with file-by-file
     breakdown. Reference when deciding the rewrite's split between
     `NavigationSdkClient` (data layer) and `useDriverNavigationViewModel`
     (presentation layer).
   - `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` — search for
     "Navigation SDK" — captures the legacy gotchas: New Architecture
     requirement (`@googlemaps/react-native-navigation-sdk` 0.14.1 is
     TurboModule-only); `react-native-maps` pinning at 1.24.0 because
     1.25.0+ NPEs inside `MapView.onSaveInstanceState`; the
     `TERMS_NOT_ACCEPTED` error path that requires
     `showTermsAndConditionsDialog()` first; the
     `getCurrentActivity()` null inside `NavigationView` quirk that
     forces session init in `DriverMonitor` before pushing
     `DriverNavigation`.
6. SDK reference:
   - `@googlemaps/react-native-navigation-sdk@0.14.1` — pin matches
     legacy. The package's
     [README](https://github.com/googlemaps/react-native-navigation-sdk)
     covers the JS API: `NavigationApi.create()`, session lifecycle,
     `NavigationView` component, listeners (`onArrival`,
     `onRouteChanged`, `onTrafficUpdated`, etc.).
   - License-key handling: the SDK uses Google Maps Platform's
     Navigation SDK billing — **no separate license key**, but the
     Google Maps Platform project must have the Navigation SDK API
     enabled (per-OS: Android Navigation SDK, iOS Navigation SDK).
     The Google Maps API keys (`GOOGLE_MAPS_APIKEY_ANDROID` /
     `GOOGLE_MAPS_APIKEY_IOS`) the rewrite already has work for the
     Navigation SDK if the API is enabled in the Cloud Console.
7. Native config references:
   - iOS: the SDK's Pod has its own modular-headers requirements
     under `useFrameworks: 'static'`. The legacy
     `scripts/patch-podfile.js` doesn't cover this yet (Navigation
     SDK isn't installed in legacy via pure JS — it's wired through
     `withNavigationSdk.js`). First `pod install` will tell us if a
     new modular-headers pin is needed.
   - Android: `withNavigationSdk.js` from legacy is the canonical
     source. Phase 8 must port the relevant patches into a rewrite
     plugin (probably `plugins/withNavigationSdk.js`, mirroring the
     name). The Firebase BoM 34.0.0 pin and the MapView
     constructor / onPause patches are NOT optional — without them,
     the app crashes on backgrounding while a navigation session is
     active.

## Starting state — what's already built

- **Domain.** `Coordinates`, `Endpoint`, `Route`, `Ride` (with
  `pickup` / `dropoff` endpoints + the dispatched-driver pickup
  `Route` from `Ride.dispatch({pickupDirections})`). The dropoff
  route is computed on demand by `ComputeRoutes` use case and lives
  in the rider-side trip draft store. Phase 8 doesn't add new
  domain types — it consumes the existing route + endpoint shapes.
- **Data.** `GoogleRoutesService` for the Routes API (already wired);
  no Navigation SDK adapter yet. Phase 8 adds `NavigationSdkClient`
  alongside `BackgroundGeolocationClient` as a second
  presentation-data SDK seam.
- **Presentation.** `useDriverMonitorViewModel` exposes the active
  ride. The status-router renders `EnRouteToPickupView` /
  `AtPickupView` / `StartedView` / etc. Phase 8 adds:
  - `useDriverNavigationViewModel` (orchestrates session lifecycle
    + listens for arrival events)
  - `DriverNavigationScreen` (hosts `<NavigationView/>` + the
    end-navigation CTA)
  - `useDriverMonitorViewModel.onLaunchNavigation()` callback that
    initializes the session BEFORE navigation.push
- **No package, no native config.** Phase 8 adds
  `@googlemaps/react-native-navigation-sdk@0.14.1` + an Expo plugin
  block + `plugins/withNavigationSdk.js` (ported from legacy).

So Phase 8 spans data + presentation + native: a new SDK adapter
(`NavigationSdkClient`), a new presentation hook
(`useDriverNavigationViewModel`), a new screen
(`DriverNavigationScreen`), the `DriverMonitor` integration, plus
the once-only-prebuild-required native plugin install. Bigger than
Phase 7 because the screen is genuinely new (no prior placeholder).

## Scope decisions (lock at kickoff)

These need confirmation in the first message back. Don't re-debate
them mid-phase — surface follow-ups as deferred items.

1. **`@googlemaps/react-native-navigation-sdk@0.14.1` for the Navigation
   pipeline.** Same major / minor as legacy. The SDK's TurboModule-only
   shape requires New Architecture; the rewrite already runs on New
   Arch (verify in `app.config.ts` and `ios/Podfile.properties.json`
   before declaring Turn 1 done).

2. **`NavigationSdkClient` is the single seam to the SDK.** Lives in
   `src/data/services/NavigationSdkClient.ts` (data layer; concrete
   SDK wrapper). Domain code never imports
   `@googlemaps/react-native-navigation-sdk`. Methods (all
   `Result`-returning):
   - `init()` — calls `NavigationApi.create()`; returns `Result<void,
     AuthorizationError>` if the user hasn't accepted terms.
   - `showTermsAndConditionsDialog()` — invokes the SDK's dialog;
     `Result<{accepted: boolean}, NetworkError>`.
   - `setDestinations(waypoints: readonly Coordinates[])` — sets up
     the route(s).
   - `startGuidance()` / `stopGuidance()` — start / stop turn-by-turn.
   - `cleanup()` — terminates the session, frees native resources.
   - `subscribeToArrival(callback)` — registers an `onArrival` listener;
     returns synchronous unsubscribe.

3. **`useDriverNavigationViewModel` is the single presentation seam.**
   Owns:
   - Session lifecycle (init → terms-if-needed → setDestinations →
     startGuidance).
   - Arrival listener registration + delegation to the parent
     view-model (probably via callback prop into the screen).
   - Cleanup on screen-unmount (synchronous unsubscribe + cleanup
     fire-and-forget).
   - Exposed surface: tagged-union state machine
     (`uninitialized | terms_pending | initializing | guiding |
error`) + `onTermsAccept` / `onTermsDecline` / `onEndNavigation`
     callbacks.

4. **DriverMonitor handles the "session init before push" quirk.**
   `useDriverMonitorViewModel.onLaunchNavigation()` calls
   `navigationSdkClient.init()` + `setDestinations()` synchronously,
   then `navigation.navigate('DriverNavigation', {...})`. The screen
   mounts knowing the session is already alive. This avoids the
   legacy `getCurrentActivity()` null-after-mount footgun.

5. **`react-native-maps` stays at 1.24.0.** Already pinned for the
   driver-home / monitor map surfaces. Phase 8 doesn't touch this —
   the Navigation SDK uses its own `<NavigationView/>`, not
   `react-native-maps`.

6. **No license-key plumbing.** Unlike Phase 7's
   `BG_GEOLOCATION_LICENSE_KEY`, the Navigation SDK uses Google
   Maps Platform billing. If the API key isn't enabled for the
   Navigation SDK API in Cloud Console, `init()` returns a
   well-known error code; surface it as `AuthorizationError` at the
   adapter boundary.

7. **Pickup vs. dropoff routing.** Phase 8 launches a single
   navigation session per leg: pickup leg uses the
   `Ride.dispatchedRoute` (already computed by `Ride.dispatch`);
   dropoff leg uses a freshly-computed route via the existing
   `ComputeRoutes` use case (driver app needs the same route the
   rider selected — pull from `ride.routePreference`).

8. **Don't auto-launch.** The driver taps "Open Navigation" from
   `EnRouteToPickupView` / `StartedView`. Auto-launching on
   `'dispatched'` would interrupt drivers who prefer their own nav
   app (Waze, Apple Maps). Manual launch only.

9. **End-of-leg auto-pop.** When the SDK's `onArrival` fires for the
   final waypoint, `useDriverNavigationViewModel` pops the
   `DriverNavigation` screen automatically and the driver lands
   back on `DriverMonitor`. This matches the legacy behaviour and
   keeps the driver from being stranded inside `<NavigationView/>`
   after arrival.

10. **No background-route updates.** If traffic reroutes, the SDK
    handles it natively. Phase 8 doesn't tap `onRouteChanged` or
    write the new polyline back to the trip doc — keep the
    server-side state minimal (legacy parity).

## Scope (in / out)

**In:**

- **Data layer**:
  - `src/data/services/NavigationSdkClient.ts` — interface + real
    SDK adapter. Methods listed in scope decision 2.
  - `src/shared/testing/FakeNavigationSdkClient.ts` — programmable
    in-memory fake with seed/spy/emit seams (`emitArrival`,
    `seedTermsAccepted`, `failNext({method,error})`,
    `getActiveDestinations`, `isInitialized`, `reset`). Pattern
    matches `FakeBackgroundGeolocationClient`.
  - DI container gains `navigationSdk: NavigationSdkClient` arg,
    threaded through `makeUseCases({...})`. Production branch
    lazy-`require`s the real adapter; fakes branch wires the fake.

- **App layer**: no new use cases. Session lifecycle is a
  presentation concern.

- **Presentation layer**:
  - `src/presentation/hooks/useNavigationSdk.ts` — sibling of
    `useUseCases()` and `useBackgroundGeolocation()`; throws if
    used outside `<ContainerProvider/>`.
  - `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
    — the orchestration hook (scope decision 3).
  - `src/presentation/features/driver/screens/DriverNavigationScreen.tsx`
    — hosts `<NavigationView/>` from the SDK. Bottom-sheet trim:
    "End navigation" CTA.
  - `useDriverMonitorViewModel.onLaunchNavigation()` — extends the
    existing surface; gates on `ride.status` (only allow during
    `'dispatched'` or `'started'`).
  - `EnRouteToPickupView` / `StartedView` — add "Open Navigation"
    CTA wired to `onLaunchNavigation`.
  - `DriverNavigator` — add the `DriverNavigation` route.

- **Wiring**:
  - `package.json` adds `@googlemaps/react-native-navigation-sdk@0.14.1`.
    Install via `npx expo install`.
  - `app.config.ts` registers the SDK's Expo plugin block (or, more
    likely, the rewrite's own `plugins/withNavigationSdk.js` that
    mirrors the legacy patches).
  - `plugins/withNavigationSdk.js` — port from legacy. Critical
    patches: Firebase BoM pin to 34.0.0 (gRPC stream stability);
    MapView constructor `super.onCreate` / `super.onResume` race
    fix; MapView `onPause` NPE swallow.
  - `npm run prebuild` is **required** before the next iOS / Android
    build.
  - `scripts/patch-podfile.js` may need a new modular-headers pin
    for the `@googlemaps/react-native-navigation-sdk` pod under
    `useFrameworks: 'static'`. First iOS `pod install` is the
    canonical smoke; if it fails with non-modular include errors,
    extend the patch.

**Out (deferred — do not build in Phase 8):**

- **Background route updates** (write traffic reroutes back to
  the trip doc). Out of scope; the SDK handles rerouting natively.
- **Driver-side ETA refinement based on Navigation SDK telemetry**.
  The rewrite already shows ETAs from the dispatched-route
  `durationSeconds`. A more accurate ETA from the SDK's
  `onTrafficUpdated` is Phase 9 polish.
- **Voice-guidance language switching**. Use the SDK default
  (device language). Localization is a post-cutover concern.
- **CarPlay / Android Auto integration**. Out of Phase 8.
- **In-app navigation for riders** (e.g. "you have a ride coming;
  walk to the pickup point"). Driver-only this phase.
- **Navigation history / replay**. The SDK doesn't persist the
  navigation track; we don't either.

## Suggested turn breakdown (3 turns, mirror of Phase 7)

- **Turn 1 — `NavigationSdkClient` adapter + fake + DI wiring +
  Expo plugin port.** Add the SDK + the Expo plugin block + the
  `plugins/withNavigationSdk.js` port (start with the absolute
  minimum patches; bring in the BoM pin + MapView patches as the
  first device build catches them). Implement
  `NavigationSdkClient` against the SDK (init, terms,
  setDestinations, startGuidance, cleanup, subscribeToArrival).
  Mirror in `FakeNavigationSdkClient` with full seed/spy/emit
  seams. Wire DI. No view-model / screen changes yet — pure
  data-layer + fake parity. Tests run against the fake only; real
  SDK exercised on the next iOS / Android build.

- **Turn 2 — `useDriverNavigationViewModel` + `DriverNavigationScreen`
  + DriverMonitor integration.** Build the presentation hook with
  session state machine, arrival listener, end-navigation
  callback. Build the screen (`<NavigationView/>` + "End
  navigation" CTA + bottom-sheet trim matching the legacy
  proportions). Add `onLaunchNavigation` to
  `useDriverMonitorViewModel` (init session before
  `navigation.navigate`). Wire CTAs in `EnRouteToPickupView` /
  `StartedView`. Add the `DriverNavigation` route to
  `DriverNavigator`. View-model + screen tests against the fake.

- **Turn 3 — Phase 8 polish + cleanup.** First iOS + Android build
  smoke (post-prebuild) confirms the SDK boots and the terms
  dialog renders. Address any device-build patch needs (BoM pin,
  modular-headers, Maven repo additions). Update CLAUDE.md
  (Phase 8 → ✅, Phase 9 → Next). Write `docs/PHASE_8_TURN_*.md`
  records. Final `npm run verify` green. The first end-to-end
  navigation smoke (driver accepts ride → taps Open Navigation →
  follows pickup route → arrives → leg-2 launch on Start ride) is
  the manual integration acceptance.

## Risks + mitigations

- **iOS modular-headers under `useFrameworks: 'static'`.** Same
  family as the existing fixes. Extend `scripts/patch-podfile.js`
  if first `pod install` fails.
- **`@googlemaps/react-native-navigation-sdk` 0.14.1 + RN 0.83.6
  compatibility.** Legacy is on RN 0.79.6. The 0.14.1 pin was
  chosen specifically because 0.15+ requires CMake helpers that
  RN 0.79.6 doesn't have (per legacy CLAUDE.md). The rewrite is on
  RN 0.83.6, which DOES have those helpers — **consider whether to
  bump to a newer SDK version** before locking the 0.14.1 pin.
  Risk: 0.14.1 is two years old; APIs may have evolved. Mitigation:
  start with 0.14.1 for legacy parity, bump in Phase 9 if there's
  a compelling reason.
- **`getCurrentActivity()` null inside `<NavigationView/>`.**
  Documented in legacy CLAUDE.md. Mitigation: scope decision 4 —
  init the session in DriverMonitor before pushing the screen.
- **`TERMS_NOT_ACCEPTED` error path.** First-time launch requires
  the SDK's terms dialog. The view-model state machine handles
  this via the `terms_pending` arm. Mitigation: tag a kickoff
  acceptance criterion that exercises the terms-pending path in
  tests.
- **Firebase BoM 34.0.0 pin.** Required for gRPC stream stability
  while a Navigation session is active. The rewrite isn't yet
  pinned (Phase 7 didn't need it). Phase 8 brings the pin in via
  `plugins/withNavigationSdk.js` — same patch as legacy.
- **MapView constructor / onPause NPEs.** Legacy patches in
  `withNavigationSdk.js` swallow these defensively. Port them
  verbatim; don't try to debug from scratch.
- **New Architecture verification.** The SDK is TurboModule-only.
  Verify `newArchEnabled=true` in `android/gradle.properties` and
  `ios/Podfile.properties.json` does NOT set `"newArchEnabled":
"false"` before declaring Turn 1 done.
- **Test mocking under jest.** The SDK's TurboModule registration
  fails outside RN runtime. Mitigation: jest-mock
  `@googlemaps/react-native-navigation-sdk` globally via
  `jest.setup.ts` (mirror the Phase 7 SDK mock pattern).
- **Cleanup on screen-unmount.** A driver who hits the back gesture
  during navigation must not strand the SDK in a partial state.
  Mitigation: `useDriverNavigationViewModel` exposes synchronous
  unsubscribe + fire-and-forget `cleanup()` chain on unmount.

## Acceptance for end of Phase 8

- A signed-in driver on a `'dispatched'` ride taps "Open
  Navigation" on `EnRouteToPickupView`. The terms dialog shows on
  first launch (handled in-band). The `<NavigationView/>` mounts
  with the pickup destination set; voice guidance starts.
- Arriving at the pickup geofence (Phase 7's contract) auto-pops
  the navigation screen back to `DriverMonitor`'s `'at_pickup'`
  view. The driver taps "Start ride" — `Started` view shows the
  "Open Navigation" CTA again, this time routing to the dropoff.
- Arriving at the dropoff auto-pops back; the driver taps
  "Request payment" and the existing Phase 4/6 fare flow runs.
- The Navigation SDK's `cleanup()` fires when `DriverMonitor`
  unmounts (cancel / completed / payment_failed close-trip). No
  zombie session.
- Force-quitting the app during navigation does NOT leave the SDK
  reporting GPS in the background (the SDK's session state ties
  to the foreground process per its own contract).
- Test suite stays green; new view-model + adapter tests against
  the fake; the SDK is jest-mocked globally so no test pulls in
  the real native module. Net test gain: ~+25 to +35 tests
  (estimate).
- `CLAUDE.md` updated; `docs/PHASE_8_TURN_*.md` records written;
  Phase 8 → ✅ and Phase 9 → Next across both phase tables.
- A first iOS + Android native build smoke (with `npm run
  prebuild` re-run) confirms the Navigation SDK boots and the
  terms dialog renders.

## Conventions (non-negotiable — same as Phases 3–7)

- `Result.ok` / `Result.err` for every expected failure. The SDK's
  errors are caught at the `NavigationSdkClient` boundary and
  mapped to domain errors (`AuthorizationError` for terms-pending /
  API-not-enabled, `NetworkError` for transient failures, etc.).
- Build the in-memory fake first (Turn 1) before the real SDK
  adapter exercises the contract.
- Server state → TanStack Query. Client / UI state → Zustand. The
  Navigation hook itself is presentation-layer SDK seam, not
  state — the same architectural exception we made for
  `useGpsLifecycle`.
- View-model tests use `FakeNavigationSdkClient` via
  `TestContainerProvider` (a new optional override slot mirrors
  the existing `bgGeolocation` pattern).
- Logger only: `LOG.extend('NAV')` for the SDK adapter,
  `LOG.extend('DriverNavigationVM')` for the view-model. Never
  `console.*`.
- Every SDK call goes through `NavigationSdkClient`. No scattered
  `import { NavigationApi } from '@googlemaps/...'` across the
  codebase.
- AppContent is the ONLY place that calls
  `useGpsLifecycle`. `useDriverNavigationViewModel` is mounted
  ONLY by `DriverNavigationScreen`. Don't lift it to AppContent —
  it's session-scoped to a navigation screen.
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring a turn done.
- ESLint boundaries override extension: the
  `useDriverNavigationViewModel.ts` hook will need to import
  `NavigationSdkClient` types from the data layer (same pattern as
  `useGpsLifecycle.ts` + `useGpsStore.ts`). Add it to the existing
  override block in `eslint.config.js`.

## Start with

Read `CLAUDE.md`, then `docs/PHASE_7_TURN_3.md`, then the legacy
`src/driver/screens/DriverNavigation.js` end-to-end, then the legacy
`plugins/withNavigationSdk.js` (read every patch comment), then
`docs/plans/2026-03-04-google-navigation-sdk-design.md` and
`-implementation.md`. Then propose **Turn 1 scope** as a numbered
punch list (files to create, files to touch, tests to add) and wait
for confirmation before writing code.

Tip: this kickoff is bigger than Phase 7's. The legacy implementation
is mature and well-documented; lean on it heavily. Resist the urge
to redesign the session lifecycle from scratch — port the patterns
that already work in production.
