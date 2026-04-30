# Phase 7 Turn 2 Kickoff Prompt — `useGpsLifecycle` + AppContent integration

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 7
Turn 2.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Phase 7 Turn 1 just
closed: the `BackgroundGeolocationClient` adapter (11 methods,
`Result`-returning, listener-deduped) + `FakeBackgroundGeolocationClient`
+ the global Jest SDK mock + DI wiring all landed, with **148 suites
/ 1124 tests passing**. The Container exposes `bgGeolocation`
alongside `useCases`. **No view-model touches** the SDK seam yet —
that's Turn 2 and Turn 3's job.

Your job this session is **Phase 7 Turn 2: build `useGpsLifecycle`
on top of the adapter and lift the GPS lifecycle into AppContent**.
By end of turn, the SDK is initialized once at app launch, started /
stopped based on auth + role + active-trip state, fed live locations
into Firestore via `UpdateUserLocation` (debounced), and the
pickup geofence is registered / deregistered as ride status
transitions in and out of `'dispatched'`. View-model swap-ins for
RideMonitor / DriverMonitor stay deferred to Turn 3.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered
   architecture, conventions. Phase 7 Turn 1 acceptance paragraph
   is the most recent entry.
2. `docs/PHASE_7_TURN_1.md` — what Turn 1 shipped, the design
   decisions baked into the adapter, the risks surfaced.
3. `docs/PHASE_7_KICKOFF.md` — full Phase 7 scope reminder
   (especially `Scope decisions` 1-10).
4. The Turn-1 surface you'll consume:
   - `src/data/services/BackgroundGeolocationClient.ts` — read the
     11 method signatures, the `BgLocationEvent` /
     `BgGeofenceEvent` / `BgPermissionStatus` types, and the
     listener-level dedup behavior. Critical: subscribe-to-location
     and subscribe-to-geofence return synchronous unsubscribers.
   - `src/shared/testing/FakeBackgroundGeolocationClient.ts` — the
     fake your view-model and lifecycle tests will drive. Note the
     `seed* / emit* / failNext / spies / getActiveGeofence /
     isEnabled / isInitialized` seams.
   - `src/shared/testing/TestContainerProvider.tsx` — the
     `bgGeolocation?: FakeBackgroundGeolocationClient` override
     prop is in place.
   - `src/presentation/di/container.ts` — `Container.bgGeolocation`
     is the runtime entry point. The `buildBackgroundGeolocationClient()`
     helper instantiates the real adapter unconditionally.
5. The presentation surface you'll touch:
   - `src/presentation/AppContent.tsx` — current shell. ~80 lines.
     Today only owns the auth-state listener + safety timeout. Turn
     2 lifts in GPS lifecycle.
   - `src/presentation/hooks/useCurrentLocation.ts` — Phase 3
     foreground-only hook. Read the comment block describing
     "Phase 7's responsibility" — that's the bridge. This hook is
     NOT removed in Turn 2; Turn 3 deprecates its trip-tracking
     callers in the rider/driver monitor view-models.
   - `src/presentation/stores/useSessionStore.ts` — the auth-state
     mirror you'll gate GPS on (`status: 'initializing' |
     'unauthenticated' | 'needs_verification' | 'authenticated'`).
   - `src/presentation/stores/useGeofenceUiStore.ts` — Turn 2 does
     NOT yet flip the `pickupExitWarningVisible` flag from
     background events. That swap-in is Turn 3.
   - `src/presentation/queries/index.ts` (or
     `src/presentation/queries/location.queries.ts` if it exists)
     — `useUpdateLocationMutation` is the existing TanStack hook
     wrapping `UpdateUserLocation`.
6. The data layer you'll wire through:
   - `src/app/usecases/location/UpdateUserLocation.ts` — pass-through
     to `LocationRepository.updateLocation`. Already has retry-with-
     backoff at the repository level.
   - `src/data/repositories/FirestoreLocationRepository.ts` — 3-retry
     exponential backoff + canonical write to `locations/{uid}` (see
     CLAUDE.md note B from Turn 1 kickoff — the kickoff's `users/{uid}.location`
     wording is loose; the canonical path is `locations/{uid}`).
   - `src/domain/entities/UserLocation.ts` — the value object
     `UpdateUserLocation` consumes. Construction is `Result`-returning;
     drop the event with a warn log if construction fails.
7. View-model context (READ-ONLY this turn — Turn 3 swaps these):
   - `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`
     — currently runs the geofence tick from foreground
     `useCurrentLocation`. Turn 2's `useGpsLifecycle` exposes the
     surface the Turn 3 swap will read.
   - `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
     — has the `arrivedAtPickup` flag and the `stubOdometerMeters`
     derivation. Turn 2 makes the real signals available; Turn 3
     wires them in.
