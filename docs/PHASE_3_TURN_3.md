# Phase 3 — Turn 3: RiderHome + role-based routing

The first turn where the app stops looking like a Phase 1 placeholder. A
signed-in rider lands on a real `RiderHome` (full-bleed map, "Where to?"
CTA, location + service-area resolution), can plan and confirm a ride
end-to-end (RouteSearch → RouteSelect → CreateRide → RideMonitor), and
gets auto-resumed into RideMonitor on cold-launch when an active ride
exists. Drivers land on a Phase 4 placeholder.

## What's in

### Domain + repositories

- `RideRepository.newId()` — new method on the contract. The Firestore
  adapter generates a fresh auto-id via `doc(collection)` (no write).
  The in-memory fake mirrors a 20-char alphanumeric so tests against
  `RideId.create()`'s validation regex pass without surprises. Exists
  so the `CreateRide` use case can mint ids without leaking the repo
  to presentation.

### App layer

- `CreateRide` refactored — now takes a `CreateRideInput` spec
  (passenger snapshot, ride-service snapshot, pickup, dropoff,
  createdAt, optional routePreference / driver) and internally
  mints the id + builds the `Ride` aggregate + persists. Frees the
  view-model from a repo dependency. The use case is the natural
  owner of "creating a ride from parts" anyway.

### Presentation — queries & hooks

- `useCurrentUserQuery` (`presentation/queries/user.queries.ts`) —
  TanStack-Query wrapper around `GetCurrentUser`. Enabled only when the
  session store has a userId. Returns `AuthorizationError | NotFoundError`
  on the error channel.
- `useCurrentLocation` (`presentation/hooks/useCurrentLocation.ts`) —
  foreground-only `expo-location` read, returning a
  `Coordinates | null` plus the permission status. **Phase 4 owns the
  full GPS lifecycle** (start/stop, geofence registration, dedup); this
  hook is the foreground stop-gap for RiderHome's map + service-area
  resolution.

### Presentation — feature screens (`presentation/features/rider/`)

- `useRiderHomeViewModel` — composes `useCurrentUserQuery` +
  `useCurrentLocation` + `useActiveServiceAreaQuery` +
  `useInProgressRideQuery` + `useUpdateLocationMutation`. Auto-redirects
  via `useFocusEffect` to RideMonitor when an in-progress ride exists.
  Pushes the resolved active area into `useServiceAreaStore` so RouteSearch
  picks it up.
- `RiderHomeScreen` — full-bleed Map, top status banner (loading /
  permission-denied / out-of-coverage / sensor-error), bottom
  action-card with greeting + "Where to?" CTA.
- `RideMonitorScreen` and `RideReceiptScreen` — turn-3.3 placeholders
  with rideId display + simple navigation. Real implementations land in
  3.4 (RideMonitor) and 3.5 (RideReceipt).
- `ActivityPlaceholderScreen` and `WalletPlaceholderScreen` — Phase
  5 / Phase 6 tab placeholders.

`useRouteSelectViewModel.confirm()` rewritten:

- Was: `() => boolean` stub.
- Now: `() => Promise<RideId | null>`. Builds passenger + ride-service
  snapshots from the current user + selected tier, attaches the
  selected route's directions to the dropoff endpoint, calls
  `useCreateRideMutation`, resets the trip-draft on success, returns
  the new id.
- Surfaces `submitError` and `isSubmitting` so the screen can render
  inline error + spinner states.

### Presentation — feature screens (`presentation/features/driver/`)

- `DriverPlaceholderScreen` — friendly "driver flows land in Phase 4"
  copy with sign-out CTA. Sole screen in `DriverNavigator` for now.

### Navigation

- New navigators:
  - `RiderTabsNavigator` — bottom tabs: Home (live), Activity, Wallet,
    Profile.
  - `RiderNavigator` — native-stack hosting `RiderTabs` + RouteSearch +
    RouteSelect + RideMonitor + RideReceipt + UserProfile (modal).
  - `DriverNavigator` — single-screen placeholder.
- `RootNavigator` rewired:
  - `initializing` → splash
  - `unauthenticated` → AuthNavigator
  - `needs-verification` → VerifyEmailNavigator
  - `authenticated` → reads `useCurrentUserQuery`; on
    `data.role === 'driver'` mounts DriverNavigator, else RiderNavigator.
  - User-doc loading → splash; user-doc error → friendly retry +
    sign-out escape hatch.
