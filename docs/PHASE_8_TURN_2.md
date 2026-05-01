# Phase 8 — Turn 2: view-model + screen + DriverMonitor integration

The driver Google-Navigation surface is wired end-to-end now. App-root
mount of `<NavigationProvider/>` (Phase 8 turn 2) creates a single
shared `NavigationController`; `DriverMonitorScreen` mounts the new
`useNavigationSdkConnector` to push that controller into the
`NavigationSdkClient` adapter as soon as the driver is on an active
trip; the new `useDriverMonitorViewModel.onLaunchNavigation()` callback
runs the legacy-faithful `init()` (+ terms dialog if first launch)
sequence BEFORE pushing the new `DriverNavigation` screen; that screen
hosts `<NavigationView/>` and a five-arm
`useDriverNavigationViewModel` that runs `setDestinations` →
`startGuidance` after `onMapReady`, surfaces an error overlay with a
retry CTA on non-OK route statuses or transport throws, and auto-pops
back to DriverMonitor on final-destination arrival. Both
`EnRouteToPickupView` (pickup leg) and `StartedView` (dropoff leg) gain
"Open Navigation" CTAs gated on `isLaunchingNavigation`.

End of Turn 2 acceptance: **160 suites / 1260 tests passing** (+5
suites / +47 tests over Turn 1's 155/1213 — at the high end of the
kickoff's "+6 to +8 suites / +30 to +45 tests" band. Every test maps
to a documented behavior; the surplus is parameterized
`NavRouteStatus → error.subKind` mapping coverage). typecheck, lint,
format, and test all green.

## What's in

### 1. `<NavigationProvider/>` mount at App root

