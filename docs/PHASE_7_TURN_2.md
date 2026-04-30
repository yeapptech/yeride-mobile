# Phase 7 — Turn 2: `useGpsLifecycle` + AppContent integration + pickup geofence

The single GPS-aware presentation hook is in. AppContent owns the SDK
lifecycle exactly once. `useGpsStore` is the cheap-read mirror every
view-model will compose on top of in Turn 3. Pickup-geofence
registration is wired through a sibling `useActiveRideForGeofence`
hook that resolves the dispatched ride per role.

End of turn: **152 suites / 1162 tests passing**, **+4 suites / +38
tests** on top of Turn 1's 148/1124 — at the high end of the
kickoff's "≥20 tests" estimate but every test maps to a documented
behavior. typecheck + lint + format + test all green.

## What's in

### 1. `useGpsStore` (Zustand, transient SDK mirror)

`src/presentation/stores/useGpsStore.ts`. Six fields decomposed from
the SDK's event shapes so common selectors stay primitive:

- `permissionStatus: BgPermissionStatus`
- `currentLocation: Coordinates | null`
- `currentSpeed: number | null` (metres per second, `null` when SDK
  hasn't established a fix)
- `currentOdometerMeters: number`
- `lastGeofenceEvent: BgGeofenceEvent | null`
- `isInsidePickupGeofence: boolean` (auto-derived from
  `lastGeofenceEvent.action`; `setIsInsidePickupGeofence(false)` is
  the deregistration escape hatch the lifecycle hook uses)

Five named action methods (`setPermissionStatus`, `setLocation`,
`setGeofenceEvent`, `setIsInsidePickupGeofence`, `reset`). Six
selector hooks (`useGpsCurrentLocation`, `useGpsCurrentOdometer`,
`useGpsCurrentSpeed`, `useGpsLastGeofenceEvent`,
`useGpsIsInsidePickupGeofence`, `useGpsPermissionStatus`).

**Mounting rule** documented at the top of the file:
`useGpsLifecycle` is the ONLY writer; everyone else READS via the
selector hooks. Mirrors the existing `useGeofenceUiStore` /
`useDriverStatusStore` patterns. Re-exported through
`@presentation/stores`.

### 2. `useBackgroundGeolocation()` hook

`src/presentation/di/ContainerProvider.tsx` extended with a sibling
hook to `useUseCases()`. Throws if used outside `<ContainerProvider/>`
— same contract as `useUseCases()`. Re-exported through
`@presentation/di`. The container.ts comment block is updated to
point callers at the new hook.

### 3. `useGpsLifecycle` (the single GPS-aware presentation hook)

`src/presentation/hooks/useGpsLifecycle.ts`. Inputs:
`{ enabled: boolean; userId: UserId | null; activeRideForGeofence?: { rideId; pickupCoords } | null }`.
Returns `void` — every output lives in `useGpsStore`.

Five effects:

1. **SDK lifecycle** — one-shot `init({ distanceFilter: 200, debug: __DEV__ })`
   on first `enabled === true` (`useRef`-guarded). One-shot
   `requestAuthorizationIfNeeded()` on the first `false → true`
   transition. `start()` when permission resolves to `'always'` or
   `'when_in_use'`. `stop()` (fire-and-forget) on `enabled === false`.
2. **Location subscription** — pushes `BgLocationEvent`s into
   `useGpsStore.setLocation` AND fans out to
   `useUpdateLocationMutation.mutate(UserLocation)` so the
   `locations/{userId}` Firestore doc gets a fresh write per delivery.
   Distance throttling is the SDK's `distanceFilter: 200`; no JS-side
   debounce (kickoff Decision 4).
3. **Geofence subscription** — pushes `BgGeofenceEvent`s into
   `useGpsStore.setGeofenceEvent` (which derives
   `isInsidePickupGeofence` from `event.action`).
4. **Pickup-geofence registration** (Turn 2b) — when
   `activeRideForGeofence` is non-null, `addPickupGeofence(...)` with
   the supplied rideId + pickupCoords + `radiusMeters: 200`. On
   transition to null, `removePickupGeofence()` and clear
   `isInsidePickupGeofence` so a stale ENTER doesn't survive past the
   trip.
5. **Synchronous teardown** on unmount — fires a fire-and-forget
   ordered chain `stop → removeAllGeofences → removeAllListeners`.
   React effect cleanup remains synchronous.

`updateLocationMutation` and `userId` are carried through `useRef`s
so the long-lived subscription effect doesn't tear down on every
fresh TanStack-mutation identity. The mutation closure reads
`updateLocationMutationRef.current` per event.

The hook's docstring includes an explicit "AppContent-only" guard
note. Re-exported through `@presentation/hooks`.

### 4. `useActiveRideForGeofence` (Turn 2b resolver)

`src/presentation/hooks/useActiveRideForGeofence.ts`. Pure read-only
hook — no side effects, returns `{ rideId, pickupCoords } | null`.

Two-stage resolution per the kickoff plan:

- **Discovery via the role-appropriate one-shot query**:
  `useInProgressRideQuery(rider.id)` for riders,
  `useInProgressDriverRideQuery(driver.id)` for drivers. Both hooks
  are called unconditionally to satisfy the Rules of Hooks; the
  irrelevant one stays `enabled: false`.
- **Live overlay via `observeRide`**: a `useFirestoreSubscription`
  closure subscribes to the active ride doc so a status flip
  (`'dispatched' → 'started'`) reactively switches the geofence in /
  out without waiting on a TanStack invalidation. The closure
  no-ops when there's no rideId, so the hook can be mounted at
  AppContent unconditionally.

Geofence visibility window: only `ride.status === 'dispatched'` (the
segment when the rider is at pickup and the driver is en route).
Every other status returns `null`.

### 5. AppContent integration

`src/presentation/AppContent.tsx`. Three additions on top of the
existing auth-listener + safety-timeout shell:

- Compute `enabled` from `useSessionStatus()` + `useCurrentUserQuery()`
  via the new `isRegistrationComplete(user)` predicate. Mirrors the
  legacy `computeTargetRoute` gate: rider needs
  `defaultPaymentMethodId !== null`; driver needs
  `stripeChargesEnabled && stripePayoutsEnabled`. Anything mid-
  onboarding doesn't get GPS yet — same gate the legacy app applied
  before `gpsStart(200)`.
- Resolve `activeRideForGeofence` via `useActiveRideForGeofence(user)`.
- Mount `useGpsLifecycle({ enabled, userId, activeRideForGeofence })`.
- Reset `useGpsStore` on transition to `'unauthenticated'` so the
  next sign-in starts fresh. Sign-out is the canonical reset point;
  the lifecycle hook's `enabled === false` path stops the SDK but
  deliberately leaves the store alone (so a brief `enabled` flicker
  during hot reload doesn't drop the user's last known location).

### 6. ESLint boundaries override

`useGpsLifecycle.ts` and `useGpsStore.ts` import the SDK adapter's
domain-shaped types (`BgLocationEvent`, `BgGeofenceEvent`,
`BgPermissionStatus`) from `@data/services/BackgroundGeolocationClient`.
Per kickoff Decisions 2 + 3, the lifecycle hook IS the
presentation-layer composition seam over the data-layer SDK adapter
— same architectural exception as `presentation/di/container.ts`.
`eslint.config.js` adds both files to the existing
`boundaries/element-types: 'off'` override block, with a comment
explaining why.

### 7. Tests (+38 across four suites)

**`useGpsStore.test.ts` — 11 tests.** Defaults; per-action setter
behaviour (including non-pickup geofence events that skip the inside
flag); manual `setIsInsidePickupGeofence(false)` for deregistration
cleanup; reset wipes everything; subscriber notifications fire.

**`useGpsLifecycle.test.tsx` — 15 tests.** Init + permission +
start ordering on first enable; idempotent across `false → true →
false → true`; permission-denied skip-start; disabled = no init;
location event populates the store + writes through the location
repo; null-userId skips Firestore writes (telemetry surface still
updates); pickup geofence add on rideForGeofence transition; remove
on null transition + inside flag clear; re-register on rideId
change; chain-ordered teardown on unmount; init failure isolation;
permission-request failure isolation.

**`useActiveRideForGeofence.test.tsx` — 6 tests.** Null user →
null; rider with `'awaiting_driver'` ride → null; rider on
`'dispatched'` ride → `{rideId, pickupCoords}`; driver on
`'dispatched'` ride → same; live transition from
`'dispatched'` → `'started'` flips back to null; ride seeded as
`'started'` from the start → null (no flicker through dispatched).

**`AppContent.test.tsx` — 6 tests.** Rider with default payment
method → SDK starts; rider mid-onboarding → SDK does NOT start;
driver with Connect enabled → SDK starts; driver mid-Connect-
onboarding → SDK does NOT start; dispatched ride → pickup geofence
registered with the right rideId / coords / radius; sign-out stops
the SDK and resets `useGpsStore`.

## Why this turn doesn't include

- **`useRideMonitorViewModel` foreground-tick swap** — Turn 3.
  Today's foreground geofence tick driven by `useCurrentLocation`
  remains in place; Turn 3 swaps it for
  `useGpsLastGeofenceEvent()`.
- **`useDriverMonitorViewModel.arrivedAtPickup` auto-flip** — Turn 3.
  The store flag is already populated correctly (Turn 2b verifies
  this via the AppContent integration test), but the VM hasn't been
  rewired to read it.
- **`stubOdometerMeters` replacement with `useGpsCurrentOdometer()`**
  — Turn 3.
- **"Open Settings" CTA UI** — Phase 9 polish. Turn 2 plumbs
  `permissionStatus` into the store; the UI affordance to deep-link
  into system settings is not in scope.
- **AppState foreground-resume listener** — kickoff Decision 9. The
  SDK manages its own foreground/background lifecycle.
- **JS-side debounce on location writes** — kickoff Decision 4. SDK
  `distanceFilter: 200` is the rate limiter.
- **Per-ride `resetOdometer()` call** — adapter exposes the method
  but Turn 2 doesn't call it. Turn 3 (or Phase 9) decides whether
  trip-start should reset.

## Risks surfaced

### Mutation cascade under jittery GPS

`useUpdateLocationMutation` fires per-delivery. The SDK's
`distanceFilter: 200` already gates deliveries to roughly every 200m
of motion or every ~30s idle, and the `FirestoreLocationRepository`
already has 3-retry exponential backoff. Field telemetry from the
first device smoke will tell us whether any additional JS-side
throttling is warranted (Phase 9 polish, if at all).

### Permission-dialog timing across hot-reload

The OS permission dialog fires on the first
`requestAuthorizationIfNeeded()` per app launch.
`permissionRequestedRef` (a `useRef` in `useGpsLifecycle`) guards
against re-prompting on a transient `false → true → false → true`
flicker (e.g. dev hot reload). On a real cold boot the ref starts
`false` so the prompt does fire.

### Live `observeRide` at AppContent depth

AppContent now subscribes to a single ride doc whenever the user
has an in-progress ride. This is one Firestore listener per active
session — modest cost. The subscription reuses the existing
`useFirestoreSubscription` adapter so cleanup is synchronous and
StrictMode-safe.

### `act` warnings in tests

The AppContent + `useActiveRideForGeofence` tests print TanStack
Query notification settling warnings ("An update to … inside a test
was not wrapped in act"). These come from the test framework's
collision with TanStack's batched notify scheduler, not from
production code. Pattern matches existing turns' VM tests; not a
regression.

### Worker-process leak warning at end of `npm test`

Jest prints "A worker process has failed to exit gracefully" on the
last test run. This is the SDK fake's listener buckets retaining
references after tests finish. The fake's `removeAllListeners` is
called in cleanup, but the underlying global jest mock from Turn 1
keeps a small registry. Non-fatal; matches Turn 1's similar
`detectOpenHandles` warning. Phase 9 polish can chase it.

### Boundary rule override expanded

`useGpsLifecycle.ts` and `useGpsStore.ts` are now in the
boundaries-rule-off list alongside `presentation/di/container.ts`.
This is a real architectural exception, not a workaround — the
lifecycle hook IS the seam between presentation and the SDK
adapter (kickoff Decisions 2 + 3). Documented with an inline
comment in `eslint.config.js`.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at
end of turn. **152 test suites / 1162 tests** (+4 suites / +38
tests over Turn 1's 148/1124).

A future Turn 3 has, at this point:

1. The SDK lifecycle running unattended at AppContent — view-models
   never need to think about init / permissions / start / stop.
2. The Zustand selector hooks (`useGpsCurrentLocation`,
   `useGpsCurrentOdometer`, `useGpsLastGeofenceEvent`,
   `useGpsIsInsidePickupGeofence`, `useGpsPermissionStatus`) ready
   to swap into `useRideMonitorViewModel` and
   `useDriverMonitorViewModel`.
3. Pickup-geofence registration driven by ride status — the
   driver's `at_pickup` flag will auto-flip from
   `useGpsIsInsidePickupGeofence()` rather than a button tap.
4. A real GPS-derived odometer (`useGpsCurrentOdometer()`) ready to
   replace the `stubOdometerMeters` derivation in
   `useDriverMonitorViewModel`'s Start / RequestPayment mutations.

## Files added / touched this turn

**Added:**

- `src/presentation/stores/useGpsStore.ts`
- `src/presentation/stores/__tests__/useGpsStore.test.ts`
- `src/presentation/hooks/useGpsLifecycle.ts`
- `src/presentation/hooks/__tests__/useGpsLifecycle.test.tsx`
- `src/presentation/hooks/useActiveRideForGeofence.ts`
- `src/presentation/hooks/__tests__/useActiveRideForGeofence.test.tsx`
- `src/presentation/__tests__/AppContent.test.tsx`
- `docs/PHASE_7_TURN_2.md` (this file)

**Touched:**

- `src/presentation/AppContent.tsx` — `useGpsLifecycle` mount,
  `useActiveRideForGeofence` resolution, sign-out store reset
- `src/presentation/di/ContainerProvider.tsx` — new
  `useBackgroundGeolocation()` hook
- `src/presentation/di/index.ts` — re-export
- `src/presentation/di/container.ts` — comment refresh on the
  `bgGeolocation` field
- `src/presentation/stores/index.ts` — re-export `useGpsStore` +
  selector hooks
- `src/presentation/hooks/index.ts` — re-export `useGpsLifecycle` +
  `useActiveRideForGeofence`
- `eslint.config.js` — boundaries override extended to the two
  presentation-layer SDK seams
- `CLAUDE.md` — Phase 7 turn 2 acceptance + arc summary