8. Legacy parity reference:
   - `/Users/papagallo/yeapptech/dev/yeride/AppContent.js` — the
     legacy GPS lifecycle in `useEffect` blocks. Read the
     `setupListeners` function (~620-715), the `gpsStarted` gate
     (`gpsStart(200)` only after auth + user-doc + email-verified),
     and the cleanup function. Note the explicit deduplication in
     `onLocationChange` / `onGeofenceChange` (already absorbed by
     the Turn 1 adapter — VMs see deduped events natively).

## Starting state — what's already wired

- **Adapter**: `BackgroundGeolocationClient` lives in `Container.bgGeolocation`.
  Idempotent `init` / `start` / `stop`. Listener-level dedup. SDK
  errors caught at the boundary and mapped to `NetworkError` /
  `AuthorizationError`.
- **Fake**: `FakeBackgroundGeolocationClient` available via
  `TestContainerProvider`'s `bgGeolocation` override. Same surface
  1:1, programmable seams.
- **Native**: SDK plugin block + `withBackgroundFetchMaven` plugin
  + iOS infoPlist additions are baked. `npm run android` builds and
  runs on Pixel 10 Pro emulator.
- **Auth lifecycle**: `AppContent` owns `observeAuthState` already.
  `useSessionStore` carries `status` + `userId` + `role`.
- **Existing foreground hook**: `useCurrentLocation` is the Phase 3
  foreground reader. Turn 2 leaves it in place; Turn 3 deprecates
  its trip-tracking callers.

## Scope decisions (locked at kickoff)

These are resolved before the kickoff doc was written. Don't
re-debate them mid-turn; surface objections as deferred items.

1. **`useGpsLifecycle` is mounted exactly once, in AppContent.**
   Not in any screen, not in any view-model. AppContent passes the
   gating props (`enabled: boolean`, `activeRideForGeofence: { rideId,
   pickupCoords } | null`). The hook's inner `useEffect` blocks
   own all init / start / stop / geofence-register / geofence-remove
   side effects.

2. **VMs read GPS state via Zustand selectors, not by re-mounting
   `useGpsLifecycle`.** A new `src/presentation/stores/useGpsStore.ts`
   carries the latest values: `permissionStatus`, `currentLocation`,
   `currentOdometerMeters`, `isInsidePickupGeofence`,
   `lastGeofenceEvent`. `useGpsLifecycle`'s subscription callbacks
   write into the store; VMs read selector hooks like
   `useGpsCurrentLocation()`. This pattern matches the existing
   `useGeofenceUiStore` / `useDriverStatusStore` split — read
   `CLAUDE.md`'s "Zustand vs. TanStack Query — split of concerns"
   section.

3. **GPS lifecycle gating mirrors legacy.** GPS starts when:
   - Session status is `authenticated` (post-email-verify), AND
   - User doc has resolved (role known), AND
   - Either rider stack or driver stack is the active navigator
     (i.e. the user has cleared Stripe-customer onboarding or
     Stripe-Connect onboarding as appropriate).

   GPS stops when:
   - The user signs out, OR
   - The session re-enters `unauthenticated` for any reason.

   GPS is **not started** during the `initializing` /
   `needs_verification` / Stripe-onboarding pre-tabs phases. This
   matches the legacy `gpsStarted` flag pattern in `AppContent.js`.

