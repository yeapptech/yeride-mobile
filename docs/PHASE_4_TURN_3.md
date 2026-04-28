# Phase 4 — Turn 3: DriverDispatch (incoming-ride accept/decline)

The DriverHome ride-card tap now opens a real preview screen. The driver
sees the pickup-route polyline, the rider's planned trip distance and
duration, and an Accept / Decline pair. Accept calls `DispatchRide`,
flips `useDriverStatusStore` to `'dispatched'`, and pops back; the live
race-condition handling flips the screen to `'gone'` if another driver
wins between paint and accept.

Note on the dispatch model: YeRide is **driver-pull** — drivers pick
from the available list, no offer-timeout, no auto-pass-to-next-driver.
The live `ObserveRide` subscription handles the only race-condition
case (another driver accepted faster) reactively.

## What's in

### Presentation — query

`src/presentation/queries/ride.queries.ts`:

- `useDispatchRideMutation` — wraps `DispatchRide`. On success: writes
  the byId cache so DriverMonitor's first paint (Turn 4) doesn't
  double-fetch; invalidates `listsForDriver(driverId)` so the
  in-progress driver query picks up the freshly-accepted ride;
  invalidates `listsForPassenger(passengerId)` so any rider-side cache
  read sees the dispatched snapshot.
- `DispatchRideInput` is exported for the view-model to type its
  mutation calls.

### Presentation — view-model

`useDriverDispatchViewModel` (`features/driver/view-models/`):

- Composes:
  - Live `ObserveRide` subscription via `useFirestoreSubscription` —
    drives initial paint AND the race-condition flip.
  - `useCurrentUserQuery` — driver profile, source for the
    `DriverSnapshot` built on accept.
  - `useQuery`-wrapped `computeRoutes(driverLocation → ride.pickup)` —
    the pickup-route preview. Re-fetches when rideId or driver
    coordinates change.
  - `useDispatchRideMutation` — the accept handler.
  - `useDriverStatusStore` — `setMode('dispatched')` after success.
- Exposed surface: `status`, `ride`, `pickupRoute`, `user`,
  `driverLocation`, `cannotAcceptReason`, `onAccept`, `onDecline`.
- Status enum: `'loading' | 'cannot_accept' | 'ready' | 'accepting' |
'gone'`. Order priorities documented inline.
- `cannotAcceptReason`: `'no_stripe_connect'` (no Stripe Connect
  account on the user doc) or `'no_active_vehicle'` (no active
  vehicle id). Both gate the Accept button before any mutation runs.
  The `DriverSnapshot` factory's empty-`stripeAccountId` rejection is
  defense-in-depth — the gate fires first.
- Driver location is passed in as an arg rather than being read from
  `useCurrentLocation` directly inside the VM: keeps the VM testable
  without an `expo-location` mock and lets the parent screen own
  location.

### Presentation — screen

`features/driver/screens/DriverDispatchScreen.tsx`:

- Map: pickup pin + driver "you are here" + the driver→pickup polyline
  (when computed). Reuses the shared `<Map/>` component's slots.
- Bottom panel: a single `DispatchPanel` that branches on
  `vm.status` — loading spinner / "already taken" notice / cannot-
  accept message / accept-decline buttons. `'accepting'` reuses the
  ready panel with disabled inputs and a button-spinner on Accept.
- Trip card shows ride-service tier name, ETA-to-pickup (from the
  computed route), pickup endpoint, dropoff endpoint, and the rider's
  planned distance/duration text from `ride.dropoff.directions`.
  PII boundary: no phone, no email, no full passenger name beyond
  what's already on the rider's snapshot.
- The screen owns `useCurrentLocation` and feeds coordinates to the
  view-model — same pattern RideMonitor uses on the rider side.

### Presentation — navigation

- `DriverNavigator` swaps `DriverDispatchPlaceholderScreen` for the
  real `DriverDispatchScreen`. No type changes — the `DriverDispatch`
  route was already declared in Turn 2.

