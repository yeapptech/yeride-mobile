# Phase 10 Turn 7 Kickoff — Scheduled rides (rider-side creation UI + listing)

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 6
closed 2026-05-19** (Activity tab — paginated recent-rides on both
roles + role-agnostic `TripDetailScreen` + `TripPaymentsList`
fold-in; see `docs/PHASE_10_TURN_6.md`). Post-Turn-6 audit shows
**3 ❌ / 0 🟡 / 0 ⚠️** remaining (§3.2 Scheduled rides creation UI,
§3.4 Chat, §10.1 BG-geolocation test regression).

Turn 7 closes the largest remaining ❌: **§3.2 Scheduled rides —
rider-side creation UI**, plus the LISTING data path that Turn 6
explicitly deferred under its Decision 3 = (b). When this turn
lands, riders can again pick a future pickup datetime, persist a
`scheduled` ride, and see their pending scheduled rides on Activity.
Size per audit §8 row 7: **medium (2-3d)**.

## Context — why this turn now

**Legacy surface (the user-visible behavior we're restoring):**

- `yeride/src/components/ScheduleDatetimePicker.js` (224 lines) — a
  `<Modal>` wrapping `@react-native-community/datetimepicker` with a
  15-minutes-from-now minimum, iOS `spinner` / Android two-step
  date→time flow, and an `onSchedule(date)` callback. Light-dark
  theme aware via `useColorScheme()`.
- `yeride/src/rider/screens/RideSelect.js` lines 282-318 — the
  picker entry sits inside RideSelect (the rewrite's RouteSelect).
  When the rider taps "Schedule pickup for later", the picker opens;
  on schedule it sets `schedulePickupAt` in TripContext and flips
  `tripStatus` to `'scheduled'`. The Confirm button then creates a
  trip with both fields baked in; on success the rider lands on
  `RideScheduledConfirmation` instead of `RideMonitor`.
- `yeride/src/rider/screens/RideScheduledConfirmation.js` (79 lines)
  — a static success card: ✓ icon, formatted pickup datetime,
  pickup address, "We'll match you with a driver before your pickup
  time," and a "Got it" button routing back to `RiderHome`.
- `yeride/src/components/ScheduledTrips.js` (57 lines) +
  `yeride/src/api/firebase/Trip.js:subscribeToRiderScheduledRides`
  (lines 299-322) — a `useFocusEffect`-scoped `onSnapshot` that
  queries `trips where passenger.id == userId AND status IN
  ['scheduled', 'scheduled_driver_accepted']`, deliveres a
  `Ride[]`, and is rendered above the regular trip list **on
  `RiderHome`** in legacy (NOT on Activity — confirmed Turn 6 §A).
- `yeride/src/api/firebase/Trip.js:createTrip` lines 540-552 — when
  `trip.schedulePickupAt` is truthy the trip is persisted WITHOUT
  setting `users/{uid}.inProgressTrip`, so the home-screen auto-
  redirect doesn't fire on the scheduled ride. The status is
  `'scheduled'` (set client-side at line 316 of RideSelect).
- `yeride-functions/handlers/trip-created.js` lines 120-155 — the
  Cloud Function already special-cases `tripData.schedulePickupAt`
  for the driver notification copy AND tags the push payload
  `type: 'scheduled' | 'awaiting_driver'`. Server-side schedule
  reminders flow via `onScheduledNotification` + Cloud Tasks —
  unchanged by this turn; the rewrite has to make sure the
  scheduled trip writes the field with the right Timestamp shape so
  the function can `.toDate()` it.

**Rewrite gap (verified at kickoff time):**

- ✅ `RideStatus` domain literals already include `'scheduled'`
  and `'scheduled_driver_accepted'`
  (`src/domain/entities/RideStatus.ts` lines 45-46). Both classify
  as `ACTIVE_STATUSES` (lines 67-69). Not terminal.
- ✅ `useTripDraftStore.scheduledPickupAt: Date | null` already
  exists at line 47 with the stub comment "Set by
  `ScheduleDatetimePicker` for a future-dated pickup. … the field
  exists so Phase 5 can flip the flag without a store migration."
  Selector `useTripDraftScheduledAt()` ships. Setter
  `setScheduledPickupAt(at)` ships. No store migration needed.
- ✅ `RideMonitorScreen` already routes a status-router branch for
  `scheduled_driver_accepted` (lines 33, 186), so the post-driver-
  acceptance live surface is wired.
- ✅ Push handler routes `scheduled_driver_accepted` →
  `rider_ride_monitor | tripId` (HandleNotificationResponse).
- ❌ **No `ScheduleDatetimePicker` component** in
  `src/presentation/components/`.
- ❌ **No `RideScheduledConfirmationScreen.tsx`** in
  `src/presentation/features/rider/screens/`.
- ❌ **`Ride` entity has no `schedulePickupAt` field.**
  `Ride.create()` (line 114) always sets `status: 'awaiting_driver'`
  and accepts no scheduling argument. There is no
  `Ride.createScheduled(...)` factory.
- ❌ **`RideProps` / `RideDoc` DTO** don't carry
  `schedulePickupAt`. `rideMapper` doesn't read or write it.
- ❌ **`CreateRide` use case** accepts no `scheduledPickupAt`
  argument. The rewrite's `createRideMutation` always hits
  `awaiting_driver`.
- ❌ **`RideRepository` interface** has no
  `observeScheduledRidesForPassenger` (or equivalently shaped)
  method. `FirestoreRideRepository` mirrors.
- ❌ **`ObserveScheduledRides` use case** missing.
- ❌ **`app.config.ts`** doesn't list
  `@react-native-community/datetimepicker` in its `plugins:` array
  (legacy lists it at line 196 of `yeride/app.config.js`). The
  plugin is a native-config-only stub that ensures the iOS
  podspec lands; without it the picker compiles but fails at
  runtime on a fresh native build.
- ❌ **The npm package** `@react-native-community/datetimepicker`
  is not in `yeride-mobile/package.json`. Verify before kickoff —
  if absent, add at the version legacy ships (check legacy
  `yarn.lock` / `package.json` for the exact pin and pick the
  Expo SDK 55 compatible one from
  https://docs.expo.dev/versions/v55.0.0/sdk/date-time-picker).
- ❌ **`RouteSelectScreen.tsx`** has no schedule entry-point row
  (lines 174-217 are the confirm-button region only). On success
  `navigation.replace('RideMonitor', …)` is hardcoded (line 188);
  needs to branch to `RideScheduledConfirmation` when the draft
  carries `scheduledPickupAt`.
- ❌ **`RiderStackParamList`** has no `RideScheduledConfirmation`
  route. `RiderNavigator.tsx` doesn't mount the screen.
- ❌ **Rider Activity tab (`ActivityScreen.tsx`)** has no
  Scheduled section. Turn 6 §C notes the ~50-line addition is
  scoped here.

## Required reading (in order)

1. **Audit `docs/PHASE_10_PARITY_AUDIT.md` §3.2, §3.3 (closed),
   §4 line 571 (datetimepicker plugin call-out), §8 row 7.** §3.2
   is canonical scope. §3.3 is closed but its "Decision 3 = (b)
   defer" note in Turn 6 hands you the listing-side work that
   lands here.
2. **`docs/PHASE_10_TURN_6.md` §B Decision 3 + §"Notes for the
   next turn"** — explicit hand-off: Turn 7 wires
   `ObserveScheduledRides` + the rider-side Scheduled section on
   Activity + the creation UI. ~50-line Activity addition once the
   data path exists.
3. **`docs/PHASE_10_CUTOVER_PLAN.md` §0** — confirms parity audit
   is the gate; flip §3.2 ❌ → ✅ at the end of this turn so only
   §3.4 Chat and §10.1 BG-geolocation tests block §6 rollout.
4. **Legacy `yeride/src/components/ScheduleDatetimePicker.js`** in
   full (224 lines). Note the Android two-step UX (date picker →
   time picker), the 15-minute minimum, the iOS `spinner` display,
   the `isAfter(newDate, getMinimumDate())` validation, and the
   `formatDateTime` import from `utils/DatetimeUtil`. Port to a
   typed `ScheduleDatetimePicker.tsx` that returns a `Date | null`
   via a typed `onSchedule(date: Date) => void` callback (no
   `onClose`-only callback; keep the legacy semantics).
5. **Legacy `yeride/src/rider/screens/RideScheduledConfirmation.js`**
   (79 lines). Stateless. Reads
   `route.params.formattedSchedulePickupAt` + `pickupAddress`.
   "Got it" navigates back to `RiderHome`. Visual feel: ✓ icon in
   `bg-success/10`, card with schedule + place rows, reassurance
   line, primary button. Port 1:1 to NativeWind.
6. **Legacy `yeride/src/rider/screens/RideSelect.js` lines
   46-60, 282-318, 324-354, 440-460.** The picker-entry
   composition (a tappable row above the Confirm button), the
   schedule-branch in confirm (`if (schedulePickupAt) { navigate
   RideScheduledConfirmation } else { navigate RideMonitor }`),
   and the `handleScheduleRide` setter that flips local
   `tripStatus` to `'scheduled'` BEFORE the create call.
7. **Legacy `yeride/src/components/ScheduledTrips.js`** (57 lines)
   + `yeride/src/api/firebase/Trip.js:subscribeToRiderScheduledRides`
   (lines 299-322). Confirm: live `onSnapshot`,
   `where('passenger.id', '==', userId)` +
   `where('status', 'in', ['scheduled', 'scheduled_driver_accepted'])`,
   no orderBy (legacy doesn't sort the scheduled list —
   match that or sort client-side; the existing Activity recent-
   list orders server-side on `createdDateTime desc` and rider
   intuition is "next pickup soonest" so a CLIENT-side sort on
   `schedulePickupAt asc` is a reasonable polish — call this out
   in Decision 4 below if you go that way).
8. **Legacy `yeride/src/api/firebase/Trip.js:createTrip` lines
   481-559.** Note line 545: `if (trip.schedulePickupAt) { … }
   else { update inProgressTrip }`. Scheduled rides are NOT
   written to `users/{uid}.inProgressTrip`, so the
   `useInProgressRideQuery` auto-redirect doesn't fire on a
   pending scheduled ride. The rewrite must preserve this — the
   data layer's `FirestoreRideRepository.create()` must NOT write
   `inProgressTrip` for scheduled rides. Confirm what current
   `create()` does about `inProgressTrip` (legacy yeride manages
   it; the rewrite probably doesn't write it at all — verify
   before deciding whether you have new code to suppress).
9. **`yeride-functions/handlers/trip-created.js` lines 120-155.**
   Server-side already reads `tripData.schedulePickupAt.toDate()`
   — confirming the on-disk shape MUST be a Firestore Timestamp,
   not an ISO string. The `rideMapper` write path needs
   `Timestamp.fromDate(scheduledFor)` accordingly.
10. **Rewrite `src/domain/entities/Ride.ts` lines 1-150**, with
    extra attention to `Ride.create()` (line 114) and `RideProps`
    (line ~90). Decision 1 below locks whether you add a
    `schedulePickupAt: Date | null` prop on `Ride` or expose
    scheduling only as a creation-time argument.
11. **Rewrite `src/data/dto/RideDoc.ts`** (look at the
    `RideDocSchema`). Find the `status` literal set + the
    permissive-parse zone. Add the optional `schedulePickupAt:
    Timestamp | string | null` accepter (legacy might have written
    ISO strings during a prior migration — match the conservative
    permissive-read pattern).
12. **Rewrite `src/data/mappers/rideMapper.ts`** — read + write
    halves. The write half needs to translate
    `ride.schedulePickupAt` (Date | null) to a Firestore Timestamp
    when present, and OMIT the field when null (avoid setting
    Firestore fields to `undefined` per CLAUDE.md).
13. **Rewrite `src/data/repositories/FirestoreRideRepository.ts`**
    — `create()` (look around line 150-180), `listByPassenger`
    (lines 238+, just paginated in Turn 6), and
    `subscribeAvailableRides` (line 374, current pattern for an
    `onSnapshot`-based subscription method — Decision 2 below
    locks whether scheduled-rides observation uses this shape or
    a one-shot list+cursor).
14. **Rewrite
    `src/presentation/features/rider/view-models/useRouteSelectViewModel.ts`**
    lines 255-400. The `confirm()` flow currently always lands at
    `RideMonitor`. Two changes land here: branch on
    `scheduledPickupAt` to navigate to
    `RideScheduledConfirmation`, and pass `scheduledPickupAt`
    through to `createRideMutation` (which needs a corresponding
    `CreateRideInput` extension).
15. **Rewrite `src/presentation/features/rider/screens/RouteSelectScreen.tsx`**
    in full. The picker-entry row sits between the
    `RideServicesList` (lines 165-171) and the `submitError`
    region (line 174). Mirrors legacy `renderSchedulePickupAt`
    visually (lines 324-354 of `RideSelect.js`).
16. **Rewrite
    `src/presentation/features/rider/view-models/useActivityViewModel.ts`
    + `ActivityScreen.tsx`** (shipped Turn 6). The Scheduled
    section grafts above the Recent Rides section as a separate
    block; reuse `TripCard`. Driver-side `useDriverActivityViewModel`
    is unchanged (legacy didn't show scheduled on driver side,
    confirmed §3.2).
17. **Rewrite `src/presentation/navigation/RiderNavigator.tsx` +
    `types.ts`** lines 60-80. The new `RideScheduledConfirmation`
    route follows the same shape as `RideReceipt` + `TripDetail`
    (single string param: `tripId` or richer
    `{formattedAt, pickupAddress}`; Decision 3 below picks).
18. **`docs/PHASE_10_TURN_6_KICKOFF.md`** — pattern reference for
    this kickoff doc; same pre-checklist / decisions / sign-off
    flow. Test policy unchanged (100% on use cases, >80% on
    repositories, screen-level VM tests against fakes).
19. **`docs/PATTERNS.md`** — `feature-area` patterns for
    `useDriverHomeViewModel` etc. The rider-side draft-store
    pattern (Phase 3 turn 3) is the relevant precedent for how
    `scheduledPickupAt` flows from picker → store → view-model →
    use case.

## Starting state — what's already true

- **HEAD** on `main`: `5104aa95b7d903dc0bd76cda45b88caef993ab21`
  (Turn 6 closure). Working tree clean modulo any sandbox `.lock`
  files (delete via `find .git -name '*.lock' -delete` if `git`
  complains).
- The 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain Turn 9 scope — DO NOT try to fix them here.
- `RideStatus` already declares `'scheduled'` and
  `'scheduled_driver_accepted'` as valid literals; both are in
  `ACTIVE_STATUSES`. No domain literal additions needed.
- `useTripDraftStore` already exposes `scheduledPickupAt: Date |
null` + `setScheduledPickupAt(at)` +
  `useTripDraftScheduledAt()`. `reset()` clears it. Wire the
  picker to call `setScheduledPickupAt` on schedule; no store
  migration.
- `RideMonitorScreen`'s `scheduled_driver_accepted` branch ships
  (Phase 4); a rider who taps a `scheduled_driver_accepted` row in
  Activity should still reach `RideMonitor`, which Turn 6's
  status-aware navigation switch already handles.
- Push notification deep-link handler routes
  `scheduled_driver_accepted` → `rider_ride_monitor` (already
  shipped — confirms a driver who accepts a scheduled trip
  brings the rider into the live surface from the push tap).
- Cloud Functions in production already read
  `tripData.schedulePickupAt.toDate()` — the wire format MUST be
  Firestore `Timestamp` (not ISO string). `onScheduledNotification`
  + Cloud Tasks ship and need NO server-side change.
- `useInProgressRideQuery` queries `passenger.id == userId AND
status IN ['awaiting_driver', 'scheduled_driver_accepted',
'dispatched', 'started', 'payment_requested',
'payment_failed']` (verify in
  `src/presentation/queries/ride.queries.ts`). Decision: a `'scheduled'`
  ride (pending dispatch) should NOT auto-redirect the rider into
  RideMonitor — the rider hasn't yet been matched. Confirm the
  status set excludes `'scheduled'`; if it doesn't, that's a
  bug-fix in scope here.
- `@react-native-community/datetimepicker` may or may not be in
  `package.json` today — verify via `grep -n
'react-native-community/datetimepicker' package.json`. If
  absent, `npm install @react-native-community/datetimepicker@8.x`
  (Expo SDK 55 compatible — confirm at
  https://docs.expo.dev/versions/v55.0.0/sdk/date-time-picker).
- Tab navigators: `RiderTabsNavigator.tsx` mounts
  `ActivityScreen` (Turn 6). Adding a Scheduled section is a
  view-model + screen edit, not a navigator change.

## Scope — what to ship

Land in one commit so partial state doesn't reach `main`. Six
layers, ordered domain → data → app → presentation → native config:

### A. Domain — Ride scheduling

- **Extend `Ride` entity** with `schedulePickupAt: Date | null`.
  Decision 1 picks whether this is a top-level `RideProps` field or
  a new aggregate VO (e.g. `RideSchedule`). Default: top-level
  optional `Date | null`, mirroring the `cancellation: RideCancellation
| null` precedent (read-only public getter, never mutated after
  creation).
- **Add `Ride.createScheduled({...})` static factory** OR extend
  `Ride.create()` with `scheduledPickupAt?: Date | null` argument.
  Decision 1 locks. If factory variant: it sets `status: 'scheduled'`
  and `schedulePickupAt: args.scheduledPickupAt`; the existing
  `Ride.create()` continues to set `status: 'awaiting_driver'` and
  `schedulePickupAt: null`.
- **Domain validation:** `schedulePickupAt > createdAt + 15min`
  (15-minute floor mirrors legacy SDP `minimumMinutes = 15`). Reject
  with `ValidationError({code: 'ride_invalid_schedule', message:
'schedulePickupAt must be at least 15 minutes after createdAt'})`.
- **Test additions:** valid scheduled-ride construction; rejection
  when `schedulePickupAt < createdAt + 15min`; rejection when
  `schedulePickupAt < createdAt`; happy-path getter; `status ===
'scheduled'` post-create.

### B. Data — DTO, mapper, repository

- **`src/data/dto/RideDoc.ts`**: add optional `schedulePickupAt`
  accepter via `z.preprocess`. Accept:
  - Firestore `Timestamp` (the canonical legacy on-disk shape) →
    coerce to ISO string for the domain mapper layer.
  - ISO string (defensive — accommodates any prior migration data).
  - `undefined` / missing field → treat as `null`.
  - `null` → pass through.
  Output: `string | null` (ISO). Match the existing pattern for
  other optional date fields in `RideDoc`.
- **`src/data/mappers/rideMapper.ts` (read path):** parse
  `dto.schedulePickupAt` ISO → `Date | null` and feed it to
  `Ride.fromProps`.
- **`src/data/mappers/rideMapper.ts` (write path):** when
  `ride.schedulePickupAt !== null`, write a Firestore `Timestamp`
  via `Timestamp.fromDate(ride.schedulePickupAt)`. When `null`,
  OMIT the field (don't set to `undefined` or `null` — CLAUDE.md
  forbids `undefined` writes; an omitted field reads as `null`
  cleanly via the DTO accepter).
- **`RideRepository` interface**: add
  ```ts
  observeScheduledRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;
  ```
  Subscription-shaped, synchronous unsubscribe — matches the
  existing `subscribeEvents` / `subscribePayments` /
  `subscribeAvailableRides` pattern. Decision 2 locks vs. a
  one-shot `listScheduledRidesByPassenger` returning
  `Result<readonly Ride[], NetworkError>` — kickoff default is
  subscription-shape (legacy used `onSnapshot`; scheduled rides
  CAN mutate while the rider watches them as drivers accept).
- **`FirestoreRideRepository`**:
  - `observeScheduledRidesByPassenger`: `onSnapshot` over
    `query(collection(firestore, TRIPS), where('passenger.id',
'==', passengerId), where('status', 'in', ['scheduled',
'scheduled_driver_accepted']))`. Reuse `toDomainOrCorrupt`
    error skip pattern. Server-side ordering: `orderBy('schedulePickupAt',
'asc')` for "next-soonest" UX. (Note: this requires a
    composite Firestore index — `passenger.id ASC, status ASC,
schedulePickupAt ASC`. Decision 4 picks whether to deploy the
    index in this turn or rely on client-side sort. Default:
    client-side sort, smaller cutover surface.)
  - `create()`: extend the write path so the new
    `schedulePickupAt` field lands on the Firestore doc when set.
    Verify: legacy semantics keep `users/{uid}.inProgressTrip`
    UNSET for scheduled rides — read the current rewrite path
    carefully. If the rewrite never writes `inProgressTrip` (which
    is likely — that's a legacy yeride mechanism for the home
    auto-redirect that the rewrite replaced with
    `useInProgressRideQuery`), no change needed.
- **In-memory `InMemoryRideRepository`** (`@shared/testing/`):
  mirror `observeScheduledRidesByPassenger`. Emit on every mutation
  affecting passenger-id-matched + scheduled-status rides. Mirror
  the same status-set filter.

### C. App — use cases

- **Extend `CreateRide` use case**:
  ```ts
  export interface CreateRideInput {
    // ... existing fields
    readonly scheduledPickupAt?: Date | null;
  }
  ```
  When `scheduledPickupAt != null`, call `Ride.createScheduled({...})`
  (or pass the arg through to extended `Ride.create()` per Decision
  1). When null/omitted, preserve existing behavior — `Ride.create()`
  emits an `awaiting_driver` ride. The single-line conditional
  goes inside `CreateRide.execute`.
- **New use case `ObserveScheduledRides`** in
  `src/app/usecases/ride/ObserveScheduledRides.ts`. Subscription-
  shaped:
  ```ts
  export class ObserveScheduledRides {
    constructor(private readonly repo: RideRepository) {}
    execute(args: {
      passengerId: UserId;
      callback: (rides: readonly Ride[]) => void;
    }): () => void {
      return this.repo.observeScheduledRidesByPassenger(args);
    }
  }
  ```
  No `Result` — subscription cleanups don't fail. Wire through the
  DI container as `useCases.observeScheduledRides`.
- **Tests:** `CreateRide` — scheduled-arg routes to the scheduled
  factory; missing arg routes to existing; invalid scheduled-arg
  surfaces ValidationError. `ObserveScheduledRides` — delivers
  passenger-scoped scheduled rides; filters out non-scheduled;
  unsubscribe stops delivery.

### D. Presentation — picker + screens + view-models

- **`src/presentation/components/trip/ScheduleDatetimePicker.tsx`**
  (new). Typed port of legacy `ScheduleDatetimePicker.js`. Props
  shape:
  ```ts
  interface ScheduleDatetimePickerProps {
    visible: boolean;
    onClose: () => void;
    onSchedule: (date: Date) => void;
    initialDate?: Date;
    title?: string;
    buttonText?: string;
    minimumMinutes?: number; // default 15
  }
  ```
  Keep the iOS spinner / Android two-step pattern, the
  `minimumMinutes` floor, the `isAfter` validation, and the `Modal`
  with `statusBarTranslucent` + `navigationBarTranslucent` props
  (Android 15 edge-to-edge — CLAUDE.md rule). Use NativeWind
  semantic tokens (`bg-card dark:bg-card-dark`, `text-primary`,
  `border-border`) instead of the legacy raw color classes. Reuse
  the existing logger pattern (`LOG.extend('SCHEDULE_PICKER')`).
- **`src/shared/datetime/formatDateTime.ts`** (or wherever the
  existing rewrite already places date formatters — `grep` for
  `format(.*date|formatDateTime|date-fns` to find). The legacy
  `utils/DatetimeUtil.formatDateTime` is the source helper; if the
  rewrite has an equivalent, reuse it; otherwise port the formatter
  and add tests. `date-fns` is already in the rewrite (Turn 6 used
  it for `formatDistanceToNow`).
- **`src/presentation/features/rider/screens/RideScheduledConfirmationScreen.tsx`**
  (new). Stateless. Reads route params
  `{ formattedSchedulePickupAt: string; pickupAddress: string |
null }`. Same visual structure as legacy
  `RideScheduledConfirmation.js`. "Got it" tap calls
  `navigation.popToTop()` or `navigation.navigate('RiderTabs',
{ screen: 'RiderHome' })` — match the legacy effect (clear the
  RouteSelect stack so the rider lands fresh on Home). Add
  `testID="ride-scheduled-confirmation"` plus testIDs on the
  schedule and address rows.
- **Extend `useRouteSelectViewModel`**:
  - Surface `scheduledPickupAt: Date | null` (read from
    `useTripDraftStore`) + `setScheduledPickupAt: (d: Date | null)
=> void` + `formattedSchedulePickupAt: string | null`
    (formatted via the helper from above).
  - Pass `scheduledPickupAt` into `createRideMutation.mutateAsync`
    (`createRideMutation` itself needs the prop forwarded — extend
    `useCreateRideMutation` parameter type).
  - The `confirm()` return type stays `Promise<RideId | null>` but
    the SCREEN's `onPress` needs to know whether the trip was
    scheduled or live so it can navigate appropriately. Two options:
    (a) return a richer `{rideId, isScheduled}` shape, (b) the VM
    exposes the post-confirm navigation target via a new
    `confirmedNavigation: 'monitor' | 'scheduled' | null` flag.
    Decision 5 locks; default = (a) for the smaller diff.
- **Extend `RouteSelectScreen.tsx`**:
  - Add a tappable "Schedule pickup for later" / formatted-time row
    between `RideServicesList` (line 171) and the
    `submitError` region (line 174). Tap opens
    `<ScheduleDatetimePicker visible={…} onSchedule={…}
onClose={…} initialDate={scheduledPickupAt ?? new Date()} />`.
  - When `scheduledPickupAt` is set, show the formatted datetime
    inline with a clear button (`X` icon → call
    `setScheduledPickupAt(null)`).
  - Confirm button copy changes when scheduled:
    `"Schedule ride"` vs. `"Confirm ride"`.
  - Post-confirm branch: navigate to `RideScheduledConfirmation`
    when the returned shape indicates scheduled, else
    `RideMonitor` (existing path).
- **Extend `useActivityViewModel`** (rider-side only — driver-side
  unchanged):
  - Open a subscription to `useCases.observeScheduledRides` keyed
    on `userId`. Use a `useEffect` + unsubscribe-on-cleanup
    pattern; the result lives in a `useState`
    `scheduledRides: readonly Ride[]`. Sort client-side by
    `schedulePickupAt asc` (cheap; in-memory at the VM, see §B
    Decision 4 rationale).
  - Surface a new `scheduledRides: readonly Ride[]` field on the
    VM output. `onSelectRide` already handles the
    `scheduled_driver_accepted` case (active status → `RideMonitor`);
    add a branch for `scheduled` pending-dispatch: route to
    `RideMonitor` as well (the existing `RideMonitorScreen`
    `scheduled_driver_accepted` branch renders fine for plain
    `scheduled` too — verify, or render an "awaiting driver"
    sub-state).
- **Extend `ActivityScreen.tsx`**: render a `<TripList rides=
{scheduledRides} …/>` section ABOVE the existing Recent Rides
  block, with a section header "Scheduled". Only render the block
  when `scheduledRides.length > 0` (legacy ScheduledTrips returned
  null on empty). Keep `<DevToolsSection/>` reachable.
- **`RiderNavigator.tsx`**: add the
  `RideScheduledConfirmation` stack screen between `RideReceipt`
  and `TripDetail`. Header hidden (it's a full-bleed confirmation).
- **`navigation/types.ts`**:
  ```ts
  // extend RiderStackParamList
  RideScheduledConfirmation: {
    formattedSchedulePickupAt: string;
    pickupAddress: string | null;
  };
  ```
  Decision 3 locks the param shape — alternative is `{tripId:
string}` and the screen reads the trip doc, which is cleaner for
  deep-link survivability but adds a load state. Default = the
  legacy shape (params carry the formatted strings) for the
  smaller diff.

### E. Native config — datetimepicker plugin

- **`app.config.ts`**: append `'@react-native-community/datetimepicker'`
  to the `plugins:` array (around line 210). Verify the package is
  in `package.json` first; install at the Expo-SDK-55-compatible
  version if not.
- **Confirm the plugin's no-op-on-iOS / pod-injection behavior** at
  `node_modules/@react-native-community/datetimepicker/app.plugin.js`
  before running prebuild, to make sure it doesn't conflict with
  `withFirebasePodfileFix` or `withGradleHeap` (precedent: Phase
  10 Turn 2 ran into a Firebase plugin ordering issue — read
  `docs/PHASE_10_TURN_2.md` if the picker plugin needs reordering
  with the Firebase plugins).
- **Native rebuild required.** Add the rebuild instruction to the
  turn doc:
  ```bash
  npm install @react-native-community/datetimepicker@<version>
  npm run prebuild
  npm run ios     # or android
  ```

### F. Tests

| Layer       | File                                                                                            | What it covers                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain      | `src/domain/entities/__tests__/Ride.test.ts`                                                    | Extend: `Ride.createScheduled` happy path; 15-minute-floor rejection; `schedulePickupAt < createdAt` rejection; getter returns Date \| null                  |
| Data        | `src/data/dto/__tests__/RideDoc.test.ts`                                                        | Extend: schedulePickupAt accepts Timestamp / ISO string / missing / null; round-trip with mapper preserves the field                                         |
| Data        | `src/data/mappers/__tests__/rideMapper.test.ts`                                                 | Extend: write path emits Timestamp; null omits the field; read path parses Timestamp/ISO; legacy on-disk shape with `schedulePickupAt` Timestamp round-trips |
| Data        | `src/data/repositories/__tests__/FirestoreRideRepository.test.ts`                               | Extend: scheduled-rides subscription delivers passenger-scoped + status-filtered; unsubscribe stops; multi-passenger isolation                               |
| App         | `src/app/usecases/ride/__tests__/CreateRide.test.ts`                                            | Extend: scheduled-arg routes through `createScheduled` (status === 'scheduled', schedulePickupAt populated); missing arg routes existing path                |
| App         | `src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`                                 | New: subscription delivers scheduled rides; unsubscribe; ignores non-scheduled                                                                              |
| Component   | `src/presentation/components/trip/__tests__/ScheduleDatetimePicker.test.tsx`                    | New: visible/invisible, onSchedule fires with valid date, validation rejects < min, iOS path uses datetime mode, Android path two-step                       |
| Screen      | `src/presentation/features/rider/screens/__tests__/RideScheduledConfirmationScreen.test.tsx`    | New: renders formatted datetime + address; "Got it" navigates to RiderHome                                                                                  |
| VM          | `src/presentation/features/rider/view-models/__tests__/useRouteSelectViewModel.test.tsx`        | Extend: scheduledPickupAt selectable + clearable; confirm() with schedule routes to scheduled return shape (per Decision 5); without schedule routes existing |
| VM          | `src/presentation/features/rider/view-models/__tests__/useActivityViewModel.test.tsx`           | Extend: scheduledRides surfaces via subscription; refreshes on subscription emit; cleanup on unmount                                                          |
| Screen      | `src/presentation/features/rider/screens/__tests__/RouteSelectScreen.test.tsx`                  | Extend: schedule row tap opens picker; selecting a date updates the row copy; clear button resets; confirm with scheduled date navigates to RideScheduledConfirmation |
| Screen      | `src/presentation/features/rider/screens/__tests__/ActivityScreen.test.tsx`                     | Extend: Scheduled section renders above Recent when present; hides when empty; row tap navigates to RideMonitor                                              |

**Target pass count: ~50-80 new tests, zero regressions outside
the 21 pre-existing BG-geolocation failures.** Smaller than Turn 6
because no new top-level surfaces (TripDetail, pagination) — most
of the work is rewiring existing surfaces (RouteSelect, Activity).

## Decisions to lock at kickoff time

### Decision 1 — `Ride` scheduling: extend `Ride.create()` OR add `Ride.createScheduled()` factory?

- **(a) Extend `Ride.create()`** with an optional
  `scheduledPickupAt?: Date | null` argument. When set, it picks
  `status: 'scheduled'`; when null/absent, `'awaiting_driver'`.
  One factory, one path. Smaller surface.
- **(b) Add `Ride.createScheduled({...})` static factory** that
  internally sets `status: 'scheduled'` and `schedulePickupAt:
args.scheduledPickupAt`. Two factories — one per status. Clearer
  call sites (`Ride.createScheduled` is grep-friendly).

Kickoff recommends **(b)** — explicit factory matches the
"transitions return new entities" pattern (line 196 dispatch, line
223 start, etc.) and keeps `Ride.create()` semantics unchanged.
Call sites use whichever factory they need without
optional-argument branching inside `CreateRide.execute`.

### Decision 2 — Listing: subscription (`observeScheduled…`) vs. one-shot (`listScheduled…`)?

- **(a) Subscription `observeScheduledRidesByPassenger`** — live
  `onSnapshot`. Driver acceptance updates the rider's Activity
  in real-time.
- **(b) One-shot `listScheduledRidesByPassenger`** — TanStack
  `useQuery` with `refetchOnFocus`. Driver acceptance shows up on
  next tab focus.

Kickoff recommends **(a)** — legacy used `onSnapshot` (verified
§3.2). Scheduled rides DO mutate while the rider watches them
(`scheduled` → `scheduled_driver_accepted` on driver accept,
then `scheduled_driver_accepted` → `dispatched` at the pickup
window), so live updates are user-visible. The Activity Recent
section's choice of `useInfiniteQuery` (Turn 6 Decision 6) is
specifically because history doesn't mutate after closure —
scheduled is the opposite case.

### Decision 3 — `RideScheduledConfirmation` route params: legacy-shape strings OR tripId?

- **(a) Legacy shape:** params = `{formattedSchedulePickupAt:
string; pickupAddress: string | null}`. Screen is stateless.
  Matches legacy 1:1.
- **(b) Trip-id only:** params = `{tripId: string}`. Screen loads
  the ride via `GetRideById` and formats the datetime + reads the
  address from `ride.pickup.address`. Loadable across cold-launches
  / deep-links; survives navigation state restoration.

Kickoff recommends **(a)** — confirmation is a transient one-way
screen the rider sees once immediately after creation. The trip is
already persisted by the time the screen mounts; reloading it
would just re-fetch fields the VM just wrote. Smaller diff.
Override only if you can articulate a deep-link / state-restoration
scenario that requires (b).

### Decision 4 — Firestore composite index for `(passenger.id, status, schedulePickupAt)` OR client-side sort?

- **(a) Deploy composite index** so the `observeScheduled…` query
  can `orderBy('schedulePickupAt', 'asc')` server-side. Cleaner
  ordering, requires a `firestore.indexes.json` deploy at the
  cutover SHA.
- **(b) Client-side sort** in the VM (or repository post-snapshot).
  Cheap at YeRide's scheduled-ride volume (< 20 per rider
  realistically); zero index deploy work.

Kickoff recommends **(b)** — keeps the cutover-plan §3.4 "Firestore
indexes deployed and unchanged from legacy app's HEAD" gate green.
A scheduled-rides-per-rider count high enough for client-side sort
to bite is implausible at this scale.

### Decision 5 — `useRouteSelectViewModel.confirm()` return shape: tagged tuple vs. flag

- **(a) Return `Promise<{rideId: RideId; isScheduled: boolean} |
null>`.** Screen branches on `isScheduled` for navigation
  target. Single return path.
- **(b) Expose a new VM field `confirmedNavigation: 'monitor' |
'scheduled' | null`** alongside `confirm()`. Screen reads the
  flag inside an effect or post-confirm callback.

Kickoff recommends **(a)** — smaller VM API surface, the navigation
branch is a single switch at the screen. (b) introduces a
multi-step VM state machine that's overkill for this turn.

### Decision 6 — `useInProgressRideQuery` status set: does `'scheduled'` belong?

The home-screen auto-redirect query
(`src/presentation/queries/ride.queries.ts`) MUST not redirect a
rider with a pending `scheduled` ride into `RideMonitor` (the
ride has no driver yet). Confirm at pre-checklist:

- The active-redirect status set excludes `'scheduled'` (rider
  stays on RiderHome until a driver accepts → status becomes
  `scheduled_driver_accepted`, at which point the redirect fires).
- If the set INCLUDES `'scheduled'`, that's a pre-existing bug
  we're inheriting; fix in scope here (single-line edit).
- Document the verified set in the turn doc evidence chain.

### Decision 7 — Where to put the schedule-picker entry: RouteSelect (legacy) vs. RiderHome?

Legacy showed the picker on `RideSelect` (the rewrite's
`RouteSelect`). The rewrite is consistent with that by default.

- **(a) RouteSelect** (parity) — picker row above Confirm. Rider
  picks pickup → dropoff → route → tier → optionally schedule →
  confirm.
- **(b) RiderHome** — picker tappable from the home screen
  before the rider enters RouteSearch. New surface; deviation.

Kickoff recommends **(a)** for parity. Override only if you
discover a UX reason during pre-checklist; flag a follow-up turn
if (b) feels right but doesn't fit this turn's budget.

## Pre-checklist

Resolve in your first message back if not already settled.

1. **Confirm HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile && git rev-parse HEAD && git status --short
   ```
   Expected: HEAD = `5104aa9` or newer; working tree clean modulo
   `.git/*.lock` from prior sandbox sessions
   (`find .git -name '*.lock' -delete` if needed).

2. **Confirm the rewrite gap is as described.**
   ```bash
   grep -rn 'ScheduleDatetimePicker\|RideScheduledConfirmation\|observeScheduled\|ObserveScheduledRides' src/
   ```
   Expected: zero matches outside the `useTripDraftStore` comment
   and the kickoff-cited statuses.

3. **Confirm the npm package state.**
   ```bash
   grep -n '@react-native-community/datetimepicker' package.json
   ```
   If missing, look up the Expo SDK 55-compatible version at
   https://docs.expo.dev/versions/v55.0.0/sdk/date-time-picker and
   add it. If present, note the pin in the turn doc.

4. **Confirm `useInProgressRideQuery` status set excludes
   `'scheduled'`.**
   ```bash
   grep -n 'scheduled' src/presentation/queries/ride.queries.ts
   ```
   Cross-check against the IN-PROGRESS-STATUSES literal (line ~48
   per the kickoff investigation). If `'scheduled'` IS in the
   active-redirect set, that's Decision 6 = "fix in scope here."

5. **Confirm Cloud Function on-disk shape.**
   ```bash
   grep -n 'schedulePickupAt' /Users/papagallo/yeapptech/dev/yeride-functions/functions/handlers/trip-created.js
   ```
   Confirms `tripData.schedulePickupAt.toDate()` — so write path
   MUST be a Firestore `Timestamp`. Capture the line numbers in
   the turn doc as evidence.

6. **Confirm legacy ScheduleDatetimePicker / Confirmation /
   ScheduledTrips line counts and shapes** match the kickoff
   description (224 / 79 / 57).
   ```bash
   wc -l /Users/papagallo/yeapptech/dev/yeride/src/components/ScheduleDatetimePicker.js \
         /Users/papagallo/yeapptech/dev/yeride/src/rider/screens/RideScheduledConfirmation.js \
         /Users/papagallo/yeapptech/dev/yeride/src/components/ScheduledTrips.js
   ```

7. **Decide Decisions 1-7 + capture evidence chain.**

8. **Datetime formatter discovery.**
   ```bash
   grep -rn 'formatDateTime\|date-fns\|date-fns-tz' src/shared/ src/presentation/
   ```
   If a rewrite formatter already exists for "Today 3:45 PM" /
   "May 22, 2026 3:45 PM" shape, reuse. Otherwise add a small
   helper under `src/shared/datetime/` and tests.

9. **`firestore.rules` audit (parity check).** Read
   `/Users/papagallo/yeapptech/dev/yeride/firestore.rules` for any
   `'scheduled'` / `schedulePickupAt`-specific rules. If legacy has
   a rule like "rider can only set `schedulePickupAt` on their own
   trip," the rewrite must honor it. (Likely the existing
   passenger.id-based rule already covers it — confirm.)

10. **Optional — manual smoke check.** With stage Firebase wired
    up: pre-Turn screenshot of RouteSelectScreen (no schedule row),
    post-Turn screenshot of RouteSelectScreen with the schedule
    row and an active selection, plus the
    `RideScheduledConfirmation` screen, plus the Activity tab's
    Scheduled section with at least one entry. Skip if no
    simulator handy.

## Suggested approach

1. **Pre-checklist first.** Resolve items 1-10 before touching
   code. Decisions 1-7 documented in the turn doc with evidence.

2. **Land changes bottom-up (domain → data → app → presentation →
   native).**
   - Domain: `Ride.createScheduled` factory + `schedulePickupAt`
     prop + validation + tests.
   - Data: `RideDoc` DTO accepter + `rideMapper` read/write paths
     + tests. Then `RideRepository.observeScheduledRidesByPassenger`
     interface + `FirestoreRideRepository` impl + in-memory fake
     mirror + repository tests.
   - App: `CreateRide` input extension + `ObserveScheduledRides`
     use case + tests. Wire both through the DI container.
   - Presentation: `ScheduleDatetimePicker` component + tests.
     `RideScheduledConfirmationScreen` + tests. Extend
     `useRouteSelectViewModel` (scheduledPickupAt selector,
     clearer, formatter, confirm return shape) + tests. Extend
     `RouteSelectScreen` (schedule row, picker invocation,
     post-confirm navigation branch) + tests. Extend
     `useActivityViewModel` (rider-side subscription) +
     `ActivityScreen` (Scheduled section above Recent) + tests.
   - Navigation: `navigation/types.ts` `RideScheduledConfirmation`
     param-list entry + `RiderNavigator.tsx` mount.
   - Native: `app.config.ts` plugin append +
     `package.json` install. `npm run prebuild`.

3. **Verify gates.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck     # green
   npm run lint          # green
   npm run format:check  # green (modulo pre-existing CLAUDE.md
                         #  prettier warning)
   npm test              # only the 21 BG-geolocation failures
                         #  (Turn 9)
   ```
   Use `--shard=N/M` if jest times out in the sandbox.

4. **Audit + turn doc updates.**
   - §1 headline count: flip `3 ❌ / 0 🟡` → `2 ❌ / 0 🟡`.
   - §3.2 row: flip ❌ → ✅ with Turn 7 closure note + chosen
     decisions 1-7.
   - §4 row 571 (datetimepicker plugin): annotate "✅ added in
     Turn 7 (YYYY-MM-DD)".
   - §8 turn-plan row 7: strike-through with close date + doc
     reference.
   - Header sublabel: append "Turn 7 closed YYYY-MM-DD" (still
     v2 — Turn 10 produces v3).
   - Write `docs/PHASE_10_TURN_7.md` following Turn 6's format.
     Smaller patch — expect 12-18 changed files (4 domain/data,
     2 app, 5 presentation, 2 navigation, 1 native config, ~10
     tests).

5. **Commit.** Use the sandbox commit pattern
   (`~/Library/.../memory/sandbox_git_commit_pattern.md`) — virtiofs
   blocks `git commit`'s `unlink()` on lockfiles after the first
   write, so use:
   ```bash
   cp .git/index /tmp/shadow
   GIT_INDEX_FILE=/tmp/shadow git add -A
   GIT_INDEX_FILE=/tmp/shadow git write-tree
   git commit-tree <tree> -p HEAD -m "<msg>"
   git update-ref refs/heads/main <commit>
   ```

## Out of scope (defer to later turns)

- **Chat** — Turn 8 (audit §3.4).
- **BG-geolocation test regression** — Turn 9 (audit §10.1).
- **Audit v3 + cutover sign-off** — Turn 10.
- **Scheduled-rides driver-side surface.** Legacy doesn't show
  scheduled rides on the driver Activity tab; matching parity
  here. Driver acceptance flow remains via the existing
  `subscribeAvailableRides` (`'scheduled'` IS in that query's
  status set already at `FirestoreRideRepository:385`).
- **`RideScheduledConfirmation` deep-link survival** — Decision 3
  picks legacy-shape params; survives the next foreground but not
  cold-launch. Acceptable for a transient confirmation.
- **Composite Firestore index for scheduled-rides ordering** —
  Decision 4 picks client-side sort. Defer index deploy to a
  future polish turn if scheduled-ride volume per rider grows.
- **Re-scheduling an existing scheduled ride.** Legacy doesn't
  support this; rider has to cancel + create. Match parity.
- **Picker theme polish** — legacy uses raw color classes; the
  rewrite uses semantic tokens. The port substitutes tokens but
  doesn't pixel-match. Acceptable diff (call out in §3.2 closure
  as 🟡-like deviation if you discover anything substantive at
  smoke time).
- **Detox E2E** for the scheduled-rides flow — covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.1 gate, not by this turn.

## Deliverable

A single PR / commit on `main` containing:

1. **Domain**: `Ride.createScheduled` factory (or extended
   `Ride.create` per Decision 1), `schedulePickupAt: Date | null`
   prop + getter, 15-minute-floor validation, tests.
2. **Data**: `RideDoc` schedulePickupAt accepter; `rideMapper`
   read+write paths (Timestamp ↔ Date); `RideRepository.observeScheduledRidesByPassenger`
   interface + `FirestoreRideRepository` impl + in-memory fake
   mirror; tests.
3. **App**: `CreateRide` input extension + `ObserveScheduledRides`
   use case wired through DI; tests.
4. **Presentation components**: `ScheduleDatetimePicker.tsx` +
   tests. Optional datetime formatter helper if absent today.
5. **Presentation screens**: `RideScheduledConfirmationScreen.tsx`
   + tests. Extended `RouteSelectScreen.tsx` (schedule row +
   post-confirm branch) + tests. Extended `ActivityScreen.tsx`
   (Scheduled section) + tests.
6. **Presentation VMs**: extended `useRouteSelectViewModel`
   (scheduled selector + formatter + confirm return shape) +
   tests. Extended `useActivityViewModel` (rider-side
   subscription) + tests.
7. **Navigation**: `navigation/types.ts`
   `RideScheduledConfirmation` param-list entry +
   `RiderNavigator.tsx` mount.
8. **Native config**: `@react-native-community/datetimepicker` in
   `package.json` + `app.config.ts` plugins array.
9. **Tests**: ~50-80 new tests per the §F table; zero regressions
   outside the 21 pre-existing BG-geolocation failures.
10. **Audit `docs/PHASE_10_PARITY_AUDIT.md`** — §1 count + bullet,
    §3.2 verdict, §4 row 571 annotation, §8 turn plan row 7
    strike-through, header sublabel append.
11. **`docs/PHASE_10_TURN_7.md`** documenting:
    - Pre-checklist outcomes (HEAD SHA, gap-confirmation greps,
      package state, in-progress-status-set verification, Cloud
      Function field-shape evidence, legacy line-count confirms).
    - The seven decisions with evidence chain.
    - The patch diffs by layer.
    - Test additions and pass counts.
    - Acceptance criteria.
    - Out-of-scope list.

`npm run verify` should be green except the carry-over 21
BG-geolocation failures (Turn 9's job).

## Sign-off criteria

- [ ] Decisions 1-7 documented with the evidence that drove them.
- [ ] `Ride.createScheduled` (or extended `Ride.create`) returns a
      `Ride` with `status === 'scheduled'` and
      `schedulePickupAt: Date`, rejecting `schedulePickupAt <
createdAt + 15min`.
- [ ] `RideDoc` DTO + `rideMapper` round-trip `schedulePickupAt`
      via Firestore Timestamp (read + write) AND tolerate ISO
      strings on the read path.
- [ ] `RideRepository.observeScheduledRidesByPassenger` shipped
      with a Firestore implementation that filters by passenger
      AND `status IN ['scheduled', 'scheduled_driver_accepted']`,
      and an in-memory fake mirror.
- [ ] `CreateRide` accepts `scheduledPickupAt?: Date | null` and
      routes through the scheduled factory when present.
- [ ] `ObserveScheduledRides` use case shipped + wired through DI.
- [ ] `ScheduleDatetimePicker.tsx` typed component shipped with
      iOS spinner / Android two-step UX and a 15-minute floor.
- [ ] `RideScheduledConfirmationScreen.tsx` shipped and routed via
      `RiderStackParamList.RideScheduledConfirmation`.
- [ ] `RouteSelectScreen` has a schedule-pickup row that opens
      the picker, displays the formatted selection, and confirms
      to a scheduled trip → `RideScheduledConfirmation` (else
      `RideMonitor`).
- [ ] `useRouteSelectViewModel.confirm()` returns the chosen
      tagged shape per Decision 5; the screen routes correctly on
      each branch.
- [ ] `ActivityScreen` renders a Scheduled section above Recent
      Rides when scheduled rides exist, hides when empty.
      `<DevToolsSection/>` continues to mount.
- [ ] `useInProgressRideQuery` does NOT redirect on `'scheduled'`
      status (verified or fixed per Decision 6).
- [ ] `@react-native-community/datetimepicker` added to
      `package.json` AND `app.config.ts` `plugins` array.
- [ ] New / updated tests per the §F table. ~50-80 new tests, no
      regressions outside Turn 9's 21 carry-overs.
- [ ] Audit §3.2 row flipped ❌ → ✅ with Turn 7 annotation.
- [ ] Audit §1 headline count updated `3 ❌ / 0 🟡` →
      `2 ❌ / 0 🟡`.
- [ ] `PHASE_10_TURN_7.md` written following Turn 6's structure.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo the pre-existing `CLAUDE.md` Prettier
      warning); jest carries only the 21 pre-existing
      BG-geolocation failures.
- [ ] Commit landed on `main` via the sandbox commit pattern.

## Native rebuild

**Required.** `app.config.ts` plugins change + a new native
dependency (`@react-native-community/datetimepicker`). The Expo
plugin's iOS handler is typically a no-op or pod-injection; the
Android handler may add Gradle dependencies. Run:

```bash
npm install @react-native-community/datetimepicker@<expo-sdk-55-pin>
npm run prebuild  # expo prebuild --clean + scripts/patch-podfile.js
npm run ios       # OR npm run android
```

If the prebuild step fails:

- Reorder the plugin entry in `app.config.ts` — `withFirebasePodfileFix`
  and `withGradleHeap` are precedence-sensitive (`withFirebasePodfileFix`
  must run after all native config plugins per the existing
  comment around line 374).
- Check
  `node_modules/@react-native-community/datetimepicker/app.plugin.js`
  for any `withPodfile` / `withGradleProperties` modifications.

Smoke test after first native run:

1. Open RouteSelect; tap the schedule row.
2. iOS: spinner appears; pick a date+time ≥ 15 min from now.
3. Android: date picker opens; pick a date; time picker opens;
   pick a time.
4. Confirm the formatted datetime appears in the schedule row.
5. Tap "Schedule ride"; verify navigation to
   `RideScheduledConfirmation`.
6. From Home tab → Activity tab; verify the new ride appears in
   the Scheduled section.
7. (Optional, requires a second device + driver login) Driver
   accepts → rider's Scheduled section row flips to
   `scheduled_driver_accepted` live.

---

**End of PHASE_10_TURN_7_KICKOFF.md.** Read top to bottom on a
new session and execute. Ask if any pre-checklist item surfaces
a blocker — especially if `useInProgressRideQuery` already
includes `'scheduled'` (pre-checklist item 4, Decision 6 in
scope), if the datetimepicker plugin conflicts with
`withFirebasePodfileFix` at prebuild (kickoff §E call-out), or
if the Cloud Function's on-disk Timestamp expectation can't be
satisfied through the existing `rideMapper` write path without a
shape change. Each of those is a wiring decision that comes
BEFORE the screen-side work.