`src/presentation/App.tsx`. Adds `NavSdkProvider` (renamed import to
avoid colliding with React Navigation's `NavigationContainer`)
between `MaybeStripeProvider` and `<QueryClientProvider/>`. Always
mounted — the SDK provider has no "unconfigured" branch like Stripe,
and the jest mock makes `<NavigationProvider/>` a `children`
passthrough so unit-test trees still work.

Terms dialog config: `{ title: 'Navigation Terms', companyName:
'YeRide', showOnlyDisclaimer: true }`. Task-removed behaviour:
`TaskRemovedBehavior.CONTINUE_SERVICE`. Both match legacy yeride
verbatim.

### 2. `useNavigationSdkConnector` (presentation seam)

`src/presentation/features/driver/hooks/useNavigationSdkConnector.ts`.
Calls the SDK's `useNavigation()` context hook to read the
`{navigationController, ...listenerSetters}` minted by
`<NavigationProvider/>`, pushes them into the adapter via
`navigationSdk.setController({controller, listeners})`. On unmount,
pushes `{controller: null, listeners: null}` to disconnect.

**Mounting rule:** mounted by `DriverMonitorScreen`, not by
AppContent (too broad — would attach for unauthenticated users +
riders) and not by `DriverNavigationScreen` (too narrow — `init()`
needs to have already succeeded by the time `<NavigationView/>` is on
screen, which the legacy team specifically engineered to sidestep the
`getCurrentActivity()` null-after-mount Android quirk).

The connector does NOT call `navigationSdk.cleanup()` on unmount.
Cleanup is owned by `useDriverNavigationViewModel`'s effect-cleanup —
which runs at `DriverNavigationScreen` unmount, AFTER any
`onEndNavigation` / auto-arrival paths have already fired
`stopGuidance`.

### 3. `useDriverNavigationViewModel` (5-arm tagged-union state machine)

`src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`.

States (`DriverNavigationVMState`):

- `uninitialized` — initial; waiting on the screen to flip
  `onMapReady` true.
- `initializing` — `setDestinations()` / `startGuidance()` chain in
  flight.
- `guiding` — turn-by-turn live; arrival subscription armed;
  `onEndNavigation` callable.
- `arrived` — final-destination arrival fired OR `onEndNavigation`
  tapped. Terminal in this VM; the screen reads `hasArrived` and
  calls `navigation.goBack()`.
- `error` — chain failed. Carries `subKind: 'route_not_found' |
'network' | 'permission' | 'api_not_authorized' | 'unknown'` +
  user-facing `message`. `onRetry` resets to `'uninitialized'` AND
  bumps a `retryNonce` to retrigger the chain effect.

`NavRouteStatus` → error sub-kind mapping (per the kickoff):

- `'no_route_found'` / `'waypoint_error'` / `'invalid_place_id'` /
  `'duplicate_waypoints_error'` → `'route_not_found'`
- `'network_error'` → `'network'`
- `'location_disabled'` / `'location_unknown'` → `'permission'`
- `'quota_check_failed'` / `'route_canceled'` / `'unknown'` →
  `'unknown'`

**Race avoidance.** The chain effect's gate (`state.kind ===
'uninitialized'`) is read via a `stateRef`, not via the dep list.
Listing `state.kind` as a dep created a self-cancelling race: the
synchronous `setState({kind: 'initializing'})` immediately re-fires
the effect, which calls the previous effect's cleanup → flips
`cancelled = true` on the in-flight chain → the `setState({kind:
'guiding'})` after `startGuidance` never lands. The `retryNonce`
state pairs with this so `onRetry()` can re-trigger the chain even
though the deps haven't otherwise changed.

**Cleanup on unmount.** Synchronous fire-and-forget chain
`stopGuidance()` → `cleanup()`, both tolerant of the no-controller
path (the connector clears the controller separately at
DriverMonitor's unmount, which happens after this VM's cleanup).

### 4. `DriverNavigationScreen`

`src/presentation/features/driver/screens/DriverNavigationScreen.tsx`.

Renders `<NavigationView style={{flex: 1}} onMapReady={...}/>` filling
the screen. A bottom-pinned "End Navigation" CTA fires
`vm.onEndNavigation()`. A `<StateOverlay/>` renders during non-guiding
arms — a spinner + copy on `uninitialized` / `initializing` / a
"Try again" CTA on `error` / a brief "Arrived" panel on `arrived`.

Auto-pop: a `useEffect` on `vm.hasArrived` schedules
`navigation.goBack()` after a 1.2s delay (so the "Arrived" overlay
gets a frame). A `hasNavigatedAwayRef` guards against double-pop.

The screen does NOT call `useNavigationSdkConnector` itself — that's
mounted by `DriverMonitorScreen` (the parent). It also doesn't
construct a `NavWaypoint` directly (that's a data-layer type and
would violate the boundaries rule); it passes `{title, coords}`
primitives to the VM, which constructs the waypoint internally.

### 5. `useDriverMonitorViewModel.onLaunchNavigation`

`src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`.
Extension of the existing surface (Phase 4); adds an async callback
that:

1. Reads `ride.status` to pick the leg via `buildLegParam(ride)`:
   - `'dispatched'` / `'scheduled_driver_accepted'` → pickup leg,
     no `routeToken` (pickup directions are dispatch-computed, not
     rider-selected), forwards `ride.routePreference?.avoidTolls`.
   - `'started'` → dropoff leg, forwards
     `ride.routePreference?.routeToken` (when present) +
     `avoidTolls`.
   - Anything else → returns `null`; `onLaunchNavigation` no-ops.
2. Calls `navigationSdk.init()`. If
   `'navigation_terms_not_accepted'`:
   - Calls `showTermsAndConditionsDialog()`. On accept, retries
     `init()`. On decline, returns silently (the user made a
     deliberate choice).
3. On any other init failure: surfaces a Toast warn (no
   external-Maps fallback this phase, per kickoff "out" list); does
   not navigate.
4. On init success: `navigation.navigate('DriverNavigation', {
leg, title, destination, routeToken?, avoidTolls? })`.

`isLaunchingNavigation` mirrors the in-flight state so the
"Open Navigation" CTA disables across the init+terms chain.

### 6. CTAs on `EnRouteToPickupView` + `StartedView`

`src/presentation/features/driver/components/EnRouteToPickupView.tsx`

- `src/presentation/features/driver/components/StartedView.tsx`. Each
  view gains a new outlined-primary "Open navigation" Pressable above
  the existing primary CTA, gated on the new
  `launchNavigationDisabled` prop. The "No Navigate button — Phase 8"
  JSDoc comments are dropped from both files.

### 7. `DriverNavigation` route on `DriverNavigator`

`src/presentation/navigation/DriverNavigator.tsx`. Plain native-stack
push, `headerShown: false` so the SDK's full-screen UI fills the
viewport. Param payload (`src/presentation/navigation/types.ts`):
`{leg: 'pickup' | 'dropoff', title: string, destination: {lat, lng},
routeToken?: string, avoidTolls?: boolean}`.

### 8. ESLint boundaries override extension

`eslint.config.js`. The `useNavigationSdkConnector.ts` and
`useDriverNavigationViewModel.ts` files import the
`NavigationSdkClient` adapter's data-layer `Nav*` types (the same
architectural exception as `useGpsLifecycle.ts` /
`useGpsStore.ts` for the BG SDK). The override block carries them
alongside the existing entries.

### 9. `FakeNavigationSdkClient.setController` + jest-mock `useNavigation`

`src/shared/testing/FakeNavigationSdkClient.ts`. New no-op `setController`
method that records calls in `spies.setControllerCalls` so connector
hook tests can verify mount-push (controller non-null) +
unmount-clear (controller null). Parameter `controller` typed as
`unknown` so the union-typed `Container.navigationSdk` (real adapter
| fake) keeps `setController` callable from the connector hook
without an intersection-typed parameter.

`jest.setup.ts`. The SDK module mock gains a `useNavigation` export
returning a shared `{navigationController, ...listenerSetters}`
instance. New `__getSharedNavigation()` /
`__resetSharedNavigation()` test helpers + an updated `__reset()`
that flushes the shared instance.

### 10. Tests (+5 suites / +47 tests)

**`src/presentation/features/driver/hooks/__tests__/useNavigationSdkConnector.test.tsx` — 6 tests.**

- Pushes the SDK controller into the adapter on mount.
- Pushes the SAME controller the SDK context exposes (reference
  equality).
- Clears the controller on unmount.
- Does not re-push on a no-op re-render (SDK context is stable).
- Re-pushes when the SDK shared context is reset between mounts.
- Tolerates concurrent mounts (each independently pushes).

**`src/presentation/features/driver/view-models/__tests__/useDriverNavigationViewModel.test.tsx` — 24 tests.**

- Initial state (2 tests): starts `uninitialized`; chain doesn't
  fire while `onMapReady` is false.
- Happy path (3 tests): `uninitialized → initializing → guiding`
  when `onMapReady` flips; `routeToken` passthrough; `avoidTolls`
  passthrough.
- Error mapping — non-OK NavRouteStatus (10 tests, parameterized):
  every status arm maps to the documented `error.subKind`.
- Error: SDK throws (2 tests): `setDestinations` rejects with
  `NetworkError` → `error.subKind = 'network'`;
  `startGuidance` rejects → `error.subKind = 'unknown'`.
- Arrival (2 tests): final-destination arrival flips to `arrived`
  - fires `stopGuidance`; non-final arrival ignored.
- `onEndNavigation` (1 test): flips to `arrived` + fires
  `stopGuidance`.
- `onRetry` (1 test): from `error`, resets and re-runs the chain.
- Cleanup on unmount (3 tests): disposes arrival subscription;
  fires `stopGuidance` + `cleanup`; mid-chain unmount doesn't
  transition stale state.

**`src/presentation/features/driver/screens/__tests__/DriverNavigationScreen.test.tsx` — 7 tests.**

- Renders the preparing-map overlay during `uninitialized`.
- Renders the calculating-route overlay during `initializing`.
- Hides overlay during `guiding` and shows the End Navigation CTA.
- End Navigation press fires VM's `onEndNavigation`.
- Renders the error overlay with retry CTA during `error`.
- Hides the End Navigation CTA in `arrived` and auto-pops via
  `goBack` after the 1.2s timer.
- Renders an inline error for invalid route-param coordinates.

**`src/presentation/features/driver/components/__tests__/EnRouteToPickupView.test.tsx` — 1 test.**
Open Navigation CTA fires `onLaunchNavigation`.

**`src/presentation/features/driver/components/__tests__/StartedView.test.tsx` — 1 test.**
Open Navigation CTA fires `onLaunchNavigation`.

**Extension to
`src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx` — 8 new tests.**

- On `dispatched`, navigates with the pickup leg payload (forwards
  `avoidTolls`).
- On `started`, navigates with the dropoff leg payload + the
  rider-selected `routeToken`.
- On `started` without a `routeToken`, omits it from the payload.
- On terms-not-accepted, shows dialog → on accept retries `init()`
  → navigates.
- On terms declined by user, does not navigate (no Toast — declining
  is a deliberate choice).
- On init network error, surfaces a Toast and does not navigate.
- On a non-launchable status (e.g. `'completed'`), does nothing
  (no `init()` call, no `navigate()`).
- `isLaunchingNavigation` is `false` after the call settles.

## Why this turn doesn't include

- **Floating mute / chat / exit buttons inside the navigation
  screen.** Per kickoff "out" list — Phase 9 polish.
- **External-Google-Maps fallback** on init failure. Per kickoff
  "out" list. The error message in the Toast is the user-facing
  surface; no automatic retry to a different app.
- **`onRouteChanged` / `onTrafficUpdated` /
  `setOnRemainingTimeOrDistanceChanged` listeners.** Out of Phase 8
  entirely — Phase 9 polish lands the Distance Matrix bypass + ETA
  refinement via SDK telemetry.
- **`<NavigationView/>` style customization** (night-mode toggle,
  audio guidance type toggle, traffic overlay toggle). Use SDK
  defaults.
- **Multi-stop trips.** Single-leg only (one waypoint per
  `setDestinations` call). The arrival listener defensively ignores
  non-final arrivals so adding multi-stop later is purely additive.
- **CarPlay / Android Auto.** Hard-out per kickoff.
- **Rider-side in-app navigation.** Driver-only.

## Risks surfaced

### Pre-Turn-3 manual steps

The Cloud Console project hosting the Maps API keys still needs the
"Navigation SDK for Android" + "Navigation SDK for iOS" APIs enabled
before the Turn 3 device-build smoke. If they're not, `init()`
returns `NavigationSessionStatus.NOT_AUTHORIZED` →
`AuthorizationError({code: 'navigation_api_not_authorized'})`. The VM
surfaces this via a Toast on DriverMonitor; the smoke can't proceed
without enabling.

### `npm run prebuild` is not strictly required

This turn doesn't touch `app.config.ts` or any plugin file. The
plugin-driven native config from Turn 1 (`withNavigationSdk.js`) is
still the canonical source of truth. A native rebuild against the
Turn-1 prebuild output works.

### Effect-dep race in the navigation VM

Documented in detail above (`useDriverNavigationViewModel`'s chain
effect). The `state.kind` self-cancelling race was caught by the test
suite (the happy-path test went red on the first run); the fix
(`stateRef`-gated effect + `retryNonce` for retry triggering) is the
canonical pattern in the rewrite for state-machine VMs that drive
async transitions from a single effect.

### Connector mount granularity

The connector lives at the DriverMonitor screen level. If a future
phase adds a non-trip surface that wants to use Navigation SDK
features (e.g. rider in-app pickup walking directions in a future
phase), that surface will need to mount its own connector. We
deliberately did NOT lift to AppContent — the SDK's `init()` requires
the user to have accepted terms, and we don't want to badger
non-driver users with the dialog at boot.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` + `npm
run test` all green. **160 test suites / 1260 tests** (+5 suites /
+47 tests over Turn 1's 155/1213; +8 suites / +89 tests over Phase 7
turn 3's 152/1171).

Phase 8 turn 2 acceptance criteria, all met:

1. ✅ `<NavigationProvider/>` mounted at App root with the legacy
   terms-dialog config + CONTINUE_SERVICE task-removed behaviour.
2. ✅ `useNavigationSdkConnector` lives in
   `presentation/features/driver/hooks/`, calls `useNavigation()`
   from the SDK and pushes/clears the adapter's controller.
3. ✅ `useDriverNavigationViewModel` ships with the 5-arm
   tagged-union state machine, full route-status → subKind mapping,
   final-arrival auto-flip, `onEndNavigation` + `onRetry`, and
   synchronous unmount cleanup.
4. ✅ `DriverNavigationScreen` hosts `<NavigationView/>` + the End
   Navigation CTA + the state overlay + the auto-pop effect.
5. ✅ `DriverNavigation` route registered on `DriverNavigator`,
   `headerShown: false`, plain native-stack push.
6. ✅ `useDriverMonitorViewModel.onLaunchNavigation` runs the legacy
   init+terms chain BEFORE pushing the navigation screen, surfaces
   errors via Toast, no-ops on non-launchable statuses.
7. ✅ `EnRouteToPickupView` + `StartedView` render the new "Open
   navigation" CTA, gated on `isLaunchingNavigation`.
8. ✅ ESLint boundaries override extended; lint passes.
9. ✅ Test suite green; +8 suites / +89 tests over Phase 7's close
   (+5 suites / +47 over Turn 1).
10. ✅ `docs/PHASE_8_TURN_2.md` written.

Pending for the device build (Turn 3 acceptance):

- Cloud Console: Navigation SDK API enabled for both platforms.
- First end-to-end smoke: signed-in driver accepts a ride → taps
  Open Navigation on EnRouteToPickupView → sees terms dialog (first
  launch) → accepts → `<NavigationView/>` renders with pickup
  destination → drives into the geofence → DriverMonitor auto-flips
  to AtPickupView (Phase 7) → driver returns to monitor → taps
  Start ride → screen shows StartedView with Open Navigation CTA →
  taps it → `<NavigationView/>` renders with dropoff destination
  (using the rider's selected route token if present) → arrives →
  auto-pops back to DriverMonitor.

## Files added / touched this turn

**Added:**

- `src/presentation/features/driver/hooks/useNavigationSdkConnector.ts`
- `src/presentation/features/driver/hooks/__tests__/useNavigationSdkConnector.test.tsx`
- `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
- `src/presentation/features/driver/view-models/__tests__/useDriverNavigationViewModel.test.tsx`
- `src/presentation/features/driver/screens/DriverNavigationScreen.tsx`
- `src/presentation/features/driver/screens/__tests__/DriverNavigationScreen.test.tsx`
- `src/presentation/features/driver/components/__tests__/EnRouteToPickupView.test.tsx`
- `src/presentation/features/driver/components/__tests__/StartedView.test.tsx`
- `docs/PHASE_8_TURN_2.md` (this file)

**Touched:**

- `src/presentation/App.tsx` — mount `<NavigationProvider/>`
- `src/presentation/navigation/types.ts` — add `DriverNavigation`
  route to `DriverStackParamList`
- `src/presentation/navigation/DriverNavigator.tsx` — register the
  new screen
- `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`
  — mount the connector hook; pass `onLaunchNavigation` /
  `isLaunchingNavigation` through to the views
- `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
  — add `onLaunchNavigation` + `isLaunchingNavigation` + the
  `buildLegParam` helper + Toast import
- `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`
  — add the Toast jest mock + extend `withTestContainer` + 8 new
  tests
- `src/presentation/features/driver/components/EnRouteToPickupView.tsx`
  — add `onLaunchNavigation` + `launchNavigationDisabled` props +
  the new CTA; drop the "Phase 8" JSDoc note
- `src/presentation/features/driver/components/StartedView.tsx` —
  same shape
- `src/shared/testing/FakeNavigationSdkClient.ts` — add
  `setController` no-op spy + extend `FakeNavigationSdkSpies` with
  `setControllerCalls`
- `eslint.config.js` — extend the boundaries override block
- `jest.setup.ts` — add `useNavigation` mock + shared-context
  helpers