4. **Distance-based location writes only.** Turn 2 wires
   `BackgroundGeolocation.onLocation` →
   `useUpdateLocationMutation.mutate(...)` with NO debounce on the
   JS side. The SDK's `distanceFilter: 200` config (Turn 1) already
   limits delivery to roughly every 200m of motion or every ~30s
   of idle. Adding a JS-side throttle would just delay writes that
   are already gated. If field telemetry shows we're writing too
   often, Phase 9 polish can layer a 5s wall-clock debounce. The
   kickoff's "5s OR 50m" framing was a placeholder; the SDK's own
   `distanceFilter` is the canonical primitive.

5. **Pickup geofence registration is driven by AppContent, not by
   a view-model.** AppContent reads the user's `inProgressTrip`
   (already mirrored in `useSessionStore` or via `ListRidesByPassenger`
   / `ListRidesByDriver` — confirm during research) and passes the
   pickup coords + rideId to `useGpsLifecycle`. The hook's inner
   effect calls `bgGeolocation.addPickupGeofence(...)` when the
   ride enters `'dispatched'` and `removePickupGeofence()` when it
   leaves any active state. Single-shared `'pickup'` identifier
   (Turn 1 decision) means there's at most one geofence at a time
   per session.

6. **`init` is called once per app launch.** AppContent fires
   `bgGeolocation.init({ distanceFilter: 200, debug: __DEV__ })`
   in the same effect that starts the SDK lifecycle. The adapter's
   `initialized` flag short-circuits a second call. If GPS conditions
   transition `false → true → false → true` rapidly (e.g. logout +
   re-login during the same JS runtime), `init` is a no-op on the
   second pass; only `start` / `stop` flip.

7. **Permission flow is event-driven, not blocking.** `useGpsLifecycle`
   calls `bgGeolocation.requestAuthorizationIfNeeded()` once per
   `enabled` transition (`false → true`). The result lands in the
   Zustand store as `permissionStatus`. Screens that care
   (`RideMonitorScreen`, `DriverMonitorScreen`) read the status and
   render an "Open Settings" CTA when it's `'denied'` or
   `'when_in_use'`. Turn 2 only plumbs the value; the actual
   "Open Settings" CTA UI is a follow-up (Phase 9 polish), but the
   prop is exposed.

8. **No `subscribeToUserLocation` regression.** The rewrite's
   `SubscribeToUserLocation` use case returns a synchronous
   unsubscribe (the legacy footgun was explicitly fixed). The Turn
   2 location-write path uses the inverse direction
   (`UpdateUserLocation` mutation, not subscription); the
   subscription path is unchanged this turn.

9. **AppState transitions don't double-start.** The adapter's
   `start()` already gates on `getState().enabled`. `useGpsLifecycle`
   doesn't need an `AppState` listener for the start path. A future
   Phase 9 polish can layer foreground-detection if we want to
   resume lapsed sessions; for Turn 2, the SDK's own
   foreground-resume behavior is sufficient.

10. **Logout cleanup is fire-and-forget but ORDERED.** The hook's
    cleanup effect calls
    `bgGeolocation.stop().then(() => bgGeolocation.removeAllGeofences()).then(() => bgGeolocation.removeAllListeners())`
    in sequence. AppContent's session-store listener flips `enabled`
    to `false` on sign-out, which kicks the effect's cleanup before
    the navigation reset. The chain is fire-and-forget at the
    React-effect level (cleanup functions are synchronous), but the
    Promise chain inside completes before the next mount happens.

## Scope (in / out)

**In:**

- **Presentation hook**: `src/presentation/hooks/useGpsLifecycle.ts`.
  Inputs: `{ enabled: boolean; activeRideForGeofence: { rideId:
RideId; pickupCoords: Coordinates } | null }`. Outputs: nothing
  directly (state lives in `useGpsStore`). Internally:
  - One-shot `init()` on first mount when `enabled === true`.
  - Permission request on `enabled` transition `false → true`.
  - `start()` when `enabled === true` + permission `'always' |
'when_in_use'`.
  - `stop()` when `enabled === false`.
  - Subscribes to `subscribeToLocation` + `subscribeToGeofence`
    via `bgGeolocation`; pushes events into `useGpsStore`.
  - Side-firing `useUpdateLocationMutation.mutate(UserLocation)` on
    each location event (the SDK's `distanceFilter` already rate-
    limits).
  - Geofence registration: when `activeRideForGeofence` flips
    non-null, call `addPickupGeofence(...)`. When it flips null,
    call `removePickupGeofence()`.
  - Synchronous cleanup function on unmount.
