# Phase 10 Turn 5 Kickoff — Rider live ETA via NavSdk telemetry

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 4
closed 2026-05-18** (drop unused `BGTaskSchedulerPermittedIdentifiers`
from `app.config.ts` because the v5.1.1 Transistor SDK provably no
longer uses BGTaskScheduler — see `docs/PHASE_10_TURN_4.md`). Audit
v2 post-Turn-4 shows **5 ❌ / 1 🟡 / 0 ⚠️**.

Turn 5 closes the highest-severity remaining ❌ — the user-visible
rider-ETA regression that flipped ⚠️ → ❌ in Turn 1. It is **small-
medium (~1-2 days)** and touches four layers (domain → app → data
→ presentation). Audit §3.5 + §10.2 carry the discovery.

## Context — why this turn now

The rewrite's rider-side `DispatchedView` / `StartedView` show ETA
read from `ride.pickup.directions.durationSeconds` /
`ride.dropoff.directions.durationSeconds` respectively. Those
values are **stamped at trip-create / dispatch time and never
updated as the driver drives**. So the rider sees a frozen "driver
is 7 min away" the whole way through pickup — a clear regression
from legacy, which updates every ~15-30 seconds.

Legacy's pipeline (verified at Turn 5 kickoff time by reading
`yeride/src/api/services/distanceTrackingService.js` + `DriverHome.js`
+ `DriverNavigation.js` + `rider/components/DispatchedView.js`):

```
DriverNavigation: setOnRemainingTimeOrDistanceChanged((td) =>
                  LocationContext.setNavSdkTracking({meters, seconds, updatedAt}))
       ↓
DriverHome.handleLocationChange: on each GPS event, call
                  calculateTripDistance(driverLoc, trip, status, apiKey, navSdkData)
       ↓
distanceTrackingService.calculateTripDistance:
                  - if navSdkData fresh (< 15s) → format as tripTracking
                  - else throttled Distance Matrix call (30s min interval,
                    50m min movement, 60s staleness)
                  - return {tripId, tripStatus, destination,
                    distance: {text, value}, duration: {text, value},
                    calculatedAt}
       ↓
Trip.updateUserLocation(driverId, locationData, tripTracking):
                  writes users/{driverId}.location.tripTracking = {...}
       ↓
Rider DispatchedView.useEffect: subscribeToUserLocation(driver.id, cb, tripId)
                  → reads locationData.tripTracking → setLiveTracking({...})
       ↓
TripETAInfo: renders driverDistance.text + driverDuration.text,
             falls back to "Calculating..." while liveTracking is null
```

The NavSdk path is the **primary** source — Distance Matrix is the
secondary fallback for the window between Nav startup and the first
SDK telemetry callback (and for moments when NavSdk data goes
stale). Legacy `distanceTrackingService.js:231` confirms: "Priority:
Use Nav SDK data if fresh (< 15 seconds old)" comes before the
Distance Matrix branch.

**Rewrite gap (verified Turn 5 kickoff):**

- `NavigationService` interface (`@domain/services/NavigationService.ts`)
  exposes only `subscribeToArrival` — no time/distance subscription.
- `NavigationSdkClient` adapter (`@data/services/NavigationSdkClient.ts`)
  wires only `setOnArrival` on the SDK listener bag.
- `UserLocation.tripTracking` domain shape is
  `{tripId, tripStatus, destination}` — **no distance/duration fields**.
- `useGpsLifecycle.ts:243` writes `tripTracking: null` on every GPS
  event regardless of driver state — no logic ever populates the
  field for the active driver.
- `useDriverMonitorViewModel` doesn't touch location writes.
- `useRideMonitorViewModel` doesn't subscribe to driver location.
- `SubscribeToUserLocation` use case exists (Phase 7) but has zero
  consumers in `src/presentation/features/rider`.

So Turn 5 ships an end-to-end pipeline that doesn't exist yet in
the rewrite. The pieces are independent (NavSdk seam extension,
domain field add, driver write, rider consume) but they have to
land together for the rider to see a live ETA.

