# Phase 10 OOB — Driver-dispatch first-come-first-served rework

**Closed:** 2026-06-23
**PR:** #12 (`fix/driver-dispatch-fcfs-deferred-routes`)
**Commits:** `81afc97` (FCFS rework) · `a9ea4bd` (anti-stuck-state test
coverage) · `4b6ecb1` (retry cap + double-tap guard)
**Type:** Out-of-band defect fix (not a planned Phase 10 turn —
uncovered during pre-cutover driver dogfooding).
**Precedent:** Same out-of-band shape as the driver/rider home
stale-location fix (`docs/PHASE_10_OOB_DRIVER_HOME_STALE_LOCATION.md`)
and the react-native-background-geolocation 4.19.4 → 5.1.1 upgrade
chore — a fix that landed between the Phase 10 turn cadence to clear a
real defect, documented per-fix rather than as a planned turn.

## Symptom

A driver who was online and tapped an available ("Incoming") ride saw
`DriverDispatchScreen` hang on **"Loading ride…"** for a long time
before accept/decline appeared — and if the network route call failed
it stayed in `'loading'` **forever** (no retry, no error state). The
driver could never accept.

## Root cause

The dispatch view-model gated the WHOLE screen on a synchronous
`TRAFFIC_AWARE` Google Routes call (driver→pickup directions) computed
_before_ accept. That call:

1. was on the critical path for the first paint, so a slow Routes
   response delayed accept/decline by its full round-trip; and
2. returned `null` on failure, which the VM mapped to `'loading'` with
   no retry and no error escalation — a permanent stuck state.

Two secondary problems the rework also closes:

- **Claims were not race-guarded.** The legacy claim used a Firestore
  transaction but did NOT guard status, so a second driver accepting an
  already-dispatched ride would silently overwrite the winner's
  assignment (lost-update / double-dispatch).
- **Every driver who opened a dispatch screen spent a Routes quota
  unit**, even the ones who declined or lost the race, because the
  route was computed pre-accept.

## Patch shape

The fix is three coordinated changes so the panel paints instantly and
the claim is genuinely first-come-first-served, plus two follow-up
hardening fixes.

### A. Atomic first-come-first-served claim

- New `RideRepository.transitionWithClaim({ rideId, expectedFromStatus, apply })`
  (`src/domain/repositories/RideRepository.ts`). The Firestore impl
  (`src/data/repositories/FirestoreRideRepository.ts`) uses
  `runTransaction` to re-read + status-guard INSIDE the transaction,
  returning `ConflictError('ride_already_taken')` on a lost race
  instead of clobbering the assignment. `permission-denied` maps to
  `AuthorizationError`; any other infra failure re-throws (programming
  error, per the Result-over-throw convention). The in-memory fake
  (`src/shared/testing/InMemoryRideRepository.ts`) mirrors the
  read → status-check → conflict-or-apply → notify contract.
- `Ride` entity (`src/domain/entities/Ride.ts`): the dispatch
  transition is split into directions-free `claimForDispatch` /
  `beginScheduledClaim` plus a separate `attachPickupDirections`
  (guarded on `'dispatched'`). The old `dispatch` / `beginScheduledRide`
  methods (which took `pickupDirections` up front) are **removed**.
- `DispatchRide` / `BeginScheduledRide` / `AcceptScheduledRide`
  (`src/app/usecases/ride/`) route through `transitionWithClaim`.
- The doc the winner writes is **byte-identical** to the prior `update`
  (`rideMapper.toDoc(...) + { merge: true }`), so there is **no
  Firestore-rules change** — this is an atomicity-only change.

### B. Google directions deferred to _after_ assignment

- `useDriverDispatchViewModel`
  (`src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts`)
  no longer computes the pickup route. The loading gate is just
  `user + ride`, which is what makes accept/decline paint instantly. A
  lost claim (`ConflictError`) flips to the existing **"Already taken"**
  panel; the ready panel shows Haversine distance.
- The WINNING driver computes + attaches the route post-claim via the
  new `useAttachPickupDirections` hook
  (`src/presentation/features/driver/hooks/useAttachPickupDirections.ts`)
  mounted inside `useDriverMonitorViewModel`, backed by the new
  `AttachPickupDirections` use case
  (`src/app/usecases/ride/AttachPickupDirections.ts`). Only the winner
  spends a Routes quota unit. Safe because `pickup.directions` is
  nullable and every consumer (`DispatchedView`, `EnRouteToPickupView`)
  already null-guards — a `dispatched` ride with no route yet is fully
  operable; the ETA fills in when the route lands.

### C. DriverHome — nearest-first, live distance

- `useDriverHomeViewModel`
  (`src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`)
  sorts available rides nearest-first by **live** GPS Haversine distance
  (`useGpsCurrentLocation`), re-ordering as the driver moves, while the
  Firestore availability subscription stays keyed on the **stable**
  foreground coord so it doesn't re-subscribe on every GPS tick.
  `formatMilesAway` was extracted to
  `@presentation/utils/formatDistance`.

### D. Bounded post-claim retry (follow-up, `4b6ecb1`)

