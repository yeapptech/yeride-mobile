# Phase 4 — Turn 4a: DriverMonitor scaffold + early-status views

The active-trip surface lands here. A driver who taps Accept on
DriverDispatch (turn 3) now `replace`s into a real `DriverMonitorScreen`:
top-half map showing pickup + dropoff + the driver→pickup polyline,
bottom-half `@gorhom/bottom-sheet` with a status-router that picks which
view to render based on `Ride.status` plus a single client-side
`arrivedAtPickup` flag. En-route-to-pickup and at-pickup states are
wired; started / payment / completed / payment_failed land in 4b along
with their views.

The split-turn proves the harness on real iOS + Android before piling
more status views into it — same approach as the rider-side 3.4a / 3.4b
split.

## What's in

### Presentation — query

`src/presentation/queries/ride.queries.ts`:

- `useCancelRideAsDriverMutation` — wraps `CancelRideByDriver`. Mirrors
  the rider-side `useCancelRideAsRiderMutation` but routes through the
  driver-allowed code set. The use case rejects `'driver_no_show'` with
  `cancellation_reason_not_driver_allowed`; the view-model surfaces the
  error message via `cancelError`. Cache effects: byId set; both
  `listsForDriver(driver.id)` and `listsForPassenger(passenger.id)`
  invalidated on success so neither side's resume queries hold a stale
  reference to the now-terminal ride.

### Presentation — view-model

`useDriverMonitorViewModel` (`features/driver/view-models/`):

- Composes:
  - Live `ObserveRide` via `useFirestoreSubscription` — source of truth
    for status transitions.
  - Live `ObserveTripEvents` primed in 4a so 4b's events panel is a
    pure rendering add. Returned but not yet consumed.
  - `useUpdateLocationMutation` with the same `lastWrittenCoordsRef`
    dedup pattern as `useDriverHomeViewModel`. Phase 7 swaps the
    foreground source for `useGpsLifecycle`.
  - `useCancelRideAsDriverMutation` — exposes `cancel({reason,
odometerMeters?})` returning `Promise<boolean>`.
  - `useDriverStatusStore.setMode` mirror, driven from `Ride.status`:
    - `dispatched` / `scheduled_driver_accepted` → `'dispatched'`
    - `started` / `payment_requested` / `payment_failed` / `completed`
      → `'on_trip'`
    - `cancelled` → `'online_idle'` (driver re-joins the queue)
- Surface: `ride`, `status`, `events`, `arrivedAtPickup`,
  `isCancelling`, `cancelError`, `onArriveAtPickup`,
  `onBackToEnRoute`, `onStartRide`, `cancel`.
- Status enum: `'loading' | 'en_route_to_pickup' | 'at_pickup' |
'future_status_fallback' | 'cancelled' | 'gone'`. The
  `'future_status_fallback'` covers `started` /
  `payment_requested` / `payment_failed` / `completed` server statuses
  until 4b lands their views.
- Driver location is passed in as an arg (the screen owns
  `useCurrentLocation`) — same testability seam DriverDispatch uses.
- `arrivedAtPickup` UI flag bridges server status `'dispatched'` to the
  UI's `'en_route_to_pickup'` ↔ `'at_pickup'` distinction. Phase 7's
  geofence-entry event will auto-flip; in 4a it's a manual button tap.
  The flag resets whenever the ride leaves `dispatched` so a
  defensive re-render in a later state doesn't render a stale at-pickup
  view.
- `onStartRide` is a Turn 4a stub: `LOG.warn` + `Toast.show("Coming in
Turn 4b")`. Real `useStartRideMutation` lands in 4b alongside the
  `StartedView`.
- Terminal redirect on `cancelled`: `navigation.reset({index: 0, routes:
[{name: 'DriverTabs'}]})`. Mirror of `useRideMonitorViewModel`'s
  rider-side reset, with the same `redirectedRef` guard so a re-render
  with the same terminal status doesn't double-fire.

### Presentation — feature components

`features/driver/components/`:

- `EnRouteToPickupView` — dispatched-but-not-arrived view. Header with
  ETA-to-pickup pulled from `ride.pickup.directions` (set by the
  dispatch use case at accept time), distance subtitle, destructive
  cancel button. Sanitized passenger card (first name + last initial
  only — same PII boundary as the rider-side `DispatchedView`'s driver
  card; no email, no phone). Pickup endpoint card. Primary CTA
  "Arrived at pickup" → flips the parent into the `'at_pickup'` UI
  state. No "Navigate" button — Google Navigation SDK is Phase 8.