## Required reading (in order)

1. **Audit `docs/PHASE_10_PARITY_AUDIT.md` §3.5** (the
   verified-Turn-1 rider-ETA gap analysis with the suggested Phase
   10 turn scope) and **§10.2** (the discovery write-up — two
   minutes). These are the canonical scope for Turn 5.

2. **Legacy `yeride/src/api/services/distanceTrackingService.js`**
   in full (360 lines). Note `THROTTLE_CONFIG` (30s / 50m / 60s),
   `NAV_SDK_MAX_AGE = 15000`, the legacy tripTracking shape
   (`distance: {text, value}, duration: {text, value}`), and the
   format helpers `formatMetersToText` / `formatSecondsToText`.

3. **Legacy `yeride/src/driver/screens/DriverNavigation.js`**
   lines 200-245 — the `setOnRemainingTimeOrDistanceChanged`
   subscription that captures NavSdk telemetry into
   `LocationContext.navSdkTracking`. This is the SDK-side surface
   to mirror in the rewrite's `NavigationSdkClient`.

4. **Legacy `yeride/src/driver/screens/DriverHome.js`** lines
   90-130 — the GPS handler that calls `calculateTripDistance` and
   passes the result into `updateUserLocation`. The
   `user?.inProgressTrip` guard + `tripStatus in ['dispatched',
   'started']` gating is the gate the rewrite must replicate.

5. **Legacy `yeride/src/rider/components/DispatchedView.js`** + the
   `TripETAInfo` component it wraps. Note how `liveTracking` falls
   back to nothing while null (no live data yet) — the rewrite
   should keep the same "Calculating…" feel using
   `ride.pickup.directions.durationSeconds` as the fallback while
   live data hasn't arrived.

6. **Rewrite `src/data/services/NavigationSdkClient.ts`** lines
   60-90 + 110-200. Understand the multi-subscriber listener-dedup
   pattern for `setOnArrival` — `arrivalCallbacks: Set<callback>`,
   `lastArrivalKey: string | null`, "register internal handler
   once, fan out to N subscribers, clear when last unsubscribes."
   Turn 5's new `subscribeToTimeAndDistance` mirrors this shape
   exactly. The two SDK setter functions live alongside
   `setOnArrival` in the same `NavigationListenerSetters` bag
   passed via `setController`.

7. **Rewrite `src/domain/entities/UserLocation.ts`** in full (~100
   lines). Note `TripTracking` is an interface, not a class, and
   has no Result-returning factory — it's flat data. Phase 7 left
   it deliberately minimal because legacy carried richer state.

8. **Rewrite `src/data/dto/UserLocationDoc.ts` + `userLocationMapper.ts`**.
   This is where the DTO will gain the legacy-compatible
   `distance: {value, text}` + `duration: {value, text}` +
   `calculatedAt` shape on the read side, and emit canonical flat
   fields on the write side per the
   "permissive read / canonical write" convention.

9. **Rewrite `src/presentation/hooks/useGpsLifecycle.ts`** lines
   230-280 — the location-write side that currently hardcodes
   `tripTracking: null`. **Read the warnings about lifecycle
   ownership at the top of the file**: AppContent is the only
   writer. Turn 5 should NOT pull lifecycle into the driver view-
   model — instead, the driver view-model should publish telemetry
   into a Zustand store that `useGpsLifecycle` reads, OR the
   driver view-model should hold its own
   `UpdateUserLocation`-with-tripTracking effect that runs alongside
   `useGpsLifecycle` (see decision section below).

