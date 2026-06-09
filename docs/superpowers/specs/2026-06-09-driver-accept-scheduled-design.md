# Driver-Accept-Scheduled — Fill the Driver Home Scheduled Section

**Date:** 2026-06-09
**Status:** Approved design — ready for implementation plan
**Follows:** `2026-06-08-home-ride-list-design.md` (the "Phase 2 / Out of
scope here — separate plan" section of that spec is what this realizes).

## Problem

The home-ride-list work (PR #4, `87f774d`) shipped the rider side fully
and the driver **In-progress** section, but intentionally left the driver
**Scheduled** section empty: drivers cannot accept scheduled rides in the
rewrite yet. `HomeRideSections` already renders a Scheduled section;
`DriverHomeScreen` passes `scheduledRides={[]}`.

This spec adds the net-new driver-accept-scheduled capability so that
section fills, and carries it **end-to-end**: a driver discovers a
scheduled ride, accepts it, sees it in their Home Scheduled section, and —
when the pickup nears — **begins** it, dropping into the existing
DriverMonitor drive→pickup→start→complete flow.

## Decisions (settled with the product owner)

1. **Scope: full end-to-end.** Accept _and_ begin. Accepting alone (a
   read-only Scheduled section) would leave accepted rides un-drivable in
   the app; we ship the complete loop.
2. **Begin timing: anytime (legacy parity).** The "Begin trip" CTA is
   always available on an accepted scheduled ride; the driver decides
   when. No time gate, no countdown, no extra validation. Matches legacy
   `startTrip` (manual, ungated). With several accepted rides, the
   Scheduled section is sorted soonest-first and the driver taps whichever
   to begin.
3. **Begin lives in `DriverDispatch` (Approach A).** `DriverDispatch` is
   already the single-ride "act on this ride" screen — it takes a
   `rideId`, subscribes to the ride, computes the driver→pickup route, and
   shows an action CTA. All three driver actions branch on `ride.status`
   there. The **DriverMonitor is left untouched**: Begin flips the ride to
   `dispatched` _before_ the monitor mounts, so the existing
   `dispatched → started → payment_requested → completed` flow runs
   verbatim. (Rejected: extending the DriverMonitor status-router with a
   `scheduled_driver_accepted` case — it would touch the delicate monitor
   VM, its terminal-redirect rule, and add route-compute the monitor
   doesn't have. Rejected: a dedicated begin screen — most files, least
   reuse.)
4. **Reuse the existing available feed.** `subscribeAvailableRides`
   already queries `status in ['awaiting_driver', 'scheduled']` in both
   `FirestoreRideRepository` and `InMemoryRideRepository`, so scheduled
   rides already flow into the driver's available-rides feed. No new feed
   and no query change. (The Phase-2 planning memory anticipated building
   a separate scheduled feed; it turned out unnecessary.)
5. **Begin flips `scheduled_driver_accepted → dispatched` (deliberate
   deviation from legacy).** Legacy keeps a ride in
   `scheduled_driver_accepted` until `startTrip` flips it straight to
   `started`. The rewrite instead flips to `dispatched` on Begin, because
   the rewrite's `EnRouteToPickupView`/`AtPickupView` and `Ride.start()`
   are keyed off `dispatched`. Both apps tolerate the other's status doc
   (legacy renders `dispatched` as `DriverDispatchedView`), so data
   co-existence holds.
6. **No single-active enforcement.** Consistent with the home-ride-list
   decision and legacy `scheduleDriver` (which sets no `inProgressTrip`
   pointer): a driver may hold several accepted scheduled rides and may
   even begin one while another ride is in progress. Not blocked. The
   rewrite tracks assignment via the denormalized `ride.driver.id`, not a
   user-doc pointer.

## Goals

- Drivers see scheduled rides in their available-rides feed (already
  present) and can **accept** one → it becomes `scheduled_driver_accepted`
  with the driver snapshot denormalized onto the trip.
- Accepted scheduled rides appear in the **driver Home Scheduled section**,
  sorted soonest-first, with the "Scheduled for {time}" line.
- The rider's Scheduled card reflects `scheduled_driver_accepted` (already
  wired — `observeScheduledRidesByPassenger` includes that status).
- Drivers can **Begin** an accepted scheduled ride at any time → it flips
  to `dispatched` and enters the existing DriverMonitor flow.
- Section movement falls out for free: a begun ride leaves Scheduled and
  enters In-progress on **both** sides via the existing subscriptions.

## Non-goals

- A begin time gate / countdown (decided: anytime).
- A new "available scheduled rides" feed (decided: reuse existing).
- Single-active-ride enforcement / an accepted-ride queue beyond
  soonest-first sorting.
- A Cloud Function that auto-promotes `scheduled_driver_accepted →
dispatched` at the pickup time (legacy has none; begin is manual).
- Restyling DriverMonitor or its status-router views.
- Rider-side changes — the rider already handles `scheduled_driver_accepted`
  (Scheduled section) and `dispatched` (In-progress section).
- Re-scheduling an accepted ride, or transactional double-accept guarding
  beyond what immediate dispatch already does (last-write-wins, pre-existing).

## Design

### 1. Domain — two transitions + two thin use cases

**`Ride.acceptSchedule({ driver, at })`** (`src/domain/entities/Ride.ts`):
`scheduled → scheduled_driver_accepted`. Sets the `driver` snapshot only;
leaves `pickupTiming` and pickup directions null (matches legacy
`scheduleDriver`, which writes driver + status and nothing else). Illegal
from any status other than `scheduled` → `Result.err(ValidationError
ride_illegal_transition)`.

**`Ride.beginScheduledRide({ pickupDirections, at })`**: `scheduled_driver_accepted →
dispatched`. Attaches `pickup.withDirections(pickupDirections)` and sets
`pickupTiming.startedAt = at` — structurally the same write `dispatch`
performs, minus the driver (already set at accept time). Illegal from any
status other than `scheduled_driver_accepted`. After this, `Ride.start()`
works unchanged (its precondition is `dispatched`, and `elapsedSeconds` is
computed from `pickupTiming.startedAt`, which Begin set).

**`AcceptScheduledRide`** use case (`src/app/usecases/ride/AcceptScheduledRide.ts`),
args `{ rideId, driver }`: `getById → ride.acceptSchedule({ driver, at:
clock.now() }) → repo.update`. Mirrors `DispatchRide` (`getById →
transition → update`), including the `if (!r.ok) return r` sequencing. No
transaction (matches immediate dispatch). Driver eligibility (active
vehicle + Stripe) stays gated in the VM, as it is for immediate dispatch.

**`BeginScheduledRide`** use case (`src/app/usecases/ride/BeginScheduledRide.ts`),
args `{ rideId, pickupDirections }`: `getById → ride.beginScheduledRide({
pickupDirections, at: clock.now() }) → repo.update`. Same shape.

### 2. Data — one new observe + its fake

**`RideRepository.observeScheduledRidesByDriver({ driverId, callback })`**
(`src/domain/repositories/RideRepository.ts`) — subscription-shaped,
synchronous unsubscribe. Direct mirror of
`observeScheduledRidesByPassenger`, but for the driver and a single status:

- `FirestoreRideRepository`: `where('driver.id', '==', driverId)` +
  `where('status', '==', 'scheduled_driver_accepted')` `.onSnapshot(...)`.
  (Driver scheduled = only `scheduled_driver_accepted`; a driver never
  holds a bare `scheduled` ride — those are unaccepted/available.)
  Ordering not specified server-side; callers sort by `schedulePickupAt
asc` client-side, like the passenger method.
- `InMemoryRideRepository`: filter seeded rides by `driver?.id === driverId
&& status === 'scheduled_driver_accepted'`, emit on mutation, return
  synchronous unsubscribe. **Built first (TDD).**

The **available feed is reused unchanged** — `subscribeAvailableRides`
already includes `'scheduled'`.

### 3. Presentation

**DI** (`src/presentation/di/container.ts`): wire `acceptScheduledRide:
new AcceptScheduledRide(args.rides, clock)`, `beginScheduledRide: new
BeginScheduledRide(args.rides, clock)`, and the driver scheduled
subscription use case (see below) into `makeUseCases`. `TestContainerProvider`
is covered by the existing rides-repo injection.

**Driver scheduled subscription** — mirror the in-progress role-parameterized
pattern. `useInProgressRidesSubscription(userId, role)` already serves both
roles via one `ObserveInProgressRides` use case; generalize the scheduled
path the same way: `ObserveScheduledRides` becomes role-parameterized
(`execute({ userId, role, callback })`, delegating to
`observeScheduledRidesByPassenger` / `observeScheduledRidesByDriver`), and
`useScheduledRidesSubscription(userId, role)` gains the role arg. The
existing rider callers (Activity tab, rider Home) pass `'rider'`.
_(Implementation may instead add a sibling `ObserveScheduledRidesByDriver`
use case if the refactor of the working rider path proves riskier than a
near-duplicate — decided during planning; the repo method and the hook's
role arg are fixed either way.)_

**`useDriverHomeViewModel`** (`src/presentation/features/driver/view-models/`):
add `scheduledRides: readonly Ride[]` from
`useScheduledRidesSubscription(user?.id ?? null, 'driver')`, sorted
soonest-first. Branch the existing select handler on status:

```ts
onSelectRide(ride) {
  if (ride.status === 'scheduled_driver_accepted')
    navigation.navigate('DriverDispatch', { rideId: String(ride.id) }); // → Begin
  else
    navigation.navigate('DriverMonitor', { rideId: String(ride.id) });  // in-progress
}
```

**`DriverHomeScreen`**: pass `scheduledRides={vm.scheduledRides}` instead
of `[]`. `HomeRideSections`'s Scheduled section and `TripCard`'s
"Scheduled for {time}" line already exist — no component changes.

**`useDriverDispatchViewModel` / `DriverDispatchScreen`**: branch the CTA
label, the action, and the post-action navigation on `ride.status`:

| `ride.status`               | CTA                                       | Action                                                            | After                                  |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| `awaiting_driver`           | "Accept"                                  | `dispatchRide` (existing)                                         | `replace('DriverMonitor')`             |
| `scheduled`                 | "Accept scheduled ride for {pickup time}" | `acceptScheduledRide` (build `DriverSnapshot`, as accept does)    | `goBack()` → Home (lands in Scheduled) |
| `scheduled_driver_accepted` | "Begin trip"                              | `beginScheduledRide` (uses the route the screen already computes) | `replace('DriverMonitor')`             |

The `cannot_accept` gate (missing vehicle/Stripe) applies to the accept
paths exactly as it does for immediate dispatch.

Scheduled rides reached from the Home available overlay show their
"Scheduled for…" time via the existing `TripCard`; no separate section in
the available list (legacy parity — scheduled and immediate are merged).

## Testing

Build the in-memory fake before the Firestore method; write tests before
implementation (TDD), per the rewrite conventions.

- **Entity** (`Ride.test.ts`): `acceptSchedule` legal (`scheduled →
scheduled_driver_accepted`, driver set) + illegal from every other
  status; `beginScheduledRide` legal (`scheduled_driver_accepted →
dispatched`, pickup directions + `startedAt` set) + illegal from every
  other status; `start()` still works after `beginScheduledRide`.
- **Use cases**: `AcceptScheduledRide` / `BeginScheduledRide` delegate to
  the repo and propagate `Result` errors (not-found, illegal transition).
- **Fake**: `observeScheduledRidesByDriver` emits the seeded
  `scheduled_driver_accepted` rides for the driver, re-emits on mutation
  (accept adds a row; begin removes it), unsubscribe stops emissions, and
  does not leak another driver's rides.
- **Driver Home VM**: `scheduledRides` populates from the subscription and
  sorts soonest-first; `onSelectRide` routes `scheduled_driver_accepted` →
  `DriverDispatch` and in-progress statuses → `DriverMonitor`; the
  Scheduled section renders independent of location `status`.
- **DriverDispatch VM**: the three-way branch picks the right CTA/action/
  navigation per status; accept-schedule lands back on Home, begin and
  dispatch land on the monitor.
- **Maestro** (driver = Android): seed a `scheduled` ride in-area → it
  appears in the available list → accept → it appears in the driver Home
  Scheduled section → Begin → land in DriverMonitor. Update
  `e2e/maestro/README.md` / driver flow notes if they assert the empty
  Scheduled section.

## Files touched (anticipated)

**Domain:** `Ride.ts` (two transitions), `RideRepository.ts` (interface
method). `RideStatus.ts` unchanged (statuses already present).

**App:** `AcceptScheduledRide.ts`, `BeginScheduledRide.ts` (new);
`ObserveScheduledRides.ts` (role-parameterized, or a new sibling).

**Data:** `FirestoreRideRepository.ts`, `InMemoryRideRepository.ts`
(`observeScheduledRidesByDriver`).

**Presentation:** `container.ts` (wiring), `useDriverHomeViewModel.ts`,
`DriverHomeScreen.tsx`, `useDriverDispatchViewModel.ts`,
`DriverDispatchScreen.tsx`, the scheduled-subscription hook
(`ride.subscriptions.ts`) + its rider callers (pass `'rider'`). Plus the
corresponding test files.

**Docs/e2e:** `e2e/maestro/README.md` + driver flow if it references the
empty Scheduled section.

## Assumptions to verify during planning

- **Composite index** for `driver.id + status == 'scheduled_driver_accepted'`
  — the `driver.id + status` path is already exercised by
  `useInProgressDriverRideQuery`, so it likely exists; confirm before
  relying on it.
- The driver Home **available-rides overlay renders scheduled rides** from
  the feed (doesn't client-filter to `awaiting_driver` only) and tapping
  one navigates to `DriverDispatch`.
- The `DriverNavigator` **param list** lets `DriverDispatch` receive a
  `scheduled_driver_accepted` ride id (no status assumption in the route
  typing).
- **Trip-event / push side effects** of accept/begin match whatever
  immediate `dispatch` does today (legacy `scheduleDriver` writes a
  `scheduled_driver_accepted` trip event; confirm whether the rewrite
  writes trip events app-side or leaves them to Cloud Functions, and stay
  at parity).
- Whether to **generalize `ObserveScheduledRides`** to role-parameterized
  vs. add a sibling driver use case (risk of touching the working rider
  path vs. a near-duplicate).

## Legacy source of truth

`/Users/papagallo/yeapptech/dev/yeride/src/api/firebase/Trip.js`:

- `scheduleDriver(driverId, tripId)` (~`:586`) — transaction sets trip
  `status = 'scheduled_driver_accepted'` + denormalizes the driver; **no**
  `inProgressTrip` write; creates a `scheduled_driver_accepted` trip event.
- `subscribeAvailableRides` (~`:324`) — `where('status', 'in',
['awaiting_driver', 'scheduled'])` + service filter + 50-mi Haversine;
  scheduled and immediate merged in one list.

`/Users/papagallo/yeapptech/dev/yeride/src/driver/screens/DriverDispatch.js`
(~`:303`) — driver taps a ride; a `ride.status === 'scheduled'` branch
shows an "Accept Schedule Ride" confirm → `scheduleDriver`, no navigation
after. `DriverMonitor.js` (~`:664`) renders `scheduled_driver_accepted`
like `dispatched`; `startTrip` then flips to `started`.
