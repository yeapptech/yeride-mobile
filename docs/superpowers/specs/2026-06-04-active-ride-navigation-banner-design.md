# Active-Ride Navigation: Stop Trapping Users on the Monitor

**Date:** 2026-06-04
**Status:** Approved design — ready for implementation plan

## Problem

A user (rider or driver) with an active ride is auto-routed to the ride
monitor and cannot reach any other tab — Profile, Sign-out, Wallet,
Earnings — until the ride reaches a terminal status (`completed` /
`cancelled`).

The trap is a `useFocusEffect` in each home view-model that re-routes to
the monitor **every time the home tab regains focus**. Backing out of the
monitor returns to the tabs, but the instant the home tab focuses, the
effect re-fires and bounces the user straight back. Profile (a tab inside
the tabs navigator) is therefore unreachable mid-ride.

- Rider: `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts:142-157`
  — `useFocusEffect` → `navigation.reset([RiderTabs, RideMonitor])`.
- Driver: `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts:213-221`
  — `useFocusEffect` → `navigation.navigate('DriverMonitor', …)`.

Both navigators are bottom-tab navigators (`RiderTabsNavigator`,
`DriverTabsNavigator`) with a shared `UserProfileScreen` mounted as the
`Profile` tab. The monitor screens (`RideMonitor`, `DriverMonitor`) are
stack screens mounted **above** the tabs in the parent stack navigators.

## Goal

Free navigation during an active ride, with an easy, always-visible way
back to the live ride.

- The user lands on the monitor **once** when a ride first becomes active
  (preserve the existing first-landing behavior — it confirms the request
  went through).
- After that, the user can freely roam all tabs.
- A persistent top banner on every tab offers one-tap return to the
  monitor while a ride is active, and disappears on terminal status.
- Applies symmetrically to riders and drivers.

## Design

Two independent pieces, applied to both rider and driver sides.

### Piece 1 — Route once per ride (kill the trap)

Replace the focus-fired re-route with a deduped, route-once effect.

Track the last ride id routed to via a `useRef<string | null>`. When the
active ride's id differs from the ref, perform the existing navigation and
record the id. On every subsequent focus the id matches → no re-route → the
user stays wherever they navigated. A genuinely new ride (different id)
routes once again.

**Rider** (`useRiderHomeViewModel.ts`): keep the existing
`navigation.reset({ index: 1, routes: [{ name: 'RiderTabs' }, { name:
'RideMonitor', params: { rideId } }] })` shape unchanged. This `reset`
shape is load-bearing: when the ride completes, `RideMonitor` does
`replace('RideReceipt', …)`, and the Done button's `popToTop()` needs
`RiderTabs` underneath to pop to. Only the _trigger_ changes
(focus-every-time → once-per-ride), not the navigation call.

**Driver** (`useDriverHomeViewModel.ts`): keep the existing
`navigation.navigate('DriverMonitor', { rideId })` call unchanged. The
driver side deliberately uses `navigate` (no RideReceipt-popToTop
constraint); preserving it is the surgical choice. Again, only the trigger
changes.

**Cold-start behavior (intentional):** opening the app mid-ride routes once
to the monitor (ref starts empty), which is the desired "land on the live
ride" behavior. It is not a trap — backing out stays out, because the ref
is now set for that ride id.

The `useRef` persists across focus cycles because the home tab stays
mounted inside its bottom-tab navigator (tabs are not unmounted on
blur, and the `reset` keeps the tabs entry at index 0).

### Piece 2 — Persistent active-ride banner

A top-pinned banner, mounted once per tabs navigator, offering one-tap
return to the live ride.

**Placement:** Inside `RiderTabsNavigator` / `DriverTabsNavigator`, wrap
`<Tabs.Navigator>` in a `<View>` and render the banner as a sibling above
it. Use `useSafeAreaInsets()` for the top inset so it clears the notch. The
banner occupies layout space (pushes tab content down) rather than floating,
so it never overlaps screen content or headers.

**Scope:** Because the banner lives inside the tabs navigator, it shows on
all four tabs but **not** on the monitor screens, `DriverDispatch`
(ephemeral accept/decline offer), or `DriverNavigation` (full-screen
turn-by-turn) — those are stack screens above the tabs. This is exactly the
desired scope; no extra guarding needed.

**Visibility & data:** Driven purely by the existing active-ride queries —
no new Zustand state.

