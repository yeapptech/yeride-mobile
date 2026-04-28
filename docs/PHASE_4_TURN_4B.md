# Phase 4 — Turn 4b: DriverMonitor late-status views + Start/RequestPayment

The driver-side trip surface is now full-fat. The harness from 4a covers
every `RideStatus` the driver is allowed to see; the at-pickup → started
mutation is wired through a real `useStartRideMutation`; the
started → payment_requested mutation is wired through a real
`useRequestPaymentMutation` (Cloud Function path); the cancel flow has
been promoted from a hard-coded `Alert.alert` to a full per-reason
`DriverCancelReasonSheet` modal.

The only Phase 4 work left after this turn is the cleanup pass in 4.5
(CLAUDE.md driver-side fold-in, any small polish that fell out of 4b
review).

## What's in

### Presentation — queries

`src/presentation/queries/ride.queries.ts`:

- `useStartRideMutation` — wraps `useCases.startRide.execute(...)`. The
  use case reads the current ride and writes back via
  `RideRepository.update` (direct Firestore write — no Cloud Function;
  the entity transition is local). On success: byId cache set + both
  `listsForDriver(driver.id)` and `listsForPassenger(passenger.id)`
  invalidated, mirroring `useDispatchRideMutation`.
- `useRequestPaymentMutation` — wraps `useCases.requestPayment.execute(...)`.
  Routes through the `completeTrip` Cloud Function (server-side fare
  math + auth + Stripe charge kickoff). The function flips status to
  `payment_requested`; the Stripe webhook later flips it to `completed`
  (or `payment_failed`) — the live `ObserveRide` subscription delivers
  either snapshot. Same cache effects as the start mutation.
- `presentation/queries/index.ts` re-exports both new hooks and their
  input types.

### Presentation — view-model

