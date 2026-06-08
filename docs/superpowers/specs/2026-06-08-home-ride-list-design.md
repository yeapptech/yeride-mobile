# Home Ride List — Replace the Active-Ride Banner with a Legacy-Style List

**Date:** 2026-06-08
**Status:** Approved design — ready for implementation plan
**Supersedes:** `2026-06-04-active-ride-navigation-banner-design.md` (the
banner this replaces was never merged to `main`; it lives only on the
`feat/active-ride-banner` branch).

## Problem

The `feat/active-ride-banner` branch solved a real "trap" — a user with
an active ride was force-routed to the monitor on **every** home focus and
couldn't reach other tabs — by adding (1) a once-per-ride auto-route and
(2) a persistent top banner that returned them to the live ride.

The product owner doesn't want the banner. The legacy YeRide app instead
surfaced a **list of in-progress and scheduled rides** on the Home screen;
the user picks a ride to open. That list is itself the anti-trap mechanism:
you land on Home, see your rides, and choose when to enter the monitor.

This spec replaces the banner with that legacy-style list.

## Decisions (settled with the product owner)

1. **Placement:** the list lives on the **Home screen** for both roles
   (legacy parity, best discoverability now that the banner + auto-route
   are gone). The Activity tab stays history-only (its existing rider
   Scheduled section is unaffected — see Non-goals).