- Rider: `useInProgressRideQuery` (active statuses: `awaiting_driver`,
  `scheduled_driver_accepted`, `dispatched`, `started`,
  `payment_requested`, `payment_failed`).
- Driver: `useInProgressDriverRideQuery` (active statuses:
  `scheduled_driver_accepted`, `dispatched`, `started`,
  `payment_requested`, `payment_failed`).

TanStack dedups by query key, so the banner's read shares the home
view-model's existing subscription — no extra network cost. Terminal /
no-ride → query returns `null` → banner unmounts.

**Status-aware label:** The banner text reflects `Ride.status`.

| Status                      | Rider label                    | Driver label                   |
| --------------------------- | ------------------------------ | ------------------------------ |
| `awaiting_driver`           | Finding your driver            | — (not a driver-active status) |
| `scheduled_driver_accepted` | Driver assigned                | Pickup scheduled               |
| `dispatched`                | Driver on the way              | Heading to pickup              |
| `started`                   | On your trip                   | Trip in progress               |
| `payment_requested`         | Wrapping up                    | Awaiting payment               |
| `payment_failed`            | Payment issue — tap to resolve | Payment issue                  |

(Exact copy can be refined during implementation; the mapping is the
contract.)

**Contents:** Left — a live indicator (pulsing dot or small ride icon) +
the status label. Right — a chevron / "Return" affordance. The whole row is
one tappable element. Styled with the "Honey and the Bee" NativeWind
tokens to match existing components.

**Navigation:** Tapping calls `navigation.navigate('RideMonitor', { rideId })`
(rider) / `navigation.navigate('DriverMonitor', { rideId })` (driver) on the
**parent stack** navigator (the tabs sit at that stack's root, so this
pushes the monitor on top). With the trap removed, the monitor's back
affordance returns to the tabs and stays there — no bounce.

### Component structure

- **Presentational:** one shared dumb `ActiveRideBanner` component
  (`{ visible, statusLabel, onPress }` → JSX; theme-token styled). Renders
  nothing when `visible` is false.
- **View-models:** two thin role-specific hooks following the
  project's per-surface view-model convention:
  - `useRiderActiveRideBannerViewModel` — wires `useInProgressRideQuery`,
    rider status→label map, and parent-stack navigation to `RideMonitor`.
  - `useDriverActiveRideBannerViewModel` — wires
    `useInProgressDriverRideQuery`, driver status→label map, and parent-stack
    navigation to `DriverMonitor`.

This isolates the differing queries / routes / labels while sharing the
presentation. Each view-model is unit-testable in isolation against
in-memory fakes via `TestContainerProvider`; the presentational component
gets a rendered test fed props.

## Out of scope

- `DriverDispatch` and `DriverNavigation` surfaces (banner does not appear
  there; their flows are unchanged).
- Pure `scheduled` rides (driver not yet accepted) — already excluded from
  the active-ride queries; they live in the Activity tab only.
- Tab-bar visual restyling, monitor screen header redesign.
- Any change to the monitor screens' internal status-router views.

## Testing

- **Route-once view-model tests** (rider + driver): a new active ride id
  triggers the navigation call exactly once; subsequent focuses with the
  same id do not re-navigate; a different id re-navigates once. Cold-start
  with an existing ride navigates once.
- **Banner view-model tests** (rider + driver): `visible` toggles with the
  active-ride query; `statusLabel` maps each active status correctly;
  `onPress` navigates to the correct monitor route with the right `rideId`;
  terminal / null ride → `visible` false.
- **Banner component render test:** renders label + return affordance when
  visible; renders nothing when not visible; `onPress` fires on tap.
- **Manual / Maestro:** with an active ride, confirm Profile/Sign-out and
  other tabs are reachable, the banner is present on each tab, tapping it
  returns to the monitor, and the banner disappears on completion/cancel.
  (See the Maestro driver=Android / rider=iOS paired-trip flows.)

## Files touched (anticipated)

- `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts` — trap → route-once.
- `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts` — trap → route-once.
- `src/presentation/navigation/RiderTabsNavigator.tsx` — mount banner.
- `src/presentation/navigation/DriverTabsNavigator.tsx` — mount banner.
- `src/presentation/components/trip/ActiveRideBanner.tsx` — new shared component (sits alongside the existing `trip/` components).
- `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts` — new.
- `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts` — new.
- Sibling test files for each of the above.