- **Zustand store**: `src/presentation/stores/useGpsStore.ts`.
  Fields:
  - `permissionStatus: BgPermissionStatus`
  - `currentLocation: Coordinates | null`
  - `currentSpeed: number | null`
  - `currentOdometerMeters: number`
  - `isInsidePickupGeofence: boolean`
  - `lastGeofenceEvent: BgGeofenceEvent | null`
  Actions: `setPermissionStatus`, `setLocation`, `setGeofenceEvent`,
  `setIsInsidePickupGeofence`, `reset`. Selector hooks for
  consumer ergonomics: `useGpsCurrentLocation`,
  `useGpsCurrentOdometer`, `useGpsLastGeofenceEvent`,
  `useGpsIsInsidePickupGeofence`, `useGpsPermissionStatus`.
- **AppContent integration**: extend `AppContent.tsx` to:
  - Import `useGpsLifecycle`.
  - Resolve the gating predicate from `useSessionStore` (the
    `authenticated` status; possibly also the role from
    `useCurrentUserQuery` if Stripe-onboarding gates apply).
  - Resolve the active ride for geofence registration. The legacy
    pattern is: rider sees their `inProgressTrip` (from `user.trips.in_progress`
    in legacy); driver sees the ride they accepted via
    `useDriverStatusStore`. Confirm the rewrite's equivalent during
    research. If the wiring is complex, defer the geofence input to
    a follow-up (the hook still works without geofences — pure
    location stream).
  - Render `null` if not authenticated; otherwise render the existing
    children prop.
- **Tests**:
  - `useGpsLifecycle.test.tsx` — view-model-style tests under
    `TestContainerProvider` with a `FakeBackgroundGeolocationClient`.
    Cover: init-on-first-enable, idempotent init on re-enable,
    permission-request on transition, start gates on permission,
    stop on disable, geofence-add on rideForGeofence, geofence-remove
    on null, location event populates the store, cleanup is
    synchronous.
  - `useGpsStore.test.ts` — pure-store tests for setters / selectors
    / reset.
  - AppContent test — extend the existing AppContent test (if any)
    or add a smoke that confirms `useGpsLifecycle` is mounted and
    receives the right `enabled` value as session status flips. If
    AppContent has no test today, defer to a smoke at the screen
    level (a `RideMonitorScreen` test that confirms a seeded
    geofence event lands in the banner state — but actually that's
    Turn 3, so just write the AppContent integration smoke).

**Out (deferred — do not build in Turn 2):**

- **`useRideMonitorViewModel` swap** — Turn 3 replaces the
  foreground geofence tick with `useGpsLastGeofenceEvent()`.
- **`useDriverMonitorViewModel` `arrivedAtPickup` auto-flip** — Turn
  3.
- **`useDriverMonitorViewModel` real-odometer for Start / Request
  Payment** — Turn 3 swaps `stubOdometerMeters` for
  `useGpsCurrentOdometer()`.
- **"Open Settings" CTA UI** — Turn 2 plumbs `permissionStatus` into
  the store; the actual deep-link to system settings is Phase 9
  polish.
- **AppState-triggered resume** — see scope decision 9.
- **Per-ride odometer reset** — `resetOdometer()` is exposed on
  the adapter but Turn 2 doesn't call it. Turn 3 (or Phase 9) can
  decide whether trip-start should reset.
- **JS-side debounce on location writes** — see scope decision 4.
- **AppContent driver-side EXIT geofence handling** — out of phase
  scope per the original Phase 7 kickoff.

## Suggested implementation order

1. **`useGpsStore.ts` first.** Zustand store + selector hooks.
   ~80 lines, easy to test in isolation. Land tests; verify gates.
2. **`useGpsLifecycle.ts` second.** Compose `useGpsStore` +
   `bgGeolocation` from the Container + `useUpdateLocationMutation`.
   Land tests under `TestContainerProvider` + the fake.
