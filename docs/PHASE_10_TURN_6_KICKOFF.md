# Phase 10 Turn 6 Kickoff — Activity tab (rider + driver)

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 5
closed 2026-05-18** (rider live ETA via NavSdk telemetry — end-to-end
pipeline `NavigationService.subscribeToTimeAndDistance` →
`tripTracking.{distanceMeters, durationSeconds, updatedAt}` →
`DispatchedView` / `StartedView` live-prefer-with-static-fallback;
followed by a 2026-05-19 review-fix patch addressing cross-trip
staleness, dispatched→started destination swap, GPS dep churn, and
exact-zero coercion — see `docs/PHASE_10_TURN_5.md`). Audit v2
post-Turn-5 shows **4 ❌ / 1 🟡 / 0 ⚠️**.

Turn 6 closes the **largest user-facing ❌** remaining: §3.3
**Activity tab — rider + driver**. Both the rider and driver tab
slots currently mount `ActivityPlaceholderScreen` /
`DriverActivityPlaceholderScreen`, which render a static "lands in
Phase 5" message plus the dev-only `<DevToolsSection/>`. Users coming
from the legacy app rely on Activity to see past trips and receipts,
so the placeholder is a regression that blocks cutover. This is a
**large turn (3-5d)** spanning all four layers; the audit's §8 row 6
explicitly notes "possibly two turns: one per role." This kickoff
recommends shipping both roles in one turn because the data layer and
list-row UI are identical — splitting would duplicate review effort
without a meaningful safety win.

## Context — why this turn now

The legacy app's Activity tab is wired in
`yeride/src/{rider,driver}/navigation/{Rider,Driver}TabNavigator.js`
as `component={TripHistory}`. `TripHistory.js` is thin — it ONLY
renders `<RecentTrips/>` plus a loading shim — and `RecentTrips.js`
subscribes (`useFocusEffect`) to either `subscribeToDriverRecentTrips`
or `subscribeToPassengerRecentTrips` based on user role, limit 10.
Selecting a row in `RecentTrips` dispatches `getTripById` and
navigates to either:

- `TripPreviewModal` (per-trip details surface) for terminal-status
  trips (`closed` / `passenger_canceled` / `driver_canceled` /
  `payment_failed`), or
- `RideMonitor` / `DriverMonitor` for any non-terminal status (live
  tracking surface).

The legacy `InProgressTrips.js` and `ScheduledTrips.js` components
exist BUT they're rendered on `RiderHome.js` and `DriverHome.js`, NOT
on Activity. So the audit's §3.3 framing —

> "Legacy: Activity tab on BOTH rider and driver renders
> `TripHistory.js`, which composes: `InProgressTrips.js`,
> `ScheduledTrips.js`, `RecentTrips.js`"

— is **slightly wrong about composition**. Legacy Activity = Recent
only. The rewrite has freedom to choose whether Activity in the new
app is also recent-only (parity), or to fold in-progress + scheduled
sections into Activity (deviation, marginally better UX). Decision 1
locks this.

`TripPreviewModal.js` is the legacy post-trip details surface — per
audit §3.7 it was misidentified as a pre-trip preview in v1. It
renders, for a terminal-status trip:

