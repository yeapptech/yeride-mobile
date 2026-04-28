# Phase 4 — Turn 5: Phase 4 cleanup + CLAUDE.md driver-side fold-in

The closing turn of Phase 4. No new product surface — this is a polish
pass that retires turn-numbered language from the driver tree, carries
the `DriverCancelReasonSheet` press-bubbling fix over to the rider-side
sheet, and folds driver-specific guidance into `CLAUDE.md` so future
turns don't have to re-derive it from the phase docs.

Phase 5 (Vehicle management) opens after this.

## What's in

### Stale-comment cleanup across the driver tree

Several driver-side files referenced "Turn 4a" / "Turn 4b" / "stubbed
in 4a; lands in 4b" — language that was correct mid-phase but reads
as drift now that everything has shipped. The comment text was
rewritten to describe the current behavior, not the historical
trajectory:

- `features/driver/components/AtPickupView.tsx` — doc-block now says
  "Start ride transitions to `started` via `useStartRideMutation`
  (a direct Firestore write through `RideRepository.update`)" instead
  of "handler stubbed in Turn 4a; full mutation lands in Turn 4b".
  The cancel-button paragraph was rewritten to describe the shared
  `DriverCancelReasonSheet` instead of the 4a hard-coded code stub.
- `features/driver/components/EnRouteToPickupView.tsx` — "Phase 7's
  geofence-exit warning will auto-fire this; for Turn 4a it's a manual
  button tap" → "Phase 7's geofence-entry event will auto-fire this;
  until then it's a manual button tap". (Also corrected "exit" → "entry"
  — the geofence we care about for the en-route → at-pickup flip is
  the pickup-zone-entry event, not exit.)
- `features/driver/components/StartedView.tsx` — "For Turn 4b we ship
  a working completion path…" softened to "Until then the
  destructive-confirm alert is enough for a functionally complete
  screen".
- `features/driver/view-models/useDriverMonitorViewModel.ts` — the
  ObserveTripEvents JSDoc bullet now says "primed so the future events
  panel (Phase 9 polish) is a pure rendering add" instead of "primed in
  Turn 4a".
- `features/driver/view-models/useDriverHomeViewModel.ts` — two
  references to "Turn 4a registered the real DriverMonitor route…"
  collapsed into present-tense descriptions of the redirect contract.
- `presentation/navigation/types.ts` — DriverStackParamList preamble
  retired turn references; the DriverMonitor doc-block is now status-
  router-centric.
- `presentation/navigation/DriverNavigator.tsx` — turn-by-turn
  enumeration replaced with a single sentence describing what the
  navigator hosts today.

No behavior changes; pure prose.

### Press-bubbling fix on the rider-side `CancelReasonSheet`

`presentation/components/trip/CancelReasonSheet.tsx` had the same
latent dismiss-on-card-tap bug we fixed in `DriverCancelReasonSheet`
during 4b. Carried the same fix over: the inner card Pressable now
takes an explicit `onPress={() => undefined}` so:

1. In production, touch events that land on the card area don't
   bubble up to the outer dismiss-Pressable's `handleClose`.
2. If a rendering test ever lands for the rider sheet,
   `@testing-library/react-native`'s `fireEvent.press` won't walk up
   the tree and reset internal state mid-test.

Updated the comment above the inner Pressable to document the rationale
and reference the driver-side mirror.

No tests added — the rider sheet doesn't have an existing rendering
test file. If/when that test file lands, the fix already covers it.

### CLAUDE.md driver-side fold-in

A new H3 inside "## AI best practices" — "Driver-side specifics
(Phase 4)" — codifies six patterns that are easy to miss without
walking the phase docs. Six bullets:

1. **Driver mode mirror.** `useDriverStatusStore.mode` is mirrored
   from `Ride.status` inside `useDriverMonitorViewModel`. Documents
   which server statuses map to `'dispatched'` vs. `'on_trip'` vs.
   `'online_idle'` and where to update the switch.
2. **Client-side `arrivedAtPickup` flag.** Documents the UI-only
   en-route ↔ at-pickup split, why it exists, and when Phase 7 will
   auto-flip it.
3. **Stub odometer at start / request-payment.** The single edit-site
   for swapping in real GPS-derived odometer in Phase 7 is
   `stubOdometerMeters` inside the VM. Explains the +1 metre
   monotonicity rule and why the screen doesn't pass odometer in.
4. **Terminal-redirect rule.** `cancelled` and `completed` redirect;
   `payment_failed` does NOT. New terminal status = decide
   deliberately, don't blanket extend the effect.
