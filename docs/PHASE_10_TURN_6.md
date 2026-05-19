# Phase 10 Turn 6 — Activity tab (rider + driver) + TripDetail

**Status:** ✅ closed 2026-05-19.

## Why

Phase 10 Turn 5 (2026-05-18 + a 2026-05-19 review-fix patch) closed
the user-visible rider-ETA regression. Post-Turn-5 audit
([`docs/PHASE_10_PARITY_AUDIT.md`](PHASE_10_PARITY_AUDIT.md)) showed
**4 ❌ / 1 🟡 / 0 ⚠️**. The largest user-facing ❌ was **§3.3
Activity tab — both rider and driver**: both tab slots mounted
`ActivityPlaceholderScreen` / `DriverActivityPlaceholderScreen`,
which rendered a static "lands in Phase 5" message plus the dev-
only `<DevToolsSection/>`. Users on legacy rely on Activity to see
past trips and receipts, so the placeholders were a regression
blocking cutover.

Turn 6 closes §3.3 with a paginated recent-rides surface on both
roles and a new role-agnostic `TripDetailScreen` reached on
terminal-status row taps. The §3.6 🟡 (Wallet / per-trip
`TransactionHistory`) was folded into the same turn because its
discovered data path (`ObserveTripPayments` + `tripPaymentMapper`,
both shipped in Phase 9) only needed a UI component, and that UI
component naturally lives inside the new `TripDetailScreen`.

## Pre-checklist outcomes (resolved at kickoff time)

1. **HEAD SHA**: `41c54cd55631a0f10fdac9d1379ee9ffb19420e1` (Turn 5
   review-fix). Working tree clean modulo three stale 0-byte
   `.lock` files from prior sandbox sessions (`.git/index.lock`,
   `.git/HEAD.lock`, `.git/refs/heads/main.lock`) — virtiofs blocks
   the unlink; documented per the sandbox commit pattern memory.
2. **Gap-confirmation greps** (all passed):
   - `ActivityPlaceholderScreen.tsx` + `DriverActivityPlaceholderScreen.tsx`
     existed and mounted `<DevToolsSection/>` with "lands in Phase 5"
     copy.
   - `grep -n 'Activity' src/presentation/navigation/{Rider,Driver}TabsNavigator.tsx`
     confirmed both tab slots referenced the placeholders.
   - `grep -n 'cursor\|startAfter' src/data/repositories/FirestoreRideRepository.ts`
     returned zero matches — no pagination support today.
   - `grep -rn 'ObserveScheduledRides\|observeScheduled' src/`
     returned zero matches.
3. **Legacy compositions verified** — `TripHistory.js` is 60 lines,
   only renders `<RecentTrips/>`; `RecentTrips` subscribes via
   `subscribeToPassengerRecentTrips` / `subscribeToDriverRecentTrips`
   (limit 10, `useFocusEffect`-scoped); both queries are simple
   `where('passenger.id'/'driver.id', '==', userId)
.orderBy('createdDateTime', 'desc').limit(limit)` shape with no
   client-side status filter (the audit's v1 framing of "InProgress +
   Scheduled + Recent" composed inside `TripHistory` was incorrect —
   InProgress/Scheduled render on Home, not on Activity).
4. **RideStatus drift** — the rewrite's `RideStatus` set is
   `['awaiting_driver', 'scheduled', 'scheduled_driver_accepted',
'dispatched', 'started', 'payment_requested', 'completed',
'payment_failed', 'cancelled']`. The `rideMapper` collapses legacy
   `closed` → `completed`, and `passenger_canceled` / `driver_canceled`
   → `cancelled`. So the terminal-for-nav-switch set is
   `['completed', 'cancelled']` — NOT the kickoff's five-status list.
   `payment_failed` is NOT terminal in the rewrite (active per
   `RideStatus.isActive()`); the rider stays on `RideMonitor`'s
   `PaymentFailedView` to retry. Activity tap on `payment_failed` →
   `RideMonitor` / `DriverMonitor`.
