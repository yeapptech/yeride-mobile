# Phase 3 — Turn 4a: RideMonitor scaffolding + early-status views

The bottom-sheet harness for the live-trip surface lands here. A rider
who taps Confirm on RouteSelect (turn 3.3) now arrives at a real
`RideMonitorScreen`: top-half map showing pickup + dropoff + the route,
bottom-half `@gorhom/bottom-sheet` with a status-router that picks
which view to render based on `ride.status`. Awaiting and dispatched
states are wired; started / completed / payment_failed land in 3.4b
along with their views.

The point of this split-turn is to prove the harness on real iOS +
Android before piling more status views into it.

## What's in

### Presentation — view-model

`useRideMonitorViewModel` (`features/rider/view-models/`):

- Subscribes to the live ride doc via `ObserveRide` and the audit-event
  log via `ObserveTripEvents`, both through `useFirestoreSubscription`.
  Synchronous unsubscribe by construction — no async-cleanup footgun.
- Exposes `status: RideStatus | null` for the screen's status-router.
  `null` = still loading; the screen renders a skeleton.
- Wires `useCancelRideAsRiderMutation` and exposes a `cancel(reason)`
  that returns `Promise<boolean>`. `cancelError` and `isCancelling`
  drive the screen's UI states.
- Auto-redirects on terminal statuses. Phase 3 turn 3.4a wires only
  the `cancelled` redirect (`navigation.reset` to RiderTabs so back-nav
  doesn't return to a dead ride). `completed` and `payment_failed`
  redirects land in 3.4b with their respective views.

### Presentation — components

`components/trip/`:

- `BottomSheetHeader` + `HeaderIconButton` — shared header used by every
  status view. Title + optional subtitle + a slot for trailing icon
  buttons (cancel / chat-stub). The icon button accepts a `tone`
  ('neutral' | 'destructive') so destructive actions get the error tint.
- `CancelReasonSheet` — modal-based sheet (RN `Modal`, not nested
  `@gorhom/bottom-sheet`) listing the rider-allowed cancellation codes
  filtered through `CancellationReason.isRiderCode`. Picks: changed_mind,
  driver_no_show, vehicle_malfunction, vehicle_accident, safety_concerns,
  other. The "other" branch reveals a freeform `reasonText` box and
  requires a non-empty value before Confirm enables. The sheet does NOT
  call the cancel mutation — the parent screen owns it. Sheet only
  assembles a `CancellationReason` value object and hands it back via
  `onConfirm`. `statusBarTranslucent` + `navigationBarTranslucent` are
  set so the backdrop extends under the system bars on Android 15
  edge-to-edge per legacy CLAUDE.md.

### Presentation — feature components

`features/rider/components/`:

- `AwaitingDriverView` — spinner + wall-clock timer ("Submitted Ns ago")
  - pickup/dropoff summary + cancel button in the header (not as a
    primary CTA, mirroring legacy layout). The timer ticks every second
    via `setInterval` with synchronous cleanup on unmount.
- `DispatchedView` — ETA-to-pickup pulled from `ride.pickup.directions`
  (set by the driver app at dispatch), driver name + sanitized vehicle
  info (color/year/make/model · plate), cancel + chat-stub buttons in
  the header, and a geofence-banner slot wired to
  `useGeofenceUiStore.pickupExitWarningVisible`. The setter caller is
  unbuilt in turn 3.4a — the banner is testable today by setting the
  store flag manually (a `vm.setPickupExitWarning(true)` from a console).
  Phase 4's `BackgroundGeolocationClient` will feed it from real
  geofence events.

### Presentation — screen

`RideMonitorScreen` rewritten:

- Top-half map with always-mounted-children pool (carry-forward from
  turn 3.2): pickup + dropoff + driver markers, selected dropoff route
  (gold), dispatched-state pickup route (green) when status flips.
  Driver marker stays `null` until Phase 4 wires the live driver
  location subscription.
- Bottom-half `@gorhom/bottom-sheet` with three snap points (25% / 50%
  / 90%). `enablePanDownToClose: false` keeps the sheet anchored.
  `keyboardBehavior: 'interactive'` so the cancel-reason "other" textbox
  doesn't fight the keyboard.
- Status-router branches:
  - `null` (loading) → spinner
  - `awaiting_driver` → `AwaitingDriverView`
  - `dispatched` → `DispatchedView`
  - everything else → `FutureStatusFallback` (turn 3.4b replaces this)
- Cancel flow: header's cancel button opens `CancelReasonSheet`; the
  sheet's `onConfirm` calls `vm.cancel(reason)`; on success the live
  subscription delivers a `cancelled` snapshot which triggers the
  view-model's `navigation.reset` redirect.

## Test counts (delta from turn 3.3)

| Category    | New tests                     |
| ----------- | ----------------------------- |
| View-models | `useRideMonitorViewModel` (7) |

7 new tests on top of turn 3.3's 505. The retirement of
`HelloYeRideScreen.test.tsx` (3 tests, deleted in the turn-3.3 cleanup
commit) nets to **+4 tests**: **509 tests / 73 suites passing**.

The 7 RideMonitor tests cover: loading state, seeded ride emission,
status-transition propagation, cancel-success redirect, cancel-success
spy + args, cancel-error friendly message, audit-event seed emission.
Component-level tests for AwaitingDriverView / DispatchedView /
CancelReasonSheet land in 3.4b alongside the StartedView / CompletedView
/ PaymentFailedView tests; component tests for these would duplicate
view-model coverage for now.

## What's deferred to turn 3.4b

- `StartedView` (rider in the car: ETA-to-dropoff, geofence banner
  suppressed, chat stub).
- `CompletedView` (fare summary, "View receipt" CTA, tip / retry stubs
  for Phase 6).
- `PaymentFailedView` (read-only "Charge declined" + Phase 6 stubs).
- `EvaluateExitWarning` ticking — re-runs on every Firestore
  `users/{uid}.location` snapshot; until then the banner is unfed.
- Chat stub button → "Phase 3.5" toast. Currently a no-op.
- Component-level rendering tests for the status views.
- Terminal-status redirects for `completed` (→ RideReceipt) and
  `payment_failed` (no redirect — stays on RideMonitor with the
  retry-failed view).

## Acceptance for turn 4a

`npm run verify`:

- **`npm test`** — 509 tests / 73 suites passing.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors.
- **`npm run format:check`** — clean.

End-to-end (against the in-memory fakes): RouteSelect → Confirm →
RideMonitor with the new ride → AwaitingDriverView shows the timer →
seed a `dispatch` transition via the admin script and the screen flips
to DispatchedView showing the driver card → tap Cancel → reason sheet
→ Confirm → ride flips to `cancelled` → screen resets to RiderTabs.

## Risks / known issues to watch on first real-Maps + real-Firebase boot

- **Bottom-sheet snap-point handoff with the underlying map** — the
  sheet is a sibling of `<Map/>`, not a child, so gesture pass-through
  should work out of the box. If panning the map at the lowest snap
  drags the sheet instead, the issue is usually that
  `react-native-gesture-handler`'s root view is wrapping only one of
  them; verify `<GestureHandlerRootView/>` wraps the whole tree
  (already true in `App.tsx` from Phase 1).
- **Modal under Android 15 edge-to-edge** — the `Modal`-based
  `CancelReasonSheet` has `statusBarTranslucent` +
  `navigationBarTranslucent`. If the backdrop doesn't extend under the
  system bars on Android 15, double-check those flags survived a
  bundler tree-shake.
- **Cancel race vs. Cloud Function side effect** — the
  `CancelRideByRider` use case routes through the `cancelTrip` Cloud
  Function which writes the `cancellation` row server-side. The live
  subscription delivers the `cancelled` snapshot a tick later. If the
  redirect fires before the snapshot arrives the screen briefly shows
  the dispatched view; then the snapshot lands and we redirect. Handled
  via the view-model's `redirectedRef` so we don't double-redirect.
- **Driver vehicle snapshot — undefined in legacy data** — some early
  legacy rides don't have `driver.vehicle` (vehicle module shipped
  later). DispatchedView guards on `driver.vehicle` truthiness; if
  undefined, falls back to a "Driver details loading…" line. If a
  legacy ride lands and shows that line forever, the mapper's vehicle
  parse is the issue, not the view.
