# Phase 10 Turn 5 — Rider live ETA via NavSdk telemetry

**Status:** ✅ closed 2026-05-18.

## Why

Phase 10 Turn 4 (2026-05-18) closed the last `app.config.ts` 🟡
(unused `BGTaskSchedulerPermittedIdentifiers`). Post-Turn-4 audit
([`docs/PHASE_10_PARITY_AUDIT.md`](PHASE_10_PARITY_AUDIT.md)) showed
**5 ❌ / 1 🟡 / 0 ⚠️**. The highest-severity remaining ❌ was
§3.5 — the user-visible rider-ETA regression.

The rewrite's rider `DispatchedView` showed ETA-to-pickup read from
`ride.pickup.directions.durationSeconds` — a value stamped at trip
dispatch time and never updated as the driver drove. Same for
`StartedView`'s ETA-to-dropoff (stamped at trip-create time).
Legacy's `TripETAInfo` updated every ~15-30 seconds via NavSdk
telemetry written to `users/{driverId}.location.tripTracking`. The
rewrite shipped without the driver-side telemetry write path, and
without the rider-side subscription that would consume it.

Phase 9 Turn 5 was originally planned to ship this. It got
repurposed to close the passenger-snapshot Stripe gap and the
NavSdk telemetry work was deferred. Turn 5 closes it.

## Pre-checklist outcomes (resolved at kickoff time)

1. **HEAD SHA**: `fa3bb1a3cbd56e5f2fb1df8f35c393c8688abe2f` (Turn 4
   closure). Working tree clean.
2. **Gap-confirmation greps** (all passed):
   - `src/domain/entities/UserLocation.ts` had `TripTracking =
{tripId, tripStatus, destination}` only — no live-ETA fields.
   - `grep -rn 'subscribeToTimeAndDistance\|setOnRemainingTime' src/`
     returned zero matches.
   - `grep -rn 'SubscribeToUserLocation' src/presentation/features/`
     returned zero matches — the use case was wired in the DI
     container (Phase 7) with zero presentation consumers.
   - `src/presentation/hooks/useGpsLifecycle.ts:243` hardcoded
     `tripTracking: null`.
3. **Rider VM name**: `useRideMonitorViewModel.ts`.
4. **SDK setter name**: `setOnRemainingTimeOrDistanceChanged` on the
   `NavigationListenerSetters` bag. `TimeAndDistance` shape
   `{delaySeverity, meters: number, seconds: number}` — `delaySeverity`
   is ignored (rewrite cares only about meters/seconds).
5. **Connector forwarding**: `useNavigationSdkConnector` already
   forwards the listener bag wholesale via
   `...listenerSetters` — no connector change needed.

## Decisions locked at kickoff time

### Decision 1 — Domain shape: extend `TripTracking`

**(a) chosen.** Added `distanceMeters | null`, `durationSeconds |
null`, `updatedAt | null` directly to the existing `TripTracking`
interface in `@domain/entities/UserLocation`. Smallest diff;
matches the legacy doc shape exactly (legacy co-locates
`tripTracking.distance / duration / calculatedAt` with
`tripTracking.{tripId, tripStatus, destination}`).

Splitting off a separate `LiveTracking` VO (option b) would have
required a second Firestore field, breaking read-back parity with
legacy clients reading the same `locations/{uid}` doc during the
cutover side-by-side window.

### Decision 2 — Writer ownership: extend `useDriverMonitorViewModel` (Path α)

**Path α chosen.** The driver VM owns its tripTracking write
effect, subscribing to `navigationSdk.subscribeToTimeAndDistance`
while `ride.status ∈ ['dispatched', 'started']`. The race against
`useGpsLifecycle`'s plain `tripTracking: null` writes is harmless
because Firestore `set({merge: true})` on the underlying repo
preserves the active-write's fields.

Path β (extending `useGpsLifecycle` with a side-channel store)
would have moved driver-trip lifecycle out of the VM and weakened
the "VM owns its screen's lifecycle" convention. The "AppContent
is the only `UserLocation` writer" invariant was preserved as a
convention for the rider/awaiting paths, but the VM-owned active-
trip writer is a strict subset (active trip only, gated by status).

### Decision 3 — Rider subscription: reuse `SubscribeToUserLocation`

**(a) chosen.** `useRideMonitorViewModel` calls
`useCases.subscribeToUserLocation.execute({userId: driverId, callback})`
directly, keyed off `ride.driver?.id`. No new
`ObserveDriverLocation(rideId)` wrapper — the VM's effect cleanup
already handles the ride-switch race by re-running the effect
when `driverId` changes.