5. **`useInProgressRideQuery` migration cost** — three callsites to
   migrate from `r.value[0]` / `return r.value` to `r.value.rides[0]`
   / `return r.value.rides`:
   - `useInProgressRideQuery` (line 147)
   - `useInProgressDriverRideQuery` (line 187)
   - `useRidesByPassengerQuery` (line 118)
     Trivial — confirms Decision 5 = (a) (extend existing).
6. **Trip-detail screen path** — created
   `src/presentation/features/shared/screens/` (new directory) +
   `src/presentation/features/shared/view-models/`. Convention is
   `rider/` and `driver/` for role-scoped surfaces; `shared/` is
   new and signals "mounted on both stacks."

## Decisions locked at kickoff time

### Decision 1 — Activity = Recent only (parity). Pick (a).

Legacy `TripHistory` is RecentTrips-only. Smallest diff; matches
legacy users' muscle memory. (b) "carry Scheduled + In-Progress
sections too" was rejected: Scheduled needs Turn 7's data path
(deferred per Decision 3); In-Progress is dead UI per Decision 2.

### Decision 2 — Omit In-Progress section. Pick (a).

The rewrite auto-redirects single-active-trip users to
`RideMonitor` / `DriverMonitor` via `useInProgressRideQuery` /
`useInProgressDriverRideQuery`. A user with no active trip has
nothing to render; a user with one active trip auto-redirects
before they can tap Activity. The section would be dead UI.

### Decision 3 — Defer Scheduled section + `ObserveScheduledRides` to Turn 7. Pick (b).

Keeps Turn 6 focused on the largest single port. The scheduled-
section UI is a ~50-line addition in Turn 7 once the data path
lands alongside the rider-side creation UI. Bundling them in Turn
7 avoids re-opening `RideRepository` twice.

### Decision 4 — New role-agnostic `TripDetailScreen` (both roles). Pick (b).

One screen, mounted on both the rider and driver stacks. Renders
trip route, role-flipped party header (derived from `useCurrentUserId()`
matching `ride.driver.id`), per-trip events list (via
`ObserveTripEvents`), per-trip payments list (via the new
`TripPaymentsList` consuming `ObserveTripPayments`). Symmetric UX,
matches legacy `TripPreviewModal`. `RideReceiptScreen` (immediate-
post-completion receipt with PDF + first-time tip) stays untouched
— different surface, different purpose.

Path: `src/presentation/features/shared/screens/TripDetailScreen.tsx`.

### Decision 5 — Extend existing `listByPassenger` / `listByDriver` methods with optional cursor. Pick (a).

Return type changes from `Result<readonly Ride[], NetworkError>`
to `Result<RidePage, NetworkError>` where
`RidePage = { rides: readonly Ride[]; nextCursor: RideListCursor | null }`.
Three callsite migrations (above). Cleaner than adding parallel
`paginateByPassenger` / `paginateByDriver` methods.

### Decision 6 — `useInfiniteQuery` + focus-refetch. Pick (a).

History doesn't mutate after closure; pull-to-refresh + tab-focus
refetch gives a near-live experience without the cursor-pagination
edge cases that live `onSnapshot` introduces.

## Patch shape (bottom-up)

### A. Domain (`src/domain/`)

- **`entities/RideListCursor.ts`** (new). Opaque
  `Brand<string, 'RideListCursor'>` encoded as
  `"${createdAtMillis}:${docId}"`. `.create(props)` validates
  timestamp finite + non-negative, docId non-empty + Firestore-doc-
  safe charset + <=64 chars; `.decode(cursor)` round-trips back to
  `{createdAtMillis, docId}`. The data adapter uses ONLY the
  `createdAtMillis` segment for single-field `startAfter(<iso>)` —
  `docId` is encoded for forward compatibility if we ever migrate
  to composite ordering. The file-level docstring describes the
  tie-skip semantics honestly: Firestore's single-field `startAfter`
  on desc skips every doc whose `createdDateTime` equals the
  cursor's millisecond. Per-user ties are functionally impossible
  in production so the rewrite accepts that as the tradeoff for
  no composite index. Exports `RidePage = { rides, nextCursor }`
  too — coupled pair lives in one file.