- `AtPickupView` — UI-only intermediate state during server status
  `dispatched`. Header "Pick up your passenger" + sub. Sanitized
  passenger + pickup cards. Primary CTA "Start ride" → calls
  `onStartRide()` (stub). Cancel button in the header (driver-only
  `'passenger_no_show'` code via the screen's stub helper). Secondary
  link "Not quite there yet — go back" → `onBackToEnRoute()` so a
  premature arrival flip can be reversed (UI-only — no server write).

### Presentation — screen

`features/driver/screens/DriverMonitorScreen.tsx`:

- Outer/inner split for the typed `RideId.create()` guard (mirrors
  `DriverDispatchScreen` and `RideMonitorScreen`).
- `<Map>`: pickup pin (always when `ride` resolved), dropoff pin
  (visible from dispatch onward so the driver sees where they're
  headed), driver pin from `useCurrentLocation`, driver→pickup
  polyline from `ride.pickup.directions` while status is `dispatched`.
  Pool of children stays fixed-size — visibility flows via props per
  the always-mounted-children rule.
- `BottomSheet` snap points 25 / 50 / 90 mirror the rider-side
  RideMonitor. `enablePanDownToClose: false`, `keyboardBehavior:
'interactive'`.
- Status-router branches on `vm.status`: loading → spinner;
  `'en_route_to_pickup'` → `EnRouteToPickupView`; `'at_pickup'` →
  `AtPickupView`; `'future_status_fallback'` → "More to come (Turn
  4b)" placeholder; `'cancelled'` / `'gone'` → quiet "Wrapping up…"
  (the VM redirects so this is a one-frame fallback).
- **Cancel-button stub for 4a**: each early-status view's header
  cancel button → `Alert.alert("Cancel ride?", …, [Keep ride, Cancel
ride])` → on confirm, builds a `CancellationReason` with a hard-coded
  driver-allowed code per status and calls `vm.cancel`.
  `EnRouteToPickup` uses `'changed_mind'` (common code, driver may use);
  `AtPickup` uses `'passenger_no_show'` (driver-only). Full per-reason
  picker modal lands in 4b.

### Presentation — navigation

- `types.ts` — adds `DriverMonitor: { rideId: string }` to
  `DriverStackParamList`. Preamble comment refreshed to reflect that
  4a now ships the route.
- `DriverNavigator.tsx` — registers the `DriverMonitor` screen with
  `title: 'Active ride'`, `headerBackVisible: false` (the driver should
  not be able to back out of an active trip mid-flight via the system
  back button).
- `useDriverHomeViewModel.ts` — both the `useFocusEffect` resume
  redirect and `onResumeInProgress` now navigate to `DriverMonitor`
  unconditionally. The status-router inside DriverMonitor handles every
  active state, so DriverHome doesn't need to branch.
- `useDriverDispatchViewModel.ts` — `onAccept`'s success path replaced
  `goBack()` with `navigation.replace('DriverMonitor', { rideId })`.
  Replace (not push) so back-nav goes to DriverHome rather than
  bouncing the driver into the now-stale dispatch screen.

### Test updates

- `useDriverHomeViewModel.test.tsx` — the in-progress redirect test
  asserts `navigate('DriverMonitor', …)` instead of
  `navigate('DriverDispatch', …)`. Title changed to match.
- `useDriverDispatchViewModel.test.tsx` — adds `mockReplace` to the
  `useNavigation` mock; the accept-success test asserts
  `replace('DriverMonitor', { rideId: String(RIDE_ID) })` and that
  `goBack()` is NOT called.

## Test counts (delta from Phase 4 turn 3)

| Category    | New tests                       |
| ----------- | ------------------------------- |
| View-models | `useDriverMonitorViewModel` (8) |

8 new tests covering the contract:

1. Stays in `'loading'` until the ride subscription emits.
2. Dispatched ride → `'en_route_to_pickup'` and the store mode flips
   to `'dispatched'`.
3. `onArriveAtPickup()` flips status to `'at_pickup'` without a server
   write — verified by checking the `update` spy stayed flat and the
   underlying ride is still `'dispatched'`.