`useAttachPickupDirections` clears its per-rideId latch on a no-route
attempt so a later GPS emit retries — but only up to
`MAX_ATTACH_ATTEMPTS` (3), after which it gives up at `warn`. Without
the cap, a _persistent_ Routes failure with GPS streaming recomputed on
every GPS emit indefinitely, burning a quota unit each time. Pickup
directions are best-effort (ETA-only), so giving up leaves the ride
fully operable. `FakeRoutesService` gained `seedPersistentError` to
test the cap (the existing `seedError` is one-shot).

### E. Double-tap claim guard (follow-up, `4b6ecb1`)

`onAccept` early-returns while a claim mutation is pending or has
already succeeded (`anyPending || anySuccess`). Without it, a rapid
second tap fired a second `transitionWithClaim` that re-read the
now-`dispatched` doc, missed the `awaiting_driver` guard, returned
`ConflictError`, and flipped the **winning** driver to the "Already
taken" panel. A genuine rival-lost-race still correctly flips to
`'gone'`.

## Verify gates

```
$ npm run verify   # typecheck + lint + format:check + jest — all green
                   # 2061 tests / 224 suites
```

New / extended tests:

- `FirestoreRideRepository.transitionWithClaim` — win / conflict /
  not-found / permission-denied→Authorization / infra-rethrow.
- `InMemoryRideRepository.transitionWithClaim` — lost-race re-claim
  exercises the real conflict branch (no false-green).
- `useAttachPickupDirections` — happy path, already-has-directions
  no-op, no-location no-op, compute-fail-then-retry-on-next-GPS-tick,
  attach-fail-swallow (rider cancelled mid-window), and the
  persistent-failure attempt cap.
- `useDriverDispatchViewModel` — lost-race → `'gone'` without
  navigating, and the double-tap → no-op (no spurious `'gone'`).
- `useDriverHomeViewModel` — nearest-first live ordering.
- `Ride` entity — `claimForDispatch` / `beginScheduledClaim` /
  `attachPickupDirections` transitions + illegal-transition rejections.

Reviewed by the repo's `architecture-reviewer` (clean — all layer/
convention invariants verified) and a general-purpose correctness
reviewer (no Critical/Important after the follow-up test + fix commits).

## What this fix does NOT do — deferred

- **Use-case / repository-level claim idempotency.** The double-tap
  case is handled at the VM (the `onAccept` guard prevents the spurious
  second claim) rather than by reclassifying a self-conflict as success
  in `transitionWithClaim` / the use cases. The lighter guard was
  chosen deliberately for a "very unlikely" edge case; if a self-
  conflict ever arises despite the guard (e.g. lost in-flight state),
  the winner would still see "Already taken." Revisit only if observed.
- **Time-based backoff for the post-claim retry.** A fixed attempt cap
  is sufficient and simpler (no timers / fake-timers); directions are
  best-effort.
- **Device validation.** Maestro check on the Android driver client
  (instant accept/decline, live nearest-first ordering, loser "Already
  taken", post-claim pickup polyline) and confirming the deployed
  `yeapp-stage` Firestore rules accept the claim writes (expected —
  identical write shape) belong to `PHASE_10_CUTOVER_PLAN.md`'s manual
  pass.

## Acceptance criteria — checked

- ✅ `DriverDispatchScreen` paints accept/decline as soon as the ride
  doc + driver profile resolve — no pre-accept Google Routes call.
- ✅ Concurrent claims: exactly one driver wins; the loser sees "Already
  taken" and the winner's assignment is never clobbered
  (`transitionWithClaim` status-guard inside `runTransaction`).
- ✅ Only the winning driver computes the driver→pickup route
  (post-claim, on the monitor).
- ✅ A slow/failed Routes call never blocks claiming or operating the
  ride; the post-claim attach retries on GPS ticks, capped at
  `MAX_ATTACH_ATTEMPTS`.
- ✅ Winner double-tap is a no-op (no spurious "Already taken").
- ✅ Available rides sort nearest-first and re-order as the driver
  moves; the Firestore subscription doesn't churn per GPS tick.
- ✅ No Firestore-rules change — claim write shape matches the prior
  `update`.
- ✅ `npm run verify` clean; no test regressed (2061 / 224).
- ✅ `CLAUDE.md` opener references this doc; the entity-transition
  example + Critical files table rows (`Ride.ts`,
  `FirestoreRideRepository.ts`, `useDriverMonitorViewModel.ts`,
  `useDriverDispatchViewModel.ts`, `useAttachPickupDirections.ts`)
  reflect the new claim API; `docs/PATTERNS.md` "Driver-side specifics"
  documents the FCFS claim, deferred directions, double-tap guard, and
  nearest-first ordering.

## Native rebuild

**Not required.** This fix changes only TypeScript under
`src/domain/`, `src/app/`, `src/data/`, `src/presentation/`,
`src/shared/testing/`, and the doc set. No `app.config.ts`, no
`package.json`, no `plugins/*`, no Podfile, no Gradle.

---

**End of PHASE_10_OOB_DRIVER_DISPATCH_FCFS.md.**
