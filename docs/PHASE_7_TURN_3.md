# Phase 7 — Turn 3: RideMonitor + DriverMonitor swap-ins + Phase 7 close

The two view-models that have been carrying placeholder geofence /
odometer plumbing since Phase 3 (rider) and Phase 4 (driver) are now
fully wired to the live GPS pipeline. AppContent's single
`useGpsLifecycle` mount is the producer; both view-models are
consumers via `@presentation/stores` selector hooks. The
foreground-tick path and the `stubOdometerMeters` helper are retired.
Phase 7 closes here.

End of turn: **152 suites / 1171 tests passing**, **+0 suites / +9
tests** on top of Turn 2's 152/1162 — at the low end of the kickoff's
"~+10 to +15 tests" estimate band because the swap-ins land in two
existing test files rather than spawning new ones. typecheck + lint +
format + test all green.

## What's in

### 1. `useRideMonitorViewModel` — event-driven banner

`src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`.
The geofence tick that ran `EvaluateExitWarning` against
`useCurrentLocation()` on every render during `'dispatched'` is gone.
In its place: a single `useEffect` keyed on `useGpsLastGeofenceEvent()`
(from `useGpsStore`) plus the live ride status. The effect's invariants:

- **Status gate.** Only fires while `status === 'dispatched'`. Other
  statuses dismiss the banner unconditionally (defensive — covers a
  stale `true` surviving a server-side flip out of dispatched).
- **Identifier gate.** Only `event.identifier === 'pickup'` events
  drive the banner. A future `'dropoff'` geofence (Phase 9 candidate)
  won't accidentally light up the pickup surface.
- **Action gate.** `EXIT` → `showPickupExitWarning()`; `ENTER` →
  `dismissPickupExitWarning()`.
- **Replay guard.** A `useRef<number | null>` keyed on
  `event.timestampMs` guards against re-handling the same event across
  re-renders. The ref is cleared when the status leaves dispatched so
  a re-entry into dispatched on a subsequent ride starts fresh.

`useCurrentLocation` is no longer imported by this VM. The hook
itself stays in place — RiderHome / DriverHome / RouteSearch still
use it for the initial map centre. Phase 9 polish can audit whether
those should switch to `useGpsCurrentLocation()` from the store.

`EvaluateExitWarning` (the pure-domain predicate use case) is no
longer instantiated here either, but it stays in the codebase. It's
still useful for distance-based fallback testing and for any future
"you're X metres away" surface.

### 2. `useDriverMonitorViewModel` — `arrivedAtPickup` derived

The stored `useState<boolean>` is gone. The display flag is now:

```ts
const fromGps = useGpsIsInsidePickupGeofence();
const [manualOverride, setManualOverride] = useState<boolean>(false);
const arrivedAtPickup = fromGps || manualOverride;
```

`onArriveAtPickup()` flips the manual override. `onBackToEnRoute()`
clears it. The reset effect that watched `ride.status` now resets
`manualOverride` (instead of `arrivedAtPickup`) when the ride leaves
`'dispatched'`.

The OR semantics deliberately let the override stick even when GPS
later reports `EXIT` — covers the case where the driver has actually
arrived but cellular dead zones / GPS drift trigger a spurious exit.
Once the trip transitions out of dispatched (driver pressed Start
ride or cancel), the override resets so a fresh trip starts clean.

### 3. `useDriverMonitorViewModel` — real odometer

`stubOdometerMeters(currentRide)` is gone. Replaced by:

```ts
const currentOdometerMeters = useGpsCurrentOdometer();
```

Both `onStartRide()` and `requestPayment()` mutations now pass
`currentOdometerMeters` as `odometerMeters`. The Cloud Function's
server-side fare math sees real GPS-derived distance instead of the
`pickup + 1` placeholder.

Staleness: the value is the most-recent SDK delivery, gated by
`distanceFilter: 200` (so ≤200m / ~30s old). We deliberately don't
call `bgGeolocation.getOdometer()` at click time to avoid an `await`
on the user-facing tap; the freshness/responsiveness trade is
documented in the VM's docstring and can be revisited in Phase 9.

Pre-first-delivery default: `useGpsCurrentOdometer()` defaults to
`0`. The `Ride.start({odometerMeters: 0})` entity transition accepts
that value (any non-negative finite reading is a valid first
odometer). The `Ride.requestPayment({odometerMeters})` monotonicity
check requires `odometerMeters >= pickupTiming.odometerMeters` — in
practice the SDK has fired several deliveries between Start ride
and Request payment, so the values are already ratcheting upward;
the default-zero only matters at Start ride.

### 4. Test updates (+9 tests across 2 existing files)