3. **AppContent integration third.** Decide the gating predicate
   shape. Add the hook call. Resolve the active-ride geofence input
   (likely via a new selector on the in-progress ride; coordinate
   with existing patterns — see how legacy AppContent resolves
   `tripRef.current`).
4. **Verify gates.** typecheck + lint + format + test all green.
   Run `npm run android` smoke if possible.

## Risks + mitigations

- **Mounting `useGpsLifecycle` outside AppContent breaks the
  contract.** It's tempting for a future agent to add the hook to
  `RideMonitorScreen` thinking it'll re-mount cleanly. Don't —
  the lifecycle effects would re-fire and re-init the SDK on every
  navigation. Mitigation: a comment block at the top of
  `useGpsLifecycle.ts` declaring it AppContent-only (mirrors the
  similar guard in `useCurrentLocation.ts`).
- **Permission flow on cold start**. iOS shows the system permission
  dialog the first time `requestAuthorizationIfNeeded` runs; if
  AppContent calls it during the auth flicker (signed-in → signed-
  out → signed-in), the dialog could pop unexpectedly. Mitigation:
  gate the permission call on a stable `enabled === true` for at
  least one effect cycle (use a `useRef`-guarded flag).
- **`updateLocation` mutation cascades on every event.** The SDK
  fires roughly every 200m or every ~30s. With the existing 3-retry
  backoff on the repository, a network blip during a trip could
  queue up retries. Mitigation: confirm `useUpdateLocationMutation`
  returns immediately and doesn't block subsequent calls. If the
  TanStack mutation returns `isPending`, an in-flight write should
  still let the next event fire its own mutation (TanStack handles
  this natively unless we set custom keys). Read
  `useUpdateLocationMutation`'s implementation before wiring.
- **`activeRideForGeofence` resolution is non-trivial.** The rider's
  in-progress ride lives in their `users/{uid}.trips.in_progress.id`
  field (legacy) or via a `useCurrentUserQuery` lookup. The driver's
  active ride lives in `useDriverStatusStore.dispatchedRideId` (Phase
  4). Both need to resolve to a `Coordinates` (pickup point) for
  the geofence. Mitigation: research before implementing. If the
  resolution is too tangled, ship Turn 2 with location streaming
  ONLY and defer geofence registration to a Turn 2.5 / Turn 3.
- **Synchronous cleanup vs. async chain.** React effect cleanup
  must be synchronous (no `async function` cleanup). The cleanup
  fires fire-and-forget Promise chain via a non-async `() => {
  void doCleanup(); }` wrapper. The promise inside can `await
  bgGeolocation.stop()` etc. but React doesn't wait for it.
  Mitigation: explicit comment + a hard-coded synchronous wrapper
  pattern.
- **Ride-doc subscription leakage**. If AppContent subscribes to
  the in-progress ride to populate `activeRideForGeofence`, the
  subscription cleanup must fire synchronously on logout — this
  is a pattern that's already tested via `useFirestoreSubscription`,
  so reuse it.
- **Test mocking of `Container.bgGeolocation`**. The kickoff
  already wired `TestContainerProvider`'s `bgGeolocation` override
  slot. View-model tests get the fake via the prop. Mitigation:
  follow the existing `cloudFunctions` override pattern as a
  template.