2. **Layout:** keep the existing **full-bleed map**; the floating bottom
   card becomes a **bounded, scrollable sheet** holding the greeting, the
   primary CTA, and the ride sections. Surgical; preserves the map ("you
   are here", cold-start centering, the driver's available-rides overlay).
3. **Phasing:** ship the **list UX + banner removal first**. Drivers
   accepting **scheduled** rides is **net-new** functionality and is
   deferred to a separate follow-up plan (see Phase 2 / Out of scope).
4. **Concurrency:** the design does **not** add or rely on a
   "one-active-ride" invariant. Sections render 0..N rows, so the UI is
   correct whether the user has zero, one, or (hypothetically) several
   active rides. Legacy's single-active-trip behavior is neither enforced
   nor required here.
5. **Liveness:** the In-progress section is driven by a **live
   subscription**, not a one-shot query — because Home is now the landing
   surface, a rider waiting there must see "awaiting driver → driver on
   the way" update the moment a driver accepts (cross-device). A one-shot
   query would leave that card stale until refocus.

## Goals

- Both Home screens show the user's **in-progress** and **scheduled**
  rides as tappable rows, visible the moment the app opens.
- Tapping a row opens the relevant live surface.
- Free tab navigation during an active ride (the original anti-trap goal),
  achieved by the list rather than a banner.
- No regression to ride creation, dispatch acceptance, or geofencing.

## Non-goals

- Drivers accepting scheduled rides (Phase 2).
- Changing the rider **Activity** tab (its Scheduled + Recent sections
  stay as-is; the Home Scheduled section reuses the same subscription and
  components).
- Enforcing a single active ride per user.
- Restyling the monitor screens or their status-router views.
- A draggable gesture sheet (the bounded scrollable card is enough;
  `@gorhom/bottom-sheet` on Home is an optional later polish).

## Design

### 1. Remove the banner and the cold-start auto-route

**Delete:**

- `src/presentation/components/trip/ActiveRideBanner.tsx` (+ test).
- `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts` (+ test).
- `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts` (+ test).

**Revert to plain tabs:**

- `src/presentation/navigation/RiderTabsNavigator.tsx` and
  `DriverTabsNavigator.tsx` — drop the banner mount and the
  `SafeAreaInsetsContext` `top: 0` override wrapper; restore a plain
  `<Tabs.Navigator>`. (Tab screens use `SafeAreaView edges={['top']}` and
  pad themselves once the banner no longer claims the inset.)

**Remove the auto-route from both home view-models:**

- `useRiderHomeViewModel.ts` — delete the module-level `autoRoutedRideId`
  guard, the `resetRiderAutoRouteGuard` export (no non-test caller — grep
  confirms), and the `useFocusEffect` that calls
  `navigation.reset([RiderTabs, RideMonitor])`.
- `useDriverHomeViewModel.ts` — delete the `routedRideIdRef` and its
  `useFocusEffect` `navigation.navigate('DriverMonitor', …)`.

**Why this is safe:**

- The **post-action** navigations are independent: `useRouteSelectViewModel`
  navigates to `RideMonitor` / `RideScheduledConfirmation` after
  `createRideMutation` (`:435+`); `useDriverDispatchViewModel` does
  `navigation.replace('DriverMonitor', …)` on accept (`:236`). Creating /
  accepting a ride still lands on the monitor.
- **Geofencing** reads its own `useInProgressRideQuery` /
  `useInProgressDriverRideQuery` inside `useActiveRideForGeofence` — left
  **untouched**. Those two queries stay; only the home view-models stop
  consuming them.

### 2. Data layer — a live In-progress subscription (mirror of Scheduled)

The Scheduled section already has a live source: `ObserveScheduledRides`
→ `RideRepository.observeScheduledRidesByPassenger` (statuses
`['scheduled','scheduled_driver_accepted']`). Add the symmetric
In-progress source so the two sections are consistent and both live.

**Repository interface** (`src/domain/repositories/RideRepository.ts`) —
two sibling methods (kept separate from the scheduled method to avoid
refactoring working code; a future generalization to
`observeRidesBy{Passenger,Driver}({statuses})` is noted but out of scope):

```ts
observeInProgressRidesByPassenger(args: {
  passengerId: UserId;
  callback: (rides: readonly Ride[]) => void;
}): () => void;          // synchronous unsubscribe

observeInProgressRidesByDriver(args: {
  driverId: UserId;
  callback: (rides: readonly Ride[]) => void;
}): () => void;
```

**Status sets** (live = "currently happening", excludes scheduled\*):

- Passenger LIVE: `awaiting_driver`, `dispatched`, `started`,
  `payment_requested`, `payment_failed`.
- Driver LIVE: `dispatched`, `started`, `payment_requested`,
  `payment_failed` (a driver is never in `awaiting_driver`).

Excluding `scheduled_driver_accepted` from LIVE means a driver-accepted
scheduled ride appears in **Scheduled only** — no double-listing.

**Implementations:**

- `FirestoreRideRepository` — `where('passenger.id'|'driver.id','==',id)`
  `.where('status','in', LIVE)` `.onSnapshot(...)`, same shape as the
  existing scheduled observe (which already proves the `passenger.id +
status` index path; the `driver.id + status` path is already used by
  `useInProgressDriverRideQuery`). Verify composite-index needs during
  planning.
- `InMemoryRideRepository` — filter seeded rides by owner + LIVE set,
  emit on mutation, return synchronous unsubscribe. Build this fake first.

**Use case** (`src/app/usecases/ride/ObserveInProgressRides.ts`) —
subscription-shaped, role-parameterized or two thin classes mirroring
`ObserveScheduledRides`; wired in `container.ts` with the standard lazy
`require`. Add an override slot path through `TestContainerProvider` (it
already injects the rides repo, so the fake covers it).

The existing `useInProgressRideQuery` / `useInProgressDriverRideQuery`
(one-shot, `limit: 1`) remain for the geofence hook and are not reused
here — separation of concerns over a shared read.

### 3. Presentation — sections on Home

**Rider** (`useRiderHomeViewModel` / `RiderHomeScreen`):

- VM exposes `inProgressRides: readonly Ride[]` (new subscription) and
  `scheduledRides: readonly Ride[]` (reuse the `ObserveScheduledRides`
  wiring already living in `useActivityViewModel` — factor the
  subscription into a small shared hook, e.g.
  `useScheduledRidesSubscription(passengerId)`, consumed by both Activity
  and Home so there's one implementation).
- VM keeps `goToRouteSearch`; replaces the single `inProgressRide` +
  `resumeRide` with the lists + an `onSelectRide(ride)` handler →
  `RideMonitor`. (Home rows are never terminal — completed/cancelled rides
  drop out of both the LIVE and scheduled sets — so that's the only
  branch; matches the Activity tab's `onSelectRide`.)

**Driver** (`useDriverHomeViewModel` / `DriverHomeScreen`):

- VM exposes `inProgressRides: readonly Ride[]` (new subscription) and
  keeps the online-toggle / available-rides / vehicle machinery. The
  in-progress rows reuse the existing `onResumeInProgress(rideId)` →
  `DriverMonitor` handler (rename to `onSelectRide(ride)` for symmetry
  with the rider VM).
- No Scheduled section in Phase 1 (drivers have no scheduled rides yet);
  the screen leaves room for it.

**Screens** — the bottom floating card becomes a **bounded scrollable
card** (`maxHeight` ~55–60%, inner `ScrollView`), `absolute bottom-0`,
over the unchanged map. Order inside the sheet:

1. greeting,
2. primary CTA (`Where to?` / online toggle / vehicle prompt) — still
   gated by the location `status`,
3. **In progress** section header + `TripCard` rows (hidden when empty),
4. **Scheduled** section header + `TripCard` rows (rider only; hidden when
   empty).

Crucial detail: the ride sections render **independent of the location
`status`** (they key off `userId`, not location), so a user who has an
active ride but is currently `permission_denied` / `out_of_coverage` can
still see and resume it. Only the CTA is status-gated.

Reuse the existing `TripCard` (status pill, endpoints, fare) and, where a
plain list is convenient, `TripList`. Tap → `onSelectRide`.

### 4. TripCard — show the scheduled pickup time

`TripCard` currently always renders `formatTimestamp(ride.createdAt)`.
For rides with a `schedulePickupAt`, render "Scheduled for {pickup time}"
instead (legacy parity: "Scheduled for: Tomorrow at 3:45 PM"). Small,
contained change in the one component; covered by an added render test.

## Component / data isolation

- **`observeInProgressRidesBy*`** (repo) — "give me a live list of this
  user's currently-happening rides". One job; tested via the in-memory
  fake.
- **`ObserveInProgressRides`** (use case) — domain entry point; no
  Firestore knowledge.
- **`useScheduledRidesSubscription`** (shared hook) — one implementation
  of the scheduled live read, consumed by Home + Activity.
- **Home view-models** — compose the two subscriptions into flat section
  arrays + tap handlers; no navigation logic beyond `navigate`.
- **`TripCard` / `TripList`** — presentational; unchanged contract aside
  from the schedule-time line.

Each is understandable and testable in isolation; changing the Firestore
query shape doesn't touch the screens, and changing the sheet layout
doesn't touch the data layer.

## Phase 2 (out of scope here — separate plan)

Driver-accept-scheduled, to fill the driver Scheduled section:

- `Ride.acceptSchedule({ driver, at })` transition
  (`scheduled → scheduled_driver_accepted`).
- `AcceptScheduledRide` use case + repository write.
- An "available scheduled rides" feed for drivers (observe `scheduled`
  rides in-area, by service + geo, mirroring `ListAvailableRides`).
- `observeScheduledRidesByDriver` + the driver Home Scheduled section.
- DriverDispatch UI to accept a scheduled ride; queue handling for
  multiple accepted scheduled rides (which one to start when pickup nears).

## Testing

**Remove:** the three banner tests; the route-once tests in
`useRiderHomeViewModel.test.tsx` / `useDriverHomeViewModel.test.tsx`
(auto-route no longer exists).

**Add:**

- In-memory fake: `observeInProgressRidesBy{Passenger,Driver}` emits the
  seeded LIVE rides, re-emits on mutation, unsubscribe stops emissions.
- `ObserveInProgressRides` use case: delegates to the repo, returns the
  unsubscribe.
- Home view-models: `inProgressRides` / `scheduledRides` populate from the
  subscriptions; `onSelectRide` navigates to the correct monitor with the
  right `rideId`; **no** auto-route fires on focus; sections render even
  when location `status` is not `ready`.
- Home screens: In-progress / Scheduled sections show rows when present
  and are hidden when empty; tapping a row fires `onSelectRide`; CTA stays
  status-gated.
- `TripCard`: renders "Scheduled for …" when `schedulePickupAt` is set,
  the created-at line otherwise.

**Manual / Maestro** (driver=Android, rider=iOS): with an active ride,
confirm Home shows it as a row, every tab is reachable (no trap), tapping
the row opens the monitor, the row clears on completion/cancel, and a
scheduled ride (rider) appears in Scheduled. Update the e2e docs/flows
that reference the banner (`e2e/maestro/README.md`,
`e2e/maestro/auth/sign-out.yaml` note) to the list behavior.

## Files touched (anticipated)

**Deleted:** `ActiveRideBanner.tsx`, `useRiderActiveRideBannerViewModel.ts`,
`useDriverActiveRideBannerViewModel.ts` (+ their tests).

**Domain/data/app:** `RideRepository.ts` (interface),
`FirestoreRideRepository.ts`, `InMemoryRideRepository.ts`,
`ObserveInProgressRides.ts` (new use case), `container.ts` (wiring).

**Presentation:** `RiderTabsNavigator.tsx`, `DriverTabsNavigator.tsx`
(revert), `useRiderHomeViewModel.ts`, `useDriverHomeViewModel.ts`,
`RiderHomeScreen.tsx`, `DriverHomeScreen.tsx`, a new
`useScheduledRidesSubscription` hook + `useActivityViewModel.ts` refactored
to consume it, `TripCard.tsx` (schedule-time line). Plus the corresponding
test files.

**Docs/e2e:** `e2e/maestro/README.md`, `e2e/maestro/auth/sign-out.yaml`.

## Git strategy

The `feat/active-ride-banner` branch's only content vs `main` is the
banner + auto-route commits (which this work removes) plus two unrelated
keepers (`chore: gitignore .env.e2e`, the CLAUDE.md doc fix). Interactive
rebase isn't available here, so **build forward**: continue on this branch
(optionally renamed to `feat/home-ride-list`) with new commits that remove
the banner and add the list, and **squash-merge** so the net diff that
lands on `main` is "list, no banner". (Alternative: branch fresh off
`main` and cherry-pick only the two keeper commits — cleaner history, more
work; not required if squash-merging.)

## Assumptions to verify during planning

- Firestore composite-index needs for `driver.id + status IN (…)` and
  `passenger.id + status IN (…)` live observes (the scheduled observe and
  `useInProgressDriverRideQuery` suggest both paths already exist).
- Exact `TestContainerProvider` override surface for the new use case
  (the rides-repo injection should cover it).
- The bounded-sheet height that keeps the map usable on small devices.