- `MainStackParamList` retired in favor of:
  - `RiderStackParamList` (with `RideMonitor: { rideId: string }` and
    `RideReceipt: { rideId: string }` carrying the trip id),
  - `RiderTabsParamList`, and
  - `DriverStackParamList`.
- `MainNavigator.tsx`, `HomePlaceholderScreen.tsx`, `HelloYeRideScreen*`
  retired (sandbox couldn't `rm` so the files now contain only an
  `export {};` with a `git rm` reminder; safe to delete in a follow-up).

### Native deps

- `expo-location@~55.1.8` installed; foreground permission strings
  configured via the `expo-location` plugin in `app.config.ts`.

### Test infrastructure

- `TestContainerProvider` wraps children in a `QueryClientProvider`
  with a fresh `QueryClient` per test. View-models that compose
  TanStack queries / mutations (now most of them) work out-of-the-box;
  no per-test boilerplate.

## Test counts (delta from turn 3.2)

| Category    | New tests                   |
| ----------- | --------------------------- |
| View-models | `useRiderHomeViewModel` (4) |

**4 new tests** on top of turn 3.2's 501 = **505 tests / 73 suites
passing**, all four verify gates green.

The existing `useRouteSelectViewModel` test suite (8 tests) survived
the `confirm()` rewrite without modification — the suite asserts route
loading, fare derivation, error surfacing, and the `canConfirm`
predicate, none of which changed shape. Submit-path tests for the new
`confirm()` flow land alongside the 3.4 RideMonitor view-model tests
since they both depend on the rider-flow seed.

## What's deferred to later turns

- **Branded marker styling on RiderHome** — the "you are here" pin
  reuses the gold pickup-marker slot for now. Custom `<View>` inside
  `<Marker>` lands in turn 3.4 alongside the RideMonitor markers.
- **`tabBarIcon`s** — labels-only for now. Icon set ports in 3.5.
- **Map fit-to-coordinates** — none of the screens need imperative fit
  yet; turn 3.4's RideMonitor will introduce a ref-based API.
- **Location push throttling** — the view-model dedups identical
  coordinates against a ref but doesn't time-throttle. Phase 4's
  `useGpsLifecycle` adds 3-second throttling to match legacy.
- **Background GPS, geofence registration, listener-level dedup** —
  Phase 4 owns all of it. Foreground reads via `useCurrentLocation` are
  the Phase 3 stop-gap.
- **`MainNavigator.tsx` / `HomePlaceholderScreen.tsx` / `HelloYeRideScreen*`**
  — replaced with `export {};` bodies; pending a `git rm` cleanup.

## Acceptance for turn 3

`npm run verify`:

- **`npm test`** — 505 tests / 73 suites passing (up from 501 / 72).
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors.
- **`npm run format:check`** — clean.

End-to-end happy path (against the in-memory fakes): sign-in → rider
lands on RiderHome → "Where to?" → autocomplete → continue → routes
load → tier picked → confirm → RideMonitor placeholder shows the new
ride id. Cold-launch with an in-progress ride lands directly on
RideMonitor.

## Risks / known issues to watch on first real-Maps + real-Firebase boot

- **expo-location permission prompt timing** — first prompt only
  appears once per install. If it never shows on iOS, check that
  `NSLocationWhenInUseUsageDescription` got into Info.plist via the
  `expo-location` plugin (look at `ios/YeRideNext/Info.plist` after
  prebuild).
- **`useCurrentUserQuery` race vs. AppContent's `setSignedIn`** — the
  query is gated on `useCurrentUserId()` so it should fire only after
  the session store has the uid. If RootNavigator flashes the
  AuthNavigator briefly during sign-in, the gate isn't holding;
  AppContent's auth-state observer is the canonical source.
- **Auto-redirect loop guard** — `useRiderHomeViewModel`'s
  `useFocusEffect` redirects to RideMonitor whenever an in-progress
  ride exists. If RideMonitor's exit-to-home path leaves the ride
  visible to `useInProgressRideQuery`, the loop bounces. Turn 3.4's
  RideMonitor must call `cancelRideAsRider` (or wait for the trip to
  reach a terminal state) before navigating back to Home; never just
  `popToTop` against an active ride.
