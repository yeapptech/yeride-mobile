# Phase 10 Turn 7 — Scheduled rides (rider-side creation UI + listing)

**Closed:** 2026-05-19
**Predecessor:** [PHASE_10_TURN_6.md](PHASE_10_TURN_6.md)
**Kickoff:** [PHASE_10_TURN_7_KICKOFF.md](PHASE_10_TURN_7_KICKOFF.md)

## Why

Audit §3.2 was the largest remaining ❌ blocking the cutover plan §6
rollout. Legacy yeride lets riders pick a future pickup datetime,
persist a `scheduled` ride, and see pending scheduled rides on
Activity; the rewrite had every supporting piece (RideStatus
literals, `useTripDraftStore.scheduledPickupAt`, push routing for
`scheduled_driver_accepted`) but no creation UI, no confirmation
screen, no listing, and no native picker dependency.

This turn closes the gap end-to-end. The headline audit count
flips `3 ❌ → 2 ❌`; only §3.4 Chat and §10.1 BG-geolocation test
regression remain.

## Pre-checklist outcomes (resolved at kickoff time)

1. **HEAD SHA:** `5104aa95b7d903dc0bd76cda45b88caef993ab21` (Turn 6
   closure). Working tree clean modulo the untracked kickoff doc.
2. **Rewrite gap verified.** `grep -rn 'ScheduleDatetimePicker|RideScheduledConfirmation|observeScheduled|ObserveScheduledRides' src/` returned only the
   `useTripDraftStore.ts:42` comment referencing the not-yet-built
   picker. Zero other matches.
3. **`@react-native-community/datetimepicker` not in package.json.**
   Added at `8.4.4` (Expo SDK 55 compatible). `npm install` succeeded
   under the sandbox to make the test mock resolvable.
4. **Decision 6 confirmed bug.** `useInProgressRideQuery.ACTIVE_STATUSES`
   at `src/presentation/queries/ride.queries.ts:47` INCLUDED
   `'scheduled'`. A pure-scheduled ride has no driver yet — it must
   not redirect to RideMonitor. Removed in scope (single-line edit).
5. **Cloud Function wire shape confirmed.** `yeride-functions/handlers/trip-created.js:120-121` reads
   `tripData.schedulePickupAt.toDate()` — Firestore Timestamp shape
   required. Mapper writes a JS `Date` (Firestore SDK serializes to
   Timestamp on write); read path coerces Timestamp/ISO/null → Date.
6. **Legacy line counts confirmed.** 224 / 79 / 57 (picker /
   confirmation / scheduledTrips). Matched kickoff §"Required reading."