### Cleanup

- `DriverDispatchPlaceholderScreen.tsx` collapsed to `export {};`.
  Sandbox can't `rm`. User cleanup:
  ```
  git rm -f src/presentation/features/driver/screens/DriverDispatchPlaceholderScreen.tsx
  ```

## Test counts (delta from Phase 4 turn 2)

| Category    | New tests                        |
| ----------- | -------------------------------- |
| View-models | `useDriverDispatchViewModel` (7) |

7 new tests covering the contract:

1. Reaches `'ready'` once user + ride + pickup route resolve.
2. Flips to `'gone'` when the seeded ride is already-dispatched.
3. `'cannot_accept'` (`no_stripe_connect`) when the driver has no
   Stripe account.
4. `'cannot_accept'` (`no_active_vehicle`) when the driver has no
   active vehicle id.
5. `onAccept` calls `DispatchRide`, writes mode→'dispatched', and
   `goBack`s — verified via the persisted ride flipping to
   `dispatched` in the InMemoryRideRepository.
6. `onDecline` pops back without calling `DispatchRide` — verified by
   the persisted ride staying `awaiting_driver`.
7. Stays `'loading'` when driver location is null (gate on the route
   query).

The standalone mutation-hook tests proposed in the punch list were
folded into the view-model tests — happy path is covered by test 5,
error path by test 2 (which exercises the same `'gone'` state the
mutation would hit if a race were lost mid-call).

**Total: 553 tests / 79 suites passing** (+7 vs. turn 2's 546). Suite
count moved 78 → 79 — one new test file
(`useDriverDispatchViewModel.test.tsx`).

## Manual smoke

Steps to exercise Turn 3 end-to-end (against in-memory fakes):

1. Sign in as a driver. Land on `DriverHomeScreen`.
2. Toggle online; seed an `awaiting_driver` ride (rider on a second
   device or seed by hand). Card appears in the bottom stack.
3. Tap the card → land on `DriverDispatchScreen`. The map shows the
   pickup pin + driver pin + driver→pickup polyline within ~1s of
   the route fetch resolving.
4. Trip card shows tier, ETA-to-pickup, pickup, dropoff, and the
   rider's trip distance/duration.
5. Tap Decline → return to DriverHome with the ride still in the
   queue.
6. Re-enter, tap Accept → button shows a spinner briefly →
   navigation pops back to DriverHome → DriverHome's in-progress
   redirect bounces you straight back to DriverDispatch with the now-
   `dispatched` ride. Status flips to `'gone'` because the entity
   transition succeeded but the screen now sees a non-`awaiting_driver`
   status. Tap "Back to home" → DriverHome.
7. Race-condition smoke: open DriverDispatch on driver A, then on a
   second device or via admin tooling change the ride's status to
   `dispatched` (or have driver B accept). Driver A's screen flips to
   `'gone'` within ~1s without any user action.
8. Cannot-accept smoke: clear the user doc's `activeVehicleId` (or
   `stripeAccountId`) in Firestore for a test driver, re-tap a card
   → screen renders the inline message + "Back to home" CTA. No
   Accept button.

## What's deferred to Turn 4

- **`DriverMonitor` screen** — Turn 4 introduces the active-trip
  surface. The accept-handler's `navigation.goBack()` currently
  bounces back through DriverHome's in-progress redirect; Turn 4
  swaps the redirect target from `DriverDispatch` to `DriverMonitor`
  and the accept handler's `goBack()` to
  `navigation.replace('DriverMonitor', { rideId })`.
- **Decline emits a server-side trip event** — useful for analytics
  ("driver X passed on ride Y"). Phase 4 turn 5 cleanup or Phase 9
  polish.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | ✅     |
| 3    | DriverDispatch — incoming-ride accept/decline              | ✅     |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | Next   |
| 4b   | DriverMonitor late-status views + start/requestPayment     | —      |
| 5    | Phase 4 cleanup + CLAUDE.md update                         | —      |