**`useRideMonitorViewModel.test.tsx` — +5 tests.** Dropped the
`expo-location` mock (the VM no longer reads foreground location).
Added a `useGpsStore.getState().reset()` +
`useGeofenceUiStore.getState().reset()` to `beforeEach`. New
`describe('pickup geofence banner (Phase 7 turn 3)', ...)` block
covers:

- EXIT during `'dispatched'` → `pickupExitWarningVisible` = true
- ENTER after EXIT → banner dismisses
- EXIT during `'awaiting_driver'` → banner stays hidden (status gate)
- Status leaving dispatched while banner is visible → defensive
  dismiss
- Non-`'pickup'` identifier event → ignored

A new `makeDispatchedRide()` test helper (uses `Ride.fromProps` with
`status: 'dispatched'` and `driver: null` — the rider banner doesn't
care about the driver snapshot) keeps the seed concise. A
`bgGeofenceEvent(action, identifier?)` helper builds events with a
monotonically increasing `timestampMs` so the replay guard doesn't
swallow back-to-back same-action events in tests.

**`useDriverMonitorViewModel.test.tsx` — +4 tests, 2 updated.**
Added `useGpsStore.getState().reset()` to `beforeEach`. New
`bgLocationEvent(odometerMeters)` and `bgGeofenceEvent(action,
identifier?)` helpers.

Two existing tests updated to seed real GPS data:

- `onStartRide()`: seeds `bgLocationEvent(2_500)` before mutation;
  asserts `persisted.value.pickupTiming.odometerMeters === 2_500`
  (proves real GPS data flowed through, not the stub).
- `requestPayment()`: seeds `bgLocationEvent(6_000)` before
  mutation (start was at 1_000, monotonicity check requires ≥1_000);
  asserts `persisted.value.dropoffTiming.odometerMeters === 6_000`.

New `describe('arrivedAtPickup auto-flip (Phase 7 turn 3)', ...)`
block covers:

- ENTER → `arrivedAtPickup = true`, status flips to `'at_pickup'`,
  no server write
- EXIT (no manual override) → flips back to false
- Manual override holds across a subsequent EXIT (resilience path)
- Status leaving dispatched resets the manual override

The existing "writes location once per fresh coordinate (dedup ref)"
test is **retained** — the VM's foreground location push remains in
place this turn. See "Why this turn doesn't include" below.

### 5. Documentation

- `docs/PHASE_7_TURN_3.md` — this file.
- `docs/PHASE_8_KICKOFF.md` — the next-phase kickoff (Google
  Navigation SDK driver in-app navigation), staged so the next
  session has a clean entry point.
- `CLAUDE.md` — Phase 7 → ✅ across both phase tables, end-of-Phase-7
  acceptance paragraph, Phase 8 → Next, test counts bumped, Critical
  files cheat-sheet refresh. The "Driver-side specifics (Phase 4)"
  section's `arrivedAtPickup` and `stubOdometerMeters` notes now
  reflect the swap as Phase 7's product rather than pending.

## Why this turn doesn't include

- **Foreground location push removal in `useDriverMonitorViewModel`
  (lines 218-248).** The VM still has its own
  `lastWrittenCoordsRef`-deduped foreground location push that fires
  `useUpdateLocationMutation` per fresh `driverLocation` prop. Turn 2
  added a parallel write path from `useGpsLifecycle` to the same
  mutation per SDK delivery. This is a double-write — both paths
  converge on the same `locations/{userId}` Firestore doc, but the
  redundancy is real. We deliberately defer removal to Phase 9 polish
  for two reasons:
  1. The kickoff scope is silent on it; lifting it now would expand
     the diff and require a screen API change (the `driverLocation`
     prop becomes unused).
  2. Field telemetry on the new SDK-driven path should land first.
     If the SDK's `distanceFilter: 200` proves too coarse for the
     map's real-time cursor, we'd want the foreground path back.

  An explicit TODO is **not** added to the VM — the duplication is
  visible from the imports list and CLAUDE.md flags it under
  "Driver-side specifics (Phase 4)".

- **"Open Settings" CTA UI on permission denial.**
  `useGpsPermissionStatus` is populated; the deep-link to system
  settings on `'denied' | 'when_in_use'` is Phase 9 polish.

- **`resetOdometer()` per ride start.** The adapter exposes the
  method but Turn 3 doesn't call it. The cumulative session odometer
  is fine for Phase 7's monotonicity checks; Phase 9 can decide if
  trip-start should reset.

- **AppState foreground-resume listener.** SDK manages its own
  foreground/background lifecycle (kickoff Decision 9).