5. **Two cancel-sheet variants.** `CancelReasonSheet` (rider) vs.
   `DriverCancelReasonSheet` (driver). Documents the code-set
   difference (`driver_no_show` rider-only vs. `passenger_no_show`
   driver-only) and the inner-Pressable press-bubbling guard.
6. **DriverMonitor map polyline rules.** Visibility-by-prop drives
   the green/gold polyline swap; both pickup and dropoff markers stay
   always-mounted across late-status transitions.

Critical-files table gained two rows:

- `useDriverMonitorViewModel.ts` — flagged as the status-router state
  machine + Start/RequestPayment/Cancel mutations + terminal-redirect
  rule.
- `{Cancel,DriverCancelReason}Sheet.tsx` — flagged as the per-reason
  cancel pickers, with the rider/driver code-set distinction called
  out.

Phase progression table flips Phase 4 turn 5 to ✅ and marks Phase 5
("Vehicle management") as Next. Project-status section rewritten
from "Mid-Phase 4" to a Phase-4-complete summary.

## Test counts

No tests added or removed. Verify gates re-run:

| Gate                   | Result                             |
| ---------------------- | ---------------------------------- |
| `npm run typecheck`    | ✅                                 |
| `npm run lint`         | ✅                                 |
| `npm run format:check` | ✅                                 |
| `npm test`             | ✅ — 81 suites / 568 tests passing |

## What's deferred

Nothing scoped to Phase 4 is left on the floor. Items that surfaced
during Phase 4 but belong to later phases (and remain in their
respective deferred lists in `docs/PHASE_4_TURN_4B.md`):

- Real GPS-derived odometer for Start / RequestPayment (Phase 7
  alongside `useGpsLifecycle`).
- SwipeButton confirm UI on Start / RequestPayment (Phase 7 alongside
  the dropoff geofence gate).
- Geofence-driven auto-flip from `'en_route_to_pickup'` →
  `'at_pickup'` (Phase 7).
- Real retry-charge mutation on the rider-side `PaymentFailedView`
  (Phase 6 with the Stripe wallet).
- Tip surface on the rider's `CompletedView` (Phase 6 with Stripe
  Connect).
- Audit-events panel inside `StartedView` / `DriverMonitor` body
  (Phase 9 polish).
- Detox driver smoke (Phase 4 → driver path now exists end-to-end;
  the rider-side smoke deferred from 3.5 can drive both halves of
  the trip from a single device when it lands).
- Boundaries v5→v6 lint rule migration (warning-only; out of scope
  for cleanup, worth its own small follow-up).

## Phase 4 — full delta

Phase 4 is now ✅. Five turns (1: foundations; 2: DriverHome; 3:
DriverDispatch; 4a: DriverMonitor scaffold; 4b: DriverMonitor late-
status views + Start/RequestPayment; 5: cleanup) shipped:

- 9 new screens / view-models on the driver side (DriverHome,
  DriverDispatch, DriverMonitor + their VMs, plus 4 placeholder /
  tab screens).
- 6 driver status views (EnRouteToPickup, AtPickup, Started,
  PaymentRequested, Completed, PaymentFailed).
- 1 new shared trip component (`DriverCancelReasonSheet`).
- 3 new TanStack Query mutations (`useDispatchRideMutation`,
  `useStartRideMutation`, `useRequestPaymentMutation`) +
  `useCancelRideAsDriverMutation` + `useAvailableRidesQuery` +
  `useInProgressDriverRideQuery`.
- 1 new Zustand store (`useDriverStatusStore`).
- 4 new use cases (`DispatchRide`, `ListAvailableRides`,
  `ListRidesByDriver`, plus the existing Phase-2 `StartRide` and
  `RequestPayment` finally consumed from the UI).
- Test count: **518 → 568 tests** (+50 across Phase 4); **75 → 81
  suites**. All four verify gates green throughout.

Phase 5 (Vehicle management) is next. Vehicles store with VIN as the
document id (legacy convention preserved); `Vehicle` entity + DTO
mapper; vehicle list / register / activate flows on the driver side;
`useDriverHomeViewModel`'s vehicle-stub gets replaced by real picker
state.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | ✅     |
| 3    | DriverDispatch — incoming-ride accept/decline              | ✅     |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | ✅     |
| 4b   | DriverMonitor late-status views + start/requestPayment     | ✅     |
| 5    | Phase 4 cleanup + CLAUDE.md driver-side fold-in            | ✅     |

Phase 4 closed.