4. Started ride → `'future_status_fallback'` and store mode flips to
   `'on_trip'`.
5. `cancel({reason})` calls the use case, persists `cancelled`, fires
   `navigation.reset` once with the `DriverTabs` route, and flips the
   store mode to `'online_idle'`.
6. Re-render in the `'cancelled'` state doesn't re-fire
   `navigation.reset` (redirectedRef guard works).
7. Foreground location push: a fresh coordinate writes once via the
   location repo; the same coordinate again does NOT write; a moved
   coordinate writes a second time (dedup ref).
8. Server-side flip to `'completed'` mid-session reaches
   `'future_status_fallback'`; no terminal redirect fires (only
   `'cancelled'` triggers the reset in 4a — `completed` redirect lands
   in 4b alongside the `CompletedView`).

**Total: 561 tests / 80 suites passing** (+8 vs. turn 3's 553). Suite
count moved 79 → 80 — one new test file
(`useDriverMonitorViewModel.test.tsx`).

## Manual smoke

Steps to exercise Turn 4a end-to-end (against in-memory fakes):

1. Sign in as a driver. Land on `DriverHomeScreen`. Toggle online; seed
   an `awaiting_driver` ride. Tap the card.
2. DriverDispatch opens. Tap Accept → button shows a spinner briefly →
   `navigation.replace` lands `DriverMonitorScreen` (no DriverHome
   interstitial — the replace skips the in-progress redirect bounce).
3. EnRouteToPickup view shows ETA-to-pickup pulled from the ride's
   pickup directions, distance subtitle, sanitized passenger name,
   pickup endpoint, and an "Arrived at pickup" CTA. Header cancel
   button is destructive-tinted.
4. Tap "Arrived at pickup" → AtPickup view renders with "Start ride"
   primary CTA, "Not quite there yet — go back" secondary link, and
   the same destructive cancel button. The map's polyline + pins stay
   put (server status is still `dispatched`).
5. Tap "Start ride" → Toast: "Starting trips coming soon — The
   Start-ride flow lands in Phase 4 turn 4b." The button is otherwise
   inert in 4a.
6. Tap "Not quite there yet — go back" → flips the bottom sheet back
   to EnRouteToPickup.
7. Tap header Cancel → Alert.alert "Cancel ride?" with reason-specific
   copy (en-route uses `changed_mind` copy, at-pickup uses
   `passenger_no_show` copy). Confirm → `cancelTrip` Cloud Function
   call → live subscription delivers `cancelled` → `navigation.reset`
   to DriverTabs lands. Driver returns to DriverHome with the queue
   visible again.
8. Cold-launch resume: driver with an in-progress dispatched ride
   re-opens the app → DriverHome's `useFocusEffect` fires → app
   navigates directly to DriverMonitor (no DriverDispatch
   interstitial).

## What's deferred to Turn 4b

- **`StartedView`** — rider-in-the-car surface. ETA-to-dropoff pulled
  from `ride.dropoff.directions`, swap the green pickup-route polyline
  for the gold dropoff-route on the map, "Request payment" SwipeButton
  CTA. Phase 7's dropoff-arrival geofence will gate visibility of the
  swipe; for 4b the driver can swipe at any point during `started`.
- **`PaymentRequestedView`** — brief intermediate state while the
  Stripe webhook flips `payment_requested → completed`. Read-only "Awaiting
  payment confirmation…" with a spinner and the running fare.
- **`CompletedView`** — fare summary + "Close trip" CTA →
  `navigation.reset` to DriverTabs. This adds the `completed` terminal
  redirect to the view-model.
- **`PaymentFailedView`** — read-only "Charge declined" + Phase 6 retry
  stub.
- **`useStartRideMutation` / `useRequestPaymentMutation`** hooks. The
  4a `onStartRide` stub becomes a real mutation.
- **`DriverCancelReasonSheet`** — full per-reason picker driven by
  `CancellationReason.isDriverCode`. Replaces the 4a `Alert.alert`
  stub on both early-status views; eliminates the hard-coded codes.
- Component-level rendering tests for the status views.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | ✅     |
| 3    | DriverDispatch — incoming-ride accept/decline              | ✅     |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | ✅     |
| 4b   | DriverMonitor late-status views + start/requestPayment     | Next   |
| 5    | Phase 4 cleanup + CLAUDE.md update                         | —      |