- **Driver-side EXIT warnings** ("you're leaving without starting /
  completing"). Out of Phase 7 scope per the original kickoff.

- **`useCurrentLocation` audit beyond `useRideMonitorViewModel`.**
  RiderHome / DriverHome / RouteSearch still use the foreground hook
  for the initial map centre. Whether they should switch to
  `useGpsCurrentLocation()` is a Phase 9 judgement call (the GPS
  store may not be populated by the time those screens mount).

- **Phase 8 implementation.** Turn 3 only writes the kickoff document;
  the actual Navigation-SDK work is the next session.

## Risks surfaced

### Pre-first-delivery odometer at Start ride

If the driver taps `Start ride` in the same second as the SDK starts
(unlikely — the SDK fires its first delivery within a few seconds of
`start()`), `useGpsCurrentOdometer()` could return `0`. The entity's
`start({odometerMeters: 0})` accepts that — any non-negative finite
reading is a valid first odometer. The risk surfaces as a slightly
short fare on a trip where the driver was already moving during
pickup. Field telemetry can quantify; Phase 9 can decide whether to
gate Start ride on a populated odometer or call `getOdometer()` at
click time.

### `act` warnings in tests

The two VM test files print TanStack Query notification settling
warnings ("An update to HookContainer inside a test was not wrapped
in act"). These come from the test framework's collision with
TanStack's batched notify scheduler, not from production code.
Pattern matches Phase 6 + Phase 7 turn 2 VM tests; not a regression.

### Worker-process leak warning at end of `npm test`

Pre-existing from Phase 7 turn 1 — the SDK fake's listener buckets
retain references after tests finish. The fake's `removeAllListeners`
is called in cleanup, but the underlying global jest mock from Turn
1 keeps a small registry. Non-fatal; flagged for Phase 9 polish.

### Manual override + simultaneous geofence flip

If the driver taps "Arrived at pickup" while GPS is reporting
`inside`, the override flag flips `true` but has no visible effect
(both halves of the OR are already `true`). On a subsequent `EXIT`,
the override carries the at-pickup state forward — the desired
resilience behaviour. On the rare case where the driver wants to
re-enter en-route (e.g. they walked out of the pickup area to find
the rider), tapping "Back to en-route" resets the override; if GPS
still reports `inside`, the OR keeps `arrivedAtPickup` true. That's
intentional — the GPS truth wins when there's no override on top.

### Double-write to `locations/{userId}` until Phase 9

Documented above. Both paths converge to the same Firestore doc; the
SDK-driven path is rate-limited at 200m, the VM path is per-render-
with-fresh-coord. Harmless but real until cleanup.

## Acceptance

`npm run verify` (typecheck + lint + format + test) all green at
end of turn. **152 test suites / 1171 tests** (+9 tests over Turn
2's 152/1162; suite count unchanged because both swaps land in
existing files).

Phase 7 close criteria, all met:

1. ✅ Rider on a `'dispatched'` trip who walks out of the pickup
   area sees the banner from a real geofence EXIT event (no
   foreground poll). Walking back in dismisses automatically.
2. ✅ Driver who accepts a ride sees `AtPickupView` automatically
   replace `EnRouteToPickupView` once the geofence reports inside.
   Manual button retained as resilience override.
3. ✅ Driver `Start ride` / `Request payment` mutations carry real
   SDK-derived odometer through to the entity (and the Cloud
   Function's fare math).
4. ✅ Test suite green; the rider + driver VM test files cover the
   new GPS-store-driven paths via the canonical
   `useGpsStore.setX()` driving pattern.
5. ✅ `CLAUDE.md` and `docs/PHASE_7_TURN_*.md` records up to date.
6. ✅ `docs/PHASE_8_KICKOFF.md` staged for the next session.

## Files added / touched this turn

**Added:**

- `docs/PHASE_7_TURN_3.md` (this file)
- `docs/PHASE_8_KICKOFF.md`

**Touched:**

- `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`
  — drop `EvaluateExitWarning` + `useCurrentLocation`; add
  `useGpsLastGeofenceEvent`-driven event-effect with `timestampMs`
  replay guard
- `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`
  — drop `expo-location` mock; reset stores in `beforeEach`; add
  pickup-geofence-banner describe block (5 tests); add
  `makeDispatchedRide` + `bgGeofenceEvent` helpers
- `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
  — `arrivedAtPickup` becomes derived (`useGpsIsInsidePickupGeofence()
|| manualOverride`); replace `stubOdometerMeters` helper with
  `useGpsCurrentOdometer()` selector hook; both mutations pass real
  odometer through
- `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`
  — reset `useGpsStore` in `beforeEach`; seed `bgLocationEvent` for
  the two odometer-sensitive tests; add `arrivedAtPickup auto-flip`
  describe block (4 tests); add `bgLocationEvent` +
  `bgGeofenceEvent` helpers
- `CLAUDE.md` — Phase 7 → ✅ across both phase tables; end-of-Phase
  acceptance paragraph for Turn 3; Phase 8 → Next; test counts
  bumped; Critical files cheat-sheet refresh; Driver-side specifics
  notes updated
