# Phase 4 — Turn 2: DriverHome (map + nearby rides + online toggle)

The first user-facing driver surface is live. Toggling online wires the
foreground location pipeline, kicks off the `ListAvailableRides`
subscription, and renders incoming-ride cards in the bottom panel.
Tapping a card navigates to a `DriverDispatch` placeholder route — the
real accept/decline flow lands in Turn 3.

## What's in

### Domain — repository contract

`src/domain/repositories/RideRepository.ts`:

- New `listByDriver({ driverId, statuses?, limit? }): Promise<Result<readonly Ride[], NetworkError>>`.
  Mirror of the existing `listByPassenger`. Excludes rides with no
  driver yet (`driver === null`) — that's `subscribeAvailableRides`'s
  territory.

### Data — adapters

- `src/shared/testing/InMemoryRideRepository.ts` — `listByDriver`
  filters on `r.driver?.id`, sorted newest-first, optional status +
  limit slicing. New contract tests cover three scenarios (matching
  rides, awaiting-driver exclusion, status filter).
- `src/data/repositories/FirestoreRideRepository.ts` — same shape as
  `listByPassenger`: server-side `where('driver.id', '==', ...)` +
  `orderBy('createdDateTime', 'desc')`, client-side status filter to
  avoid a composite-index requirement (legacy did the same).

### App — use case

`src/app/usecases/ride/ListRidesByDriver.ts` — thin forwarder. New
test file covers 5 scenarios: matching rides newest-first,
awaiting-driver exclusion, status filter, limit honored, empty list.
Wired into `UseCases` + `makeUseCases` in the DI container.

### Presentation — queries

`src/presentation/queries/ride.queries.ts`:

- `useInProgressDriverRideQuery(driverId)` — driver-side equivalent of
  `useInProgressRideQuery`. Filters to a strict subset of active
  statuses (drivers can't be assigned to `awaiting_driver` /
  `scheduled`), `limit: 1` so DriverHome resumes into the one ride
  the driver has mid-flight.
- `useAvailableRidesQuery({ driverId, services, driverLocation, enabled })`
  — subscription-shaped. Wraps `ListAvailableRides` via the existing
  `useUseCaseSubscription`. The `enabled` flag gates whether the hook
  actually subscribes; when disabled (driver offline / location not
  yet available / no services) the inner subscriber is a no-op that
  emits `[]` once. Same Rules-of-Hooks-friendly pattern used by other
  conditionally-active subscriptions in the rewrite.

`src/presentation/queries/keys.ts`:

- New `queryKeys.ride.listByDriver(driverId, statuses)` and
  `listsForDriver(driverId)` (sweep-invalidation prefix).
- New `queryKeys.ride.available({ driverId, services, lat, lng })` —
  keyed on rounded lat/lng (5 decimals, ~1m) so trivial GPS jitter
  doesn't churn the cache, and on the sorted services list so different
  service-tier subscriptions stay separate.

### Presentation — view-model

`useDriverHomeViewModel` (`features/driver/view-models/`):

- Composes `useCurrentUserQuery`, `useCurrentLocation`,
  `useActiveServiceAreaQuery(coords)`, `useRideServicesQuery(areaId)`,
  `useUpdateLocationMutation`, `useAvailableRidesQuery(...)`,
  `useInProgressDriverRideQuery(driverId)`, plus the
  `useDriverStatusStore` for client-side mode + active vehicle.
- Pushes the resolved active service area into `useServiceAreaStore`
  (parity with the rider-home VM — keeps the global store in sync so
  follow-on screens read it without re-querying).
- Pushes the driver's foreground location to Firestore on every fresh
  coordinate read, with the same identity-dedup `useRef` pattern used
  by the rider-home VM. Phase 7 swaps this for the background-aware
  GPS lifecycle.
- `onToggleOnline()`: when going online, seeds `activeVehicleId` from
  the user doc's `activeVehicleId` field if present (the field already
  exists on the `Driver` entity from Phase 1). Falls back to
  `'vehicle-stub'` so testers without a real vehicle can still go
  online. Phase 5 introduces the real selection UI; the fallback
  goes away then.
- `onSelectRide(rideId)`: navigates to `DriverDispatch`. Turn 3 wires
  the real flow.
- `onResumeInProgress(rideId)`: same target for now. Turn 4 swaps to
  `DriverMonitor`.
- `useFocusEffect`-driven auto-redirect: when an in-progress driver
  ride exists, push to `DriverDispatch` with that rideId. (Same Turn 4
  redirect-target swap applies.)
- Status enum follows the rider-home shape: `'loading' |
'permission_denied' | 'out_of_coverage' | 'ready'`.

### Presentation — components + screen

- `features/driver/components/DriverRideCard.tsx` — single card with
  service-tier label, distance-from-driver (Haversine), pickup +
  dropoff names, and the rider's planned distance/duration text from
  `ride.dropoff.directions`.
- `features/driver/components/DriverRideCardStack.tsx` — wraps the
  bottom-panel list with an empty-state ("Waiting for rides…") for
  when no rides are nearby.
