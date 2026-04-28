# Phase 3 — Turn 4b: Late-status views + chat stub + geofence tick

The harness from 3.4a is now full-fat. RideMonitor's status-router covers
every `RideStatus` the rider is allowed to see; the geofence banner
ticks against `useCurrentLocation`; and the chat-stub button surfaces a
"Phase 3.5" toast.

The only Phase 3 surface left after this turn is RideReceipt (turn
3.5).

## What's in

### Presentation — feature components

`features/rider/components/`:

- `StartedView` — the rider is in the car. Shows ETA-to-dropoff (from
  `ride.dropoff.directions`), the driver/vehicle card (read-only), the
  dropoff endpoint, cancel + chat-stub buttons. Geofence banner is
  intentionally NOT rendered (pickup-exit only matters during
  `dispatched`). Renders the chat unread-dot when
  `vm.hasUnreadMessages` flips true.
- `CompletedView` — fare summary derived via `FareCalculator.estimate`
  on the recorded odometer + duration (falls back to the route's
  planned distance/duration when odometer readings aren't captured).
  Tip selector + retry-charge are visible-but-disabled stubs labelled
  "Phase 6"; the layout reserves the space so Phase 6 doesn't redraw.
  "View receipt" CTA pushes RideReceipt. Mounted for both
  `payment_requested` and `completed` statuses; the view-model's
  `completed → RideReceipt` redirect means in practice the rider only
  sees CompletedView during the brief `payment_requested → completed`
  window.
- `PaymentFailedView` — read-only "Charge couldn't go through" message
  with disabled retry-charge / change-card buttons (Phase 6) and an
  optional contact-support link. Cancel is intentionally NOT exposed —
  the trip already terminated server-side; the rider's options are
  pay-again or contact support.

### Presentation — view-model extensions

`useRideMonitorViewModel`:

- **Geofence tick.** Composes `useCurrentLocation` and re-runs
  `EvaluateExitWarning(currentLocation, ride.pickup.location)` whenever
  the location updates _and_ the status is `dispatched`. Writes to
  `useGeofenceUiStore` via the named setters. On every other status
  the effect clears the flag defensively. Phase 4 swaps
  `useCurrentLocation` for the background-aware `useGpsLifecycle`.
- **Chat stub.** Subscribes to `ObserveLatestMessage` (Phase-3 stub
  emits `null`) and exposes `hasUnreadMessages` derived from
  `useChatUiStore.lastReadAt`. `onPressChat` shows a toast via
  `react-native-toast-message` ("Messaging coming soon — Chat threads
  land in Phase 3.5.").
- **Completed redirect.** Adds `completed → navigation.replace('RideReceipt', { rideId })`
  to the existing `cancelled → navigation.reset` path. `payment_failed`
  is intentionally NOT a redirect: the rider stays on RideMonitor with
  the retry surface (PaymentFailedView).

### Presentation — screen

`RideMonitorScreen`:

- Status-router extended:
  - `awaiting_driver` / `scheduled` / `scheduled_driver_accepted` →
    `AwaitingDriverView`
  - `dispatched` → `DispatchedView`
  - `started` → `StartedView`
  - `payment_requested` / `completed` → `CompletedView`
  - `payment_failed` → `PaymentFailedView`
  - `cancelled` → never rendered (view-model resets nav first)
- The 3.4a `FutureStatusFallback` and `onChatStub()` deletions cleaned
  up.

### Presentation — App.tsx

`<Toast/>` mounted at the root, sibling of `<NavigationContainer/>`.
Stays floating over every screen + navigator. Phase 4+ will reuse it
for GPS-permission nudges and similar transient banners.

## Test counts (delta from turn 3.4a)

| Category    | New tests                     |
| ----------- | ----------------------------- |
| View-models | `useRideMonitorViewModel` (3) |

3 new view-model tests:

- `redirects to RideReceipt when status flips to completed`
- `does NOT redirect for payment_failed (rider stays on RideMonitor)`
- `onPressChat shows a "Phase 3.5" toast`

**Total: 512 tests / 73 suites passing** (up from 509). Component
rendering tests for the new status views (StartedView / CompletedView /
PaymentFailedView) deferred — they'd duplicate the view-model coverage,
and the planned Detox `rider.test.ts` smoke flow in turn 3.5 will
exercise the screen end-to-end including these views.

## What's deferred to turn 3.5

- **Real `RideReceiptScreen`** — terminal-state read-only receipt with
  fare breakdown, charged-card last-4, "Email receipt" stub. The
  current placeholder just shows the rideId.
- **Detox `rider.test.ts` smoke** — walks search → select → confirm →
  seed-driver-dispatch → seed-driver-start → seed-driver-complete →
  receipt against the in-memory fakes (driver-side seeded via an
  admin script that turn 3.5 introduces).
- **`useRouteSelectViewModel.confirm()` submit-path tests** — the
  doc note in turn 3.3 promised these here; they actually need
  `useCurrentUserQuery` to resolve a real user inside a renderHook
  wrapper, which adds enough boilerplate to be its own follow-up.

## Acceptance for turn 4b

`npm run verify`:

- **`npm test`** — 512 tests / 73 suites passing.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors.
- **`npm run format:check`** — clean.

End-to-end (against the in-memory fakes): RideMonitor walks the rider
through `awaiting_driver → dispatched → started → payment_requested →
completed`, rendering the matching status view at each step; geofence
banner shows when the rider's mocked location moves outside the 200m
pickup geofence during `dispatched` and clears immediately on
`started`; chat-stub tap shows the toast; `completed` snaps to
RideReceipt; an inline `payment_failed` injection keeps the rider on
RideMonitor with the retry surface.

## Risks / known issues to watch on first real-Maps + real-Firebase boot

- **Geofence flicker at the boundary.** With foreground-only location
  reads from `useCurrentLocation`, the rider only gets a fresh GPS
  ping per re-mount. If the rider sits on the geofence boundary, the
  banner won't update until the next focus. Phase 4's `useGpsLifecycle`
  fixes this with continuous reads + listener-level dedup against
  jitter. Until then, an occasional banner flash is expected.
- **`react-native-toast-message` mock pattern.** Test uses
  `jest.requireMock` to grab the spy after the module factory builds
  the function-with-static-method shape. If a future test imports
  `Toast` differently (e.g. named export), the spy won't see calls —
  the workaround is fully contained to `useRideMonitorViewModel.test.tsx`.
- **`payment_requested` lingering on the rider's screen.** If the
  Stripe webhook is slow, the rider sees CompletedView's "Charging your
  card" copy for a few seconds. The view-model's `completed`-only
  redirect is intentional — never auto-flip while the charge is
  in-flight. Phase 6's webhook ETA monitoring may surface a "still
  processing…" banner here.
- **Cancel from `started`.** The cancel CTA still appears in the
  StartedView header. The Cloud Function handles odometer-aware
  fare-deduct math; the view-model passes whatever `odometerMeters` it
  has (which is `null` until Phase 4 wires GPS). On the legacy backend
  this is fine — the function tolerates a missing odometer and bills
  whatever was recorded server-side. If Phase 4 lands and fares jump
  on cancel, the issue is the new GPS-supplied odometer, not the
  view-model.