`useDriverMonitorViewModel` (rewritten end-to-end, but the public surface
is a strict superset of 4a's):

- Status enum dropped `'future_status_fallback'` and added literals
  `'started' | 'payment_requested' | 'completed' | 'payment_failed'`. The
  status-derivation switch maps each server status to its UI counterpart
  one-to-one.
- `onStartRide(): Promise<boolean>` replaces the 4a Toast stub. Wraps
  `useStartRideMutation` and surfaces `isStarting` + `startError`. The
  view-model derives a stub odometer (the recorded pickup odometer plus
  one metre, falling back to one metre if pickup was never recorded) so
  the screen stays prop-thin. Phase 7 swaps that single helper for a real
  GPS-derived reading from `useGpsLifecycle`. Returns `true` on success —
  the screen doesn't have to dig through TanStack-Query state.

- `requestPayment(): Promise<boolean>` is the same pattern: wraps
  `useRequestPaymentMutation`, derives the stub odometer, surfaces
  `isRequestingPayment` + `requestPaymentError`.
- Terminal-redirect effect now fires on `'completed'` in addition to
  `'cancelled'`. Both reset the stack to `DriverTabs`. `'payment_failed'`
  intentionally does NOT redirect — the driver stays on the failure
  card and taps "Close trip" themselves. The same `redirectedRef` ref
  guards against re-firing across re-renders for both terminal statuses.
- The 4a `Toast.show` import + the `react-native-toast-message` mock in
  the VM test file are gone.
- Mode mirror unchanged: `started` / `payment_requested` /
  `payment_failed` / `completed` all map to `'on_trip'`; `cancelled`
  maps to `'online_idle'`. The VM doesn't try to map terminal redirect
  to a mode flip — the redirect tears the screen down, and DriverHome's
  own `useFocusEffect` resyncs the mode when the driver lands back on
  the queue.

### Presentation — feature components

`features/driver/components/`:

- `StartedView` — rider-in-the-car surface. ETA-to-dropoff pulled from
  `ride.dropoff.directions`, sanitized passenger card, dropoff endpoint
  card, an estimated-fare row computed via `FareCalculator.estimate`
  against the planned dropoff distance/duration. Header destructive
  cancel button. Primary CTA "Request payment" pops a destructive-confirm
  `Alert.alert` ("This ends the trip and charges the rider") before
  calling `onRequestPayment()`. The real swipe-to-confirm UX is
  intentionally deferred to Phase 7 alongside the dropoff geofence gate
  (drivers shouldn't be able to end a trip from across town).
- `PaymentRequestedView` — read-only intermediate state during the
  Stripe webhook lag. Centered `ActivityIndicator` plus a "Running fare"
  row computed against odometer (with `dropoff.directions` fallback).
  No CTAs — the driver has nothing to act on while the charge is in
  flight.
- `CompletedView` — read-only fare summary: total fare via
  `Money.format()`, distance (miles, with miles-per-meter conversion +
  fallback to planned distance), duration (mins, with wall-clock
  computation + fallback to planned duration). Single "Close trip" CTA
  → `navigation.reset` to DriverTabs. The VM auto-redirects on
  `completed`, so this view renders for one frame at most in practice;
  it stays mounted as a graceful fallback if the redirect ref ever
  races.
- `PaymentFailedView` — read-only "Charge declined" surface.
  Reassurance copy ("you've already been paid for this trip") because
  the function paid the driver out of escrow regardless of the rider's
  card outcome. Only CTA is "Close trip" → `navigation.reset` to
  DriverTabs. No retry surface (driver-side retry doesn't make sense —
  the driver has no card to retry against; rider-side retry lands in
  Phase 6 alongside the Stripe wallet).

### Presentation — shared trip component

`features/components/trip/DriverCancelReasonSheet`:

- Per-reason picker modal, mirror of the rider-side `CancelReasonSheet`
  but gated on `CancellationReason.isDriverCode`. Driver-allowed codes:
  `changed_mind`, `passenger_no_show`, `vehicle_malfunction`,
  `vehicle_accident`, `safety_concerns`, `other`. The rider-only
  `driver_no_show` code is filtered out; the driver-only
  `passenger_no_show` code is added. Each option carries
  driver-friendly label/description copy.
- `'other'` branch: TextInput appears, confirm button stays disabled
  until `reasonText.trim().length > 0`.
- Modal props: `transparent`, `animationType="slide"`,
  `statusBarTranslucent`, `navigationBarTranslucent` — last two per the
  legacy CLAUDE.md note (Android 15 edge-to-edge backdrop).
- Adds an explicit `onPress={() => undefined}` to the inner card
  Pressable so touch events that land on the card area don't bubble up
  to the outer dismiss-Pressable. This avoids a press-bubbling issue in
  `@testing-library/react-native`'s `fireEvent.press` (which walks up
  the tree) AND removes a latent bug where in production the inner
  card area would dismiss the sheet on certain touch sequences.
- Sheet builds the `CancellationReason` value object internally and
  hands it to `onConfirm(reason)`. The parent owns submission /
  loading / error.

### Presentation — screen

`features/driver/screens/DriverMonitorScreen.tsx`:

- The 4a `confirmCancelWithCode` helper + the two
  `handleEnRouteCancel` / `handleAtPickupCancel` callbacks are gone.
  Replaced by a `useState<boolean>` for `cancelSheetVisible` plus an
  `openCancelSheet` callback that every cancel-eligible status view
  wires its `onPressCancel` to.
- `<DriverCancelReasonSheet>` mounted as a sibling of `<BottomSheet>`,
  driven by that visibility flag. Its `onConfirm` calls `vm.cancel({
reason })` and on success closes the sheet. `vm.isCancelling` and
  `vm.cancelError` thread through.
- Status-router branches added for `'started'`, `'payment_requested'`,
  `'completed'`, `'payment_failed'`. The `'future_status_fallback'`
  branch is gone.
- Map polyline swap: when the ride is in any late status (`started` /
  `payment_requested` / `payment_failed` / `completed`), the green
  driver→pickup polyline (already gated on `=== 'dispatched'`) hides
  and the gold pickup→dropoff polyline shows via `selectedRoute={...}`
  built from `ride.dropoff.directions`. Both pickup and dropoff
  markers stay always-mounted; only their visibility-by-prop changes.
  This keeps the `<Map>` always-mounted-children invariant intact
  across the late-status transitions.
- `handleCloseTrip` defined once at the top of `DriverMonitorContent`,
  consumed by both `CompletedView` and `PaymentFailedView`. Calls
  `navigation.reset({ index: 0, routes: [{ name: 'DriverTabs' }] })`
  directly — same shape as the VM's terminal redirect.
- `StartedView`'s "Request payment" → `() => { void vm.requestPayment(); }`.
  Same fire-and-forget shape as 4a's `onStartRide` wiring.
- `AtPickupView`'s `onStartRide` is now wired to `() => { void
vm.onStartRide(); }`. The `startDisabled` prop is wired to
  `vm.isStarting` so the button shows the disabled tint mid-mutation.

## Test counts (delta from Phase 4 turn 4a)

| Category    | New tests                                    |
| ----------- | -------------------------------------------- |
| View-models | `useDriverMonitorViewModel` (+3, −1 retired) |
| Components  | `DriverCancelReasonSheet` (4, new test file) |

The VM test file evolved:

- Replaced 4a's "ride flipping into 'completed' reaches the
  future_status_fallback" with "ride flipping into 'completed' fires
  the terminal reset" (which now expects the redirect).
- Added "onStartRide() persists 'started' and status flips to
  'started'".
- Added "requestPayment() persists 'payment_requested' and status
  flips".
- Added "requestPayment() surfaces error message on failure" (uses
  `mockRequestPaymentResult(NetworkError)` to drive the error path).
- Added "ride flipping into 'payment_failed' does NOT redirect" — the
  driver stays on the failure card.
- Removed the `react-native-toast-message` jest mock from the VM tests
  (the VM no longer imports Toast).

The new component test file `DriverCancelReasonSheet.test.tsx` has
4 tests: code-list filter (driver-allowed only), `'other'` reasonText
gating, confirm-with-non-other-code, confirm-with-`'other'`-trimmed-text.

**Total: 568 tests / 81 suites passing** (+7 vs. turn 4a's 561). Suite
count moved 80 → 81 — one new test file
(`DriverCancelReasonSheet.test.tsx`).

## Manual smoke

Steps to exercise Turn 4b end-to-end (against in-memory fakes):

1. Sign in as a driver. Land on `DriverHomeScreen`. Toggle online; seed
   an `awaiting_driver` ride. Tap the card → DriverDispatch → Accept.
2. DriverMonitor opens in `'en_route_to_pickup'`. Tap "Arrived at
   pickup" → flips to `'at_pickup'`. The map's polyline + pins stay
   put.
3. Tap "Start ride" → button shows the disabled tint briefly →
   `useStartRideMutation` writes the `started` snapshot through
   `RideRepository.update` → live `ObserveRide` delivers it → the
   bottom-sheet flips to `<StartedView>` and the map polyline swaps:
   green driver→pickup disappears, gold pickup→dropoff appears.
4. Tap "Request payment" → destructive `Alert.alert` confirm pops →
   tap "Request payment" → button disables briefly →
   `useRequestPaymentMutation` routes through the `completeTrip` Cloud
   Function → the entity transitions to `payment_requested` and the
   bottom-sheet flips to `<PaymentRequestedView>` (spinner + running
   fare).
5. Seed a `completed` snapshot in the in-memory repo (or wait for the
   mock webhook to flip) → the live subscription delivers it → the
   VM's terminal-redirect effect fires `navigation.reset({ index: 0,
routes: [{ name: 'DriverTabs' }] })` → driver lands back on
   DriverHome with the queue visible. `<CompletedView>` may render for
   one frame as a fallback; in practice it's a flash.
6. Inject a `payment_failed` snapshot into a fresh test seed → the VM
   does NOT redirect → driver sees `<PaymentFailedView>` with the
   reassurance copy and the "Close trip" CTA. Tap → `navigation.reset`
   to DriverTabs.
7. Cancel from any cancel-eligible status (en-route / at-pickup /
   started) → header cancel → `<DriverCancelReasonSheet>` slides up
   → pick a code → confirm → `vm.cancel({reason})` → live
   subscription delivers `cancelled` → terminal redirect fires →
   driver returns to DriverHome with mode `'online_idle'`.
8. Cold-launch resume: driver with an in-progress `started` ride
   re-opens the app → DriverHome's `useFocusEffect` fires →
   `useInProgressDriverRideQuery` resolves the `started` ride →
   redirect lands the driver on `DriverMonitor` showing
   `<StartedView>` (no DriverDispatch interstitial).

## What's deferred to Turn 5

- **CLAUDE.md driver-side fold-in.** The progression table is up to
  date, but the AI-best-practices section + critical-files list could
  use a small driver-side cleanup pass.
- **Real GPS-derived odometer** for `onStartRide` / `requestPayment`.
  Phase 7 wires `useGpsLifecycle` and replaces the
  `stubOdometerMeters` helper in the VM with a real reading.
- **SwipeButton confirm UI** for `onStartRide` / `requestPayment`.
  Phase 7 alongside the dropoff geofence gate.
- **Geofence-driven auto-flip** from `'en_route_to_pickup'` →
  `'at_pickup'`. Phase 7's geofence-entry event will replace the
  manual "Arrived at pickup" tap.
- **Real retry-charge mutation** on `PaymentFailedView` (rider-side).
  Phase 6 with the Stripe wallet.
- **Tip surface** on `CompletedView`. Phase 6 with Stripe Connect.
- **DriverChat** + audit-events panel inside `StartedView`. Phase 9
  polish (the VM already subscribes to `ObserveTripEvents` in 4a; it's
  a pure rendering add).
- **Detox driver smoke** — the rider-side smoke deferred from 3.5 can
  now drive both halves of the trip from a single device.
- **Press-bubbling fix in the rider-side `CancelReasonSheet`** — the
  same latent issue exists there; we fixed it in the driver sheet
  because the test exposed it. Worth carrying the same `onPress={() =>
undefined}` over in a small drive-by, separate from this turn's
  scope.

## Risks / known issues to watch on first real-Maps + real-Firebase boot

- **`payment_requested` lingering on the driver's screen.** Same risk
  as the rider-side noted in 3.4b — if the Stripe webhook is slow,
  `<PaymentRequestedView>` sits there for multiple seconds. The VM's
  redirect-on-completed is intentional; we never auto-flip while the
  charge is in-flight. Phase 6's webhook ETA monitoring may surface a
  "still processing…" banner here.
- **Stub odometer at start/request-payment.** The VM derives
  `pickupTiming.odometerMeters ?? 0 + 1` so the entity's
  monotonicity check passes. The legacy backend tolerated a missing
  odometer (it billed whatever was recorded server-side), so production
  fares should be unaffected — but if Phase 7's GPS odometer lands and
  fares jump on `requestPayment`, the issue is the new GPS-supplied
  reading, not the VM.
- **`Alert.alert` confirm on the Request-payment CTA.** Iconographic
  parity with the rider side (which uses `Alert.alert` for cancel) and
  with the driver-side cancel stub in 4a — but the legacy app used a
  SwipeButton here. Drivers used to the legacy UX may find the alert
  jarring. Phase 7 lands the swipe.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | ✅     |
| 3    | DriverDispatch — incoming-ride accept/decline              | ✅     |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | ✅     |
| 4b   | DriverMonitor late-status views + start/requestPayment     | ✅     |
| 5    | Phase 4 cleanup + CLAUDE.md update                         | Next   |