### Decision 4 — Throttle: copy legacy constants verbatim

**Legacy constants ported.** 30s min interval / 50m min movement /
60s NavSdk staleness window. The 15s NavSdk-fresh window from
legacy is implicit (we only have NavSdk data because the SDK fired
into our subscriber, so by construction it's recent).

Added a one-shot **time-gate bypass** on the nav-less → live edge:
when a NavSdk fire arrives AND the last write was nav-less, the
30s gate is skipped so the rider sees a live ETA on the first
NavSdk callback even if a `useGpsLifecycle` GPS write landed
moments before with `tripTracking: null`. Subsequent NavSdk fires
respect the gate normally — bypass is one-shot per nav-less → live
transition.

## What shipped

### Domain (`@domain/services` + `@domain/entities`)

- **`NavigationService` interface**:
  - New `NavTimeAndDistance` value type: `{remainingMeters: number;
remainingSeconds: number; timestampMs: number}`.
  - `NavigationListenerSetters` gained
    `setOnRemainingTimeOrDistanceChanged(callback: ((event: unknown)
=> void) | null): void` (method-syntax declaration so the type
    checker stays bivariant on the inner callback; `unknown` keeps
    the SDK's `TimeAndDistance` type out of the domain layer).
  - `NavigationService.subscribeToTimeAndDistance(callback:
(event: NavTimeAndDistance) => void): () => void`. Same
    pre-controller-subscribe semantics as `subscribeToArrival`.

- **`@domain/services/index.ts`**: re-exports `NavTimeAndDistance`.

- **`UserLocation.TripTracking`** gained three nullable fields:
  ```ts
  readonly distanceMeters: number | null;
  readonly durationSeconds: number | null;
  readonly updatedAt: Date | null;
  ```
  `UserLocation.create` validation rejects negative / non-finite
  `distanceMeters` / `durationSeconds` and invalid `updatedAt`
  dates. Existing call sites that pass `tripTracking: null` stay
  correct.

### Data (`@data/services` + `@data/dto` + `@data/mappers`)

- **`NavigationSdkClient`**:
  - Imports `TimeAndDistance as SdkTimeAndDistance` from the SDK.
  - Private `SdkNavigationListenerSetters` type gained
    `setOnRemainingTimeOrDistanceChanged`.
  - Two new fields: `timeDistanceCallbacks` (Set), `lastTimeDistanceKey`
    (dedup), `sdkTimeDistanceListenerActive` (bool).
  - `setController` now also detaches the old time/distance
    listener on swap and re-attaches on the new bag if subscribers
    exist (mirrors the arrival pattern).
  - `cleanup` symmetric teardown for the time/distance listener.
  - `subscribeToTimeAndDistance(callback)`: multi-subscriber facade
    - deferred-attach + per-subscriber-dispose + last-dispose
      clears SDK listener.
  - `handleTimeAndDistance` private handler: coerces negative SDK
    `meters` / `seconds` → 0, stamps `timestampMs = Date.now()`,
    dedupes by `${meters}:${seconds}`, fans out to subscribers
    with the same try/catch+`LOG.error` resilience as
    `handleArrival`.

- **`@data/dto/UserLocationDoc.ts`**:
  - `TripTrackingDocSchema` gained three optional fields:
    `distanceMeters`, `durationSeconds`, `updatedAtMs` (all
    `.nullish()`).
  - New `tripTrackingPreprocess` function (used via `z.preprocess`)
    normalises legacy nested `{distance: {value, text}, duration:
{value, text}, calculatedAt}` into the canonical flat fields
    BEFORE validation. Canonical wins on conflict (per "permissive
    read / canonical write" convention).
  - `TripTrackingDocSchemaWithLegacy` wraps the schema with the
    preprocess.

- **`@data/mappers/userLocationMapper.ts`**:
  - `tripTrackingToDomain` reads the canonical flat fields (DTO
    preprocess handles the legacy → flat normalisation upstream),
    parses `updatedAtMs` → `Date`, collapses `undefined`/`null` to
    `null` at the domain boundary.
  - New `EmittedUserLocationDoc` / `EmittedTripTrackingDoc` types
    capture the write-side superset shape (canonical flat fields
    AND legacy nested fields).
  - `toDoc` / `tripTrackingToDoc` emit **BOTH** canonical flat
    fields AND legacy nested `{distance: {value, text}, duration:
{value, text}, calculatedAt}` so legacy yeride clients reading
    the shared `locations/{uid}` doc during cutover keep rendering
    `TripETAInfo` correctly. Uses `Math.round` for integer fields
    on write; legacy text strings (`"0.9 mi"`, `"3 mins"`) come
    from new `formatMetersToText` / `formatSecondsToText` helpers
    that match the legacy `distanceTrackingService.js` output
    verbatim.

### Test infrastructure (`jest.setup.ts` + `@shared/testing`)

- **`jest.setup.ts`**:
  - `MockNavListeners` interface gained `timeAndDistance: Array<(event:
unknown) => void>`.
  - `mockMakeListenerSetters` wires `setOnRemainingTimeOrDistanceChanged`
    to push/clear the new list.
  - `__emitTimeAndDistance(event)` test helper fans an SDK-shaped
    `TimeAndDistance` into all registered callbacks.
  - `__reset` + every `removeAllListeners` clears the new list.

- **`FakeNavigationSdkClient`**:
  - `subscribeToTimeAndDistance` + `emitTimeAndDistance` helpers
    that mirror `subscribeToArrival` / `emitArrival` exactly.
  - `getTimeAndDistanceSubscriberCount()` introspection.
  - `cleanup` / `reset` clear the new registry.
  - New spy counters: `subscribeTimeAndDistanceCalls`,
    `timeAndDistanceDisposes`.

### App (no new use case — Decision 3 = (a))

No `ObserveDriverLocation` wrapper. The rider VM reuses
`SubscribeToUserLocation` keyed off `ride.driver?.id`.

### Presentation (driver + rider VMs + status views)

- **`useDriverMonitorViewModel`**:
  - New imports: `Coordinates`, `UserLocation`, `UserId`,
    `NavTimeAndDistance`, `useUpdateLocationMutation`,
    `useGpsCurrentLocation`, `useGpsCurrentSpeed`, `useSessionStore`.
  - Three new refs for throttle bookkeeping (`lastWriteAtMsRef`,
    `lastWriteCoordsRef`, `lastWriteHadTelemetryRef`,
    `latestNavSdkRef`, `latestGpsRef`).
  - `useEffect` keyed on `(isActiveTripStatus, navigationSdk)`
    subscribes to `subscribeToTimeAndDistance` while
    `ride.status ∈ ['dispatched', 'started']`; on each fire calls
    `tryWriteTripTracking({source: 'navsdk', ...})`.
  - `useEffect` keyed on `(isActiveTripStatus, gpsLocation,
gpsSpeed, driverUserId, updateLocationMutation)` calls
    `tryWriteTripTracking({source: 'gps', ...})` on every GPS
    update.
  - Both effects share the same throttle state — only one Firestore
    write per 30s / 50m / 60s, with the nav-less → live bypass.

- New file-scope helpers:
  - `TRIP_TRACKING_MIN_INTERVAL_MS = 30_000`,
    `TRIP_TRACKING_MIN_DISTANCE_M = 50`,
    `TRIP_TRACKING_NAVSDK_MAX_AGE_MS = 60_000`.
  - `tryWriteTripTracking(args)`: gates source-aware throttle,
    computes `destination` from `ride.pickup.location` /
    `ride.dropoff.location` by status, builds populated
    `UserLocation` via `UserLocation.create`, calls
    `mutation.mutate(locR.value, {onError: ...})`.
  - `haversineMetres(a, b)`: metres between two `Coordinates`.

- **`useRideMonitorViewModel`**:
  - New `UserLocation` import.
  - New interface fields: `liveDurationSeconds: number | null`,
    `liveDistanceMeters: number | null`.
  - `useEffect` keyed on `(useCases, driverId)` subscribes to
    `useCases.subscribeToUserLocation.execute({userId: driverId,
callback: setDriverLocation})` while `ride.driver?.id` is
    non-null. Cleans up via the returned unsubscribe.
  - Surfaces `driverLocation.tripTracking.durationSeconds /
distanceMeters` as the two live fields (null when no driver,
    no doc, or no telemetry).

- **`DispatchedView`** (`@presentation/features/rider/components/DispatchedView.tsx`):
  - New optional props: `liveDurationSeconds?: number | null`,
    `liveDistanceMeters?: number | null`.
  - `effectiveDuration` prefers live; falls back to
    `directions?.durationSeconds`. Same for distance text via new
    `formatDistanceMeters` helper (matches legacy
    `formatMetersToText`).

- **`StartedView`**: same prop additions + same fallback logic
  against `dropoff.directions`.

- **`RideMonitorScreen`**: threads `liveDurationSeconds` /
  `liveDistanceMeters` from VM into both views.

## Test additions

| Layer           | New / extended file                  | Coverage                                                                                                                                                                                      |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain          | `UserLocation.test.ts`               | 4 new arms: live telemetry populated, negative distanceMeters, non-finite durationSeconds, invalid updatedAt                                                                                  |
| Data DTO/mapper | `userLocationMapper.test.ts`         | 4 new arms: round-trip with telemetry, read legacy nested shape, flat wins on conflict, write emits both shapes, write omits legacy nested when telemetry null                                |
| Adapter         | `NavigationSdkClient.test.ts`        | New `subscribeToTimeAndDistance` describe: one-listener-per-N-subs, fan-out + dedup, negative coercion, last-disposer-clears-SDK, deferred-attach-before-controller                           |
| Fake            | `FakeNavigationSdkClient.test.ts`    | New `emitTimeAndDistance + dedup` describe: fan-out, dedup, distinct events, disposer-zeroes-count                                                                                            |
| Driver VM       | `useDriverMonitorViewModel.test.tsx` | New `live tripTracking write` describe: writes on NavSdk fire (dispatched + started), throttle holds after first live write, terminal cleanup unsubscribes, GPS-only path writes nav-less doc |
| Rider VM        | `useRideMonitorViewModel.test.tsx`   | New `liveDurationSeconds / liveDistanceMeters` describe: null until driver doc arrives, surfaces values, null when route-metadata-only, no-driver = no subscription                           |

**Pass counts:** all suites green. Targeted runs show **130 tests
pass** (across the 8 suites touched by the turn). Full-suite sharded
run: **1,673 pass / 21 fail** — the 21 failures are pre-existing
`BackgroundGeolocationClient.test.ts` carry-overs (Turn 9 scope,
documented in audit §10.1).

## Verify gates

```bash
npm run typecheck       # green
npm run lint            # green
npm run format:check    # green modulo pre-existing CLAUDE.md warning
npm test                # 1,673 pass / 21 pre-existing fails (Turn 9 scope)
```

## Acceptance criteria — all met

- [x] Decisions 1-4 documented with evidence (above).
- [x] `NavigationService` interface gained `subscribeToTimeAndDistance`
      and matching `NavigationListenerSetters` entry, both behind
      `unknown`-typed callbacks (no SDK types in domain).
- [x] `NavigationSdkClient` adapter mirrors `subscribeToArrival`
      multi-subscriber + dedup pattern for time/distance.
- [x] `FakeNavigationSdkClient` extended with `emitTimeAndDistance`
      test helper.
- [x] `TripTracking` domain interface gained `distanceMeters | null`,
      `durationSeconds | null`, `updatedAt | null`.
- [x] `UserLocationDoc` DTO reads BOTH canonical flat shape AND legacy
      nested `{distance, duration, calculatedAt}` shape via
      `z.preprocess`.
- [x] `userLocationMapper` writes BOTH canonical flat fields AND
      legacy nested shape (dual-write for cutover co-existence).
- [x] Driver write path (Path α) populates
      `tripTracking.distanceMeters / durationSeconds / updatedAt`
      when `Ride.status ∈ ['dispatched', 'started']`. Throttle copied
      from legacy (30s / 50m / 60s; NavSdk freshness 15s implicit).
- [x] Rider VM subscribes to driver location and surfaces
      `liveDurationSeconds` / `liveDistanceMeters` (null until first
      live event arrives).
- [x] `DispatchedView` + `StartedView` (rider) consume `live*` with
      fallback to `ride.pickup.directions.*` /
      `ride.dropoff.directions.*`.
- [x] New / updated tests for each touched layer.
- [x] Audit §3.5 row flipped ❌ → ✅ with Turn 5 annotation.
- [x] Audit §1 headline count updated 5 ❌ / 1 🟡 → 4 ❌ / 1 🟡.
- [x] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo pre-existing `CLAUDE.md` Prettier warning); jest
      carries the 21 pre-existing BG-geolocation failures only.

## Out of scope (deferred — same as kickoff)

- Distance Matrix fallback (no NavSdk-not-yet-fired branch — rider
  falls back to static `ride.pickup.directions` ETA during that
  window; same UX as legacy "Calculating…").
- `lastSeenByRiderAt` read-receipt writes.
- Activity tab (Turn 6), scheduled rides UI (Turn 7), chat (Turn 8),
  BG-geolocation test regression (Turn 9), throttle tuning (post-
  cutover), `yeride.com/stripe-return` 302 bridge (ops).

## Native rebuild

Not required — all changes are JS/TS. No `app.config.ts` or
native-side edits. Metro bundle reload picks up the changes.

## Next turn

Turn 6 — Activity tab port (rider + driver). Audit §3.3, audit
§8 row 6. Large (3-5d).

---

**End of PHASE_10_TURN_5.md.**