- `features/driver/screens/DriverHomeScreen.tsx` — full-bleed map
  (driver's "you are here" marker), top status banner identical in
  shape to RiderHome (loading / permission_denied / out_of_coverage /
  error), and a bottom action panel containing (when online) the ride
  card stack plus the online/offline toggle.

### Presentation — navigation

- `DriverStackParamList` extended with `DriverDispatch: { rideId: string }`.
- `DriverNavigator` registers `DriverDispatch` pointing at a
  `DriverDispatchPlaceholderScreen` (Turn 3 swaps for the real screen).
- `DriverTabsNavigator` swaps `DriverHomePlaceholderScreen` for the
  real `DriverHomeScreen`.

### Cleanup

- `DriverHomePlaceholderScreen.tsx` collapsed to `export {};`. Sandbox
  can't `rm`. User cleanup:
  ```
  git rm -f src/presentation/features/driver/screens/DriverHomePlaceholderScreen.tsx
  ```

## Test counts (delta from Phase 4 turn 1)

| Category    | New tests                    |
| ----------- | ---------------------------- |
| Adapters    | `InMemoryRideRepository` (3) |
| Use cases   | `ListRidesByDriver` (5)      |
| View-models | `useDriverHomeViewModel` (7) |

15 new tests on top of turn 1's 524.

The view-model tests cover: status reaches `'ready'` with seeded user +
location + area; offline → empty rides; `onToggleOnline` flips mode +
seeds vehicle id from the user doc; live rides land once online with a
seeded ride nearby; toggling offline tears the subscription back down;
`onSelectRide` navigates to `DriverDispatch`; in-progress redirect
fires on focus.

**Total: 539 tests / 77 suites passing** (+15 vs. turn 1's 524). Suite
count moved 75 → 77 — two new test files (`ListRidesByDriver.test.ts`,
`useDriverHomeViewModel.test.tsx`).

## Manual smoke

Steps to exercise Turn 2 end-to-end:

1. Sign in as a driver (or register fresh with role=Driver). Land on
   `DriverNavigator` → `DriverTabs` → `DriverHomeScreen`.
2. Confirm the map renders with a "you are here" marker. Status banner
   doesn't appear when location + area resolve.
3. With the driver offline, the bottom panel shows the "Hi, {name} 👋"
   greeting + the "Go online" CTA. The available-rides subscription is
   inactive (no DB read).
4. Tap "Go online". The toggle button label flips to "Go offline"; the
   `useAvailableRidesQuery` subscription kicks in and the bottom panel
   shows "Waiting for rides…" if no rides are nearby.
5. Have a rider on a second device create a ride (or seed one in
   Firestore by hand). Within ~1s the new ride appears as a card with
   the pickup name, distance from driver, and trip duration.
6. Tap the card → land on `DriverDispatchPlaceholderScreen` showing the
   rideId. Back to DriverHome works as expected.
7. Toggle offline → ride cards disappear, subscription closes.
8. Cold-launch with an in-progress dispatched ride for this driver →
   the focus effect pushes you straight to `DriverDispatch` (with the
   correct rideId).

Real-Firebase smoke (rider on iPhone, driver on Android) is the full
end-to-end gate; the in-memory test suite covers the contracts.

## What's deferred to Turn 3

- **Real `DriverDispatchScreen`** — incoming-ride accept/decline UI with
  the pickup-route preview map. The view-model wires `DispatchRide`
  (already on the container) on accept; decline returns to `DriverHome`.
- **Pickup-route polyline on the map** — once a driver accepts, the
  Google Routes call for driver → pickup happens server-side or in the
  view-model; the polyline renders on the active-trip surface. Turn 4a
  may handle this on the `DriverMonitor` map instead.
- **Notification listener** — the legacy app subscribes to FCM for
  ride-request push, so a driver who's offline but has the app open
  still sees an incoming-ride banner. Push lives in Phase 9; the live
  Firestore subscription via `useAvailableRidesQuery` handles the
  in-app case for Turns 2–4.

## Risks / known issues to watch on first real-Firebase boot

- **`available` query-key churn at high driver speed.** Coarsened to
  5 decimals (~1m) — fine for stationary or slow-moving drivers.
  Highway-speed drivers will see a fresh subscription every 4–5
  emissions of `useCurrentLocation`. Phase 7's `useGpsLifecycle` adds
  proper distance-filter throttling; until then this is acceptable
  because the screen is foreground-only and the legacy app threw away
  rides at the same rate when re-querying.
- **Ride card distance label uses Haversine straight-line, not road
  distance.** Matches legacy. The driver sees "0.8 mi away" but the
  actual drive may be longer due to one-ways or geography. This is by
  design — pre-accept, we don't pay for a Routes call to label cards.
- **`activeVehicleId` fallback is `'vehicle-stub'`.** Real vehicle
  selection (Phase 5) writes a meaningful id to `user.activeVehicleId`,
  at which point the fallback is dead code. Don't ship Turn 2 to
  external drivers — Phase 5 has to land first or the placeholder
  vehicle id flows into Cloud Functions.
- **No coverage gating on the online toggle.** The `out_of_coverage`
  status disables the toggle visually (the screen falls back to
  "loading" / "out_of_coverage" banners), but the `onToggleOnline`
  callback itself doesn't refuse the call — Turn 3's accept flow will
  validate that the driver is in-coverage when an offer arrives, which
  closes the loophole.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | ✅     |
| 3    | DriverDispatch — incoming-ride accept/decline              | Next   |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | —      |
| 4b   | DriverMonitor late-status views + start/requestPayment     | —      |
| 5    | Phase 4 cleanup + CLAUDE.md update                         | —      |

Turn 3 takes the next obvious step: a real `DriverDispatchScreen` view
that calls `DispatchRide` on accept and routes the driver into the
(still-coming) `DriverMonitor` surface, falling back to home on
decline.