1. PassengerView (driver-facing) / DriverView (rider-facing)
2. TripView (route summary)
3. `TipSelector` (rider + completed/closed + driver has
   `stripeAccountId` — same gate as legacy Wallet's tip path)
4. `TransactionHistory` (per-trip — subscribes to
   `trips/{tripId}/payments` subcollection) — gated on `status ===
   'closed'`
5. `Events` (per-trip event log — subscribes to `trips/{tripId}/events`
   subcollection)

The audit §3.6 (per-trip TransactionHistory) is **folded into this
turn** — it's the same surface, reached only via the Activity-tab
trip-detail navigation.

**Rewrite gap (verified Turn 6 kickoff):**

- `ActivityPlaceholderScreen.tsx` + `DriverActivityPlaceholderScreen.tsx`
  are dummy "lands in Phase 5" cards. Each hosts `<DevToolsSection/>`
  (Crashlytics smoke buttons, hidden in production).
- `ListRidesByPassenger` + `ListRidesByDriver` use cases already
  exist (`src/app/usecases/ride/ListRides*.ts`), backed by
  `FirestoreRideRepository.{listByPassenger,listByDriver}`. Both
  accept optional `statuses?: readonly RideStatus[]` + `limit?:
  number` and order server-side by `createdDateTime desc`. **No
  cursor parameter today** — that's a Turn 6 extension.
- `RideReceiptScreen` ships and routes from `RideMonitor` on the
  rider side for completed trips. The trip-detail surface for trips
  reached from Activity needs to either reuse `RideReceiptScreen` or
  introduce a new `TripDetailScreen` — Decision 4 locks this.
- `ObserveTripPayments` use case + `tripPaymentMapper` shipped in
  Phase 9 — the per-trip payments list has its data path ready;
  presentation work only.
- `ObserveTripEvents` use case ships and is consumed by
  `useRideMonitorViewModel` / `useDriverMonitorViewModel` (for the
  live event-banner stream during active trips). For the post-trip
  events list rendered in `TripPreviewModal`-equivalent, the same use
  case can be reused as a one-shot read OR kept as a subscription —
  either is fine since `events` is append-only.
- No `ObserveScheduledRides` use case exists yet (planned for Turn 7).
  Whether scheduled rides surface in Turn 6's Activity = Decision 3.
- No `TripList`, `TripCard`, or trip-row component exists in
  `presentation/components`. Need to port from legacy `TripList.js` +
  `TripView.js`.

## Required reading (in order)

1. **Audit `docs/PHASE_10_PARITY_AUDIT.md` §3.3, §3.6, §3.7, §8 row 6.**
   §3.3 is canonical scope; §3.6 explains why per-trip
   `TransactionHistory` belongs in this turn (not in Wallet); §3.7
   verified `TripPreviewModal` is the post-trip details surface;
   §8 row 6 is the turn-plan entry and budget.

2. **Legacy `yeride/src/components/TripHistory.js`** (62 lines). Note
   how thin it is — `<RecentTrips/>` + loading shim + the
   status-aware navigation switch (`closed` / `*_canceled` /
   `payment_failed` → `TripPreviewModal`, else → `RideMonitor` /
   `DriverMonitor`).

3. **Legacy `yeride/src/components/RecentTrips.js`** (60 lines).
   Subscribes via `subscribeToPassengerRecentTrips` /
   `subscribeToDriverRecentTrips` from `api/firebase/Trip.js`, limit
   10, `useFocusEffect`-scoped. Renders `<TripList rides={...}
   onRideSelected={onSelectedRide}/>` or a "No recent rides" empty
   state.

4. **Legacy `yeride/src/api/firebase/Trip.js`** —
   `subscribeToPassengerRecentTrips` and
   `subscribeToDriverRecentTrips` implementations. Confirm: live
   `onSnapshot` subscription, `where 'passenger.id' == userId`
   (resp. `'driver.id'`), `orderBy('createdDateTime', 'desc')`,
   `.limit(N)`. NOTE the implicit "client-side status filter for
   driver path excludes `awaiting_driver`" pattern — must reproduce
   in the rewrite repo if not already there.

5. **Legacy `yeride/src/components/TripList.js`** (30 lines) +
   `TripView.js` (the per-row card). Notice TripList is itself thin
   — a FlatList wrapping TripView. The actual visual design lives in
   TripView. Port the visual into a new
   `presentation/components/trip/TripCard.tsx` or
   `presentation/components/trip/TripRow.tsx` (decide naming when
   you build it).

6. **Legacy `yeride/src/components/TripPreviewModal.js`** (95 lines)
   + each sub-component it composes: `PassengerView`, `DriverView`,
   `TripView`, `TipSelector`, `TransactionHistory`, `Events`. This
   is what the trip-detail surface for terminal-status trips looks
   like.

7. **Rewrite `src/app/usecases/ride/ListRidesByPassenger.ts` +
   `ListRidesByDriver.ts`** in full. The `// Used by: ... Future
   Activity tab — full history (statuses omitted, server orders by
   createdAt desc)` doc comment is from before this turn; Turn 6
   makes that "future" present.

8. **Rewrite `src/data/repositories/FirestoreRideRepository.ts`**
   lines 174-244 — the existing `listByPassenger` / `listByDriver`
   implementations. Note that the optional `statuses` filter is
   client-side (avoids composite-index requirement), `orderBy` is
   server-side on `createdDateTime`. No `startAfter` cursor today —
   Turn 6 extends.

9. **Rewrite `src/presentation/features/rider/screens/RideReceiptScreen.tsx`**
   in full. This is the existing post-completion receipt; understand
   what it shows (small dropoff map, fare breakdown via payments
   subcollection join, payment row, tip selector for the
   completed-not-yet-tipped case, receipt PDF generation via
   `useGenerateReceiptPdfViewModel`). Decision 4 picks whether this
   is the trip-detail target for Activity-reached completed trips,
   or whether Activity needs its own `TripDetailScreen`.

10. **Rewrite `src/presentation/features/rider/screens/ActivityPlaceholderScreen.tsx`**
    + `src/presentation/features/driver/screens/DriverActivityPlaceholderScreen.tsx`.
    Both are 30-line placeholders hosting `<DevToolsSection/>`.
    `DevToolsSection` must continue to mount (production-side it
    renders nothing, but dev-side it's load-bearing for Crashlytics
    smoke). The new screens must keep `<DevToolsSection/>` reachable
    — easiest path is rendering it below the trip list as a
    `ListFooterComponent` or stacked under the FlatList in a
    ScrollView.

11. **`docs/PHASE_10_TURN_5.md`** — most recent turn doc. Patch
    shape, kickoff-pattern, audit-update flow, sandbox commit
    pattern. Turn 6 follows the same structure but the patch will be
    larger (new screens, new components, possible new use case).

12. **`src/presentation/features/rider/view-models/useRideReceiptViewModel.ts`**
    — pattern reference for a one-shot trip-by-id load + payments
    subscription. Likely the closest existing analog to the
    trip-detail VM Turn 6 needs.

## Starting state — what's already true

- **HEAD** on `main`: latest closed at `0ecb33e` (Turn 5 review-fix
  patch 2026-05-19). Capture the exact SHA in your turn doc via
  `git rev-parse HEAD`.
- The 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain Turn 9 scope — DO NOT try to fix them here.
- `ListRidesByPassenger` + `ListRidesByDriver` + the underlying
  Firestore repository methods are wired through DI and exposed via
  `useUseCases()`. They take `{passengerId|driverId, statuses?,
  limit?}` and return `Result<readonly Ride[], NetworkError>`. No
  cursor argument yet.
- `ObserveTripPayments` (use case) + `tripPaymentMapper` +
  `FirestoreTripPaymentSubscription` are wired (Phase 9). The
  per-trip payments list has its data layer.
- `ObserveTripEvents` (use case) is wired and consumed by the live
  monitors. Reusable for the post-trip events list.
- `RideReceiptScreen` ships and currently routes from
  `RideMonitorScreen` only (deep-link target after `Ride.status
  === 'completed'`).
- `useFirestoreSubscription` hook exists and is used by the
  monitor VMs — pattern reference for subscription-based VM
  effects.
- `Ride` domain entity has `status: RideStatus` with the legacy
  literal set (`awaiting_driver`, `dispatched`, `started`,
  `payment_requested`, `completed`, `payment_failed`,
  `passenger_canceled`, `driver_canceled`, `closed`, plus
  `scheduled_driver_accepted` and friends — confirm exact set in
  `src/domain/entities/RideStatus.ts`).
- `useInProgressRideQuery` + `useInProgressDriverRideQuery` already
  exist and drive auto-redirect on `RiderHome` / `DriverHome` when
  an active trip is found. So the "in-progress" surface on Activity
  is mostly redundant for users (they auto-redirect from Home), but
  legacy still showed it on Home as a list. Decision 2 locks
  whether Activity gets an in-progress section.
- TanStack Query is wired (`QueryClientProvider` in
  `presentation/App.tsx`). `useInfiniteQuery` is available for
  cursor-based pagination.
- Tab navigators: `RiderTabsNavigator.tsx` line 38 +
  `DriverTabsNavigator.tsx` line 44 mount the placeholders. Swap
  these once the real screens land.
- `RiderNavigator.tsx` already routes `RideReceipt` as a pushed
  stack screen. The driver stack does NOT have a receipt / detail
  route today — Decision 4 surfaces the question of whether the
  driver gets one or whether driver trip-detail reuses
  `DriverMonitorScreen` in a read-only mode.

## Scope — what to ship

Land in one commit so partial state doesn't reach `main`. Six
layers, ordered domain → data → app → presentation:

### A. Domain / app — pagination + (optional) scheduled use case

- **Extend `RideRepository`** interface:
  - `listByPassenger` + `listByDriver` gain an optional
    `cursor?: RideListCursor` argument and return
    `Result<RidePage, NetworkError>` where
    `RidePage = { rides: readonly Ride[]; nextCursor: RideListCursor
| null }`.
  - `RideListCursor` is an opaque branded type carrying the
    Firestore doc-snapshot identity needed for `startAfter`. Define
    in `src/domain/entities/RideListCursor.ts` as
    `Brand<string, 'RideListCursor'>` storing the `createdDateTime`
    millis + last doc id (`"${ms}:${docId}"`) so the data adapter
    can rebuild a `startAfter` clause from the page boundary
    without a follow-up `getDoc` round-trip. Document that the
    cursor is opaque to callers.
  - Provide `RideListCursor.create(props): Result<RideListCursor,
ValidationError>` matching the standard VO pattern (validation
    on numeric/ID shape).

- **Extend `ListRidesByPassenger` / `ListRidesByDriver` use cases**
  to forward the new `cursor` argument and return the page shape.
  Existing call sites (`useInProgressRideQuery` /
  `useInProgressDriverRideQuery`) currently pass `{passengerId,
statuses: [active], limit: 1}` and read `Ride[]` directly — they
  need a one-line callsite update to read `result.value.rides[0]`
  instead of `result.value[0]`. (Or keep the old non-paginated
  shape under a separate method and add `paginateByPassenger` /
  `paginateByDriver` as new methods. Decision 5 locks; default is
  extend-the-existing.)

- **(Conditional on Decision 3) `ObserveScheduledRides` use case +
  repository method.** If Decision 3 = (a) "Activity carries
  scheduled section now", build the use case + Firestore method
  here. If Decision 3 = (b) "defer to Turn 7", skip and document
  in §C of the turn doc. The use case is subscription-shaped
  (returns `Unsubscribe`) keyed off `where 'passenger.id' ==
userId && status IN ['scheduled_driver_accepted',
'scheduled_pending_dispatch']` (confirm the exact scheduled-
  status set against
  `yeride/src/api/firebase/Trip.js:subscribeToRiderScheduledRides`).

### B. Data — Firestore pagination + (optional) scheduled subscription

- **`FirestoreRideRepository`**:
  - `listByPassenger` / `listByDriver` extended with
    `startAfter(<reconstructed snapshot or {createdDateTime,
docId} composite key>)` when `cursor` is provided. The
    Firestore JS SDK's `startAfter` accepts ordered field values
    matching the `orderBy` clause — so for
    `orderBy('createdDateTime', 'desc')` you can pass
    `startAfter(cursorTimestamp)` plus
    `orderBy(documentId(), 'desc')` as a tiebreaker. Match what
    legacy did if anything — check
    `subscribeToPassengerRecentTrips` for cursor semantics.
  - Build `nextCursor` from the last doc in the returned page
    (`Math.floor(lastDoc.data().createdDateTime.toMillis())` +
    `lastDoc.id`). Return `null` when fewer than `limit` rows
    came back.
  - Keep the client-side `statuses` filter; document that the
    filter may shrink a page below the requested `limit` and that
    callers should issue follow-up pages if needed (legacy did
    NOT compensate for this — match legacy behavior to keep
    parity).

- **(Conditional on Decision 3) `FirestoreRideRepository.observeScheduled*`**:
  one method for rider-side (legacy ScheduledTrips is rider-only).
  Use `onSnapshot` keyed by `passenger.id` + `status IN
[scheduled set]`, deliver typed `Ride[]` to callback, return
  synchronous unsubscribe. Mirror `subscribeAvailableRides` shape
  for consistency.

### C. App — no new use case (apart from the optional Scheduled one)

The Activity-tab presentation reuses the use cases already shipped:
`ListRidesByPassenger` / `ListRidesByDriver` (now paginated),
`GetRideById` (one-shot trip-detail load), `ObserveTripPayments`
(per-trip payments list), `ObserveTripEvents` (per-trip event log).
No new app-layer files except `ObserveScheduledRides` if Decision 3
= (a).

### D. Presentation — components, view-models, screens, navigation

- **`presentation/components/trip/TripCard.tsx`** (or `TripRow.tsx`
  — name to match the codebase convention). Stateless card showing
  per-row: status pill, "Trip with {OtherParty}" line, pickup →
  dropoff endpoint summary, formatted createdDateTime, fare
  preview (use the same `Money.format` helper used elsewhere; on
  pre-completion rides the fare is the route estimate). Match the
  visual feel of the legacy `TripView` component — the legacy is
  Tailwind/NativeWind so the port is largely 1:1 on class names.
  Add `testID="trip-card-{rideId}"` for E2E.

- **`presentation/components/trip/TripList.tsx`**. Thin FlatList
  wrapper. Props: `rides: readonly Ride[]`, `onSelectRide:
(ride: Ride) => void`, `ListEmptyComponent: ReactNode`,
  `ListFooterComponent?: ReactNode` (so the empty / loading-more
  state and the dev-tools section can sit underneath the list).
  Stable `keyExtractor` from `ride.id`. **Do NOT inline `<DevToolsSection/>`
  here** — that's a screen-level concern that the parent passes
  via `ListFooterComponent`.

- **`presentation/features/rider/view-models/useActivityViewModel.ts`**
  + **`presentation/features/driver/view-models/useDriverActivityViewModel.ts`**.
  Each VM owns:
  - A `useInfiniteQuery` against `ListRidesByPassenger` /
    `ListRidesByDriver`. `queryKey = ['rider-activity-recent',
userId]` / `['driver-activity-recent', userId]`. `pageParam` =
    `RideListCursor | null`. `getNextPageParam` reads
    `lastPage.nextCursor` (null = end).
  - Flat output shape: `{ status: 'loading' | 'error' | 'empty' |
'ready'; rides: readonly Ride[]; canLoadMore: boolean;
isLoadingMore: boolean; onLoadMore(): void; onRefresh():
Promise<void>; onSelectRide(ride): void }`.
  - `onSelectRide` does the status-aware navigation switch:
    terminal-status (`closed` / `passenger_canceled` /
    `driver_canceled` / `payment_failed` / `completed`) → trip-
    detail target (Decision 4); non-terminal → `RideMonitor` /
    `DriverMonitor` with `tripId` param.
  - **(Conditional on Decision 3 = (a))** the rider VM also drives
    `ObserveScheduledRides` and surfaces a separate
    `scheduledRides: readonly Ride[]` field.

- **`presentation/features/rider/screens/ActivityScreen.tsx`** (new
  file, replacing `ActivityPlaceholderScreen.tsx`). Layout:
  optional "Scheduled" section (if Decision 3 = (a)) → "Recent
  Rides" section header → `<TripList/>` with `ListFooterComponent`
  composing a "Load more" pressable + `<DevToolsSection/>`. The
  empty-state copy matches legacy: "No recent rides" centered.
  Pull-to-refresh on the FlatList wired to `onRefresh`.

- **`presentation/features/driver/screens/DriverActivityScreen.tsx`**
  (new). Same layout, no scheduled section (driver-side legacy had
  none). Footer composes the same `<DevToolsSection/>` so the
  Crashlytics smoke buttons stay reachable in dev.

- **Trip-detail target (Decision 4 outcome):**
  - **If (a) reuse `RideReceiptScreen`**: extend its VM to accept
    rides reached from Activity (no special-cased "tip not yet
    given" gating since the trip can be re-tipped). Driver-side
    requires a parallel screen (`DriverRideReceiptScreen`?) since
    `RideReceiptScreen` is rider-only today; otherwise drivers
    land somewhere different. Smaller code diff but uneven UX —
    driver side needs new screen, rider side reuses existing.
  - **If (b) new `TripDetailScreen` (recommended)**: one screen,
    role-agnostic, mounted on BOTH the rider and driver stacks.
    Renders trip route summary, role-flipped party header
    (driver sees passenger, rider sees driver), per-trip events
    list via `ObserveTripEvents`, per-trip payments list via
    `ObserveTripPayments` (this is the §3.6 fold-in), tip-selector
    re-entry for rider when the trip is completed+tippable. Bigger
    code diff but symmetric. Confirm at pre-checklist.

- **Navigation wiring:**
  - `RiderTabsNavigator.tsx` line 38 — swap
    `ActivityPlaceholderScreen` for `ActivityScreen`.
  - `DriverTabsNavigator.tsx` line 44 — swap
    `DriverActivityPlaceholderScreen` for `DriverActivityScreen`.
  - `RiderNavigator.tsx` — add `TripDetail` stack route (if
    Decision 4 = (b)).
  - `DriverNavigator.tsx` — add `TripDetail` stack route (if
    Decision 4 = (b)).
  - `presentation/navigation/types.ts` — extend
    `RiderStackParamList` + `DriverStackParamList` with
    `TripDetail: { rideId: RideId }`. Drop the old route mapping
    if reusing `RideReceipt` for the rider side.
  - Delete `ActivityPlaceholderScreen.tsx` +
    `DriverActivityPlaceholderScreen.tsx` and their
    `__tests__/*PlaceholderScreen.test.tsx` test files. Keep
    `<DevToolsSection/>` accessible from the new screens via the
    FlatList footer.

### E. TripPaymentsList component (the §3.6 fold-in)

- **`presentation/components/trip/TripPaymentsList.tsx`** (new).
  Subscribes via `ObserveTripPayments(tripId)`. Renders one row per
  payment with: type chip (fare / tip / refund / cancellation),
  status badge (`succeeded` / `pending` / `failed` / `refunded`),
  amount via `Money.format`, timestamp. Footer row: "Total"
  summing succeeded fare/tip rows minus succeeded refund rows
  (use `Money` arithmetic in minor units; never floats). Match
  legacy `TransactionHistory.js` visual feel.
- Compose into `TripDetailScreen` (or extended `RideReceiptScreen`
  per Decision 4).

### F. Tests

Tests required per the standard rewrite test policy (100% on use
cases, >80% on repositories, screen-level VM tests against the
in-memory fakes). New / extended test files:

| Layer       | File                                                                            | What it covers                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain      | `src/domain/entities/__tests__/RideListCursor.test.ts`                          | New: VO `.create` validation (timestamp >= 0, non-empty id, brand check), `null` handling                                                                                                                                                 |
| Data        | `src/data/repositories/__tests__/FirestoreRideRepository.test.ts`               | Extend: paginated `listByPassenger` / `listByDriver` — first page, cursor produces second page, end-of-list returns null cursor, optional status filter still applies                                                                     |
| App         | `src/app/usecases/ride/__tests__/ListRidesByPassenger.test.ts` + ByDriver       | Extend: VM forwards cursor; in-memory repo backs pagination behavior                                                                                                                                                                      |
| App (cond.) | `src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`                 | New if Decision 3 = (a): subscription delivers rider-side scheduled rides, ignores non-rider matches                                                                                                                                      |
| VM          | `src/presentation/features/rider/view-models/__tests__/useActivityViewModel.test.tsx` | First page renders rides, load-more appends, end-of-list stops, refresh re-fetches, navigation switch picks terminal vs in-progress correctly                                                                                       |
| VM          | `src/presentation/features/driver/view-models/__tests__/useDriverActivityViewModel.test.tsx` | Same arms, driver-side                                                                                                                                                                                                          |
| VM (cond.)  | `useActivityViewModel.test.tsx` scheduled-section arm                           | If Decision 3 = (a): rider VM surfaces scheduled rides when subscription fires                                                                                                                                                            |
| Screen      | `src/presentation/features/rider/screens/__tests__/ActivityScreen.test.tsx`     | Empty state ("No recent rides"), populated list renders TripCard rows with testIDs, pull-to-refresh triggers refresh, load-more pressable advances pagination, DevToolsSection still mounts                                               |
| Screen      | `src/presentation/features/driver/screens/__tests__/DriverActivityScreen.test.tsx` | Same arms, driver-side                                                                                                                                                                                                                |
| Detail VM   | `src/presentation/features/*/view-models/__tests__/useTripDetailViewModel.test.tsx` (or extension of useRideReceiptViewModel.test.tsx) | Loads trip-by-id, subscribes to events + payments, surfaces flat props; navigates back on missing trip                                                                                          |
| Detail screen | Test the trip-detail surface as appropriate for Decision 4                    | Trip route summary renders, payments list renders multi-row with totals, events list renders in order, role-flipped party header                                                                                                          |
| Component   | `src/presentation/components/trip/__tests__/TripCard.test.tsx`                  | Renders rider-side ("Trip with {driver}"), driver-side ("Trip with {passenger}"), status pill copy, formatted fare, formatted timestamp                                                                                                   |
| Component   | `src/presentation/components/trip/__tests__/TripList.test.tsx`                  | FlatList renders rides, empty component renders, footer composes correctly                                                                                                                                                                |
| Component   | `src/presentation/components/trip/__tests__/TripPaymentsList.test.tsx`          | Multi-row payments render, totals sum correctly across `succeeded` rows only, refund subtracts, empty state renders                                                                                                                       |
| Cleanup     | Delete placeholder tests                                                        | Remove `ActivityPlaceholderScreen.test.tsx` + `DriverActivityPlaceholderScreen.test.tsx` once their subjects are gone                                                                                                                     |

Targeted pass count target: **add ~80-120 new tests, zero regressions**.
Full-suite carry-over remains the 21 BG-geolocation failures.

## Decisions to lock at kickoff time

### Decision 1 — Composition: Activity = Recent only, OR Activity carries multiple sections?

**Legacy:** Activity tab = Recent only. In-progress + Scheduled
render on Home.

- **(a) Recent only (parity).** Smallest diff; matches legacy users'
  muscle memory.
- **(b) Recent + Scheduled (rider) + maybe In-Progress (both).**
  Marginally better UX (one tab gathers all trip-history surfaces).
  Larger diff; deviates from legacy.

Kickoff recommends **(a)** for parity-first cutover (audit §8 row
6 explicitly notes this is the largest user-facing gap and parity
trumps polish here). Override only if you find a compelling
post-cutover reason during pre-checklist.

If you pick (a), Decision 3 collapses to (b) "defer scheduled to
Turn 7" automatically.

### Decision 2 — In-Progress section on Activity?

Legacy renders `<InProgressTrips/>` on Home; the rewrite already
auto-redirects single-active-trip users to `RideMonitor` /
`DriverMonitor` via `useInProgressRideQuery`. A user with no active
trip has nothing to render in the In-Progress section, and a user
with one active trip auto-redirects before they can tap Activity.

- **(a) Omit In-Progress section.** Matches the rewrite's
  auto-redirect invariant; saves a section + use case wire-up.
- **(b) Include In-Progress section.** Useful only in the (rare)
  multi-active-trip case, which the rewrite arguably doesn't even
  support yet (one ride per user).

Kickoff recommends **(a)** — drop the section. The rewrite's
"single active trip → auto-redirect" pattern makes (b) dead UI.

### Decision 3 — Scheduled rides section in Turn 6?

The audit's Turn 7 ports the scheduled-rides creation UI; it will
also need `ObserveScheduledRides` for the listing surface. Two
options:

- **(a) Land `ObserveScheduledRides` + the Activity rider-side
  Scheduled section in Turn 6.** Turn 7 then only needs the
  creation UI + datetime picker plugin. Pros: avoids re-opening
  `RideRepository` in Turn 7 just to add an observe method. Cons:
  expands Turn 6 scope.
- **(b) Defer to Turn 7 (the section + the use case land
  together).** Turn 6 strictly recent-only. Pros: smallest Turn 6
  diff; cleaner Decision 1 = (a). Cons: Turn 7 has to wire the use
  case AND the creation UI.

Kickoff recommends **(b)** to keep Turn 6 focused on the largest
single port. The scheduled-section UI is a 50-line addition in
Turn 7 once the data path lands.

### Decision 4 — Trip-detail target: reuse `RideReceiptScreen` (rider) + new driver screen, OR new `TripDetailScreen` (both roles)?

The trip-detail surface reached from Activity row taps on
terminal-status trips.

- **(a) Reuse `RideReceiptScreen` on the rider side; build
  `DriverRideReceiptScreen` parallel.** Two screens. Inconsistent
  UX between roles.
- **(b) One new role-agnostic `TripDetailScreen` mounted on both
  stacks.** Renders trip route, party header (role-flipped),
  events list, payments list, conditional tip re-entry. Symmetric
  UX. Slightly bigger diff. `RideReceiptScreen` stays as-is for
  the immediate-post-completion flow from `RideMonitor` (it has
  the receipt-PDF + first-time-tip UX that Activity tap doesn't
  need to clone).

Kickoff recommends **(b)** — one screen, both roles. Matches
legacy `TripPreviewModal` symmetry. Override only if you find a
strong reason `RideReceiptScreen` shouldn't fork.

### Decision 5 — Pagination shape: extend existing methods, OR add new `paginateByPassenger` / `paginateByDriver`?

- **(a) Extend `listByPassenger` / `listByDriver` with optional
  cursor.** One method per role. Existing call sites
  (`useInProgressRideQuery` / `useInProgressDriverRideQuery`) need
  to read `.rides` off the new return type. One-line callsite
  change.
- **(b) Add new methods.** Two methods per role. Existing call
  sites untouched. More API surface area.

Kickoff recommends **(a)** — fewer methods, the return-type change
is a trivial migration on two call sites.

### Decision 6 — Live vs. one-shot for the Activity list

Legacy used `onSnapshot` (live subscription) on RecentTrips. The
rewrite has two reasonable options:

- **(a) `useInfiniteQuery` (one-shot per page, with refetch on
  focus).** Cleaner with cursor-based pagination. User pulls to
  refresh. TanStack staleTime tuned to ~60s so re-focusing the tab
  refetches.
- **(b) `onSnapshot` subscription.** Live updates without
  refetch. Harder to combine with cursor pagination (live + paged
  is tricky to reason about — a new doc landing at the top while
  the user has scrolled to page 3 etc.).

Kickoff recommends **(a)** — paginated one-shot with refetch on
focus. Live updates aren't essential on history (trips don't
mutate after closure) and the cursor model is cleaner.

## Pre-checklist

Resolve in your first message back if not already settled.

1. **Confirm HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile && git rev-parse HEAD && git status --short
   ```
   Expected: HEAD = `0ecb33e` or newer; working tree clean modulo
   any `.git/*.lock` from prior sandbox sessions
   (`find .git -name '*.lock' -delete` if `git` complains).

2. **Confirm the rewrite gap is as described.**
   - `cat src/presentation/features/rider/screens/ActivityPlaceholderScreen.tsx`
     should still show the "lands in Phase 5" placeholder.
   - `grep -rn 'Activity' src/presentation/navigation/` should show
     both tab navigators mounting placeholders.
   - `grep -n 'cursor\|startAfter' src/data/repositories/FirestoreRideRepository.ts`
     should return zero matches (no pagination today).
   - `grep -rn 'ObserveScheduledRides\|observeScheduled' src/`
     should return zero matches.

3. **Confirm the legacy compositions read as described.**
   - `cat yeride/src/components/TripHistory.js` (should be ~60
     lines, RecentTrips-only).
   - `grep -n 'subscribeToPassengerRecentTrips\|subscribeToDriverRecentTrips' yeride/src/api/firebase/Trip.js`
     to nail down the legacy query shape.
   - `grep -n 'subscribeToRiderScheduledRides' yeride/src/api/firebase/Trip.js`
     to nail down the scheduled query shape (for Decision 3
     evidence even if scheduled is deferred to Turn 7).

4. **Confirm `RideStatus` literal set** in
   `src/domain/entities/RideStatus.ts`. Terminal statuses for the
   navigation switch: `closed`, `passenger_canceled`,
   `driver_canceled`, `payment_failed`, `completed`. Confirm the
   exact list and surface any drift in the turn doc.

5. **Confirm `useInProgressRideQuery` callsite shape.** Read
   `src/presentation/hooks/useInProgressRideQuery.ts` (or wherever
   it lives — `grep` if needed) to estimate the migration cost of
   the `listByPassenger` return-type change under Decision 5 = (a).
   If it's >10 lines of changes, reconsider 5 = (b).

6. **Decide Decisions 1-6 + capture evidence chain.**

7. **Identify or invent the trip-detail screen filename + import
   path.** If Decision 4 = (b), confirm the path
   `src/presentation/features/<area>/screens/TripDetailScreen.tsx`
   — likely under a shared location like
   `src/presentation/features/shared/screens/` since it's
   role-agnostic. Sketch the import path in the turn doc.

8. **Optional — manual smoke check.** If you have stage Firebase
   wired up, pre-Turn screenshot of the Activity placeholder, then
   post-Turn screenshot of the populated list + a trip-detail
   surface for a closed trip. Skip if no simulator handy; the unit
   + screen tests provide the regression net.

## Suggested approach

1. **Pre-checklist first.** Resolve items 1-8 above before
   touching code.

2. **Land changes bottom-up (domain → data → app → presentation).**
   - Domain: `RideListCursor` VO + `RidePage` type + `RideRepository`
     interface extension (paginated signature). Tests.
   - Data: `FirestoreRideRepository` `listByPassenger` /
     `listByDriver` paginated implementation. Tests.
   - In-memory fakes (`@shared/testing/InMemoryRideRepository` or
     whatever the file is named): mirror pagination behavior so
     view-model tests work. Existing fake tests stay green.
   - App: `ListRidesByPassenger` / `ListRidesByDriver` use-case
     signature update + tests. Update the two
     `useInProgressRideQuery` call sites to read `.rides`.
   - (Optional, Decision 3 = (a)) `ObserveScheduledRides` use case
     + repository method + fake + tests.
   - Components: `TripCard` + `TripList` + `TripPaymentsList`
     (visual + tests).
   - Presentation VMs: `useActivityViewModel` +
     `useDriverActivityViewModel` + (if Decision 4 = (b))
     `useTripDetailViewModel`. Tests against the in-memory fakes
     via `TestContainerProvider`.
   - Screens: `ActivityScreen` + `DriverActivityScreen` +
     `TripDetailScreen` (per Decision 4). Tests with rendered
     props.
   - Navigation: swap placeholders out, add trip-detail route to
     stack navigators, extend `navigation/types.ts`. Delete
     `ActivityPlaceholderScreen.tsx` +
     `DriverActivityPlaceholderScreen.tsx` and their tests.

3. **Verify gates.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck     # green
   npm run lint          # green
   npm run format:check  # green or pre-existing CLAUDE.md warning only
   npm test              # only the 21 BG-geolocation failures (Turn 9)
   ```
   `npm test` is slow; use `--shard=N/M` if a single run times out
   in the sandbox.

4. **Audit + turn doc updates.**
   - §1 headline count: flip `4 ❌ / 1 🟡` → `3 ❌ / 1 🟡` (the
     trailing 🟡 = §3.6 Wallet/per-trip — fold its closure too if
     `TripPaymentsList` lands here per the audit's "folded into
     §3.3" note; either flip 🟡 → ✅ on §3.6 alongside §3.3, or
     keep 🟡 with an annotation that the surface ships but Wallet
     itself remains at parity).
   - §3.3 row: flip ❌ → ✅ with Turn 6 closure note + chosen
     decisions 1-6.
   - §3.6 row: annotate "✅ `TripPaymentsList` shipped in Turn 6
     (YYYY-MM-DD) per fold-in note" and consider flipping 🟡 → ✅.
   - §8 turn-plan row 6: strike + close date + doc reference.
   - Header sublabel: append "Turn 6 closed YYYY-MM-DD" (keep
     v2 — Turn 10 produces v3).
   - Write `docs/PHASE_10_TURN_6.md` following
     `PHASE_10_TURN_5.md`'s format. The patch section will be the
     largest of Phase 10 so far — expect 15-25 changed files.

5. **Commit.** Use the sandbox commit pattern
   (`~/Library/.../memory/sandbox_git_commit_pattern.md`) —
   `cp .git/index /tmp/shadow && GIT_INDEX_FILE=/tmp/shadow git
add -A && GIT_INDEX_FILE=/tmp/shadow git write-tree`, then
   `git commit-tree` + `git update-ref refs/heads/main`. Virtiofs
   blocks `git`'s `unlink()` on lockfiles, so the standard
   `git commit` flow second-trips.

## Out of scope (defer to later turns)

- **Scheduled rides CREATION UI** — Turn 7 owns the datetime picker
  plugin + the `RideScheduledConfirmation` modal. If Decision 3 =
  (a), the LISTING side of scheduled rides ships here; the
  creation side stays Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **`yeride.com/stripe-return` 302 bridge** — ops work, not
  rewrite code.
- **Audit v3 + cutover sign-off** — Turn 10.
- **`RideReceiptScreen` itself** — keep its post-completion-tip
  flow intact; do NOT refactor it into `TripDetailScreen`. The
  two surfaces have different purposes (immediate-post-trip
  receipt with PDF + first-tip vs. arbitrary-time trip-detail
  drill-in from Activity).
- **Live `onSnapshot` updates on the Activity list** —
  one-shot+focus-refresh is enough per Decision 6.
- **Compound-index scheduled-rides query** — match the legacy
  status-IN-list pattern; no new Firestore indexes in this turn.
- **Detox E2E** for the Activity flow — covered by
  PHASE_10_CUTOVER_PLAN.md §3.1 gate, not by this turn.

## Deliverable

A single PR / commit on `main` containing:

1. **Domain**: `RideListCursor` VO + `RidePage` type +
   `RideRepository` interface extension. Optional
   `RideScheduledStatus` literal subset if Decision 3 = (a).
2. **Data**: paginated `FirestoreRideRepository.listByPassenger /
listByDriver`. Optional `observeScheduledRidesForPassenger` if
   Decision 3 = (a). In-memory fake mirrors.
3. **App**: extended `ListRidesByPassenger` / `ListRidesByDriver`
   signatures (return `RidePage`). Optional `ObserveScheduledRides`
   use case + tests. Migration of the two `useInProgressRideQuery*`
   call sites.
4. **Presentation components**: `TripCard`, `TripList`,
   `TripPaymentsList` in `presentation/components/trip/`.
5. **Presentation VMs**: `useActivityViewModel`,
   `useDriverActivityViewModel`, `useTripDetailViewModel` (per
   Decision 4).
6. **Presentation screens**: `ActivityScreen`,
   `DriverActivityScreen`, `TripDetailScreen` (per Decision 4).
   Placeholders + placeholder tests removed.
7. **Navigation**: tab-navigator swaps + stack-navigator
   `TripDetail` route additions + `navigation/types.ts`
   extensions.
8. **Tests**: ~80-120 new tests per the §F table; zero
   regressions outside the 21 pre-existing BG-geolocation failures.
9. **Audit `docs/PHASE_10_PARITY_AUDIT.md`** updated — §1 count
   + bullet, §3.3 verdict, §3.6 fold-in annotation, §8 turn plan
   row 6 strike-through, header sublabel append.
10. **`docs/PHASE_10_TURN_6.md`** documenting:
    - Pre-checklist outcomes (HEAD SHA, gap-confirmation greps,
      RideStatus literal set, useInProgressRideQuery migration
      cost, trip-detail screen path).
    - The six decisions with evidence chain.
    - The patch diffs by layer.
    - Test additions and pass counts.
    - Acceptance criteria.
    - Out-of-scope list.

`npm run verify` should be green except the carry-over 21
BG-geolocation failures (Turn 9's job).

## Sign-off criteria

- [ ] Decisions 1-6 documented with the evidence that drove them.
- [ ] `RideListCursor` value object + `RidePage` type shipped in
      `@domain/entities`.
- [ ] `RideRepository.listByPassenger` + `listByDriver` accept an
      optional `cursor: RideListCursor` argument and return
      `Result<RidePage, NetworkError>`.
- [ ] `FirestoreRideRepository` pagination implementation uses
      `startAfter` against `createdDateTime desc + documentId desc`
      and emits `nextCursor` correctly (null when the page is
      shorter than `limit`).
- [ ] In-memory fakes in `@shared/testing` mirror the paginated
      signature.
- [ ] `useInProgressRideQuery` + `useInProgressDriverRideQuery`
      callsites migrated to the new `.rides` return shape.
- [ ] Activity tab placeholders deleted; tab navigators mount
      `ActivityScreen` + `DriverActivityScreen`.
- [ ] `useActivityViewModel` + `useDriverActivityViewModel` use
      `useInfiniteQuery` against the paginated use cases; surface
      a flat status/rides/canLoadMore output shape.
- [ ] Trip-row tap navigates to `RideMonitor` / `DriverMonitor`
      for non-terminal statuses and to the trip-detail target
      (per Decision 4) for terminal statuses.
- [ ] `TripDetailScreen` (per Decision 4) renders trip route,
      role-flipped party header, per-trip events list, per-trip
      payments list, conditional tip-selector for rider-on-
      completed.
- [ ] `TripPaymentsList` component subscribes via
      `ObserveTripPayments` and totals correctly (succeeded
      fare/tip minus succeeded refund; in `Money` minor units).
- [ ] `<DevToolsSection/>` continues to mount on the new
      `ActivityScreen` + `DriverActivityScreen` (via
      `ListFooterComponent` or under the FlatList in a
      ScrollView).
- [ ] New / updated tests for each touched layer per the §F
      table. ~80-120 new tests, no regressions outside Turn 9's
      21 carry-overs.
- [ ] Audit §3.3 row flipped ❌ → ✅ with Turn 6 annotation.
- [ ] Audit §3.6 row annotated with the `TripPaymentsList`
      fold-in (flip 🟡 → ✅ if Wallet itself is at parity, which
      it is per audit §3.6 verification).
- [ ] Audit §1 headline count updated `4 ❌ / 1 🟡` →
      `3 ❌ / 0 🟡` (or `3 ❌ / 1 🟡` if §3.6 stays 🟡 by
      design).
- [ ] `PHASE_10_TURN_6.md` written following Turn 5's structure.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo the pre-existing `CLAUDE.md` Prettier
      warning); jest carries only the 21 pre-existing
      BG-geolocation failures.
- [ ] Commit landed on `main` via the sandbox commit pattern.

## Native rebuild

**Not required for this turn.** All changes are JS/TS — no
`app.config.ts`, no plugin additions, no native-side edits. Metro
bundle reload picks up the changes. If Decision 3 = (a) and the
new Firestore scheduled-rides query needs a composite index
(`passenger.id ==` + `status IN`), that may surface at first
real-device run — note the index in the turn doc but don't deploy
in this turn (cutover-plan §3.x covers index deploys).

---

**End of PHASE_10_TURN_6_KICKOFF.md.** Read top to bottom on a
new session and execute. Ask if any pre-checklist item surfaces a
blocker — especially if the `RideStatus` terminal-set has drifted
from what's listed (item 4), if `useInProgressRideQuery` is
deeper-coupled than expected (item 5), or if the legacy
scheduled-rides query needs a new composite index the rewrite
hasn't deployed. Either of those is a wiring decision that comes
BEFORE the screen-side work.
