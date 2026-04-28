# Phase 4 — Turn 1: Driver foundations

The first Phase 4 turn. The driver shell is no longer a one-screen
placeholder: a real bottom-tab navigator is mounted (Home / Activity /
Earnings / Profile) and a new `useDriverStatusStore` carries the
client-side driver state (offline / online_idle / dispatched / on_trip
plus the active vehicle id). Turn 2 drops the real `DriverHome` map +
nearby-rides UI into this harness.

This turn deliberately does not wire location, ride subscriptions, or
any new use cases. Every driver-side use case Phase 4 needs is already
on the DI container from Phase 2 / 3 (`listAvailableRides`,
`dispatchRide`, `startRide`, `requestPayment`, `cancelRideByDriver`,
`observeRide`, `observeTripEvents`, `subscribeToUserLocation`,
`updateUserLocation`). Turn 2 starts consuming them.

## What's in

### Presentation — store

`src/presentation/stores/useDriverStatusStore.ts`:

- `mode: 'offline' | 'online_idle' | 'dispatched' | 'on_trip'`. The first
  two are pure client choice (the driver chooses to advertise);
  `dispatched` and `on_trip` are mirrored from the live ride status by
  the DriverMonitor view-model in later turns.
- `activeVehicleId: string | null` — UI choice for which vehicle the
  driver is advertising. Plain string slot for now; Phase 5 introduces
  a `VehicleId` branded type and a real selection screen, at which
  point this field gets re-typed.
- Action methods: `goOnline(vehicleId)`, `goOffline()`, `setMode(mode)`,
  `reset()`. `setMode` deliberately does not touch
  `activeVehicleId` — once a driver is on a trip, the vehicle stays
  locked in.
- Selector hooks: `useDriverMode`, `useActiveVehicleId`,
  `useIsDriverOnline`. Surface re-exported from
  `@presentation/stores`.

### Presentation — navigation

- `src/presentation/navigation/DriverTabsNavigator.tsx` — new
  `createBottomTabNavigator<DriverTabsParamList>()` mirroring
  `RiderTabsNavigator` exactly. Mounts `DriverHomePlaceholderScreen` /
  `DriverActivityPlaceholderScreen` /
  `DriverEarningsPlaceholderScreen` plus the shared
  `UserProfileScreen` for the Profile tab.
- `src/presentation/navigation/DriverNavigator.tsx` rewritten — the
  Phase-3-turn-3 single-placeholder stub is gone. Now a native-stack
  hosting `DriverTabs` as `initialRouteName` plus a modal `UserProfile`
  push (parity with the rider stack). DriverDispatch and DriverMonitor
  routes get added in Turns 3 / 4.
- `src/presentation/navigation/types.ts` — new `DriverTabsParamList`,
  expanded `DriverStackParamList` (`DriverTabs` +
  `UserProfile`), new `DriverTabsScreenProps` and
  `DriverTabsNavigation` aliases.

### Presentation — screens

- `DriverHomePlaceholderScreen` — placeholder with an online/offline
  toggle wired to the new store. Lets a tester verify the store ↔ UI
  loop without committing to map UI. Turn 2 replaces this with the real
  DriverHome.
- `DriverActivityPlaceholderScreen` — "lands in Phase 5".
- `DriverEarningsPlaceholderScreen` — "lands in Phase 6".
- `DriverPlaceholderScreen.tsx` (the old one-off) is collapsed to
  `export {};` because the sandbox running this turn couldn't `rm`.
  User cleanup:
  ```
  git rm -f src/presentation/features/driver/screens/DriverPlaceholderScreen.tsx
  ```

## Test counts (delta from Phase 3 turn 5)

| Category | New tests                  |
| -------- | -------------------------- |
| Stores   | `useDriverStatusStore` (7) |

7 new tests on top of turn 3.5's 518 (initial state, `goOnline`,
`goOffline`, `setMode` from `online_idle` to `dispatched`, `setMode`
from `dispatched` to `on_trip`, `reset`, subscriber notification).

The placeholder-tab screens deliberately have no rendering tests. They
match the existing rider-placeholder convention (no
`ActivityPlaceholderScreen.test.tsx` / `WalletPlaceholderScreen.test.tsx`
exist either) and the `DriverHomePlaceholderScreen` is a temporary
harness — Turn 2 swaps it out for a real screen with a real view-model
that gets the proper unit-test coverage.

