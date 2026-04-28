# Phase 4 Kickoff Prompt — Driver UI

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 4.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. The rider journey just
shipped end-to-end on real Firebase (Phase 3). Your job this session is
to start **Phase 4: driver UI**. Read carefully before writing any
code.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered architecture,
   conventions, file map. The "Project status" table now shows Phase 3
   complete and Phase 4 Next.
2. `REFACTOR_PLAN.md` — Phase 4 scope and dependencies.
3. `docs/PHASE_3_TURN_5.md` (most recent) and
   `docs/PHASE_3_TURN_4B.md` — the patterns Phase 3 locked in:
   view-model hook per screen, status-router for live-trip surfaces,
   strict Zustand-vs-TanStack-Query split. Phase 4 follows the same
   patterns; mimic them rather than re-inventing.
4. Legacy driver code at `/Users/papagallo/yeapptech/dev/yeride/src/driver/`
   — especially `screens/DriverDispatch.js`, `screens/DriverMonitor.js`,
   and the legacy `docs/DRIVER_MONITOR_ARCHITECTURE.md`. This is the
   source of truth for the driver-side trip lifecycle.

## Starting state — what's already built

- **Use cases (already in `src/app/usecases/ride/`)**: `DispatchRide`,
  `StartRide`, `RequestPayment`, `CancelRideByDriver`,
  `ListAvailableRides` (geo-filtered subscription),
  `ObserveRide`/`ObserveTripEvents`/`ObserveTripPayments`. Driver-side
  has every callable it needs; you may not need to add new use cases
  for Phase 4 at all.
- **Repositories**: `FirestoreRideRepository` already implements every
  method drivers need (driver-side dispatch, start, requestPayment, and
  cancel route through `CloudFunctionsService` where appropriate).
  `FirestoreLocationRepository` has the 3-retry backoff write path the
  driver will use to broadcast position.
- **Navigation**: `DriverNavigator.tsx` is a placeholder stub.
  `RootNavigator` already routes a user with `role: 'driver'` to it.
- **Role flip**: Phase 3 left a way to flip the signed-in user's role
  for testing — confirm by reading `RootNavigator.tsx` first.

So Phase 4 is **entirely a presentation-layer build**: driver screens,
driver view-models, driver status-views, navigator wiring, one or two
new client-state stores. Domain and data layers should not need to
change.

## Scope (in / out)

**In:**

- `DriverHomeScreen` — online/offline toggle, map showing nearby
  pending rides as cards when online, driver-state lifecycle
  (offline → online-idle → dispatched → on-trip).
- `DriverDispatchScreen` — incoming-ride card with accept/decline.
- `DriverMonitorScreen` — active-trip surface: map + bottom-sheet
  status-router. Mirrors `RideMonitorScreen` structure but with
  driver-side status views (en-route-to-pickup, at-pickup, on-trip,
  completing, payment-failed).
- `DriverActivityPlaceholderScreen`, `DriverEarningsPlaceholderScreen`,
  `DriverProfilePlaceholderScreen` — tab placeholders matching the
  rider placeholders.
- `DriverTabsNavigator` — bottom tabs (Home, Activity, Earnings,
  Profile).
- View-models for each screen; in-memory fake coverage; view-model unit
  tests against `TestContainerProvider`.

**Out (deferred — do not build in Phase 4):**

- Vehicle management UI (Phase 5). For Phase 4, derive the active
  vehicle from `user.services.ride` if present; otherwise stub a
  default. Don't build vehicle CRUD or selection screens.
- Stripe Connect onboarding flow (Phase 6). For Phase 4, the driver's
  `requestPayment` call invokes the `completeTrip` Cloud Function and
  Stripe handling happens server-side. App-side Connect onboarding
  stays deferred.
- Background GPS + geofence-exit warnings (Phase 7). For Phase 4, use
  foreground location only via the existing `TrackLocation` use case.
  Don't wire `react-native-background-geolocation` yet.
- Google Navigation SDK (Phase 8). The driver's map is the same
  react-native-maps surface the rider uses, with the route polyline
  drawn on top. No turn-by-turn navigation in-app this phase.
- Real earnings data (Phase 6). The Earnings tab is a placeholder.

## Suggested turn breakdown

- **Turn 1 — Foundations.** Real `DriverNavigator` and
  `DriverTabsNavigator`. Driver-side client store(s) — at minimum a
  store for online/offline state and the active vehicle id. Placeholder
  screens for the four tabs. Manual smoke-test of role routing by
  flipping a user doc.
- **Turn 2 — DriverHome.** Online toggle wires foreground location
  tracking via `TrackLocation`; `ListAvailableRides` subscription wires
  TanStack Query and renders ride cards stacked on the map. No accept
  flow yet — tapping a card just opens the dispatch screen as a
  preview.
- **Turn 3 — DriverDispatch.** Full incoming-ride flow: tapping a card
  opens `DriverDispatchScreen`, accept calls `DispatchRide` and
  navigates to monitor; decline returns to home. Mirror any
  time-to-acknowledge UI from the legacy spec.
- **Turn 4a — DriverMonitor scaffolding** + early-status views
  (`EnRouteToPickupView`, `AtPickupView`). Status-router on the bottom
  sheet. Map shows pickup pin and route polyline.
- **Turn 4b — DriverMonitor late-status views.** `OnTripView`,
  `CompletingView`, `PaymentFailedView`. Wire `StartRide` and
  `RequestPayment`. Driver-side cancel modal restricted to the
  driver-allowed cancellation codes (`passenger_no_show`, etc.) — the
  `CancelRideByDriver` use case already enforces this.
- **Turn 5 — Cleanup.** End-of-phase tidy: update `CLAUDE.md`
  (Phase 4 → ✅, Phase 5 → Next, refresh test count and file map),
  write `docs/PHASE_4_TURN_*.md` records, prune any TODOs.

## Conventions (non-negotiable — same as Phase 3)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors. Programming errors still throw.
- Build the in-memory fake first if extending any repository interface.
- Server state → TanStack Query. Client/UI state → Zustand. Don't mix.
  Don't put fetched ride data in a Zustand store; don't put a UI flag
  in TanStack Query.
- Each screen gets a sibling `useXxxViewModel.ts` hook. Screens are
  dumb (props in, JSX out).
- Status-router pattern: one switch on `Ride.status`, one view
  component per status. Don't grow `DriverMonitorScreen` into a god
  component.
- Logger only: `LOG.extend('DRIVER')`, never `console.*` outside
  `src/shared/logger/Logger.ts`.
- Synchronous unsubscribe for every subscription.
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring a turn done.

## Acceptance for end of Phase 4

- A signed-in driver lands on `DriverHomeScreen`, toggles online, sees
  a card appear when a rider creates a ride nearby, accepts it, and
  runs through the full status-router on `DriverMonitorScreen`
  (en-route → at pickup → on-trip → completing) all the way to a
  completion / payment-failed terminal state.
- The full rider + driver journey can be exercised end-to-end on real
  Firebase using two builds (one rider, one driver).
- Test suite stays green; new view-models have unit tests against
  in-memory fakes; new components have at least smoke renders.
- `CLAUDE.md` updated; `docs/PHASE_4_TURN_*.md` records written.

## Start with

Read `CLAUDE.md`, then the Phase 4 section of `REFACTOR_PLAN.md`, then
`docs/PHASE_3_TURN_5.md`. Then propose **Turn 1 scope** as a numbered
punch list (files to create, files to touch, tests to add) and wait
for confirmation before writing code.