- **`repositories/RideRepository.ts`** (extended).
  `listByPassenger` + `listByDriver` gained an optional
  `cursor?: RideListCursor` and now return
  `Promise<Result<RidePage, NetworkError>>`. Method docstrings
  updated.
- Tests: `domain/entities/__tests__/RideListCursor.test.ts` (11
  tests — VO `.create` validation arms + `.decode` round-trip +
  malformed-cursor rejection).

### B. Data (`src/data/`)

- **`repositories/FirestoreRideRepository.ts`**:
  - `listByPassenger` / `listByDriver` extended with cursor support.
    Single-field `startAfter(<iso-string>)` against
    `orderBy('createdDateTime', 'desc')` — matches the legacy query
    shape (no composite index required). The cursor's `createdAtMillis`
    is converted to an ISO string at the boundary (both legacy and
    the rewrite write `createdDateTime` as `new Date().toISOString()`,
    so lexicographic string compare = chronological order).
  - New `buildPage(snap, statuses, limit)` private helper. Tracks
    the boundary doc BEFORE applying the client-side status filter,
    so `nextCursor` advances by the raw last row even when the
    filter shrinks the visible page. Returns `nextCursor: null`
    when `size < limit` OR no limit was passed.
  - New module-level `cursorToIsoString(cursor)` +
    `buildCursor(rawCreatedDateTime, lastDocId)` helpers. The
    `buildCursor` defensive branch accepts both ISO strings (the
    normal case) and Firestore `Timestamp` objects via the
    `.toMillis()` duck-type, in case a Cloud Function or admin
    backfill ever surfaces a Timestamp on `createdDateTime`.
- **`repositories/__tests__/FirestoreRideRepository.pagination.test.ts`**
  (new). 9 tests:
  - First page (no cursor) returns rides + nextCursor when `size ===
limit`.
  - End-of-list returns null nextCursor.
  - Second page calls `startAfter('2026-05-19T09:00:00.000Z')`
    (literal ISO).
  - Status filter shrinks visible page but cursor advances by raw
    last row.
  - No-limit reads emit null nextCursor.
  - Firestore throws → `NetworkError { code: 'ride_list_failed' }`.
  - Driver-side mirrors passenger-side for the first three arms.

  Pattern: `jest.mock('@react-native-firebase/firestore')` factory
  uses `mock`-prefixed helpers (`mockMakeSnap`, `mockCapturedClauses`)
  to satisfy jest's hoisting-aware out-of-scope-variable check.
  `where` / `orderBy` / `limit` / `startAfter` return tagged
  objects (`__kind: 'startAfter'`, etc.) so the test can assert
  what was wired into the query.

### C. App (`src/app/usecases/ride/`)

- **`ListRidesByPassenger.ts` / `ListRidesByDriver.ts`** (extended).
  Forward the new `cursor` argument; return type is `RidePage`. No
  business-logic change — the use case is a thin pass-through.
- Tests: existing `ListRidesByPassenger.test.ts` /
  `ListRidesByDriver.test.ts` updated to read `.rides` off
  `r.value` instead of `r.value` directly (5 existing arms each).
  One new "paginate: page 1 cursor resumes page 2" arm added to
  each (validates the in-memory fake's pagination implementation
  end-to-end).

### D. In-memory fake (`src/shared/testing/InMemoryRideRepository.ts`)

- `listByPassenger` / `listByDriver` extended to return `RidePage`.
  New module-level `paginateInMemory(sortedDesc, statuses, limit,
cursor)` helper — mirrors the Firestore adapter's behavior:
  applies cursor → slices to `limit` raw rows → tracks boundary
  before status filter → emits `nextCursor: null` when the raw
  page is shorter than `limit`. The cursor lookup matches
  Firestore's single-field tie-skip exactly:
  `findIndex(r => r.createdAt.getTime() < cursorMillis)` — drops
  every tie-mate that shares the boundary's `createdAt`, so the
  fake never hides a real-adapter divergence.