7. **Datetime formatter:** `src/shared/datetime/` existed but was
   empty. Added `formatScheduleDateTime.ts` (Today / Tomorrow / "Fri,
   May 22, 2026 at 3:45 PM" shape) implemented against
   `Intl.DateTimeFormat` since `date-fns` is not in the rewrite.
8. **Firestore rules parity.** Legacy `firestore.rules` lines
   119/125/133/143 reference `'scheduled'` status alongside
   `'awaiting_driver'`. The rewrite does NOT ship a `firestore.rules`
   file (deploys against legacy yeride's rules in the shared
   `yeapp-stage` project per data co-existence). No rewrite-side
   rules change required.

## Decisions locked at kickoff time

### Decision 1 — `Ride.createScheduled` static factory. Pick (b).

Mirrors the "transitions return new entities" pattern (line 196
`dispatch`, line 223 `start`, etc.). Keeps `Ride.create()` semantics
unchanged. Call sites use whichever factory they need without
optional-argument branching inside `CreateRide.execute`.

### Decision 2 — Subscription `observeScheduledRidesByPassenger`. Pick (a).

Legacy uses `onSnapshot`. Scheduled rides DO mutate while the rider
watches them (`scheduled` → `scheduled_driver_accepted` on driver
accept, then dispatched at the pickup window). Activity's Recent
Rides section chose `useInfiniteQuery` because history doesn't
mutate post-closure; the scheduled set is the opposite case.

### Decision 3 — Legacy-shape route params. Pick (a).

`RideScheduledConfirmation` params carry pre-formatted display
strings (`formattedSchedulePickupAt: string`, `pickupAddress: string
| null`) rather than a `tripId`. Confirmation is a transient one-way
screen the rider sees once immediately after creation; reloading the
trip via `tripId` would just re-fetch fields the VM just wrote.
Smaller diff.

### Decision 4 — Client-side sort. Pick (b).

Repository query is `where('passenger.id', '==', …) AND
where('status', 'in', [scheduled, scheduled_driver_accepted])`. No
server-side `orderBy('schedulePickupAt')` — keeps the cutover-plan
§3.4 "Firestore indexes unchanged from legacy app's HEAD" gate
green. Per-rider scheduled volume is implausibly low (<5 typical)
so client-side sort by `schedulePickupAt asc` in the VM is free.

### Decision 5 — Tagged confirm() return. Pick (a).

`useRouteSelectViewModel.confirm()` now returns `Promise<{rideId,
isScheduled} | null>`. The screen branches on `isScheduled` for the
navigation target: true → `RideScheduledConfirmation`; false →
`RideMonitor`. Single VM API addition, single screen switch.

### Decision 6 — Fix `useInProgressRideQuery` in scope.

Pre-checklist confirmed `'scheduled'` IS in the `ACTIVE_STATUSES`
literal at `ride.queries.ts:47`. That's a pre-existing bug: a
pure-scheduled ride (no driver yet) would auto-redirect a rider into
an empty RideMonitor immediately after scheduling. Single-line edit
in scope here; new JSDoc explains why `'scheduled'` is excluded.
`'scheduled_driver_accepted'` (the post-accept variant) stays in
the set.

### Decision 7 — Picker entry on RouteSelect. Pick (a).

Legacy parity. The row sits between `RideServicesList` and the
Confirm button on `RouteSelectScreen.tsx`. Tap opens
`ScheduleDatetimePicker`; an active selection shows the formatted
datetime + a Clear control inline.

## Patch shape (bottom-up)

### A. Domain (`src/domain/`)

- **`entities/Ride.ts`**
  - Added `schedulePickupAt: Date | null` to `RideProps`.
  - Exported new `SCHEDULED_RIDE_MIN_LEAD_MINUTES = 15` constant.
  - New `static createScheduled(args)` factory with the 15-minute-floor
    validation; rejects with `ValidationError({code:
'ride_invalid_schedule', field: 'schedulePickupAt'})`.
  - `static create()` now sets `schedulePickupAt: null` (no behavior
    change for non-scheduled callers).
  - New getter `get schedulePickupAt(): Date | null`.
- **`entities/__tests__/Ride.test.ts`** — added `Ride.createScheduled`
  describe block: happy path, 15-min floor rejection, before-createdAt
  rejection, boundary acceptance, NaN-date rejection.

### B. Data (`src/data/`)

- **`dto/RideDoc.ts`** — added `SchedulePickupAtSchema`
  (`z.preprocess` accepting Firestore `Timestamp` duck-type / ISO
  string / null/missing → `Date | null`); added
  `schedulePickupAt: SchedulePickupAtSchema.optional()` to
  `RideDocSchema`.
- **`mappers/rideMapper.ts`**
  - Read path (`toDomain`): passes `doc.schedulePickupAt ?? null`
    through to `Ride.fromProps`.
  - Write path (`toDoc`): emits `schedulePickupAt: Date` when set
    (Firestore SDK serializes to Timestamp); OMITS the field when
    null (CLAUDE.md forbids `undefined` writes).
- **`repositories/FirestoreRideRepository.ts`** — implemented
  `observeScheduledRidesByPassenger(args)` via `onSnapshot` over
  `where('passenger.id', '==', passengerId) AND where('status', 'in',
['scheduled', 'scheduled_driver_accepted'])`. Reuses the existing
  `toDomainOrCorrupt` per-doc skip pattern. Stream error → `callback([])`
  - `logger.warn`, mirroring `subscribeAvailableRides` / `observeById`.
- **`mappers/__tests__/rideMapper.test.ts`** — added a
  `schedulePickupAt — scheduled-ride field` describe block:
  round-trip, OMIT-on-null write, Timestamp duck-type coercion,
  ISO-string tolerance, missing/null reads.

### C. Domain repository interface (`src/domain/repositories/`)

- **`RideRepository.ts`** — added `observeScheduledRidesByPassenger(args)`
  declaration with full JSDoc on the status-set, subscription shape,
  client-side ordering rationale, and the
  "no composite-index deploy at cutover" decision.

### D. In-memory fake (`src/shared/testing/InMemoryRideRepository.ts`)

- Added `scheduledObservers` Set + `notifyScheduled()` +
  `computeScheduled(passengerId)` helpers.
- `observeScheduledRidesByPassenger(args)`: registers an observer,
  synchronously emits current state (Firestore `onSnapshot` parity),
  returns the unsubscribe.
- `create` / `update` / `cancel` mutation paths now also call
  `notifyScheduled()` so the fake re-emits when the scheduled set
  changes.
- `reset()` clears `scheduledObservers`.
- **`__tests__/InMemoryRideRepository.test.ts`** — added
  `observeScheduledRidesByPassenger` describe block: initial empty
  emit, scheduled-status delivery, awaiting-driver exclusion, re-emit
  on create, passenger isolation, unsubscribe stops delivery, drop
  after cancel transition.

### E. App use cases (`src/app/usecases/ride/`)

- **`CreateRide.ts`** — extended `CreateRideInput` with
  `scheduledPickupAt?: Date | null`. Branches at the factory level:
  non-null → `Ride.createScheduled`; null/missing → `Ride.create`.
  The 15-min-floor validation surfaces through the same `Result`
  return.
- **`ObserveScheduledRides.ts`** — new subscription-shaped use case;
  thin wrapper over `repo.observeScheduledRidesByPassenger`. No
  `Result` (subscription cleanups don't fail).
- **`__tests__/CreateRide.test.ts`** — new test file (no prior CreateRide
  tests existed). Covers: awaiting-default path, null-scheduled
  path, scheduled path, too-soon ValidationError, repo.create
  call-count.
- **`__tests__/ObserveScheduledRides.test.ts`** — new test file:
  initial delivery, re-emit on create, unsubscribe stops.

### F. DI wiring (`src/presentation/di/container.ts`)

- Imported `ObserveScheduledRides`; added `observeScheduledRides:
ObserveScheduledRides` to the `UseCases` interface; instantiated
  in `makeUseCases` over `args.rides`.

### G. Presentation — shared (`src/shared/`)

- **`datetime/formatScheduleDateTime.ts`** — new helper. Output
  shapes: `Today at h:mm AM/PM`, `Tomorrow at h:mm AM/PM`, `Fri,
May 22, 2026 at 7:30 PM`. Implemented against built-in
  `toLocaleString`/`getHours`/`getMinutes` (no `date-fns` dependency
  in the rewrite). `now` is an injectable second arg for stable
  tests.
- **`datetime/__tests__/formatScheduleDateTime.test.ts`** — new test
  file: Today, Tomorrow, "future day" branch, minute padding,
  midnight/noon 12-hour rendering.

### H. Presentation — components (`src/presentation/components/trip/`)

- **`ScheduleDatetimePicker.tsx`** — new. Typed port of legacy
  `ScheduleDatetimePicker.js`. iOS spinner / Android two-step UX
  preserved. `tempDate` ferries the picked date across Android's
  date→time picker dialogs. `Modal` flags `statusBarTranslucent` +
  `navigationBarTranslucent` for Android 15 edge-to-edge. Validation
  surfaces an inline error message (`schedule-datetime-picker-error`)
  instead of swallowing the tap. Semantic NativeWind tokens
  (`bg-card`, `text-primary-foreground`, `text-destructive`, etc.) —
  no raw hex.
- **`__tests__/ScheduleDatetimePicker.test.tsx`** — new test file:
  visibility gating, title + button render, close-button press,
  too-soon error path, valid-date `onSchedule` + `onClose` invocation,
  boundary-time check.
- **`__mocks__/@react-native-community/datetimepicker.tsx`** — new
  manual Jest mock (`<View testID="mock-datetimepicker"/>` stub) so
  the picker tests run without the native module. Lives as a manual
  mock to avoid the NativeWind babel-hoist gotcha called out in
  `react-native-maps.tsx`.

### I. Presentation — view-models (`src/presentation/features/rider/view-models/`)

- **`useRouteSelectViewModel.ts`**
  - Surfaces `scheduledPickupAt: Date | null` (read from
    `useTripDraftStore`) + `setScheduledPickupAt(at)` +
    `formattedSchedulePickupAt: string | null` (computed via the new
    helper).
  - `confirm()` return changed from `Promise<RideId | null>` to
    `Promise<{rideId: RideId; isScheduled: boolean} | null>` (per
    Decision 5). Passes `scheduledPickupAt` through
    `createRideMutation.mutateAsync`.
  - `reset()` continues to clear the draft on success (no behavior
    change — the existing reset includes `scheduledPickupAt: null`).
- **`useActivityViewModel.ts`**
  - New `scheduledRides: readonly Ride[]` field on the VM output.
  - `useEffect` subscribes to `useCases.observeScheduledRides.execute({passengerId, callback})`
    while `passengerId` is non-null; sorts client-side by
    `schedulePickupAt asc`. Cleanup runs the synchronous
    unsubscribe.
- **`__tests__/useRouteSelectViewModel.test.tsx`** — added
  scheduled-pickup describe block: null-by-default, set updates
  formatter, clear resets.
- **`__tests__/useActivityViewModel.test.tsx`** — added scheduled-rides
  describe block: initial subscription delivery, ascending sort by
  schedulePickupAt, re-emit on create, null-passenger empty list.

### J. Presentation — screens (`src/presentation/features/rider/screens/`)

- **`RouteSelectScreen.tsx`**
  - New schedule-pickup row between `RideServicesList` and the
    `submitError` region. Tap → `setPickerVisible(true)`. Active
    selection shows the formatted datetime + a Clear button.
  - Confirm button label flips to `"Schedule ride"` when scheduled,
    `"Confirm ride"` otherwise (legacy parity).
  - Post-confirm branch: `isScheduled` →
    `navigation.replace('RideScheduledConfirmation', {…})`;
    otherwise → `RideMonitor` (existing path).
  - Mounts `<ScheduleDatetimePicker/>` at the bottom of the screen
    tree; visibility owned by local state, selection forwards to
    `vm.setScheduledPickupAt`.
- **`RideScheduledConfirmationScreen.tsx`** — new. Stateless port of
  legacy `RideScheduledConfirmation.js`: ✓ icon, formatted pickup
  datetime, pickup address, reassurance line, Got-it button → pops
  to `RiderTabs > RiderHome`.
- **`ActivityScreen.tsx`** — added Scheduled section above Recent
  Rides. Renders only when `vm.scheduledRides.length > 0` (legacy
  parity — empty hides). Each ride row uses the existing `TripCard`
  with `viewerRole="rider"`; tap routes through `vm.onSelectRide`
  (existing terminal-vs-active branch handles `scheduled_driver_accepted`
  → RideMonitor).
- **`__tests__/RideScheduledConfirmationScreen.test.tsx`** — new:
  renders datetime + address, hides address when null, "Got it"
  navigates to `RiderTabs > RiderHome`, reassurance line present.

### K. Navigation (`src/presentation/navigation/`)

- **`types.ts`** — added `RideScheduledConfirmation` entry to
  `RiderStackParamList` with `{formattedSchedulePickupAt: string;
pickupAddress: string | null}` params.
- **`RiderNavigator.tsx`** — imported + mounted
  `RideScheduledConfirmationScreen` between `RideReceipt` and
  `TripDetail`. `headerShown: false`, `gestureEnabled: false` (full-bleed
  one-way surface).

### L. Presentation queries (`src/presentation/queries/ride.queries.ts`)

- Removed `'scheduled'` from `ACTIVE_STATUSES` (Decision 6 fix).
  Added new JSDoc explaining why: pure-scheduled rides have no
  driver yet → no live surface → no redirect; the
  `'scheduled_driver_accepted'` variant remains in the set because
  that's the post-accept pre-pickup state that DOES land in
  RideMonitor.

### M. Native config

- **`package.json`** — added `"@react-native-community/datetimepicker": "8.4.4"`
  under `dependencies`. Expo SDK 55 compatible pin.
- **`app.config.ts`** — appended `'@react-native-community/datetimepicker'`
  to the `plugins:` array (between `withGoogleMapsApiKey` and the
  Stripe plugin block region — comment block calls out the rationale).

## Test additions and pass counts

| Suite                                                                                        | New tests | Notes                                                        |
| -------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| `src/domain/entities/__tests__/Ride.test.ts`                                                 | +5        | `Ride.createScheduled` describe                              |
| `src/data/dto/__tests__/RideDoc.test.ts` _(via rideMapper)_                                  | (covered) | DTO accept covered indirectly via mapper round-trip          |
| `src/data/mappers/__tests__/rideMapper.test.ts`                                              | +6        | Timestamp coerce, ISO accept, OMIT-on-null write, round-trip |
| `src/shared/testing/__tests__/InMemoryRideRepository.test.ts`                                | +7        | Initial emit, status filter, isolation, unsubscribe, cancel  |
| `src/app/usecases/ride/__tests__/CreateRide.test.ts`                                         | +5        | New file (no prior coverage)                                 |
| `src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`                              | +3        | New file                                                     |
| `src/shared/datetime/__tests__/formatScheduleDateTime.test.ts`                               | +5        | Today / Tomorrow / future / pad / midnight-noon              |
| `src/presentation/components/trip/__tests__/ScheduleDatetimePicker.test.tsx`                 | +6        | Component-level: visibility, schedule, error, close          |
| `src/presentation/features/rider/screens/__tests__/RideScheduledConfirmationScreen.test.tsx` | +4        | Screen-level                                                 |
| `src/presentation/features/rider/view-models/__tests__/useRouteSelectViewModel.test.tsx`     | +2        | scheduledPickupAt setter / clearer                           |
| `src/presentation/features/rider/view-models/__tests__/useActivityViewModel.test.tsx`        | +4        | Subscription + sort + re-emit + null-passenger               |

**Total: ~47 new tests across 11 suites.** Targeted scheduled-rides
jest run: 143 passed across 11 suites. Whole-suite (3 shards):
1792 passed, 21 failed — the 21 carry-over BG-geolocation failures
documented in audit §10.1 (Turn 9 scope; out of scope here).

## Verify gates

```
npm run typecheck      # ✅ green
npm run lint           # ✅ green
npm run format:check   # ⚠️ only the pre-existing CLAUDE.md warning
npm test               # ✅ 1792 passed, 21 carry-over BG failures
```

## Acceptance criteria

- [x] Decisions 1-7 documented with the evidence that drove them.
- [x] `Ride.createScheduled` returns a Ride with
      `status === 'scheduled'` and `schedulePickupAt: Date`;
      rejects `schedulePickupAt < createdAt + 15min`.
- [x] `RideDoc` DTO + `rideMapper` round-trip `schedulePickupAt`
      via Firestore Timestamp; ISO-string and missing/null tolerated
      on reads.
- [x] `RideRepository.observeScheduledRidesByPassenger` shipped on
      both adapters (Firestore + in-memory fake), filtered to
      passenger.id + status IN [scheduled, scheduled_driver_accepted].
- [x] `CreateRide` accepts `scheduledPickupAt?: Date | null` and
      routes through `Ride.createScheduled` when present.
- [x] `ObserveScheduledRides` use case shipped + wired through DI.
- [x] `ScheduleDatetimePicker.tsx` typed component with iOS spinner /
      Android two-step UX + 15-min floor.
- [x] `RideScheduledConfirmationScreen.tsx` shipped + routed via
      `RiderStackParamList.RideScheduledConfirmation`.
- [x] `RouteSelectScreen` schedule row + clear control + scheduled-branch
      navigation.
- [x] `useRouteSelectViewModel.confirm()` returns the tagged shape.
- [x] `ActivityScreen` renders the Scheduled section above Recent
      Rides when populated; hides when empty.
- [x] `useInProgressRideQuery` no longer auto-redirects pure-scheduled
      rides (Decision 6 fix).
- [x] `@react-native-community/datetimepicker` added to `package.json`
      and `app.config.ts` plugins.
- [x] Audit §3.2 ❌ → ✅; §4 plugin row ❌ → ✅; §8 turn 7 ❌ → ✅;
      headline 3 ❌ → 2 ❌.
- [x] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo pre-existing CLAUDE.md Prettier warning); jest
      carries only the 21 pre-existing BG-geolocation failures.

## Out of scope (deferred to later turns)

- **Chat (§3.4)** — Turn 8.
- **BG-geolocation test regression (§10.1)** — Turn 9.
- **Audit v3 + cutover sign-off** — Turn 10.
- **Composite Firestore index** for scheduled-rides server-side
  ordering — keeps cutover-plan §3.4 "indexes unchanged" gate green
  per Decision 4; deferable polish if volume grows.
- **Re-scheduling an existing scheduled ride.** Legacy doesn't
  support it; rider has to cancel + re-create.
- **Driver-side Scheduled Activity section.** Legacy doesn't show
  scheduled rides on the driver Activity tab; driver discovery flows
  through `subscribeAvailableRides` (already includes `'scheduled'`
  status server-side at `FirestoreRideRepository.subscribeAvailableRides`).
- **`RouteSelectScreen` screen-level test.** No prior screen-level
  test existed; VM-level tests cover scheduled selection + clear,
  and the picker has its own component-level test. Screen smoke can
  land in a future turn if a regression surfaces.
- **Detox E2E** for the scheduled-rides flow — covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.1 gate.

## Native rebuild

Required. `app.config.ts` plugins change + new native dependency
(`@react-native-community/datetimepicker@8.4.4`). The Expo plugin's
iOS handler is a no-op (no Info.plist mutation); the Android handler
adds the package's foreground service nothing — pod-only on iOS.

```bash
npm install @react-native-community/datetimepicker@8.4.4
npm run prebuild   # expo prebuild --clean + scripts/patch-podfile.js
npm run ios        # OR npm run android
```

Smoke (post-build):

1. RouteSelect → tap schedule row → picker opens.
2. iOS: pick datetime ≥ 15 min from now via spinner; tap "Schedule
   ride".
3. Android: date dialog → time dialog → tap "Schedule ride".
4. Confirm landing on `RideScheduledConfirmation` with the formatted
   datetime + pickup address.
5. Switch to Activity tab → Scheduled section shows the new ride.
6. (Two-device) Driver accepts → rider's Scheduled row flips to
   `scheduled_driver_accepted` live.

## Notes for the next turn

Turn 8 closes §3.4 Chat. The rewrite already has
`useChatUiStore` (Zustand), `ObserveLatestMessage` use case, and a
ChatMessage entity — but no chat surface and no ChatRepository
adapter. Legacy uses `react-native-gifted-chat`; carry-over
discovery: the chat thread persists at
`trips/{tripId}/messages/{messageId}` (verified at Turn 7 kickoff
scope review; not implemented here).

Turn 9 unblocks the cutover plan §3.1 jest-green gate by resolving
the 21 BG-geolocation test failures (Phase 7 `__DEV__` short-circuit
collides with the test environment's `__DEV__===true` execution
path). Either gate the short-circuit behind a test-injection seam,
or update the assertions to reflect the actual code path.

## Code-review follow-up (post-turn polish, 2026-05-19)

Seven small refinements landed on top of the turn commit after a
code-review pass. None of them changes the scheduled-rides feature
surface — they tighten the existing implementation against
edge-case correctness and remove a fragile stale-closure pattern.

1. **`confirm()` return narrowed to a discriminated union.** Was
   `Promise<{rideId, isScheduled: boolean} | null>` (Decision 5
   above); now `Promise<{rideId, isScheduled: false} | {rideId,
   isScheduled: true, formattedSchedulePickupAt: string,
   pickupAddress: string | null} | null>`. The view-model captures
   the formatted datetime + pickup address BEFORE `reset()` clears
   the trip-draft store, so `RouteSelectScreen` reads from the
   typed result instead of relying on a stale-closure trick over
   `vm.formattedSchedulePickupAt` / `vm.pickup`. Same wire-level
   behavior; `RouteSelectScreen` now navigates with
   `result.formattedSchedulePickupAt` and `result.pickupAddress`.
2. **`CreateRide.execute` flattened to a clean if/else.** The
   ternary-IIFE that satisfied `exactOptionalPropertyTypes` for the
   non-scheduled branch is replaced by `buildCreateArgs(id, input)`
   / `buildScheduledArgs(id, input, schedulePickupAt)` helpers. Pure
   code-shape refactor — no behavior change.
3. **Picker overshoot.** `ScheduleDatetimePicker` overshoots its
   accept-minimum by a new module-scope
   `SCHEDULE_PICKER_GRACE_SECONDS = 30` so a value accepted at
   picker-confirm time also survives the use case's `new Date()`
   floor a few seconds later. Without the grace, a rider who taps
   "Schedule" at exactly the 15-minute mark and idles ~10 s before
   submitting could trip `Ride.createScheduled`'s validation. The
   user-visible "at least 15 minutes from now" message stays
   accurate.
4. **`SCHEDULED_RIDE_MAX_LEAD_DAYS = 30` ceiling.**
   `Ride.createScheduled` now rejects scheduling more than 30 days
   out, symmetric with the 15-minute floor. Same
   `ride_invalid_schedule` ValidationError code as the floor so
   picker error surfacing is identical. Cloud-Tasks tolerates the
   delay but the driver-pull dispatch model doesn't, and the
   Activity tab's Scheduled section shouldn't carry years-out junk.
5. **Tightened Timestamp duck-type in `RideDoc`.** The Firestore
   Timestamp coercion now requires BOTH a `toDate()` method AND a
   numeric `seconds` field — real Timestamps always carry both, so
   this positively identifies the class without an
   `instanceof Timestamp` import (which would have pulled the
   `@react-native-firebase/firestore` SDK into the DTO module's
   load path and required a new jest mock). Updated the existing
   duck-type test to seed `seconds`/`nanoseconds`.
6. **`ActivityScreen` Scheduled section rendered in loading +
   error branches.** The scheduled-rides subscription is
   independent of the recent-rides `useInfiniteQuery`, so it can
   be ready before history loads or remain valid when history
   errors. Lifting `scheduledHeader` above the early returns gives
   the rider a faster perceived load when they have scheduled
   trips.
7. **No-ops for closure / convention.** Verified
   `<ContainerProvider/>` memoises `useCases` via
   `useMemo(() => container ?? buildContainer(), [container])`
   (production never passes `container`), so the
   `useActivityViewModel` effect's `useCases.observeScheduledRides`
   dep doesn't re-subscribe across renders. No fix needed.

Out of scope (documented but skipped):

- **Server-side `schedulePickupAt > now + 15min` enforcement in
  `firestore.rules`.** Cross-repo change to legacy
  `yeride/firestore.rules`. The 15-min floor is still client-only;
  legacy-parity-preserving.
- **Dedicated `ScheduledView` for `RideMonitor`.** Tapping a
  scheduled ride in Activity routes through
  `useActivityViewModel.onSelectRide` → `RideMonitor` →
  `AwaitingDriverView` (existing status-router mapping). The view
  reads "Finding a driver…" UX for what's actually a future-pickup
  ride. Meaningful UX scope — defer to its own turn.
- **Android picker flicker** workaround — polish only worth doing
  if reported.

Tests: 146 passing across the 11 affected suites
(`Ride.test`, `CreateRide.test`, `rideMapper.test`,
`ScheduleDatetimePicker.test`, `useRouteSelectViewModel.test`,
`useActivityViewModel.test`, `ObserveScheduledRides.test`,
`InMemoryRideRepository.test`, `formatScheduleDateTime.test`,
`ActivityScreen.test`, `RideScheduledConfirmationScreen.test`).
`npm run typecheck` and `npm run lint` green.