10. **Rewrite `src/presentation/features/rider/view-models/`** —
    pull up `useRideMonitorViewModel.ts` (if it exists with that
    name; otherwise it's the VM behind `RideMonitorScreen.tsx`).
    Confirm the seam where the live ETA should be injected.

11. **`docs/PHASE_10_TURN_4.md`** — the most recent turn doc. Patch
    shape model, kickoff-pattern model, audit-update flow, commit
    pattern. Turn 5 follows the same structure but with more code
    (this is a feature port, not a config tweak).

## Starting state — what's already true

- **HEAD** on `main`: `fa3bb1a` ("Phase 10 Turn 4 — drop unused
  BGTaskSchedulerPermittedIdentifiers"). Capture in your turn doc.
- The 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain scoped as Turn 9 — DO NOT try to fix them in Turn 5.
- `SubscribeToUserLocation` use case is wired in
  `presentation/di/container.ts` (Phase 7) but has no presentation
  consumer.
- `NavigationService.subscribeToArrival` is the only existing
  multi-subscriber facade pattern on the seam — copy its shape.
- `useGpsLifecycle.ts` is AppContent-owned and the **only writer**
  to `UserLocation` today. Decision #2 below picks whether Turn 5
  preserves that invariant or extends the surface.
- Driver `useDriverMonitorViewModel` mounts
  `useNavigationSdkConnector`, which is what supplies the SDK
  controller + listener bag to `NavigationSdkClient.setController`.
  So by the time the rewrite reaches `dispatched` / `started`
  status, the NavSdk seam is live and ready to fan out callbacks.
- Rewrite is on `react-native-background-geolocation@5.1.1` (Phase
  9 chore upgrade) and
  `@googlemaps/react-native-navigation-sdk@0.14.1` (Phase 8). No
  SDK bump in this turn.
- Working tree clean (Turn 4 closed + committed); the only stale
  artifact is `.git/index.lock` files the sandbox can't unlink (run
  `find .git -name '*.lock' -delete` from your host shell if `git`
  complains).

## Scope — what to ship

Five layers, all required for the rider to see a live ETA. They
land together as one commit so a partial state never reaches
`main`.

### A. NavSdk seam extension (domain + data + fake)

- **`@domain/services/NavigationService.ts`**
  - Add `NavTimeAndDistance` value type:
    `{ remainingMeters: number; remainingSeconds: number; timestampMs: number }`.
    The adapter stamps `timestampMs`; the SDK doesn't surface one.
  - Extend `NavigationListenerSetters` with
    `setOnRemainingTimeOrDistanceChanged(callback: ((event: unknown) => void) | null): void`.
    (Same `unknown`-typed-callback pattern as `setOnArrival` so the
    domain layer doesn't import the SDK's `TimeAndDistance` type.)
  - Add `subscribeToTimeAndDistance(callback: (event: NavTimeAndDistance) => void): () => void`
    to `NavigationService`.

- **`@data/services/NavigationSdkClient.ts`**
  - Mirror the `arrivalCallbacks` pattern: `timeDistanceCallbacks:
    Set<(event: NavTimeAndDistance) => void>`, a single internal
    handler registered against `setOnRemainingTimeOrDistanceChanged`
    on first-subscriber, cleared on last-unsubscribe.
  - Dedup the SDK fires by `(remainingMeters, remainingSeconds)`
    (the SDK can fire repeatedly with identical values during
    standstill — legacy used the same dedup pattern).
  - Translate `SdkTimeAndDistance` → `NavTimeAndDistance` at the
    boundary (negative values → 0, missing fields → 0, stamp
    `timestampMs = Date.now()`).
  - Narrow the `SdkNavigationListenerSetters` private type to also
    include `setOnRemainingTimeOrDistanceChanged`.

- **`@shared/testing/FakeNavigationSdkClient.ts`**
  - Extend the fake with `subscribeToTimeAndDistance` + a test-only
    `emitTimeAndDistance(event)` helper so tests can drive the
    pipeline deterministically. Match the existing
    `emitArrival(event)` shape exactly.

### B. Domain shape — `TripTracking` extension

- **`@domain/entities/UserLocation.ts`**
  - Extend `TripTracking` interface with three optional fields:
    ```ts
    readonly distanceMeters: number | null;
    readonly durationSeconds: number | null;
    readonly updatedAt: Date | null;
    ```
  - Update `UserLocation.create`'s validation to accept the new
    fields. Existing call sites that pass `tripTracking: null` stay
    correct (the field is the whole object, not the inner sub-fields).
  - Existing call sites that pass a `TripTracking` with only
    `{tripId, tripStatus, destination}` need a follow-up: pass
    `null, null, null` for the three new fields. Audit the call
    sites with `grep -rn 'tripTracking: {' src/`.

- Don't introduce a `Money`/Result-style `TripTracking.create`
  factory unless validation is meaningful (negative
  meters/seconds, future timestamps). Match the existing flat-data
  pattern.

### C. Data layer — DTO + mapper

- **`@data/dto/UserLocationDoc.ts`**
  - On the read side: accept BOTH the legacy nested shape
    (`distance: {value: number, text: string}`,
    `duration: {value: number, text: string}`,
    `calculatedAt: string`) AND the canonical flat fields
    (`distanceMeters`, `durationSeconds`, `updatedAt`). Per the
    "permissive read / canonical write" convention.
  - Drive the Zod schema with `z.preprocess` (same pattern
    `PassengerSnapshot.defaultPaymentMethod` uses to accept
    multiple shapes — see audit context comment in
    `tripPaymentMapper`).
- **`@data/mappers/userLocationMapper.ts`**
  - Read: prefer flat, fall back to nested. Coerce `calculatedAt`
    ISO string → `Date`.
  - Write: emit BOTH the canonical flat fields AND the legacy
    nested shape (so legacy yeride keeps rendering `TripETAInfo`
    correctly when both apps run side-by-side during cutover
    — same dual-write rationale as `userMapper` for the Stripe
    Connect shape).
  - Use `Math.round` for the integer fields on write; floats
    surface as ESLint warnings in CI.

### D. Driver-side write path

The legacy `DriverHome.handleLocationChange` pattern doesn't translate
cleanly because the rewrite has split driver lifecycle across
`useGpsLifecycle` (AppContent-owned, writes `UserLocation`) and
`useDriverMonitorViewModel` (screen-scoped, owns ride state). Two
options, pick at kickoff time per decision #2:

- **Path α (preferred):** add an effect to
  `useDriverMonitorViewModel` that, while `Ride.status ∈
  ['dispatched', 'started']`, subscribes to the NavSdk
  `subscribeToTimeAndDistance` AND to a fresh GPS event stream
  (`useGpsStore` or `bgGeolocation.subscribeToLocation` if the store
  doesn't expose enough). When EITHER fires, compute the
  `TripTracking` and call `UpdateUserLocation` with the populated
  `tripTracking`. Tear down on unmount or status leaving the
  active set. **Pro:** keeps `useGpsLifecycle` clean (`tripTracking:
  null` stays the default); active-trip telemetry lives where the
  ride state lives. **Con:** two writers race for
  `users/{uid}.location` — Firestore `set({merge: true})` makes
  this safe, but the two streams update at different cadences (the
  GPS stream every few seconds; NavSdk on geo deltas / traffic
  updates). Accept the race; tests verify the merge order.
- **Path β:** extend `useGpsLifecycle` with an "active driver"
  side channel that reads NavSdk telemetry from a Zustand store
  populated by `useDriverMonitorViewModel`. **Pro:** single
  writer to `UserLocation`. **Con:** Zustand bridge adds latency
  (one render tick) and moves driver-trip lifecycle out of the
  driver VM — fights the "VM owns its screen's orchestration"
  convention.

The kickoff recommends **Path α** because the rewrite's pattern
("VM owns its screen's lifecycle") is stronger than the "one
writer to UserLocation" invariant, and `merge: true` makes the
race harmless. Confirm in the pre-checklist; if you find an
existing race anywhere in the rewrite that resolves the question
differently, override.

- Independent of Path α/β:
  - Throttle copied from legacy: skip the Firestore write if
    `(now - lastWriteAt) < 30_000 && distanceFromLast < 50m && now
    - navSdkUpdatedAt < 60_000`. Don't over-engineer — pull the
    constants from `legacy/distanceTrackingService.js:9-13` as-is.
  - Compute `destination` (the existing `TripTracking.destination`
    field) from `Ride.pickup.coords` when `status === 'dispatched'`,
    `Ride.dropoff.coords` when `status === 'started'`. This is
    already what legacy does — match it.
  - **Do NOT** add a Distance Matrix fallback in this turn. The
    legacy fallback exists because legacy ran on simulator without
    NavSdk telemetry; the rewrite's `useDriverNavigationViewModel`
    init must succeed (Phase 8) for the driver to dispatch, so the
    NavSdk path is always the active source. If NavSdk telemetry
    hasn't arrived yet, the rewrite shows the static fallback
    ETA — same UX as legacy's "Calculating…" state.
    Audit §3.5's bullet "replaces legacy `distanceTrackingService`
    Distance Matrix polling with SDK-driven values" is the
    cutover position. Defer Distance Matrix to a follow-up if real
    devices show NavSdk gaps.

### E. Rider-side consumption

- **`useRideMonitorViewModel`** (or whatever the VM behind
  `RideMonitorScreen` is named — confirm in the pre-checklist):
  add a `SubscribeToUserLocation`-driven branch keyed on
  `ride.driver?.id`. Lift the latest `tripTracking` into the VM's
  output as `{liveDurationSeconds: number | null, liveDistanceMeters:
  number | null}`. Null when no live data has arrived yet.
- **`DispatchedView.tsx`**: replace the static
  `directions.durationSeconds` read with `liveDurationSeconds ??
  directions.durationSeconds`. Same for distance.
- **`StartedView.tsx` (rider)**: identical pattern against the
  dropoff directions.
- Keep `formatEta(durationSeconds)` and the existing distance text
  formatter unchanged — they already handle the value shape. Don't
  introduce a separate "Calculating…" label; the static fallback
  already serves that role and is informative.

### F. Tests

- **NavigationSdkClient** test: a new test arm that drives
  `setController` with a fake listener bag, verifies
  `subscribeToTimeAndDistance` registers the underlying SDK
  listener on first subscriber, fans out to N subscribers, dedups
  consecutive identical fires, and clears the SDK listener on last
  unsubscribe. Mirror the existing `subscribeToArrival` test.
- **FakeNavigationSdkClient** test: the `emitTimeAndDistance`
  helper does what it says.
- **userLocationMapper** test: round-trip canonical flat fields;
  read legacy nested shape; write emits both shapes; null
  `tripTracking` passes through unchanged.
- **useDriverMonitorViewModel** test (extend existing): with the
  fake NavSdk client + fake `LocationRepository`, drive a
  `dispatched` → `started` → terminal sequence and assert that
  `UpdateUserLocation` was called with the live
  `tripTracking.distanceMeters` / `durationSeconds` populated, and
  that the throttle suppresses high-frequency duplicate writes.
- **useRideMonitorViewModel** test (extend existing or add one):
  with the fake `LocationRepository` emitting a `UserLocation`
  with populated `tripTracking`, assert the VM surfaces
  `liveDurationSeconds` and that `DispatchedView` picks it up over
  the static `ride.pickup.directions.durationSeconds`.
- **Domain `UserLocation` test**: extend to cover the new
  `TripTracking` fields (null defaults, boundary values).

## Decisions to lock at kickoff time

### Decision 1 — Domain shape: separate `LiveTracking` VO vs. extend `TripTracking`?

The legacy doc has `tripTracking.{distance, duration, calculatedAt}`
co-located with `tripTracking.{tripId, tripStatus, destination}`.
Two options:

- **(a) extend `TripTracking`** with `distanceMeters | null`,
  `durationSeconds | null`, `updatedAt | null`. One field on
  `UserLocation`; matches the legacy doc shape; smallest diff.
- **(b) split** `TripTracking` (route metadata) from a new
  `LiveTracking` (telemetry). Two fields on `UserLocation`. More
  domain-correct (route metadata is set once; telemetry mutates);
  larger blast radius.

The kickoff recommends **(a)** because legacy's doc shape is the
parity target and (b) requires a second Firestore field, which
breaks read-back parity with legacy clients. Confirm at
pre-checklist time; if domain modeling concerns dominate,
override.

### Decision 2 — Writer ownership: extend `useDriverMonitorViewModel` (α) vs. extend `useGpsLifecycle` (β)?

Covered in scope §D. Default is Path α. Confirm at pre-checklist
time after reading the existing VM lifecycle code.

### Decision 3 — `SubscribeToUserLocation` vs. new `ObserveDriverLocation` use case?

The existing use case is generic (`SubscribeToUserLocation(userId)`).
Two options:

- **(a) reuse `SubscribeToUserLocation`** in the rider VM,
  keying off `ride.driver?.id`. No new use case; one less file.
- **(b) introduce `ObserveDriverLocation(rideId)`** that wraps
  `SubscribeToUserLocation` and adds a guard requiring the driver
  to match the active ride. Slightly safer if the rider's active
  ride changes mid-subscription (race between ride switch and
  subscription cleanup), but the VM already manages effect cleanup
  by `ride.driver?.id` — the additional guard is belt-and-
  suspenders.

Kickoff recommends **(a)** — keep the use case surface narrow.
Override if the smoke pass surfaces a race the cleanup doesn't
catch.

### Decision 4 — Throttle: copy legacy constants exactly, or pick fresh?

Legacy: 30s min interval / 50m min movement / 60s data staleness;
NavSdk freshness window 15s. The kickoff recommends **copy
exactly** — these were tuned against real traffic and there's no
new evidence to refine them. The Phase 10 cutover plan calls for
parity-first; tuning lives in a post-cutover turn.

## Pre-checklist

Surface in your first message back if not already resolved.

1. **Confirm HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile && git rev-parse HEAD && git status --short
   ```
   Expected: HEAD = `fa3bb1a` (or newer if other commits land);
   working tree clean modulo any `.git/*.lock` from prior sandbox
   sessions.

2. **Confirm the rewrite gap is as described.**
   - `grep -n 'tripTracking' src/domain/entities/UserLocation.ts`
     should NOT show `distanceMeters` / `durationSeconds`.
   - `grep -rn 'subscribeToTimeAndDistance\|setOnRemainingTime'
     src/` should return zero matches.
   - `grep -rn 'SubscribeToUserLocation' src/presentation/features/`
     should return zero matches (the use case has no rider-side
     consumer yet).
   - `grep -n 'tripTracking' src/presentation/hooks/useGpsLifecycle.ts`
     should show only `tripTracking: null`.

3. **Identify the actual rider VM name.** The kickoff assumes
   `useRideMonitorViewModel.ts`, but the rewrite may have a
   different convention (e.g. `useRiderMonitorViewModel`,
   `useRideMonitor`). Confirm via
   `ls src/presentation/features/rider/view-models/`.

4. **Confirm the SDK exports `setOnRemainingTimeOrDistanceChanged`
   in the listener bag.** Read `node_modules/@googlemaps/react-native-navigation-sdk/lib/typescript/src/maps/types.d.ts`
   (or wherever the `NavigationListenerSetters` type lives) and
   verify the setter name. Legacy uses
   `setOnRemainingTimeOrDistanceChanged` per
   `yeride/src/driver/screens/DriverNavigation.js:46`, but the SDK
   version may have renamed it between 0.14.1 and whatever legacy
   pinned.

5. **Confirm `useNavigationSdkConnector` passes the time-distance
   setter through to `NavigationSdkClient.setController`.** The
   connector should be flexible — it's pulling
   `useNavigation()`'s return bag and forwarding the listener bag
   wholesale — but verify. If the setter isn't being threaded, add
   one line to the connector before the seam-side change makes
   sense.

6. **Decide Path α vs β + Decision 1/3 outcomes.** Capture in the
   turn doc.

7. **Optional — manual smoke harness.** If you have a stage Firebase
   project hooked up and want a quick visual confirm, take a
   pre-Turn screenshot of `DispatchedView` showing the static ETA
   and a post-Turn screenshot showing the same ETA updating during
   a simulated drive. Skip if no simulator handy; the unit tests
   provide the regression net.

## Suggested approach

1. **Pre-checklist first.** Resolve items 1-6 above before
   touching code.

2. **Land changes bottom-up (domain → data → app → presentation).**
   This is the standard rewrite ordering — keeps each layer's
   tests green at every step:

   1. Extend `TripTracking` interface and `UserLocation.create`
      validation in the domain layer.
   2. Extend `UserLocationDoc` schema + `userLocationMapper` in the
      data layer. Update mapper tests.
   3. Extend `NavigationService` interface in the domain layer.
   4. Extend `NavigationSdkClient` adapter + `FakeNavigationSdkClient`
      in the data layer and `@shared/testing`. Update adapter
      tests.
   5. Extend `useDriverMonitorViewModel` (Path α). Update VM tests.
   6. Extend `useRideMonitorViewModel` to subscribe to driver
      location. Update VM tests.
   7. Update `DispatchedView.tsx` + `StartedView.tsx` (rider) to
      consume the live values.
   8. Audit any existing call sites of `tripTracking: {...}` for
      the three new field requirement.

3. **Verify gates.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck    # green
   npm run lint         # green
   npm run format:check # green or pre-existing CLAUDE.md warning only
   npm test             # only the 21 BG-geolocation failures (Turn 9)
   ```
   `npm test` is slow; use `--shard=N/M` if a single run times out
   in the sandbox (see Turn 4's verify approach).

4. **Audit + turn doc updates.**
   - §3.5 row in audit: flip ❌ → ✅ with Turn 5 closure note + the
     chosen decision-1/2/3 outcomes.
   - §10.2 verdict: flip ❌ → ✅.
   - §1 headline count: flip `5 ❌ / 1 🟡` → `4 ❌ / 1 🟡`.
   - §1 `§3.5 rider ETA` bullet: append "✅ closed in Turn 5
     (YYYY-MM-DD) via …".
   - §8 turn-plan row 5: strike + close date + doc reference.
   - Header sublabel: append "Turn 5 closed YYYY-MM-DD" (keep
     v2 — Turn 10 produces v3).
   - Write `docs/PHASE_10_TURN_5.md` following `PHASE_10_TURN_4.md`'s
     format. This turn is bigger (~1-2 days of code) so the patch
     section will be larger than Turn 4's.

5. **Commit.** Use the sandbox commit pattern in
   `~/Library/.../memory/sandbox_git_commit_pattern.md` (shadow
   index + `GIT_INDEX_FILE` + direct branch-ref write — virtiofs
   blocks `git`'s `unlink()` on lockfiles).

## Out of scope (defer to later turns)

- **Distance Matrix fallback.** The kickoff defers this — the
  rewrite's NavSdk pipeline must already be live for the driver to
  dispatch (Phase 8 startGuidance invariant). Add only if a
  post-rollout incident shows a gap.
- **Adding `lastSeenByRiderAt` writes** or other read-receipt
  shape from legacy — separate scope.
- **Activity tab** — Turn 6.
- **Scheduled rides creation UI** — Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **Tuning the throttle constants** — copy legacy as-is; tune
  post-cutover under real device load.
- **`yeride.com/stripe-return` 302-bridge** (audit §10.3) — ops
  work, not rewrite code.
- **Replacing `useGpsLifecycle`'s "AppContent owns the only
  writer" invariant with a published-event model.** Path α
  preserves that invariant; Path β would weaken it. Keep the
  invariant.

## Deliverable

A single PR / commit on `main` containing:

1. **Domain**: `UserLocation.ts` `TripTracking` extension +
   `NavigationService.ts` time/distance subscription type +
   `NavigationListenerSetters` extension.
2. **Data**: `NavigationSdkClient.ts` + `UserLocationDoc.ts` +
   `userLocationMapper.ts` updates with parity-emitting writes.
3. **App**: no new use case if Decision 3 picks (a); otherwise
   `ObserveDriverLocation` under `@app/usecases/location/`.
4. **Presentation**: `useDriverMonitorViewModel` extension,
   rider VM extension, `DispatchedView.tsx` + `StartedView.tsx`
   live-value consumption, `FakeNavigationSdkClient` extension.
5. **Tests**: new + updated tests for each layer per §F above.
6. **`docs/PHASE_10_PARITY_AUDIT.md`** updated — §1 count + bullet,
   §3.5 verdict, §8 turn plan row 5, §10.2 verdict, header
   sublabel.
7. **`docs/PHASE_10_TURN_5.md`** documenting:
   - Pre-checklist outcomes (HEAD SHA, gap-confirmation greps,
     rider VM name, SDK setter name, connector forwarding state)
   - The four decisions (1-4) with evidence chain
   - The patch diffs by layer
   - Test additions and pass counts
   - Acceptance criteria
   - Out-of-scope list

`npm run verify` should be green except for the carried-over 21
BG-geolocation failures (Turn 9's job).

## Sign-off criteria

- [ ] Decisions 1-4 documented with the evidence that drove them.
- [ ] `NavigationService` interface gained
      `subscribeToTimeAndDistance` and matching `NavigationListenerSetters`
      entry, both behind `unknown`-typed callbacks (no SDK types in
      domain).
- [ ] `NavigationSdkClient` adapter mirrors the
      `subscribeToArrival` multi-subscriber + dedup pattern for the
      new subscription.
- [ ] `FakeNavigationSdkClient` extended with `emitTimeAndDistance`
      test helper.
- [ ] `TripTracking` domain interface gained
      `distanceMeters | null`, `durationSeconds | null`,
      `updatedAt | null`.
- [ ] `UserLocationDoc` DTO reads BOTH the canonical flat shape
      AND legacy nested `{distance: {value, text}, duration:
      {value, text}, calculatedAt}` shape.
- [ ] `userLocationMapper` writes BOTH canonical flat fields AND
      legacy nested shape (dual-write for cutover co-existence).
- [ ] Driver write path (Path α or β per decision 2) populates
      `tripTracking.distanceMeters` + `durationSeconds` + `updatedAt`
      when `Ride.status ∈ ['dispatched', 'started']`. Throttle
      copied from legacy (30s / 50m / 60s; NavSdk freshness 15s).
- [ ] Rider VM subscribes to driver location and surfaces
      `liveDurationSeconds` / `liveDistanceMeters` (null until
      first live event arrives).
- [ ] `DispatchedView.tsx` + `StartedView.tsx` (rider) consume
      `live*` with fallback to `ride.pickup.directions.*` /
      `ride.dropoff.directions.*`. Same "fall back to static" UX
      as legacy's "Calculating…" state.
- [ ] New / updated tests for each touched layer.
- [ ] Audit §3.5 row flipped ❌ → ✅ with Turn 5 annotation.
- [ ] Audit §1 headline count updated `5 ❌ / 1 🟡` →
      `4 ❌ / 1 🟡`.
- [ ] `PHASE_10_TURN_5.md` written following Turn 4's structure.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo the pre-existing `CLAUDE.md` Prettier warning);
      jest carries the 21 pre-existing BG-geolocation failures
      only.
- [ ] Commit landed on `main` via the sandbox commit pattern.

## Native rebuild

**Not required for this turn.** All changes are JS/TS — no
`app.config.ts` or native-side edits. `npm run prebuild` is
unnecessary; metro bundle reload picks up the changes.

---

**End of PHASE_10_TURN_5_KICKOFF.md.** Read top to bottom on a
new session and execute. Ask if any pre-checklist item surfaces a
blocker — especially if the SDK setter has been renamed between
0.14.1 and what legacy pinned (item 4), or if the connector isn't
already forwarding the listener bag wholesale (item 5). Either of
those is a wiring fix that comes BEFORE the seam-side change.