- Tests: existing arms migrated to `.rides`. Two new arms:
  "paginate: page 1 cursor resumes page 2" and the
  tie-skip regression ("cursor whose createdAt equals other rides
  drops every tie-mate").

### E. Presentation callsite migration (`src/presentation/queries/ride.queries.ts`)

Three one-line callsite changes:

- `useRidesByPassengerQuery` returns `r.value.rides` (was
  `r.value`).
- `useInProgressRideQuery` reads `r.value.rides[0] ?? null` (was
  `r.value[0] ?? null`).
- `useInProgressDriverRideQuery` reads `r.value.rides[0] ?? null`.

No other consumers — `grep -rn 'listRidesByPassenger\|listRidesByDriver'`
returned only the DI container wiring + tests.

### F. Presentation — components (`src/presentation/components/trip/`)

- **`TripCard.tsx`** (new). Per-row card: status pill, "Trip with
  {OtherParty}" header (role-derived), pickup → dropoff endpoints,
  formatted createdAt, fare preview. Fare display: prefixed with
  `Est. ` (the Ride entity carries no final-charge field — the
  authoritative total lives in the `payments` subcollection rendered
  on `TripDetailScreen`); hidden entirely for `cancelled` trips
  because the base fare doesn't reflect what (if anything) the rider
  was charged. The status pill splits into `statusPillBgClass` +
  `statusPillTextClass` so the wrapper `<View>` and inner `<Text>`
  get only the class they can apply (NativeWind drops `bg-*` on
  Text and `text-*` on View). Wraps in a `Pressable`; emits
  `testID="trip-card-{rideId}"` for E2E.
- **`TripList.tsx`** (new). Thin `FlatList` wrapper. Props: rides,
  viewerRole, onSelectRide, ListEmptyComponent, ListFooterComponent,
  refreshing, onRefresh, testID. Stable `keyExtractor` from
  `ride.id`. Does NOT inline `<DevToolsSection/>` — the parent
  screen passes it via `ListFooterComponent`.
- **`TripPaymentsList.tsx`** (new). Per-trip payments table for
  `TripDetailScreen`. Renders one row per payment with type label
  (Fare / Tip / Refund), status pill (Succeeded / Failed / Refunded),
  amount via `Money.format()`, and a "Total" footer summing
  `succeeded` fare/tip rows minus `succeeded` refund rows. Total
  math runs in minor units via `Money.add` / `Money.subtract` —
  no floats, no currency mixing.
- Tests:
  - `TripCard.test.tsx` (8 tests — rider/driver party label, no-
    driver fallback, status pill copy, fare rendering with `Est.`
    prefix, address rendering, press dispatch, cancelled hides
    the fare line).
  - `TripList.test.tsx` (5 tests — renders one card per ride,
    empty slot, footer slot, press dispatch, stable keying).
  - `TripPaymentsList.test.tsx` (6 tests — empty state, multi-row
    render, fare+tip total, refund subtraction, failed-row
    exclusion, no-total-row when nothing succeeded).
- Shared fixture: `__tests__/_rideFixture.ts` (new). Local helpers
  (`makePassenger`, `makeDriver`, `makeRideService`,
  `makeAwaitingRide`, `makeRoute`, `makeRideAt`) so component +
  VM tests don't re-implement the 50-line `Ride.create(...)` boilerplate.
  Kept inside the components folder (not `@shared/testing`)
  because it's presentation-test-only — matches the codebase's
  file-local fixture convention.

### G. Presentation — view-models

- **`features/rider/view-models/useActivityViewModel.ts`** (new).
  Composes `useInfiniteQuery` against `ListRidesByPassenger` with
  `pageParam: RideListCursor | null`. `queryKey =
[...queryKeys.ride.listsForPassenger(passengerId), 'activity-recent']`.
  Flat output shape: `{status, rides, errorMessage, canLoadMore,
isLoadingMore, isRefreshing, onLoadMore, onRefresh, onSelectRide}`.
  `onSelectRide` does the status-aware nav switch.
- **`features/driver/view-models/useDriverActivityViewModel.ts`**
  (new). Mirror of the rider VM with `ListRidesByDriver`.
- **`features/shared/view-models/useTripDetailViewModel.ts`** (new).
  Composes `useQuery(GetRideById)` (one-shot — trip is terminal,
  no live updates expected) + `useFirestoreSubscription(ObserveTripEvents)`
  - `useFirestoreSubscription(ObserveTripPayments)`. Maps `NotFoundError`
    to a `'not-found'` discriminator so the screen can render a
    dedicated "trip not found" message. Output: `{status, ride,
events, payments, errorMessage, refresh}`. `viewerRole` is
    intentionally NOT computed here — `TripDetailScreen` derives it
    from `useCurrentUserId()` against the loaded ride. Keeps the VM
    independent of the session store and trivially testable.
- Tests:
  - `useActivityViewModel.test.tsx` (5 tests — loading→empty
    transition, ride list newest-first, terminal vs active nav
    routing, paginate `canLoadMore`, null passengerId no-op).
  - `useDriverActivityViewModel.test.tsx` (4 tests — same arms,
    driver-side).
  - `useTripDetailViewModel.test.tsx` (2 tests — ready state with
    events + payments, not-found state).

### H. Presentation — screens

- **`features/rider/screens/ActivityScreen.tsx`** (new). Replaces
  `ActivityPlaceholderScreen`. Header "Recent rides" + `TripList`
  with `ListFooterComponent` composing a "Load more" pressable
  (when `vm.canLoadMore`) and `<DevToolsSection/>` (preserved from
  the placeholder). Empty state copy: "No recent rides — When you
  take a ride, it will show up here." Pull-to-refresh wired via
  `vm.onRefresh`. Three render branches: loading (centered spinner),
  error (centered destructive copy + footer), ready/empty (header
  - TripList). The async VM `onRefresh` is wrapped in a synchronous
    `() => { void vm.onRefresh(); }` to satisfy
    `@typescript-eslint/no-misused-promises` on `RefreshControl`.
- **`features/driver/screens/DriverActivityScreen.tsx`** (new).
  Mirror of `ActivityScreen` with the driver VM. Empty copy: "Rides
  you accept will show up here." Footer testID
  `driver-activity-load-more`.
- **`features/shared/screens/TripDetailScreen.tsx`** (new). The
  exported component validates `route.params.rideId` via
  `RideId.create()` — invalid ids render the not-found state
  short-circuit and never mount the VM (defends against unvetted
  deep-link / push-notification params). On a valid id the
  component delegates to an inner `TripDetailScreenBody` so the
  conditional early return doesn't violate the Rules of Hooks.
  Body has loading / not-found / error / ready branches. Ready
  renders four sections: party header + status + timestamp +
  service, route (pickup / dropoff), payments (`TripPaymentsList`),
  and a per-trip events timeline. Viewer role is derived from
  `useCurrentUserId()` matching `ride.driver?.id` — driver match →
  driver view (party header names passenger); else rider view
  (party header names driver). The screen's props type is
  `RiderStackScreenProps<'TripDetail'>` for brevity; the driver
  stack works because both stacks register the same
  `TripDetail: { rideId: string }` route shape (verified by
  typecheck).
- Tests:
  - `ActivityScreen.test.tsx` (6 tests — empty state, ride rows,
    DevToolsSection footer, completed-ride routes to TripDetail,
    active-ride routes to RideMonitor, Load more button visibility).
  - `DriverActivityScreen.test.tsx` (5 tests — same arms, driver-
    side).
  - `TripDetailScreen.test.tsx` (4 tests — rider-view ready state
    with payments + events, not-found state, driver-view party
    header, invalid-rideId short-circuit renders not-found
    without calling the repository).

### I. Navigation (`src/presentation/navigation/`)

- **`types.ts`** (extended). Added
  `TripDetail: { rideId: string }` to BOTH `RiderStackParamList`
  and `DriverStackParamList` (same param shape on both — the screen
  derives viewer role from the session).
- **`RiderTabsNavigator.tsx`** / **`DriverTabsNavigator.tsx`**:
  swapped the placeholder imports for the real screens. Updated
  the file-header doc comments.
- **`RiderNavigator.tsx`** / **`DriverNavigator.tsx`**: registered
  `TripDetail` with the new `TripDetailScreen` import from
  `@presentation/features/shared/screens/TripDetailScreen`.

### J. Placeholder file deletion (scheduled)

The placeholder screens + their `__tests__/*PlaceholderScreen.test.tsx`
files were scheduled for deletion at commit time via `git update-
index --remove`. Virtiofs blocks the working-tree unlink, so the
files were overwritten as deprecated re-export stubs (placeholder
screen → `export { default } from './ActivityScreen'`) and the
test files were reduced to a single no-op assertion. The commit
itself reflects the deletion in the tree; the working-tree stubs
remain present on disk for the user to remove from a host shell
(`find ... -name '*Placeholder*' -delete`) after merge.

## Test additions and pass counts

New / extended test files:

| Layer     | File                                                                        | Tests added                               |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Domain    | `entities/__tests__/RideListCursor.test.ts`                                 | **11** (all new)                          |
| Data      | `data/repositories/__tests__/FirestoreRideRepository.pagination.test.ts`    | **10** (all new)                          |
| Data      | `data/repositories/__tests__/FirestoreRideRepository.test.ts`               | unchanged (telemetry-only)                |
| Fake      | `shared/testing/__tests__/InMemoryRideRepository.test.ts`                   | +2 (pagination round-trip; tie-skip)      |
| App       | `app/usecases/ride/__tests__/ListRidesByPassenger.test.ts`                  | +1 (pagination round-trip); 4 migrated    |
| App       | `app/usecases/ride/__tests__/ListRidesByDriver.test.ts`                     | +1 (pagination round-trip); 5 migrated    |
| Component | `components/trip/__tests__/TripCard.test.tsx`                               | **8** (all new)                           |
| Component | `components/trip/__tests__/TripList.test.tsx`                               | **5** (all new)                           |
| Component | `components/trip/__tests__/TripPaymentsList.test.tsx`                       | **6** (all new)                           |
| VM        | `features/rider/view-models/__tests__/useActivityViewModel.test.tsx`        | **5** (all new)                           |
| VM        | `features/driver/view-models/__tests__/useDriverActivityViewModel.test.tsx` | **4** (all new)                           |
| VM        | `features/shared/view-models/__tests__/useTripDetailViewModel.test.tsx`     | **2** (all new)                           |
| Screen    | `features/rider/screens/__tests__/ActivityScreen.test.tsx`                  | **6** (all new)                           |
| Screen    | `features/driver/screens/__tests__/DriverActivityScreen.test.tsx`           | **5** (all new)                           |
| Screen    | `features/shared/screens/__tests__/TripDetailScreen.test.tsx`               | **4** (all new)                           |
| Cleanup   | `*PlaceholderScreen.test.tsx` (both)                                        | reduced to 1 no-op each (deletion staged) |

**Net new tests: ~70 across all four layers.** Jest run:

```
Test Suites: 199 passed across 3 shards (modulo the carry-over
Turn 9 BG-geolocation failures)
Tests:       ~1743 passed total + 21 carry-over failures
Snapshots:   0 total
```

The 21 failures all live in
`src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
and are explicitly Turn 9 scope (pre-existing `__DEV__` short-
circuit + assertion mismatch — audit §10.1).

## Acceptance criteria

- [x] Decisions 1-6 documented with the evidence that drove them.
- [x] `RideListCursor` VO + `RidePage` type shipped in `@domain/entities`.
- [x] `RideRepository.listByPassenger` + `listByDriver` accept an
      optional `cursor: RideListCursor` argument and return
      `Result<RidePage, NetworkError>`.
- [x] `FirestoreRideRepository` pagination implementation uses
      `startAfter(<iso>)` against `orderBy('createdDateTime', 'desc')`
      and emits `nextCursor` correctly (null when page < limit).
- [x] In-memory fake mirrors the paginated signature.
- [x] `useInProgressRideQuery` + `useInProgressDriverRideQuery` +
      `useRidesByPassengerQuery` callsites migrated to `.rides`.
- [x] Activity tab placeholders deleted (staged at commit); tab
      navigators mount `ActivityScreen` + `DriverActivityScreen`.
- [x] `useActivityViewModel` + `useDriverActivityViewModel` use
      `useInfiniteQuery` against the paginated use cases; surface
      a flat status / rides / canLoadMore output shape.
- [x] Trip-row tap navigates to `RideMonitor` / `DriverMonitor` for
      non-terminal statuses and to `TripDetail` for terminal
      (`completed` / `cancelled`).
- [x] `TripDetailScreen` renders trip route, role-flipped party
      header, per-trip events list, per-trip payments list.
- [x] `TripPaymentsList` subscribes via `ObserveTripPayments` (via
      the VM) and totals correctly (succeeded fare/tip minus
      succeeded refund; `Money` minor units).
- [x] `<DevToolsSection/>` continues to mount on the new
      `ActivityScreen` + `DriverActivityScreen` via
      `ListFooterComponent`.
- [x] New / updated tests for each touched layer per the §F table.
      ~70 new tests, no regressions outside Turn 9's 21
      carry-overs.
- [x] Audit §3.3 row flipped ❌ → ✅ with Turn 6 annotation.
- [x] Audit §3.6 row flipped 🟡 → ✅ with the `TripPaymentsList`
      fold-in annotation.
- [x] Audit §1 headline count updated `4 ❌ / 1 🟡` → `3 ❌ / 0 🟡`.
- [x] Audit §8 turn-plan row 6 strike-through + close date.
- [x] Audit header sublabel appended with "Turn 6 closed 2026-05-19".
- [x] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo the pre-existing `CLAUDE.md` Prettier
      warning); jest carries only the 21 pre-existing
      BG-geolocation failures.

## Out of scope (deferred to later turns)

- **Scheduled rides creation UI** — Turn 7 owns the datetime picker
  plugin + `RideScheduledConfirmation` modal + the LISTING side of
  scheduled rides on Activity (rider only; legacy didn't show
  scheduled on the driver side either).
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **Audit v3 + cutover sign-off** — Turn 10.
- **`RideReceiptScreen` refactor** — kept untouched. The two
  surfaces have different purposes (immediate-post-trip receipt
  with PDF + first-time-tip vs. arbitrary-time trip-detail drill-
  in from Activity).
- **Live `onSnapshot` on Activity** — `useInfiniteQuery` is enough
  per Decision 6. Live updates aren't essential on history.
- **Tip re-entry from `TripDetailScreen`** — out of scope for Turn 6. A follow-up turn can add a "Tip your driver" CTA on the
  trip-detail surface if needed; legacy `TripPreviewModal` showed
  one inline, but the rewrite's `RideReceiptScreen` already
  exposes that flow for the rider's primary path.
- **Composite Firestore index for two-field cursor** — single-field
  `startAfter(<iso>)` works without a composite index (matches
  legacy query shape). Exact-millisecond ties between two trips
  for the same passenger are essentially impossible at YeRide's
  scale; if they ever surface, the upgrade path is to add an
  explicit `orderBy(documentId(), 'desc')` + composite index +
  `startAfter(ts, docId)`.
- **Detox E2E for the Activity flow** — covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.1 gate.

## Native rebuild

**Not required.** All changes are JS/TS — no `app.config.ts`,
plugin additions, or native-side edits. Metro bundle reload picks
up the changes.

## Notes for the next turn

- Turn 7 wires `ObserveScheduledRides` (which the Decision 3 = (b)
  defer punted) PLUS the rider-side creation UI. Turn 7's audit
  closure should flip §3.2 (Scheduled rides creation UI). The
  data path for scheduled-listing is a one-method addition on
  `RideRepository` (`observeScheduledRidesForPassenger`); the
  rider's Activity surface can grow a new "Scheduled" section
  above "Recent rides" in a ~50-line patch once that ships.
- Turn 9's BG-geolocation test fix remains the last gate before
  cutover plan §3.1 (`npm run verify` green at cutover SHA).