**Total: 524 tests / 75 suites passing** (+6 vs. turn 3.5's 518). Suite
count is unchanged: 75 → 75. The new store test added one new file
(`useDriverStatusStore.test.ts`); the GreetUser placeholder collapse
from turn 3.5 still occupies one suite slot, so the net suite delta is
zero. (When the user `git rm`s `GreetUser.{ts,test.ts}` and the
collapsed `DriverPlaceholderScreen.tsx`, suite count drops to 74.)

## Manual smoke (against in-memory fakes and against real Firebase)

Steps to exercise Turn 1 end-to-end:

1. Sign out of any existing session.
2. Register a fresh user with the rider/driver toggle set to **Driver**.
3. Verify email (in-memory fakes auto-verify; real Firebase needs the
   real verification email link).
4. `RootNavigator` → `AuthenticatedNavigator` reads the user doc, sees
   `role: 'driver'`, and mounts `DriverNavigator`.
5. The bottom tabs render: Home / Activity / Earnings / Profile.
6. Home tab — current mode shows `offline`, vehicle shows `—`. Tap
   "Go online" → mode flips to `online_idle`, vehicle shows
   `vehicle-stub`. Tap "Go offline" → both reset. The on-screen labels
   update synchronously with the store, confirming the selector hooks
   re-render correctly.
7. Activity / Earnings tabs render their "lands in Phase X" placeholders.
8. Profile tab opens the shared `UserProfileScreen`. Sign Out returns to
   `AuthNavigator`.

The rider flow stays untouched: re-register a fresh user as a rider
and confirm the full Phase 3 journey still runs (RouteSearch →
RouteSelect → CreateRide → RideMonitor → RideReceipt). The verify
gates catch any regression here automatically — no manual rider smoke
required per turn.

## Acceptance for turn 1

`npm run verify`:

- **`npm test`** — 524 tests / 75 suites passing.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors (the `boundaries/element-types`
  deprecation warnings are pre-existing).
- **`npm run format:check`** — clean.

End-to-end: a freshly-registered driver lands on `DriverNavigator` →
`DriverTabs`, can flip the home-tab online toggle, and reach all four
tabs.

## What's deferred to Turn 2

- **Real `DriverHomeScreen`** — map-first surface with foreground
  location pipeline (via `TrackLocation` / `subscribeToUserLocation`),
  active service-area resolution, and `ListAvailableRides` subscription
  rendering nearby ride cards.
- **`useDriverHomeViewModel`** — owns the online-toggle wiring,
  geo-queries, ride-card stack ordering. Mirrors
  `useRiderHomeViewModel` shape.
- **Resume-active-ride redirect** — when the driver has an in-progress
  ride, push to `DriverMonitor` on focus. The use case
  (`listRidesByPassenger`-equivalent for drivers) needs a small
  addition; turn 2 either reuses an existing query or adds a
  `useInProgressDriverRideQuery` factory.
- **Reading `activeVehicleId` from `user.services.ride`** — Turn 1
  hard-codes a `vehicle-stub` placeholder. Turn 2 seeds the store from
  the user doc on online-toggle.

## Risks / known issues to watch on first real-Firebase boot

- **Driver registration on Android needs the SHA-1 added to the Firebase
  Android app config** (same as the rider-side issue documented in
  `CLAUDE.md`). If `auth/internal-error` shows up on the first signup,
  re-add the debug SHA-1 and replace `google-services.json`.
- **Suite count parity**. The collapsed `DriverPlaceholderScreen.tsx` +
  `GreetUser.{ts,test.ts}` still occupy disk; the user's `git rm` is
  the cleanup step that takes the suite count from 75 down to 74.

## Phase 4 progression after this turn

| Turn | Scope                                                      | Status |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | Foundations: navigator + tabs + store                      | ✅     |
| 2    | DriverHome — map + ListAvailableRides cards + GPS toggle   | Next   |
| 3    | DriverDispatch — incoming-ride accept/decline              | —      |
| 4a   | DriverMonitor scaffold + en-route / at-pickup status views | —      |
| 4b   | DriverMonitor late-status views + start/requestPayment     | —      |
| 5    | Phase 4 cleanup + CLAUDE.md update                         | —      |

Phase 4 acceptance: a signed-in driver can run a full ride end-to-end
on real Firebase against a rider on a second device. Phase 4 turn 1
opens the door; the next four turns walk through it.