- **First device build has the foreground `useCurrentLocation`
  bug**. Turn 1's run surfaced a `[YeRide:useCurrentLocation]
  refresh failed` log line — `expo-location`'s
  `requestForegroundPermissionsAsync` failing on the emulator. Turn
  2's `useGpsLifecycle` uses the background SDK's
  `requestPermission` (different code path) so it won't hit the
  same bug. But the foreground hook still gets called by the
  rider/driver home screens — Turn 3 progressively deprecates it.

## Acceptance for end of Turn 2

- A signed-in rider in `RiderTabs` is being location-tracked via the
  background SDK: their `locations/{uid}` doc receives Firestore
  writes every ~200m of motion or ~30s idle (per the SDK's
  `distanceFilter`). Tracking continues through foreground →
  background transitions.
- A signed-in driver in `DriverTabs` is being tracked the same way.
- A driver who accepts a ride sees the pickup geofence registered
  (verifiable via `bgGeolocation.getActiveGeofence()` in dev or a
  log line). Walking into the geofence fires an ENTER event into
  `useGpsStore.lastGeofenceEvent`. Walking out fires EXIT.
- Sign-out flushes the SDK: `stop()` + `removeAllGeofences()` +
  `removeAllListeners()` complete before the navigation reset.
  Re-login starts fresh — no stale events from the previous
  session leak through.
- `useGpsStore` selector hooks read the live values; calling them
  outside AppContent doesn't trigger any SDK side effects.
- `useGpsLifecycle` is NOT mounted by any view-model or screen.
  Grep confirms a single call site in `AppContent.tsx`.
- Test suite stays green; new view-model and store tests added; no
  regressions in existing 1124 tests. Net delta: ≥20 tests across
  the new hook + store + AppContent integration smoke.
- typecheck + lint + format + test all green.
- `docs/PHASE_7_TURN_2.md` written following the Turn 1 doc style.
- `CLAUDE.md` updated: Phase 7 turn 2 → ✅ in both phase tables;
  acceptance paragraph added; `useGpsLifecycle.ts` + `useGpsStore.ts`
  registered in Critical files; file-locations cheat sheet
  refreshed; test counts bumped.
- A first iOS / Android device smoke (manual): rebuild post-prebuild;
  sign in; confirm `locations/{uid}` writes land in Firestore; walk
  through a pickup geofence and verify the ENTER/EXIT events fire
  in `useGpsStore`.

## Conventions (non-negotiable — same as Phases 3-7 Turn 1)

- `Result.ok` / `Result.err` for every expected failure.
- View-model / hook tests under `TestContainerProvider` with seeded
  fakes.
- Server state → TanStack Query. Client / UI state + transient SDK
  streams → Zustand. The location coordinates fit the latter (they
  ARE updated state, not a fetched resource — same as the existing
  `useGeofenceUiStore` and `useDriverStatusStore`).
- Logger only: `LOG.extend('GpsLifecycle')`. Never `console.*`.
- Subscription-shaped use cases use synchronous unsubscribe — never
  async cleanup.
- AppContent is the ONLY place that calls `useGpsLifecycle`.
  Screens and view-models READ via the Zustand selectors.
- `npm run verify` (typecheck + lint + format + test) before
  declaring the turn done.

## Start with

1. Read `CLAUDE.md`'s Phase 7 Turn 1 acceptance paragraph + the
   `docs/PHASE_7_TURN_1.md` "What's in" section.
2. Read `BackgroundGeolocationClient.ts` end-to-end — note the
   `BgLocationEvent` / `BgGeofenceEvent` / `BgPermissionStatus`
   types you'll consume.
3. Read `FakeBackgroundGeolocationClient.ts` end-to-end — note
   the `seed*` / `emit*` / `failNext` / `getActiveGeofence` /
   `isEnabled` / `isInitialized` seams.
4. Read `AppContent.tsx` and `useSessionStore.ts` end-to-end.
5. Read `useCurrentLocation.ts` for the foreground-only hook
   pattern (especially the comment block describing Phase 7's
   responsibility).
6. Read the existing `useGeofenceUiStore.ts` + `useDriverStatusStore.ts`
   as templates for the new `useGpsStore.ts`.
7. Survey how `inProgressTrip` is resolved today — grep for
   `useDriverStatusStore.dispatchedRideId` / `inProgressTrip` /
   `ListRidesByPassenger` / `ListRidesByDriver` to find the
   active-ride source the AppContent integration will read.
8. Then propose **Turn 2 scope** as a numbered punch list (files
   to create, files to touch, tests to add) and wait for
   confirmation before writing code.

Tip: if the active-ride resolution turns out to be tangled enough
to risk the turn budget, propose splitting Turn 2 into Turn 2a
(`useGpsLifecycle` + AppContent + location streaming, no geofences)
and Turn 2b (geofence registration + active-ride wiring). The
location-streaming path is the most-valuable user-visible
deliverable; geofence registration drives Turn 3's view-model
auto-flip but isn't strictly required for the location stream to
work.
