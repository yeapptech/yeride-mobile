# Phase 8 — Turn 2 kickoff: view-model + screen + DriverMonitor integration

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 8 Turn 1 just
shipped** (commit `b390520`): the `NavigationSdkClient` adapter + fake
+ DI wiring + Expo plugin port are in. End-of-Turn-1 acceptance: 155
suites / 1213 tests passing; native build smokes green on Android (Nav
SDK module loads, container instantiates the adapter cleanly at
runtime, app boots through the auth flow).

Your job this session is **Phase 8 Turn 2 — view-model + screen +
DriverMonitor integration**. The data layer is locked from Turn 1;
this turn is pure presentation-layer work + a small App-root mount.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered
   architecture, conventions. The Phase 8 row in the second phase
   table now shows "turn 1: ✅, turn 2: Next".
2. `docs/PHASE_8_TURN_1.md` — what shipped. Read end-to-end before
   touching anything.
3. `docs/PHASE_8_KICKOFF.md` — the Phase 8 scope decisions.
   Decisions 1, 2, 3, 5, and 6 are already settled (locked in
   Turn 1); decisions 4 (DriverMonitor handles "session init before
   push"), 7 (pickup vs. dropoff routing), 8 (no auto-launch), 9
   (end-of-leg auto-pop), and 10 (no background-route updates) all
   bear directly on Turn 2.
4. `src/data/services/NavigationSdkClient.ts` — the seam your VM
   will consume. Read every method's docstring; pay particular
   attention to:
   - `setController({controller, listeners})` is how the
     React-tied `useNavigationController()` hook gets pushed into
     the adapter. Without it, every other method returns
     `Result.err(NetworkError({code:
'navigation_sdk_not_connected'}))`.
   - `init()` returns `Result<true, NavInitError>` where
     `NavInitError = AuthorizationError | NetworkError`. The
     `AuthorizationError` arm carries codes
     `'navigation_terms_not_accepted'` /
     `'navigation_api_not_authorized'` /
     `'navigation_location_permission_missing'` — the VM's state
     machine branches on these.
   - `setDestinations(args)` returns `Result.ok<NavRouteStatus>`
     for non-OK SDK statuses (kickoff decision 2). Your VM
     exhaustively branches on `'ok' | 'no_route_found' |
'network_error' | …`.
   - `subscribeToArrival(cb)` returns synchronous unsubscribe; the
     adapter dedupes by `(waypointKey, isFinal)`.
5. `src/shared/testing/FakeNavigationSdkClient.ts` — what your
   tests will exercise. `seedTermsAccepted`, `seedRouteStatus`,
   `failNext`, `emitArrival`, `spies`, `getActiveDestinations`,
   `isGuiding`.
6. `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
   — the VM you'll extend with `onLaunchNavigation`. The
   status-router surface (`status: DriverMonitorStatus`) plus the
   existing `arrivedAtPickup` derivation tell you when each leg is
   launchable.
7. `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`
   — the host screen. The VM's existing surface is already exposed
   here; `onLaunchNavigation` will be a new field passed through to
   `EnRouteToPickupView` / `StartedView`.
8. `src/presentation/features/driver/components/EnRouteToPickupView.tsx`
   and `StartedView.tsx` — the two views that gain "Open
   Navigation" CTAs. Both have an explicit comment in their existing
   JSDoc saying "No Navigate button — Navigation SDK is Phase 8" —
   that comment gets removed and a CTA gets added.
9. `src/presentation/navigation/DriverNavigator.tsx` — where the
   new `DriverNavigation` route lands.
10. `src/presentation/App.tsx` — where `<NavigationProvider/>`
    mounts. Look at how `MaybeStripeProvider` is composed today;
    the Nav SDK provider sits at the same level.
11. `src/presentation/hooks/useGpsLifecycle.ts` — the
    closest-pattern sibling for "presentation-layer SDK glue +
    ref-tracked teardown + `enabled`-gated effect". Your
    `useNavigationSdkConnector` will mirror its synchronous
    chain-ordered teardown rule.
12. Legacy `src/driver/screens/DriverNavigation.js` (~440 lines, in
    `/Users/papagallo/yeapptech/dev/yeride/`). The full UX in
    production today: terms-and-conditions handling,
    init-then-setDestinations sequence, `onArrival` listener with
    auto-pop, mute / chat / exit floating buttons. **Phase 8 Turn 2
    ports the orchestration shape; the floating mute / chat
    buttons stay deferred to Phase 9 polish per kickoff "out"
    list.**
13. `eslint.config.js` — the boundaries override block. The
    connector hook and view-model don't need an exception (they
    consume the adapter's domain-shaped types via
    `@data/services/NavigationSdkClient`, which is allowed for
    `data → domain` types but boundaries-rule blocks
    `presentation → data`. Plan: re-export the SDK-adjacent types
    from `@shared/testing` or a new `@domain/services/navigation/`
    surface so the VM can import them without crossing the
    boundary; OR add an override entry — both are acceptable,
    surface the choice at kickoff).

## Starting state — what's already built

- **Data layer (Turn 1).** `NavigationSdkClient` (8 methods, all
  Result-returning) + `FakeNavigationSdkClient` (full mirror) + DI
  wiring (`Container.navigationSdk` + `useNavigationSdk()` sibling
  hook) + jest mock + minimum-patch Expo plugin. All exercised by
  25 adapter tests + 14 fake tests + 3 hook tests.
- **No view-model, no screen, no DriverMonitor integration, no
  `<NavigationProvider/>` mount.** Those are this turn.
- **Native config landed.** `npm run prebuild` is a no-op for
  Turn 2's scope (the SDK's native side is already configured).
  Turn 2 doesn't touch `app.config.ts`, `plugins/`, or any native
  files.

## Scope decisions to lock at kickoff

1. **Connector hook split.** The `useNavigationController()` SDK
   hook has React-tied lifecycle; we need to push its `controller`
   + `listeners` into the adapter via `setController()`. Two
   options:
   - **Option A (recommended)**: a single
     `useNavigationSdkConnector()` hook in
     `src/presentation/features/driver/hooks/`. Mounted by the
     `DriverNavigationScreen`. Calls
     `useNavigationController(...)`, pushes into
     `useNavigationSdk()`, registers cleanup on unmount. Same shape
     as `useStripeConnectOnboarding` from Phase 6 turn 4.
   - **Option B**: inline in the screen's body. Smaller diff,
     harder to test in isolation.

   Recommendation: A. Confirm.

2. **`useDriverNavigationViewModel` state machine arms.** Per
   kickoff scope decision 3, a 5-arm tagged union:
   `uninitialized | terms_pending | initializing | guiding |
error`. Surface decisions:
   - `uninitialized` is the mounted-but-not-yet-connected state
     (controller hasn't been pushed yet — the connector hook is
     still resolving its useEffect).
   - `terms_pending` is set when `init()` returns
     `AuthorizationError({code:
'navigation_terms_not_accepted'})`. The VM exposes
     `onTermsAccept` / `onTermsDecline`. On accept, calls
     `showTermsAndConditionsDialog` → if `accepted`, retries
     `init`; if declined, transitions to `error` with a
     user-facing message.
   - `initializing` covers the in-flight `init` AND the in-flight
     `setDestinations` calls. The VM transitions through it before
     reaching `guiding`.
   - `guiding` is the steady state during turn-by-turn navigation.
   - `error` carries a `kind: 'route_not_found' | 'network' |
'permission' | 'api_not_authorized' | 'unknown'` discriminator
     plus a user-facing message.

   Recommendation: ship as listed. Confirm.

3. **Where does `<NavigationProvider/>` mount?** Legacy yeride
   mounts it at `App.js` (above all other providers). For the
   rewrite: add it inside `App.tsx` at the level of
   `MaybeStripeProvider`. The SDK's docs require it as an ancestor
   of any `useNavigationController()` call. Three sub-options:
   - **A (recommended)**: always mount it (no-op when no driver
     navigation is active). Simplest; matches legacy.
   - **B**: conditionally mount (only when the driver session is
     active). More complex; risks subtle state issues on remount.
   - **C**: mount it inside `DriverNavigator` only. Limits
     exposure to the driver branch; would require refactoring if
     rider gets in-app navigation in a future phase.

   Recommendation: A. Confirm.

4. **`onLaunchNavigation` orchestration: who calls `init()`?** Two
   shapes:
   - **A**: `DriverMonitor` calls `init()` BEFORE pushing the
     screen (legacy pattern; the `getCurrentActivity()` null quirk
     requires this on Android per legacy CLAUDE.md). But our
     adapter requires a `controller` to be pushed via
     `setController()` first, which only happens inside
     `useNavigationController()` — so DriverMonitor would need its
     own connector. This means `<NavigationProvider/>` at App root
     + a connector mounted on DriverMonitor that `setController`s
     the adapter, then the navigation screen reuses the SAME
     adapter (already connected) when it mounts.
   - **B**: defer `init()` to the screen. Simpler call graph but
     subject to the legacy `getCurrentActivity()` null quirk. The
     legacy team specifically moved `init()` to the parent because
     of this.

   Recommendation: A — port the legacy proven pattern. The
   connector mounts at DriverMonitor level (not at screen level)
   so the controller is alive whenever the driver is on an active
   trip. The screen consumes the already-connected adapter.
   Confirm.

5. **Arrival auto-pop responsibility.** When the SDK fires
   `onArrival(isFinalDestination=true)`, kickoff scope decision 9
   says the navigation screen auto-pops back to DriverMonitor. Two
   shapes:
   - **A (recommended)**: the VM's `subscribeToArrival` handler
     sets a `hasArrived` flag in state; the screen reads the VM
     and calls `navigation.goBack()` when `hasArrived` flips true.
     Allows the toast / Alert to render before the pop.
   - **B**: the connector hook's arrival handler calls `goBack()`
     directly. Faster pop but harder to test without mounting the
     navigator.

   Recommendation: A. Confirm.

6. **End-of-trip cleanup ordering.** When DriverMonitor unmounts
   (cancel / completed terminal redirect), the connector hook's
   effect cleanup runs in this order:
   1. `setController({controller: null, listeners: null})` to
      disconnect the adapter.
   2. Fire-and-forget `navigationSdk.cleanup()` on the controller
      (best effort; tolerates throws).

   The connector hook is mounted at DriverMonitor, so its cleanup
   runs when the trip ends. Synchronous chain — never `async`
   cleanup per CLAUDE.md.

   Confirm.

7. **Boundaries: presentation imports of NavSDK types.** The VM
   needs types like `NavRouteStatus`, `NavSetDestinationsArgs`,
   `NavInitError` that today live in
   `@data/services/NavigationSdkClient`. The boundaries rule
   blocks `presentation → data` imports. Two options:
   - **A**: extend the existing eslint boundaries override block
     to include `useDriverNavigationViewModel.ts` + the connector
     hook. Same architectural exception as `useGpsLifecycle.ts` /
     `useGpsStore.ts` already have.
   - **B**: hoist the types to `@domain/services/` (a new
     `NavigationTypes.ts` re-export). Cleaner long-term but adds
     a file with no behavior.

   Recommendation: A — the override is precedented and the types
   are intentionally data-shaped (mapped from the SDK enum). The
   exception is documented in the existing override block
   comment. Confirm.

## Scope (in / out)

**In:**

- **Presentation layer**:
  - `src/presentation/features/driver/hooks/useNavigationSdkConnector.ts`
    — single sibling of `useStripeConnectOnboarding`. Calls
    `useNavigationController(termsDialogOptions,
taskRemovedBehavior)`, pushes the result into
    `useNavigationSdk().setController(...)`, handles cleanup on
    unmount.
  - `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
    — orchestration hook. State machine, init / terms /
    setDestinations / startGuidance sequence, `onTermsAccept`,
    `onTermsDecline`, `onEndNavigation`, `onArrived` (internal —
    flips the hasArrived flag).
  - `src/presentation/features/driver/screens/DriverNavigationScreen.tsx`
    — hosts `<NavigationView/>` + the End Navigation CTA +
    bottom-sheet trim. Mounts `useNavigationSdkConnector` and
    `useDriverNavigationViewModel`. Auto-pops on arrival.
    Bottom-sheet trim mirrors legacy proportions; floating mute /
    chat buttons deferred to Phase 9.
  - `useDriverMonitorViewModel.onLaunchNavigation()` — extends
    the existing surface. Reads `ride.status` to pick pickup vs.
    dropoff leg, builds the right `NavSetDestinationsArgs`
    (pickup uses `ride.pickup.coords`; dropoff uses
    `ride.dropoff.coords` + `ride.routePreference.routeToken` if
    present + `avoidTolls`), calls
    `navigation.navigate('DriverNavigation', { args })`. The
    init/setDestinations/startGuidance chain runs inside the
    screen's VM after mount — DriverMonitor doesn't await any of
    it.
  - `useDriverMonitorViewModel` connector mount —
    `useNavigationSdkConnector` is mounted by
    `DriverMonitorScreen` (NOT just `DriverNavigationScreen`) so
    the controller is alive for the whole trip lifecycle. The
    screen-level mount happens INSIDE the navigation screen's
    existing `<NavigationView/>` consumption, which is fine
    because `useNavigationController` is idempotent against the
    same provider — both consumers see the same controller.

    Surface alternative if simpler in practice: connector mounts
    at DriverMonitor only; `DriverNavigationScreen` reads the
    already-connected adapter. Decide during implementation; both
    work. Document the choice.

- **Component layer**:
  - `EnRouteToPickupView` — add "Open Navigation" CTA above (or
    below, designer's call) the existing "Arrived at pickup"
    button. Disabled when `noActiveLeg` (defensive; status-router
    already gates).
  - `StartedView` — add "Open Navigation" CTA above the "Request
    payment" button. Same disabled rule.
  - Both: drop the "No Navigate button — Navigation SDK is
    Phase 8" JSDoc note.

- **App-root**:
  - `App.tsx` — wrap the existing tree with
    `<NavigationProvider/>` using
    `termsAndConditionsDialogOptions: { title: 'Navigation Terms',
companyName: 'YeRide', showOnlyDisclaimer: true }` +
    `taskRemovedBehavior: TaskRemovedBehavior.CONTINUE_SERVICE`
    (legacy parity). Same `Maybe*Provider` no-op shape if
    `<StripeProvider/>`'s pattern feels right — the Nav SDK
    provider doesn't have an "unconfigured" branch, but tests
    benefit from the wrapper.

- **Navigation**:
  - `DriverNavigator.tsx` — register `DriverNavigation` route
    with `headerShown: false` + `presentation: 'fullScreenModal'`
    (or stick with default native-stack push if simpler — the
    legacy uses a plain push and the chrome-less SDK view fills
    the screen).

- **Tests**:
  - `useNavigationSdkConnector.test.tsx` — 4-6 tests: pushes
    controller on mount; pushes null on unmount; tolerates
    double-mount; clears arrival listener on unmount.
  - `useDriverNavigationViewModel.test.tsx` — 12-18 tests: state
    machine arms (each transition); terms-pending → accept retries
    init; terms-pending → decline lands in error; route status
    `'no_route_found'` → error arm; `'network_error'` → error
    arm; SDK throws on init → error arm; arrival fires →
    `hasArrived` flips; `onEndNavigation` calls `cleanup` +
    `setController(null)`.
  - `DriverNavigationScreen.test.tsx` — 4-6 rendered tests against
    `TestContainerProvider` + a stub `<NavigationView/>` (the
    SDK's `<NavigationView/>` is already mocked at
    `jest.setup.ts`): renders state-arm content per VM state; End
    Navigation press fires VM callback; arrival auto-pops via
    `navigation.goBack()`.
  - `useDriverMonitorViewModel.test.tsx` — extend with 4-6 new
    tests covering `onLaunchNavigation` for pickup leg / dropoff
    leg / invalid-status (does nothing) / dropoff with routeToken
    / dropoff without routeToken (fall back to routingOptions).
    Existing tests remain green.
  - `EnRouteToPickupView.test.tsx` + `StartedView.test.tsx` —
    extend each with one test verifying the new CTA renders +
    fires `onLaunchNavigation`.

  **Estimated net delta: +6 to +8 suites / +30 to +45 tests.**
  Slight variance band; lean toward the high end given the state
  machine's branching.

**Out (deferred — do not build in Turn 2):**

- **Floating mute / chat / exit buttons inside the navigation
  screen** (legacy has them). The "End Navigation" CTA is the
  only chrome.
- **`onRouteChanged` / `onTrafficUpdated` /
  `setOnRemainingTimeOrDistanceChanged` listener subscriptions.**
  Out of Phase 8 entirely per kickoff "out" list. The Distance
  Matrix bypass and ETA refinement via SDK telemetry land in
  Phase 9 polish.
- **External-Google-Maps fallback** (legacy `showLocation` path).
  If `init()` returns `'navigation_api_not_authorized'`, the VM
  lands in the `error` arm with a user-facing message + a `retry`
  callback. No external-app fallback this phase.
- **`<NavigationView/>` style customization** (night-mode toggle,
  audio guidance type toggle, traffic overlay toggle). Use SDK
  defaults.
- **CarPlay / Android Auto.** Hard-out per kickoff.
- **Rider-side in-app navigation.** Driver-only.
- **Multi-stop trips.** Single-leg only (one waypoint per
  `setDestinations` call).
- **Test against real SDK.** All view-model + screen tests run
  against fakes / jest mocks. Real-SDK exercise happens on the
  next iOS / Android device build.

## Suggested approach (single turn)

1. **Decisions confirmed → write `App.tsx` change first**
   (smallest diff; mounts `<NavigationProvider/>`). Verify
   `npm run typecheck` stays green.
2. **`useNavigationSdkConnector`** — sibling hook + tests.
   Validate the controller-push-on-mount + clear-on-unmount +
   listener teardown behavior against the fake.
3. **`useDriverNavigationViewModel`** — full state machine +
   every transition test. This is the biggest piece; isolate it
   before touching screens.
4. **`DriverNavigationScreen`** — render the VM state. Wire
   `<NavigationView/>` (SDK), the End Navigation CTA, the
   connector, the auto-pop effect. Tests against
   `TestContainerProvider`.
5. **`DriverNavigator`** route — register the screen + push its
   param list type to `DriverStackParamList`.
6. **`useDriverMonitorViewModel.onLaunchNavigation`** — extend
   the surface. Tests for both legs + the routeToken passthrough
   + invalid-status guard.
7. **`EnRouteToPickupView` + `StartedView`** — add CTAs. One
   render test each.
8. **`docs/PHASE_8_TURN_2.md`** — close-of-turn record. Then
   update `CLAUDE.md` (Phase 8 row → Turn 2 ✅, Turn 3 → Next;
   test counts bumped; Phase 8 critical-files refresh).
9. **`npm run verify`** — green typecheck + lint + format +
   test.

## Risks + mitigations

- **`useNavigationController()` requires `<NavigationProvider/>`
  ancestor.** If the screen mounts the hook without the provider
  being ancestor at App level, the SDK throws at hook-call time.
  Mitigation: scope decision 3A (always-mount). Add an
  integration test that mounts `<DriverNavigationScreen/>` inside
  `<NavigationProvider/>` + `<TestContainerProvider/>` and
  verifies the connector pushes the controller cleanly.

- **Two consumers of `useNavigationController()` (DriverMonitor +
  DriverNavigationScreen) might create two distinct
  controllers.** The SDK's hook is idempotent against the same
  `<NavigationProvider/>`, but worth verifying. Mitigation: read
  the SDK's `NavigationProvider.tsx` source to confirm a single
  shared controller per provider; if not, the connector mounts at
  DriverMonitor ONLY and the screen reads the already-connected
  adapter via `useNavigationSdk()`.

- **Cleanup ordering on terminal redirect.** When DriverMonitor's
  status flips to `'cancelled'` or `'completed'`, the existing VM
  fires `navigation.reset({routes: [{name: 'DriverTabs'}]})`. The
  connector hook's cleanup runs synchronously as part of unmount,
  so `setController(null)` + `cleanup()` chain through.
  Mitigation: test the cleanup-on-redirect path explicitly.

- **Terms dialog timing.** First-launch path: `init()` returns
  `'termsNotAccepted'` → VM enters `terms_pending` → user taps
  Accept → call `showTermsAndConditionsDialog()` → if accepted,
  retry `init()`. If the user backgrounds the app between dialog
  and retry, the dialog promise may reject with a non-error
  rejection. Mitigation: `try/catch` around the dialog promise;
  treat reject as user-cancelled.

- **`<NavigationView/>` is not available in jest.** The global
  mock from Turn 1 stubs it as `() => null`. Screen tests use the
  stub; visual rendering tests are deferred to E2E (Phase 9
  polish).

- **Auto-pop race with VM state cleanup.** If arrival fires
  `goBack()` while `cleanup()` is in flight from a manual
  end-nav, the screen could double-pop. Mitigation: a
  `hasNavigatedAwayRef` in the screen guards `goBack()` from
  firing twice.

- **DriverMonitor's `onLaunchNavigation` dispatching while the
  controller isn't yet connected.** The connector mounts on
  DriverMonitor's render, but if the user taps "Open Navigation"
  during a brief window before `useEffect`s settle, `init()` from
  the navigation screen's VM lands first and gets `not_connected`.
  Mitigation: VM's `uninitialized` arm waits up to 1s for the
  connector to push controller; otherwise transitions to `error`
  with `kind: 'unknown'` + retry CTA.

## Acceptance for end of Phase 8 Turn 2

- A signed-in driver on a `'dispatched'` ride sees an "Open
  Navigation" CTA on `EnRouteToPickupView`. Tapping it pushes
  `DriverNavigation` + the screen renders `<NavigationView/>`
  (verified via screen test against the SDK mock).
- The VM's state machine transitions exhaustively tested: every
  arm (`uninitialized | terms_pending | initializing | guiding |
error`) has at least one test that lands in it from a
  documented input.
- Arrival event with `isFinalDestination: true` flips the
  `hasArrived` flag → screen calls `navigation.goBack()` →
  DriverMonitor renders `AtPickupView` (Phase 7's auto-flip from
  geofence already handles the en-route → at-pickup transition;
  the navigation pop just lets the geofence-derived state shine
  through).
- "End Navigation" CTA on the screen pops back to DriverMonitor
  without waiting for arrival. Adapter receives the
  `setController(null)` + `cleanup()` chain on unmount.
- Same flow on `'started'` for the dropoff leg, with the
  `routePreference.routeToken` (if present) flowing through to
  the SDK's `routeTokenOptions`.
- DriverMonitor's terminal redirect (`cancelled`, `completed`) +
  `payment_failed`-then-Close-trip both unmount the connector
  cleanly. Adapter ends the session via cleanup.
- Test suite stays green; **+6 to +8 suites / +30 to +45 tests**
  over Turn 1's 155 / 1213. New view-model + screen + connector
  tests against the fake; `<NavigationView/>` is jest-mocked
  globally.
- `CLAUDE.md` updated; `docs/PHASE_8_TURN_2.md` written; Phase 8
  row shows Turn 2 ✅, Turn 3 → Next.
- **No native config changes.** `npm run prebuild` is a no-op for
  this turn. The next iOS / Android build runs against the same
  patches Turn 1 landed.

## Conventions (non-negotiable — same as Phases 3–8 Turn 1)

- `Result.ok` / `Result.err` for every expected failure
  surfacing through the adapter. The VM consumes Results and
  translates them to state-machine transitions.
- View-model tests use the fake via `TestContainerProvider`'s
  `navigationSdk` override. Drive arrivals with
  `fake.emitArrival`; prime errors with
  `fake.failNext({method, error})`.
- Server state in TanStack Query, client/UI state in Zustand or
  view-model `useState`. The Nav SDK lifecycle is
  presentation-layer state — local to the VM, not in TanStack
  Query.
- The connector hook is mounted by exactly ONE component
  (DriverMonitor). Don't lift it to AppContent — it's
  session-scoped.
- Logger only: `LOG.extend('DriverNavigationVM')` for the VM,
  `LOG.extend('DriverNavigationScreen')` for the screen. Never
  `console.*`.
- Synchronous unsubscribe / cleanup. Never `async` cleanup
  functions in `useEffect`.
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring the turn done.

## Start with

Read `CLAUDE.md` (the Phase 8 row), then `docs/PHASE_8_TURN_1.md`,
then `src/data/services/NavigationSdkClient.ts` end-to-end, then
the legacy `src/driver/screens/DriverNavigation.js` (legacy
yeride mature implementation — port the orchestration shape, drop
the mute/chat chrome). Then propose **the file-creation order +
a minimal-viable state-machine sketch for
`useDriverNavigationViewModel`** as a numbered punch list and
wait for confirmation before writing code.

Tip: Turn 2 is bigger than Turn 1 in pure LOC (a real screen +
a state-machine VM + the App-root mount), but every piece has a
clear sibling pattern in the rewrite (`useStripeConnectOnboarding`
for the connector; `useDriverEarningsViewModel` for the
tagged-union state machine; `useGpsLifecycle` for the SDK
lifecycle teardown rule). Lean on those.
