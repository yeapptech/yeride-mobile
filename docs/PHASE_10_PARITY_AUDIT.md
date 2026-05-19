# Phase 10 — Parity Audit (Legacy yeride ↔ yeride-mobile rewrite)

**Status:** v2 — verified 2026-05-18 (Phase 10 Turn 1) · Turn 2 closed 2026-05-18 · Turn 3 closed 2026-05-18 · Turn 4 closed 2026-05-18 · Turn 5 closed 2026-05-18 · Turn 6 closed 2026-05-19 · Turn 7 closed 2026-05-19
**Owner:** Hernando Sierra (hernando.sierra@yeapp.tech)
**Drafted:** 2026-05-18 · revised v2 2026-05-18 with Turn 1 verification findings · Turn 2 + Turn 3 + Turn 4 closures annotated 2026-05-18.
**Blocks:** [PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) §0 — the
cutover rollout (§6) cannot begin until every ❌ row below is
resolved or explicitly de-scoped.

This audit walks every legacy production feature against the
rewrite. Each row is marked:

- ✅ **ported** (and tested)
- 🟡 **ported with known differences** — the diff is called out
  explicitly; the rewrite version is intentionally different and
  acceptable
- ❌ **not yet ported** — a Phase 10.x turn is required before
  cutover
- ⚠️ **needs verification** — could not conclusively determine
  parity from static inspection; deeper investigation required

The audit was conducted by static inspection of both repos at
2026-05-18 HEAD. A second manual-smoke pass on real devices must
follow before the gate is signed off.

---

## 1. Headline findings

**v2 (post-Turn-1) + Turn 2 + Turn 3 + Turn 4 + Turn 5 + Turn 6 + Turn 7 closures:** **2 ❌ rows, 0 🟡 rows, 0 ⚠️ rows**
block the rollout (down from 7 ❌ / 2 🟡 at v2 — Turn 2 closed the
highest-severity ❌ on 2026-05-18 by patching `withFirebasePodfileFix.js`
to inject `$FirebaseSDKVersion = '12.12.0'`; Turn 3 closed the next
❌ on 2026-05-18 by porting `plugins/withMaterialTheme.js` to
unblock Stripe `<CardForm/>` on Android; Turn 4 closed the sole
code-side 🟡 on 2026-05-18 by dropping the unused
`BGTaskSchedulerPermittedIdentifiers` array from `app.config.ts`
because the v5.1.1 Transistor SDK provably no longer uses
BGTaskScheduler — see §10.4 + `docs/PHASE_10_TURN_4.md`). Turn 1's
verification pass resolved the four v1 ⚠️ rows and surfaced three
additional ❌ gaps:

- **§3.5 rider ETA** flipped ⚠️ → ❌ → **✅ closed in Turn 5
  (2026-05-18)** via an end-to-end NavSdk-telemetry pipeline:
  `NavigationService` gained `subscribeToTimeAndDistance`,
  `TripTracking` gained nullable `distanceMeters / durationSeconds /
updatedAt` (with the DTO accepting BOTH the canonical flat shape
  AND legacy nested `{distance, duration, calculatedAt}` and writing
  both for cutover parity), `useDriverMonitorViewModel` pushes live
  telemetry to `users/{driverId}.location.tripTracking` on a 30s /
  50m / 60s throttle (legacy `distanceTrackingService` constants
  copied verbatim) with a one-shot bypass when the first live fire
  follows a nav-less GPS write, and `useRideMonitorViewModel`
  subscribes to the driver's location via the existing
  `SubscribeToUserLocation` use case (decision 3 = (a) — keyed off
  `ride.driver?.id`, no new use case). `DispatchedView` /
  `StartedView` prefer `liveDurationSeconds` / `liveDistanceMeters`
  with static `ride.pickup.directions` / `ride.dropoff.directions`
  fallback (same "Calculating…" UX as legacy). Driver-side write
  uses Path α (VM-owned, not extending `useGpsLifecycle`) per
  decision 2 because `merge: true` makes the racing write harmless
  and the VM-owns-its-screen-lifecycle invariant is stronger than
  the AppContent-only-writer invariant. See
  `docs/PHASE_10_TURN_5.md`.
- **§3.7 trip preview** flipped ⚠️ → ✅. The "pre-confirm" / "pre-
  accept" surfaces exist in the rewrite (RouteSelect's Confirm
  button + DriverDispatchScreen's Accept/Decline). Legacy's
  `TripPreviewModal` was misidentified as a pre-trip preview in v1
  — it's actually the POST-trip details surface (used from past-
  trip taps in Activity / Wallet / Earnings) and reduces to a
  sub-problem of §3.3's Activity port.
- **§4 audio** flipped ⚠️ → ✅ post-fix. Restored in this turn (one
  line in `app.config.ts`) — NavSdk default is `VOICE_ALERTS_AND_GUIDANCE`
  and iOS suspends audio when backgrounded without the entitlement.
- **§4 processing** flipped ⚠️ → 🟡 in Turn 1 → **✅ closed in
  Turn 4 (2026-05-18)** via Path B (drop identifiers). Static
  inspection of the v5.1.1 TSLocationManager binary (both arm64 and
  simulator slices) found zero references to `BGTaskScheduler` /
  `BGProcessingTaskRequest` / `BGAppRefreshTaskRequest` /
  `registerForTaskWithIdentifier` / `com.transistorsoft.fetch` /
  `com.transistorsoft.customtask`. Source-grep in
  `node_modules/react-native-background-geolocation/{ios,src}`
  confirmed (zero matches) and the iOS Expo plugin handler is a
  documented no-op. Turn 4 removed the entire
  `BGTaskSchedulerPermittedIdentifiers` key (not left as empty
  array) and intentionally did NOT add `processing` to
  `UIBackgroundModes` (Apple requires it for
  `BGProcessingTaskRequest`, an API the v5 SDK provably doesn't
  use). See `docs/PHASE_10_TURN_4.md` for the evidence chain.
- **§4 withMaterialTheme** flipped ⚠️ → ❌ in Turn 1 → **✅ closed
  in Turn 3 (2026-05-18)**. Stripe `CardForm` (used in
  `AddPaymentMethodScreen`) requires Material Components theme on
  Android; the upstream `@stripe/stripe-react-native@0.63.0` plugin
  does not apply it. Turn 3 ported `plugins/withMaterialTheme.js`
  (modeled on legacy, parent switched to
  `Theme.MaterialComponents.DayNight.NoActionBar` so dark mode is
  preserved). See `docs/PHASE_10_TURN_3.md` for the patch + smoke-
  test record.
- **§4 withFirebaseSdkVersion** flipped ⚠️ → ❌ **CRITICAL** in Turn 1
  → **✅ closed in Turn 2 (2026-05-18)**. rnfb 24.0.0 ships
  `sdkVersions.ios.firebase = 12.10.0` which carries the Swift 6.3
  `async let` miscompile under Xcode 26.4 / iOS 26.3+. Every Cloud
  Function callable (`completeTrip` / `cancelTrip` / `tipDriver`)
  crashes in iOS release-mode builds. Turn 2 inlined the
  `$FirebaseSDKVersion = '12.12.0'` Podfile-header injection into
  `plugins/withFirebasePodfileFix.js` (Path b per the kickoff) and
  flipped this row to ✅. See `docs/PHASE_10_TURN_2.md` for the
  patch + idempotency-test record.
- **§4 withPackagingOptions / withFmtFix / withStripeIosSdkOverride
  / react-native-map-link** flipped ⚠️ → ✅ (4 retirements
  confirmed). `withPackagingOptions` reduces to `withGradleHeap` +
  `expo-build-properties` minSdk; `withStripeIosSdkOverride` is
  baked into stripe-react-native 0.63.0 (NS_ENUM + 25.10.0 pin);
  `react-native-map-link` was explicitly out-of-scope per Phase 8
  Turn 2 kickoff; `withFmtFix` likely retired (RN 0.83.6 → fmt
  12.1.0, a major-version bump past the patched 11.0.2) but needs a
  real Xcode 26 build to confirm — see §4 ⚠️ retained for this one.

The biggest user-facing gap remaining is **chat** (placeholder-only
in the rewrite). **Scheduled rides** has its backend pieces and
read-paths ported but is missing the rider-side creation UI.
**Activity / trip history** closed in Turn 6 (2026-05-19) — both
rider and driver tabs now render the real `ActivityScreen` /
`DriverActivityScreen` (paginated recent-rides + status-aware
navigation) with terminal-status taps routing to a new role-
agnostic `TripDetailScreen` carrying trip route, role-flipped
party header, per-trip events, and the new `TripPaymentsList`
component (per §3.6 fold-in). See `docs/PHASE_10_TURN_6.md`.

The **delivery flow** (DeliverService / DeliverSelect /
DeliverMonitor) is NOT a real gap — all three screens are
hard-coded `<Text>` stubs in legacy and were never built out.

The cloud-function surface is narrower in reality than legacy's
`CloudFunctions.js` exports imply — the legacy file exports
wrappers for `createTrip`, `dispatchDriver`, `startTrip`,
`updateTripStatus`, `calculateFare`, `processPayment`,
`refundPayment`, `updatePaymentMethod`, `createUserProfile`,
`updateUserProfile`, `deleteUserAccount`, `updateLocation`,
`validateLocation` — but the deployed `yeride-functions` only ships
`cancelTrip`, `completeTrip`, `tipDriver`, plus the trigger-based
functions (`onTripCreated`, `onTripUpdated`, `onTripEventCreated`,
`onScheduledNotification`, `sendPushNotification`). Most of the
legacy wrappers point at functions that **don't exist on the
server** — they're dead client code. The rewrite's narrower surface
matches reality, not legacy.

**Newly-discovered (Turn 1, §11):** a side-finding — 21 jest tests
in `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
fail at HEAD `f537773` due to the post-Phase-9 v5 SDK upgrade's
`__DEV__` short-circuit. Tests run with `__DEV__===true` (jest-expo
default) and assert native paths were exercised — the short-circuit
returns `Result.ok(true)` before reaching them. Not a parity
regression, but **blocks cutover plan §3.1's "`npm run verify`
green" gate** and must be resolved before the cutover SHA is
selected.

---

## 2. Screens & navigation

### 2.1 Auth stack

| Legacy screen          | Rewrite screen                | Status | Notes |
| ---------------------- | ----------------------------- | ------ | ----- |
| `LogIn.js`             | `LogInScreen.tsx`             | ✅     |       |
| `Register.js`          | `RegisterScreen.tsx`          | ✅     |       |
| `ForgotPassword.js`    | `ForgotPasswordScreen.tsx`    | ✅     |       |
| `EmailVerification.js` | `EmailVerificationScreen.tsx` | ✅     |       |
| `UserProfile.js`       | `UserProfileScreen.tsx`       | ✅     |       |

### 2.2 Rider stack & tabs

| Legacy screen                  | Rewrite screen                        | Status | Notes                                                                               |
| ------------------------------ | ------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `RiderHome.js`                 | `RiderHomeScreen.tsx`                 | ✅     |                                                                                     |
| `RideRouteSearch.js`           | `RouteSearchScreen.tsx`               | ✅     |                                                                                     |
| `RideSelect.js`                | `RouteSelectScreen.tsx`               | ✅     |                                                                                     |
| `RideMonitor.js`               | `RideMonitorScreen.tsx`               | ✅     |                                                                                     |
| `RideScheduledConfirmation.js` | `RideScheduledConfirmationScreen.tsx` | ✅     | Phase 10 Turn 7 — port + nav wiring + tests. See §3.2.                              |
| `Wallet.js`                    | `WalletScreen.tsx`                    | 🟡     | Wallet screen ported, but rewrite has no `TransactionHistory` equivalent. See §3.6. |
| `PaymentMethod.js`             | `AddPaymentMethodScreen.tsx`          | ✅     | Renamed; same purpose.                                                              |
| `PaymentMethodItem.js`         | —                                     | ✅     | Legacy file is a sub-component, not a routed screen.                                |
| `TripHistory` (Activity tab)   | `ActivityPlaceholderScreen.tsx`       | ❌     | Placeholder only — see §3.3.                                                        |
| `DeliverService.js`            | —                                     | ✅     | Legacy is a `<Text>RequestDeliver</Text>` stub. Not a real feature.                 |
| `DeliverSelect.js`             | —                                     | ✅     | Same — stub.                                                                        |
| `DeliverMonitor.js`            | —                                     | ✅     | Same — stub.                                                                        |

### 2.3 Driver stack & tabs

| Legacy screen                | Rewrite screen                        | Status | Notes                                  |
| ---------------------------- | ------------------------------------- | ------ | -------------------------------------- |
| `DriverHome.js`              | `DriverHomeScreen.tsx`                | ✅     |                                        |
| `DriverDispatch.js`          | `DriverDispatchScreen.tsx`            | ✅     |                                        |
| `DriverMonitor.js`           | `DriverMonitorScreen.tsx`             | ✅     | Phase 8 status-router pattern.         |
| `DriverNavigation.js`        | `DriverNavigationScreen.tsx`          | ✅     | Phase 8 Nav SDK integration.           |
| `Earnings.js`                | `DriverEarningsScreen.tsx`            | ✅     |                                        |
| `VehicleList.js`             | `VehicleListScreen.tsx`               | ✅     | Phase 5.                               |
| `VehicleRegistration.js`     | `VehicleRegistrationScreen.tsx`       | ✅     |                                        |
| `VehicleDetails.js`          | `VehicleDetailsScreen.tsx`            | ✅     |                                        |
| `VehiclePhotos.js`           | `VehiclePhotosScreen.tsx`             | ✅     |                                        |
| `TripHistory` (Activity tab) | `DriverActivityPlaceholderScreen.tsx` | ❌     | Same as rider — placeholder. See §3.3. |

### 2.4 Modals / shared screens

| Legacy                | Rewrite                             | Status |
| --------------------- | ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TripPreviewModal.js` | RideReceiptScreen (Phase 9 Turn 16) | 🟡     | Rewrite ships a different surface — `RideReceiptScreen` is a receipt view, not the legacy "trip preview" modal. Confirm in manual smoke that the rider trip preview flow has an equivalent path. |

---

## 3. Feature-level gaps

### 3.1 Delivery flow — ✅ not a real feature

**Legacy:** `DeliverService.js`, `DeliverSelect.js`, `DeliverMonitor.js`
are all hard-coded `<Text>DeliverXxx</Text>` placeholders (verified
2026-05-18). They route from `RiderStackNavigator.js` but nothing
in the legacy UI navigates to them.

**Rewrite:** No delivery screens.

**Verdict:** Not a parity gap. REFACTOR_PLAN.md §6 originally
scoped Phase 8 to "Delivery flow"; Phase 8 was repurposed mid-flight
to Google Navigation SDK integration and the delivery flow was
silently dropped because it was never real in legacy. No action
needed for cutover.

### 3.2 Scheduled rides — ✅ closed in Turn 7 (2026-05-19)

**Legacy:**

- `RideScheduledConfirmation.js` — post-schedule confirmation screen
- `ScheduleDatetimePicker.js` — full date/time picker modal
- `ScheduledTrips.js` — listing of rider's scheduled rides on Activity tab
- `Trip.js`:`subscribeToRiderScheduledRides` — Firestore query
- Cloud Function `onScheduledNotification` — pickup reminders via Cloud Tasks
- `scheduled_driver_accepted` status writes from RideSelect

**Turn 7 (2026-05-19):** Closed the gap end-to-end. Decisions captured
in `docs/PHASE_10_TURN_7.md` §B:

- **Decision 1 (b)** — new `Ride.createScheduled` static factory (vs.
  extending `Ride.create` with an optional arg). Mirrors the
  "transitions return new entities" pattern; keeps `Ride.create()`
  semantics unchanged.
- **Decision 2 (a)** — subscription-shaped repository method
  `observeScheduledRidesByPassenger` (vs. one-shot list). Scheduled
  rides DO mutate while the rider watches them (`scheduled` →
  `scheduled_driver_accepted` on driver accept, then dispatched at
  the pickup window), so live updates are user-visible.
- **Decision 3 (a)** — `RideScheduledConfirmation` route params carry
  pre-formatted display strings (legacy parity) rather than a
  `tripId`. Confirmation is a transient one-way screen the rider
  sees once; smaller diff.
- **Decision 4 (b)** — client-side sort by `schedulePickupAt asc` (vs.
  composite Firestore index). Keeps the cutover-plan §3.4 "indexes
  unchanged from legacy app's HEAD" gate green; per-rider scheduled
  volume is low enough that client-side sort is free.
- **Decision 5 (a)** — `useRouteSelectViewModel.confirm()` returns
  `Promise<{rideId, isScheduled} | null>` (vs. a VM-flag pattern).
  Screen branches on the tag at a single switch.
- **Decision 6 (fix in scope)** — removed `'scheduled'` from
  `ride.queries.ts:ACTIVE_STATUSES`. A pure-scheduled ride has no
  driver yet, so the rider should NOT be auto-redirected into
  RideMonitor. Verified at pre-checklist that line 47 of the
  rewrite's `ride.queries.ts` included `'scheduled'`; that's a
  pre-existing bug we inherited from earlier Phase work. Fixed
  here; tests pass.
- **Decision 7 (a)** — picker entry on `RouteSelectScreen` (legacy
  parity). The row sits between `RideServicesList` and the
  Confirm button.

**Shipped:**

- `Ride.createScheduled` factory + `schedulePickupAt: Date | null`
  prop + 15-minute-floor validation + tests.
- `RideDoc.schedulePickupAt` accepter (Timestamp / ISO / null) +
  `rideMapper` read+write paths + tests.
- `RideRepository.observeScheduledRidesByPassenger` interface +
  `FirestoreRideRepository` impl + `InMemoryRideRepository`
  mirror + tests.
- `CreateRide.scheduledPickupAt` extension + new
  `ObserveScheduledRides` use case + DI wiring + tests.
- `ScheduleDatetimePicker.tsx` typed port + `formatScheduleDateTime`
  helper + `__mocks__/@react-native-community/datetimepicker.tsx`
  Jest mock + tests.
- `RideScheduledConfirmationScreen.tsx` + nav wiring + tests.
- `useRouteSelectViewModel` extended with the scheduled selector +
  formatter + tagged confirm() shape; `RouteSelectScreen` schedule
  row + clear control + post-confirm branch.
- `useActivityViewModel` + `ActivityScreen` rider-side Scheduled
  section.
- `@react-native-community/datetimepicker@8.4.4` added to
  `package.json` + `app.config.ts` plugins.

**Verdict:** ✅ — rider can again create + view scheduled rides.

### 3.3 Activity / trip history — ✅ closed in Turn 6 (2026-05-19)

**Legacy:** Activity tab on BOTH rider and driver renders `TripHistory.js`,
which renders `<RecentTrips/>` — a `useFocusEffect`-scoped
`onSnapshot` subscription to
`subscribeToPassengerRecentTrips` / `subscribeToDriverRecentTrips`
(limit 10, `orderBy createdDateTime desc`). Row taps route to
either `TripPreviewModal` (terminal-status trips) or
`RideMonitor` / `DriverMonitor` (active trips). The audit v1
framing of "TripHistory composes InProgressTrips + ScheduledTrips

- RecentTrips" was incorrect — `InProgressTrips.js` +
  `ScheduledTrips.js` render on `RiderHome` / `DriverHome`, NOT on
  Activity. Verified at Turn 6 kickoff.

**Turn 6 (2026-05-19):** Replaced both placeholders with paginated
recent-rides surfaces. Decisions captured in
`docs/PHASE_10_TURN_6.md` §B:

- **Decision 1 (a)** — Activity = recent-rides only (parity).
- **Decision 2 (a)** — no in-progress section on Activity (the
  rewrite auto-redirects via `useInProgressRideQuery` so a list
  would be dead UI).
- **Decision 3 (b)** — scheduled-rides section deferred to Turn 7
  (alongside the rider-side creation UI).
- **Decision 4 (b)** — new role-agnostic `TripDetailScreen` mounted
  on both stacks (mirrors legacy `TripPreviewModal` symmetry).
- **Decision 5 (a)** — extended `listByPassenger` / `listByDriver`
  with optional `cursor: RideListCursor`; three callsite migrations
  (`useInProgressRideQuery`, `useInProgressDriverRideQuery`,
  `useRidesByPassengerQuery`).
- **Decision 6 (a)** — `useInfiniteQuery` + focus-refetch (history
  doesn't mutate after closure; cursor pagination is cleaner than
  live `onSnapshot`).

**Drift from kickoff item 4:** the rewrite's `rideMapper` collapses
legacy `closed` / `passenger_canceled` / `driver_canceled` into
domain `completed` / `cancelled`, and `payment_failed` stays on
`RideMonitor` (PaymentFailedView lets the rider retry). So the
terminal-for-nav-switch set is `['completed', 'cancelled']`, not
the kickoff's five-status list. Documented in
`docs/PHASE_10_TURN_6.md` §A.

**Patch shape:** new domain `RideListCursor` VO + `RidePage` type;
`FirestoreRideRepository` paginated reads via `startAfter(<iso>)`;
in-memory fake mirror; `ListRidesByPassenger` / `ListRidesByDriver`
return `Result<RidePage, NetworkError>`; new components
`TripCard`, `TripList`, `TripPaymentsList` (folded in per §3.6);
new view-models `useActivityViewModel`, `useDriverActivityViewModel`,
`useTripDetailViewModel`; new screens `ActivityScreen`,
`DriverActivityScreen`, `TripDetailScreen` (in
`src/presentation/features/shared/screens/`); tab-navigator swap
on both stacks; `TripDetail: { rideId: string }` route added to
both `RiderStackParamList` and `DriverStackParamList`. Placeholders

- placeholder tests scheduled for git-tracked deletion at commit
  time (sandbox unlink-EPERM workaround). ~66 new tests across all
  four layers; zero regressions outside Turn 9's 21 carry-over
  BG-geolocation failures.

### 3.4 Chat / messaging — ❌ deferred at Phase 3.5

**Legacy:** `ChatModal.js` (rider + driver) — full bidirectional
chat using `react-native-gifted-chat`, reads from + writes to
`trips/{tripId}/messages` subcollection. Marks messages read via
`markMessagesRead`. Suppresses in-app banner for the currently-open
chat via module-scoped `openChatId` ref.

Supporting components: `ChatTouchable.js` (open-chat button),
`InAppNotification.js` (foreground chat-message banner).

**Rewrite:**

- ✅ `ChatMessage` domain entity exists (`src/domain/entities/ChatMessage.ts`)
- ✅ `ObserveLatestMessage` use case (drives the unread-dot indicator)
- ✅ `useChatUiStore` — has `isOpen` + `lastReadAt` state
- ❌ **No chat UI** — `useChatUiStore.ts` itself documents this:
  > "Phase 3 scope: this store carries the open/closed flag and a
  > `lastReadAt` timestamp the unread-dot derives from. The full
  > chat thread + send/markRead use cases land in Phase 3.5; until
  > then the store remains write-only from the chat-stub button
  > (which sets `isOpen` long enough to show a 'Chat lands in
  > Phase 3.5' toast)."

Phase 3.5 never happened. Chat is deferred work that needs to land
in Phase 10.

**Verdict:** ❌ — Phase 10.x turn required. Size: medium (~2-3 days).

**Phase 10 turn scope:**

- Build `ChatModal.tsx` or `ChatScreen.tsx` (decide screen vs
  modal — legacy is modal).
- Add `react-native-gifted-chat` to dependencies; mock in
  `jest.setup.ts`.
- Use cases: `ObserveChatMessages(tripId)`, `SendChatMessage`,
  `MarkChatRead`.
- `ChatRepository` interface in `@domain/repositories`, Firestore
  adapter in `@data/repositories/FirestoreChatRepository`, in-memory
  fake in `@shared/testing`.
- Foreground push-banner suppression: port the `openChatId`
  module-scoped ref pattern, or replace with a Zustand selector on
  `useChatUiStore.isOpen`.
- Unread-dot already driven by `ObserveLatestMessage` —
  wire `lastReadAt` write-through to Firestore.

### 3.5 Rider-side ETA / Distance Matrix tracking — ✅ closed in Turn 5 (2026-05-18)

**Legacy:** `TripETAInfo.js` component on rider-side `RideMonitorScreen`
shows the driver's ETA to pickup. Powered by
`api/services/distanceTrackingService.js` — throttled Distance Matrix
API polling (30s min interval / 50m min movement / 60s data
staleness). Driver computes the values in `DriverHome.js`
(`calculateDistanceData(...)`) and writes them to
`users/{driverId}.location.tripTracking = {distance, duration, ...}`.
Rider's `DispatchedView.js` / `StartedView.js` subscribe via
`subscribeToUserLocation(driverId, callback, tripId)` and pass
`liveTracking={locationData.tripTracking}` into `TripETAInfo`.

**Rewrite (verified 2026-05-18):**

- No `TripETAInfo` equivalent. ETA on both `DispatchedView.tsx` and
  `StartedView.tsx` is read from `ride.pickup.directions.durationSeconds`
  (set at dispatch time) and `ride.dropoff.directions.durationSeconds`
  (set at trip-create time) respectively — **static values, never
  updated as the driver moves**.
- `UserLocation.tripTracking` exists in the domain entity but carries
  only `{tripId, tripStatus, destination}` — no distance/duration
  fields. The presentation-side `useRiderHomeViewModel.ts:113` writes
  `tripTracking: null` when pushing rider location to Firestore.
- No `onTrafficUpdated`, `onRouteChanged`, `setOnRemainingTimeOrDistanceChanged`
  listeners are subscribed on the NavSdk seam (`NavigationSdkClient.ts`
  only wires `setOnArrival`). No Distance Matrix call site exists.
- `docs/PHASE_9_TURN_5.md` shipped but **was repurposed** to close the
  passenger-snapshot Stripe gap (deferred from Phase 6 polish). The
  originally-planned Distance-Matrix-bypass / NavSdk-telemetry work
  was deferred to "Phase 9 polish" (per Phase 8 Turn 2 kickoff
  line 348) and never landed.

**Verdict:** ✅ closed in Turn 5 (2026-05-18). End-to-end NavSdk-
telemetry pipeline shipped. The rewrite now matches legacy's "ETA
updates every ~15-30s as the driver drives" UX. Decisions captured:

- **Decision 1** = (a) extend `TripTracking` rather than splitting
  off a separate `LiveTracking` VO — matches the legacy doc shape
  exactly and avoids a second Firestore field that would break
  read-back parity with legacy clients.
- **Decision 2** = (α) `useDriverMonitorViewModel` owns the write
  path with `merge: true`-safe race against `useGpsLifecycle`'s
  plain GPS writes. The "VM owns its screen's lifecycle" convention
  is stronger than the "AppContent is the only writer" invariant.
- **Decision 3** = (a) reuse `SubscribeToUserLocation` keyed off
  `ride.driver?.id` rather than introducing a wrapping
  `ObserveDriverLocation` use case.
- **Decision 4** = copy legacy throttle constants verbatim (30s
  min interval / 50m min movement / 60s NavSdk staleness). Tuning
  defers to a post-cutover turn.

A one-shot time-gate bypass on the first nav-less → live edge
ensures the rider sees a live ETA on the very first NavSdk fire
even if a `tripTracking: null` GPS write landed first. The
mapper dual-writes the canonical flat fields AND the legacy
nested `{distance, duration, calculatedAt}` shape so legacy
yeride clients keep reading ETA correctly during cutover.

See `docs/PHASE_10_TURN_5.md` for the patch shape, test counts,
and full evidence chain.

### 3.6 Wallet & per-trip TransactionHistory — ✅ closed in Turn 6 (2026-05-19)

**Verified Turn 1 — the v1 framing was misleading.** Legacy
`TransactionHistory.js` is NOT a Wallet-level history. It's a
**per-trip payment list** that takes a `tripId` prop and renders the
fare / tip / refund / cancellation records for one trip:

```js
// src/components/TransactionHistory.js
const TransactionHistory = ({ tripId, showHeader = true }) => {
  const unsubscribe = subscribeToTripPayments(tripId, (data, err) => { … });
}
```

The subscription reads from the `trips/{tripId}/payments` Firestore
subcollection. The component is rendered inside
`TripPreviewModal` (the per-trip details surface), not inside the
Wallet tab.

The legacy Wallet screen itself (`src/rider/screens/Wallet.js`)
renders ONLY the rider's payment-method list. Line 180 contains the
comment:

```js
{
  /* Recent Payments section temporarily disabled - see GitHub issue #110 */
}
```

— so legacy Wallet has no recent-transactions view to port. The
rewrite's `WalletScreen.tsx` matches that surface (payment methods
only), so the Wallet tab is **at parity**.

The genuine missing surface is the **per-trip payments list**, and
it belongs to the per-trip detail view that legacy reaches via
`TripPreviewModal` from Activity / RiderHome / DriverHome /
Earnings — which is blocked on §3.3 (Activity port).

The driver-side `Earnings.js` reads three Stripe-API surfaces
(`getAccountBalance`, `getAccountPayouts`,
`getAccountBalanceTransactions`) — the rewrite has the equivalent
use cases (`GetDriverBalance`, `ListDriverPayouts`,
`ListBalanceTransactions`) wired and the `DriverEarningsScreen`
shipped in Phase 6 — ✅ at parity.

**Verdict:** ✅ closed in Turn 6 (2026-05-19) via the §3.3 fold-in.
Wallet itself was already at parity. The per-trip
TransactionHistory list shipped in Turn 6 as
`TripPaymentsList` (`src/presentation/components/trip/`), consuming
the already-shipped `ObserveTripPayments` use case + `tripPaymentMapper`.
Composed into the new `TripDetailScreen`. Renders type chips
(`fare` / `tip` / `refund`), status badges (`succeeded` / `failed` /
`refunded`), per-row amount, and a total-summed footer
(`succeeded` fare + tip − `succeeded` refund). Total math runs in
`Money` minor units — no floats, no currency mixing. See
`docs/PHASE_10_TURN_6.md`.

### 3.7 Trip preview — ✅ verified (Turn 1)

**Verified 2026-05-18.** The v1 framing of `TripPreviewModal.js` as
a pre-confirm/pre-accept surface was incorrect on close reading.
Legacy navigation entrypoints into `TripPreviewModal`:

- `TripHistory.js:34` — `navigation.navigate('TripPreviewModal', { tripId: ride.id })`
- `RiderHome.js:366` — same
- `DriverHome.js:298` — same
- `Earnings.js:391` — same

— all are **post-trip** taps on a past trip's row, not pre-trip
confirmations. `TripPreviewModal.js` itself renders
`PassengerView` + `TripView` + `Events` + (rider-only)
`TipSelector` + (closed-only) `TransactionHistory`. It IS the per-
trip details surface that the Activity / Wallet / Earnings tabs
navigate into. Re-classified as a sub-problem of §3.3 (Activity
port — §3.6 captures the per-trip TransactionHistory piece).

**Pre-confirm surfaces — what actually exists in both apps:**

- **Rider RouteSelect → RideMonitor.** Legacy: `RideSelect.js`'s
  `onRideSelected(ride)` calls `createTrip(newTrip)` directly when
  the rider taps a ride-service tier (no intermediate dialog).
  Rewrite: `RouteSelectScreen.tsx` renders an explicit "Confirm"
  Pressable at the screen bottom that calls `vm.confirm()`. The
  rewrite's surface is in fact MORE explicit than legacy's "tap
  triggers create" flow.
- **Driver DriverDispatch → DriverMonitor.** Legacy: native
  `Alert.alert('Driver Dispatch', "You have selected a {tier}
ride. It will take {duration} to complete", [Confirm, Cancel])`
  before calling `dispatchDriver` (`DriverDispatch.js:323-337`).
  Rewrite: full-screen `DriverDispatchScreen.tsx` with the trip
  card + Accept/Decline buttons in the bottom panel
  (`useDriverDispatchViewModel.ts` status-router with `'ready'`
  arm). The rewrite's surface is MORE discoverable than legacy's
  native Alert.

**Verdict:** ✅ — both pre-confirm surfaces are present (in fact
richer in the rewrite). The v1 row in §2.4 about `TripPreviewModal`
vs `RideReceiptScreen` is corrected: TripPreviewModal is the post-
trip details surface (folded into §3.3), `RideReceiptScreen` is the
post-completion receipt PDF that fires after `'completed'` status,
and the two are NOT competing surfaces.

---

## 4. App config diff (legacy `app.config.js` vs rewrite `app.config.ts`)

| Surface                                         | Legacy                                                                | Rewrite                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS `UIBackgroundModes`                         | `['location', 'fetch', 'processing', 'remote-notification', 'audio']` | `['location', 'fetch', 'remote-notification', 'audio']` (post-Turn-1; unchanged Turn 4)                  | ✅ **closed Turn 4 (2026-05-18)** via Path B. `audio` was restored in Turn 1 (one-line fix in `app.config.ts:184`). `processing` intentionally NOT added in Turn 4: Apple requires it only for `BGProcessingTaskRequest`, and the v5.1.1 Transistor SDK binary contains zero references to `BGTaskScheduler` / `BGProcessingTaskRequest` / `registerForTaskWithIdentifier` (verified via `strings(1)` on both arm64 + simulator slices; source-grep in `node_modules/react-native-background-geolocation/{ios,src}` confirms; iOS Expo plugin is a documented no-op). Re-adding `processing` would inflate the app's entitlement surface for an API the SDK doesn't use. See §10.4.     |
| iOS `BGTaskSchedulerPermittedIdentifiers`       | `['com.transistorsoft.fetch', 'com.transistorsoft.customtask']`       | not emitted (Turn 4)                                                                                     | ✅ **closed Turn 4 (2026-05-18)** via Path B. Legacy entries existed because the pre-v5 Transistor SDK registered those identifiers via `BGTaskScheduler.registerForTaskWithIdentifier`. The v5.1.1 upgrade (Phase 9 chore) removed BGTaskScheduler usage entirely; carrying the now-orphan identifiers would declare to the OS that the app intends to register a task it never will (triggering Apple's runtime validation-warning). The whole key is dropped from `ios.infoPlist` rather than left as an empty array (kickoff sign-off criterion #4). If a future SDK bump reintroduces BGTaskScheduler usage, re-add both the identifier whitelist AND `processing` together.       |
| iOS permission strings                          | NSLocation×4, NSMotion, NSCamera, NSPhotoLibrary                      | NSMotion only (camera + photo handled by `expo-image-picker` plugin; location by `expo-location` plugin) | ✅ Different mechanism, same effect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Android permissions                             | ACCESS_COARSE_LOCATION + ACCESS_FINE_LOCATION explicit                | Same via plugins                                                                                         | ✅ Confirm at build time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `expo-notifications` plugin                     | Present                                                               | Present (Phase 9 Turn 2)                                                                                 | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `react-native-background-geolocation` plugin    | Present                                                               | Present (Phase 7 + v5 upgrade)                                                                           | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@stripe/stripe-react-native` plugin            | Present                                                               | Present (Phase 6)                                                                                        | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@react-native-community/datetimepicker` plugin | Present                                                               | ✅ added in Turn 7 (2026-05-19)                                                                          | ✅ **closed Turn 7 (2026-05-19)**. Plugin appended to `app.config.ts` plugins array; `@react-native-community/datetimepicker@8.4.4` added to `package.json` dependencies. Used by `ScheduleDatetimePicker.tsx` (Turn 7). Native rebuild (`npm run prebuild`) required on next build; jest tests use the manual mock at `__mocks__/@react-native-community/datetimepicker.tsx`.                                                                                                                                                                                                                                                                                                          |
| `@react-native-firebase/crashlytics` plugin     | Present                                                               | Present (Phase 9 Turn 3)                                                                                 | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `withCrashlyticsUploadSymbols` custom plugin    | Present                                                               | Present                                                                                                  | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `withMaterialTheme` custom plugin               | Present                                                               | ✅ ported as `plugins/withMaterialTheme.js` (Turn 3)                                                     | ✅ **closed Turn 3 (2026-05-18)**. Ported the legacy plugin to `plugins/withMaterialTheme.js:67-101` with two patches: `withAndroidStyles` flips `AppTheme`'s parent to `Theme.MaterialComponents.DayNight.NoActionBar` (NOT legacy's `Light` variant — preserves the rewrite's dark-mode support); `withAppBuildGradle` injects `implementation 'com.google.android.material:material:1.11.0'` into the app dependencies block. Both patches are idempotent (verified by fixture smoke test, 11/11 assertions). Remove this plugin once `@stripe/stripe-react-native` ships a release whose own Expo plugin applies the Material theme, or once the rewrite stops using `<CardForm/>`. |
| `withPackagingOptions` custom plugin            | Present                                                               | ❌ not found                                                                                             | ✅ retired (verified Turn 1). JVM heap is handled by `withGradleHeap`. The Detox-related bits (META-INF/LICENSE excludes, protobuf-lite exclusion, JUnit conflict workarounds, Stripe androidTest disable) aren't needed because rewrite has no Detox suite (Phase 10.x or later concern). The minSdk-24 forcing reduces to `expo-build-properties.android.minSdkVersion: 24` already in the rewrite.                                                                                                                                                                                                                                                                                   |
| `withFmtFix` custom plugin                      | Present                                                               | ❌ not found                                                                                             | 🟡 likely retired (verified Turn 1). The plugin patches fmt 11.0.2's `#if FMT_USE_CONSTEVAL` (missing `#ifndef` guard) for Xcode 26+ — a known fmt 11.x bug. RN 0.83.6 pulls in fmt **12.1.0** per `node_modules/react-native/third-party-podspecs/fmt.podspec` (a major-version bump). Upstream fmt 12.x likely fixed the guard but we have not confirmed against the actual cloned-pod source. Verify on the first Xcode 26 prebuild attempt; re-add the plugin only if `FMT_USE_CONSTEVAL` redefinition errors recur.                                                                                                                                                                |
| `withStripeIosSdkOverride` custom plugin        | Present                                                               | ❌ not found                                                                                             | ✅ retired (verified Turn 1). Both purposes of the plugin are covered upstream: (a) `stripe-react-native@0.63.0`'s `ios/StripeSwiftInterop.h` already declares `NS_ENUM(NSInteger, STPPaymentStatus)` (no NSUInteger forward-decl mismatch); (b) `stripe-react-native@0.63.0`'s podspec pins `stripe_version = '~> 25.10.0'` — newer than the legacy plugin's `~> 25.9.0` pin.                                                                                                                                                                                                                                                                                                          |
| `withFirebaseSdkVersion` custom plugin          | Present                                                               | ✅ inlined into `withFirebasePodfileFix.js` (Turn 2)                                                     | ✅ **closed Turn 2 (2026-05-18)**. rnfb 24.0.0's `package.json` still declares `sdkVersions.ios.firebase = 12.10.0` (the bug-carrying version), so Turn 2 added a second numbered patch to `plugins/withFirebasePodfileFix.js:86-118` that injects `$FirebaseSDKVersion = '12.12.0'` at top level of the iOS Podfile (after the existing `$RNFirebaseAsStaticFramework = true` block), guarded by a `# yeride:firebase-sdk-version` sentinel for idempotency. Pins every `Firebase/*` pod past the Swift 6.3 `async let` miscompile (firebase-ios-sdk#15974). Remove this patch once `@react-native-firebase` ships a release whose `sdkVersions.ios.firebase` is 12.12.0 or newer.     |
| `react-native-map-link` plugin                  | Present                                                               | ❌ not found                                                                                             | ✅ retired (verified Turn 1). `PHASE_8_TURN_2_KICKOFF.md:350` explicitly lists "External-Google-Maps fallback (legacy `showLocation` path)" as out-of-scope: "If `init()` returns `'navigation_api_not_authorized'`, the VM lands in the `error` arm with a user-facing message + a `retry` callback. No external-app fallback this phase."                                                                                                                                                                                                                                                                                                                                             |
| `withGradleHeap` custom plugin                  | ❌                                                                    | Present                                                                                                  | ✅ Rewrite-only; required by larger module set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `withGoogleMapsApiKey` custom plugin            | ❌                                                                    | Present                                                                                                  | ✅ Different key-injection mechanism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `withPlayServicesLocationVersion` custom plugin | Inline in `android/build.gradle` ext block                            | Present as plugin                                                                                        | ✅ Different mechanism, same effect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `withNavigationSdk` custom plugin               | Present                                                               | Present                                                                                                  | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Action items (v2):**

- ✅ `@react-native-community/datetimepicker` plugin added in Turn 7 (2026-05-19) alongside the §3.2 scheduled-rides UI port.
- ✅ `audio` UIBackgroundMode restored in Turn 1 (`app.config.ts:184`).
- ✅ `processing` UIBackgroundMode vs `BGTaskSchedulerPermittedIdentifiers`
  reconciled in Turn 4 (2026-05-18) via Path B — both transistorsoft
  identifiers dropped from `app.config.ts`'s `ios.infoPlist` (whole
  key removed). The v5.1.1 SDK binary doesn't reference
  BGTaskScheduler at all, so the identifiers would have triggered a
  runtime validation-warning without serving any function.
  `processing` not added (the API requiring it isn't used). See
  `docs/PHASE_10_TURN_4.md`.
- ✅ `withMaterialTheme` ported in Turn 3 (2026-05-18) as
  `plugins/withMaterialTheme.js` (parent: DayNight, not legacy's
  Light) — unblocks Stripe `<CardForm/>` Android render. Production
  blocker resolved.
- ✅ `withFirebaseSdkVersion` inlined into `withFirebasePodfileFix.js`
  (Turn 2, 2026-05-18) — `$FirebaseSDKVersion = '12.12.0'` patch
  closes the iOS Cloud-Function-callable crash on Xcode 26.4 / iOS
  26.3+. Production blocker resolved.
- 🟡 Verify `withFmtFix` retirement on the first Xcode 26 build;
  re-add only if `FMT_USE_CONSTEVAL` errors recur.

---

## 5. Cloud Function callables

The deployed `yeride-functions` surface is documented in legacy
`yeride-functions/CLAUDE.md`:

| Function                  | Trigger                 | Used by legacy client? | Used by rewrite client?  |
| ------------------------- | ----------------------- | ---------------------- | ------------------------ |
| `cancelTrip`              | callable                | ✅                     | ✅                       |
| `completeTrip`            | callable                | ✅                     | ✅                       |
| `tipDriver`               | callable                | ✅                     | ✅                       |
| `onScheduledNotification` | HTTP POST (Cloud Tasks) | (server-only)          | (server-only)            |
| `onTripCreated`           | Firestore onCreate      | (server-only)          | (server-only)            |
| `onTripEventCreated`      | Firestore onCreate      | (server-only)          | (server-only)            |
| `onTripUpdated`           | Firestore onUpdate      | (server-only)          | (server-only)            |
| `sendPushNotification`    | HTTP POST               | ✅ (via legacy proxy)  | ✅ (via Cloud Functions) |

**Phantom-export legacy callables that don't exist on the server:**

Legacy `src/api/firebase/CloudFunctions.js` exports wrappers for
`createTrip`, `dispatchDriver`, `startTrip`, `updateTripStatus`,
`calculateFare`, `processPayment`, `refundPayment`,
`updatePaymentMethod`, `createUserProfile`, `updateUserProfile`,
`deleteUserAccount`, `updateLocation`, `validateLocation`. These
point at function names that do NOT appear in `yeride-functions`.

Either (a) they were once deployed and removed, or (b) they were
client-side stubs for planned-but-never-shipped backend work. Per
legacy `CLAUDE.md`'s critical-files table, Trip.js, AuthUser.js,
Vehicle.js write directly to Firestore for most operations — the
callable wrappers are dead code.

**Verdict:** ✅ The rewrite correctly mirrors the actually-deployed
surface (`completeTrip`, `cancelTrip`, `tipDriver` callables; the
trigger-based functions need no client). No action needed.

---

## 6. Notifications

| Aspect                                          | Legacy                                                                                         | Rewrite                                                                                   | Status                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --- |
| Push registration                               | `expo-notifications` Expo push token                                                           | Same — `usePushTokenRegistration` (Phase 9 Turn 2)                                        | ✅                                                                                                                             |
| Server push send                                | `yeride-functions/lib/notifications.js` via Expo push API                                      | Same backend — no change                                                                  | ✅                                                                                                                             |
| Foreground handler                              | `InAppNotification.js` banner + `openChatId` suppression                                       | `useNotificationResponseHandler` (Phase 9 Turn 2)                                         | 🟡 Rewrite handles taps + foreground notification routing but may not have the in-app banner UI; verify per push payload type. |
| Notification types handled                      | `trip_event`, `chat_message`, `scheduled_driver_accepted`, `pickup_reminder`, `payment_failed` | All five per `HandleNotificationResponse.ts` and `PushNotificationService.ts`             | ✅                                                                                                                             |
| Deep links                                      | Tap-to-route to trip / chat                                                                    | Same per `HandleNotificationResponse.ts` (`scheduled_driver_accepted → rider_ride_monitor | tripId`)                                                                                                                       | ✅  |
| `chat_message` banner suppression for open chat | Module-scoped `openChatId` ref in `ChatModal.js`                                               | Not implemented (chat itself is ❌)                                                       | ❌ blocked on §3.4                                                                                                             |

---

## 7. Firestore writes

Direct Firestore writes from the legacy client (excluding
Cloud-Function-mediated writes):

| Path                             | Legacy site                                               | Rewrite equivalent                                       | Status             |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| `users/{uid}` create             | `Register.js` via `AuthUser.js:registerUser`              | `RegisterUser` use case + `FirebaseAuthRepository`       | ✅                 |
| `users/{uid}` update             | `UserProfile.js` etc.                                     | `UpdateUser` use cases                                   | ✅                 |
| `users/{uid}.location`           | `gpsLocation.js:updateUserLocation`                       | `LocationRepository.setLocation`                         | ✅                 |
| `users/{uid}.pushToken`          | `AppContent.js` after `registerForPushNotificationsAsync` | `usePushTokenRegistration` (Phase 9)                     | ✅                 |
| `trips/{tripId}` create          | `Trip.js:createTrip`                                      | `CreateRide` use case → `FirestoreRideRepository.create` | ✅                 |
| `trips/{tripId}` update          | `Trip.js:dispatchTrip`, `startTrip`, etc.                 | Cloud Function callables / direct repo writes            | ✅                 |
| `trips/{tripId}/events`          | `Trip.js:addTripEvent`                                    | `RideRepository.appendEvent` → `FirestoreRideRepository` | ✅                 |
| `trips/{tripId}/messages`        | `ChatModal.js` GiftedChat send                            | ❌ not implemented                                       | ❌ blocked on §3.4 |
| `trips/{tripId}/payments`        | written by Cloud Functions / Stripe webhooks              | read-only on client                                      | ✅                 |
| `vehicles/{vin}` create / update | `Vehicle.js`                                              | `FirestoreVehicleRepository`                             | ✅                 |

---

## 8. Phase 10.x turn plan (prioritized — v2)

Turn 1 closed 2026-05-18 (this audit's verification pass + the
one-line `audio` UIBackgroundMode restoration). Remaining turns:

| #     | Turn                                                                                                                                                                                                                                                                                                                                                | Driver                                | Size                    | Blocked by                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~1~~ | ~~**Verification pass**~~                                                                                                                                                                                                                                                                                                                           | Risk reduction                        | small (1d)              | ✅ **CLOSED 2026-05-18** (this doc v2 + `app.config.ts` audio fix)                                                                           |
| ~~2~~ | ~~**Firebase iOS SDK pin** (§4 `withFirebaseSdkVersion`) — port the legacy plugin OR inline `$FirebaseSDKVersion = '12.12.0'` into `withFirebasePodfileFix.js`. iOS release-mode Cloud-Function-callable crash fix.~~                                                                                                                               | ~~**Production blocker — iOS**~~      | ~~tiny (½d)~~           | ✅ **CLOSED 2026-05-18** (Path b inline; see `docs/PHASE_10_TURN_2.md`)                                                                      |
| ~~3~~ | ~~**Material Components Android theme** (§4 `withMaterialTheme`) — port the plugin so Stripe `CardForm` renders on Android without crash.~~                                                                                                                                                                                                         | ~~**Production blocker — Android**~~  | ~~tiny (½d)~~           | ✅ **CLOSED 2026-05-18** (Path a port; see `docs/PHASE_10_TURN_3.md`)                                                                        |
| ~~4~~ | ~~**`processing` UIBackgroundMode reconciliation** (§4) — either re-add `processing` OR drop `com.transistorsoft.customtask` from `BGTaskSchedulerPermittedIdentifiers`. Pick after a one-line Transistor v5 docs check.~~                                                                                                                          | ~~Latent BGTaskScheduler misconfig~~  | ~~tiny (½d)~~           | ✅ **CLOSED 2026-05-18** (Path B drop; see `docs/PHASE_10_TURN_4.md`)                                                                        |
| ~~5~~ | ~~**Rider live ETA** (§3.5) — NavSdk telemetry → Firestore → rider subscription. Replaces legacy `distanceTrackingService` Distance Matrix polling with SDK-driven values.~~                                                                                                                                                                        | ~~User-visible regression vs legacy~~ | ~~small-medium (1-2d)~~ | ✅ **CLOSED 2026-05-18** (NavSdk telemetry pipeline; see `docs/PHASE_10_TURN_5.md`)                                                          |
| ~~6~~ | ~~**Activity tab — rider + driver** (§3.3) — placeholder → real screen with recent-trips composition + per-trip detail navigation (where the §3.6 per-trip `TransactionHistory` lives).~~                                                                                                                                                           | ~~Largest user-facing gap~~           | ~~large (3-5d)~~        | ✅ **CLOSED 2026-05-19** (paginated recent-rides + role-agnostic TripDetailScreen + TripPaymentsList fold-in; see `docs/PHASE_10_TURN_6.md`) |
| ~~7~~ | ~~**Scheduled rides creation UI** (§3.2) — port `ScheduleDatetimePicker` + `RideScheduledConfirmation` + `ObserveScheduledRides`. Also adds `@react-native-community/datetimepicker` plugin to `app.config.ts`.~~                                                                                                                                   | ~~Existing feature regression risk~~  | ~~medium (2-3d)~~       | ✅ **CLOSED 2026-05-19** (creation UI + listing + nav + native config; see `docs/PHASE_10_TURN_7.md`)                                        |
| 8     | **Chat** (§3.4) — port `ChatModal` + `react-native-gifted-chat` integration + `ChatRepository` + foreground-banner suppression for open chats.                                                                                                                                                                                                      | Existing feature regression risk      | medium (2-3d)           | —                                                                                                                                            |
| 9     | **Pre-cutover BG-geolocation test regression fix** (Turn 1 §11 newly-discovered) — resolve the 21 jest failures in `BackgroundGeolocationClient.test.ts` so `npm run verify` is green at cutover SHA. Either gate the `__DEV__` short-circuit behind a test-injection seam or update the assertions to reflect the `__DEV__===true` execution path. | Unblocks cutover plan §3.1 gate       | small (1d)              | —                                                                                                                                            |
| 10    | **Audit v3 + sign-off** — re-run audit; confirm all rows ✅ / 🟡 / explicitly de-scoped; flip cutover plan §0 gate to "cleared."                                                                                                                                                                                                                    | Closes Phase 10 cutover prep          | small (½d)              | (2)-(9)                                                                                                                                      |

**Estimated total:** ~10-15 days of work before
[PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) §6 staged
rollout can start. Sizes preserve the v1 estimate range — Turn 1's
discovery surfaced two new "tiny" turns (Firebase + Material) and
one "small" turn (BG geolocation test fix) but those are absorbed
by §3.6 collapsing into §3.3 (one less turn) and §3.7 closing as
✅ (zero work).

Each turn should produce a `docs/PHASE_10_TURN_N.md` doc following
the existing per-turn convention (see Phase 9 turn docs as models).

---

## 9. Out of scope for this audit (deferred)

This audit covered the rewrite-codebase-vs-legacy-codebase static
inspection. The following slices were NOT audited and should be
covered separately before §6 rollout:

- **Detox E2E suite parity** — does the rewrite's E2E suite hit
  every scenario the legacy suite hits? Covered by
  PHASE_10_CUTOVER_PLAN.md §3.1 gate.
- **Real-device manual parity smoke** — covered by
  PHASE_10_CUTOVER_PLAN.md §3.2.
- **Backend code (yeride-functions + yeride-stripe-server)** —
  both backends are shared, so no parity work needed. But verify
  no client-side assumption about deployed-version-SHA has drifted.
- **Firestore index audit** — confirm rewrite-side queries use
  indexes that legacy already deployed.
- **Firestore rules audit** — same.
- **Analytics events / telemetry parity** — if legacy emits
  events the team relies on, the rewrite must emit the same shape
  on the same triggers.
- **In-app help / support flow** — if legacy has a "contact
  support" button, confirm rewrite has equivalent.

---

## 10. Newly-discovered gaps (Turn 1)

Items found while executing Turn 1's verification pass that weren't
in the v1 audit and now block or accompany cutover.

### 10.1 `BackgroundGeolocationClient` tests broken at HEAD — ❌

**Discovery:** `npm test` against HEAD `f537773` reports
**21 failed / 1647 passed** across 188/189 suites. Every failure
lives in `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`.

**Root cause:** the post-Phase-9 chore `56c273c` (bg-geolocation
4.19.4 → 5.1.1) added `if (__DEV__) return Result.ok(true);` short-
circuits to every native-method path of `BackgroundGeolocationClient`
to dodge the Android emulator `tslocationmanager:4.1.5`
`setPriority(-1)` crash. jest-expo defaults `__DEV__ === true`, so
the tests' "native SDK was called" assertions fail because the
short-circuit returns before reaching the SDK call.

**Why it matters:** cutover plan §3.1 requires `npm run verify` green
at the cutover SHA. Currently broken.

**Verdict:** ❌ — scope Turn 9 (per §8). Likely fix shape: introduce
a constructor flag `skipNativeInDev: boolean` and override it to
`false` in the relevant test setup, OR replace the short-circuit
with a dependency-injected "BG geolocation impl" seam (real / fake)
that the tests already exercise via the existing
`FakeBackgroundGeolocationClient`. Either approach restores native-
path assertions without breaking the emulator workaround.

### 10.2 NavSdk telemetry → live ETA never shipped — ✅ closed in Turn 5 (2026-05-18)

Documented under §3.5 above (now ✅). Turn 5 shipped the end-to-end
pipeline:

- `NavigationService.subscribeToTimeAndDistance` + multi-subscriber
  fan-out + `(meters, seconds)` dedup in `NavigationSdkClient`
  (mirrors the existing `subscribeToArrival` pattern). Domain layer
  exposes `NavTimeAndDistance` (adapter-stamped `timestampMs`); the
  SDK's `TimeAndDistance` type doesn't leak past the data layer.
- `TripTracking` gained nullable `distanceMeters / durationSeconds /
updatedAt`. DTO `z.preprocess` accepts BOTH the canonical flat
  shape AND the legacy nested `{distance, duration, calculatedAt}`
  shape (legacy writes win when both are present? No — flat wins,
  per the "permissive read / canonical write" convention).
- Driver-side write path lives in `useDriverMonitorViewModel`
  (Path α — VM-owned, not extending `useGpsLifecycle`). On every
  NavSdk fire OR every GPS update, the VM throttles to one
  Firestore write per 30s / 50m / 60s and writes `UserLocation`
  with `tripTracking.{distanceMeters, durationSeconds, updatedAt}`
  populated when NavSdk telemetry is < 60s old. A one-shot bypass
  on the nav-less → live transition lands the first live data
  immediately.
- Rider-side consumption in `useRideMonitorViewModel` reuses the
  existing `SubscribeToUserLocation` use case keyed off
  `ride.driver?.id`. The VM surfaces `liveDurationSeconds` /
  `liveDistanceMeters`; `DispatchedView` / `StartedView` prefer
  them with static `ride.pickup.directions` / `ride.dropoff.directions`
  fallback (same "Calculating…" UX as legacy `TripETAInfo`).
- Mapper dual-writes the canonical flat + legacy nested shapes so
  legacy yeride clients reading the shared `locations/{uid}` doc
  during cutover keep rendering ETA correctly.

Tests added: NavigationSdkClient subscribe + dedup + pre-controller

- negative coercion arms; FakeNavigationSdkClient emit + dedup +
  dispose; UserLocation validation for the three new fields;
  userLocationMapper round-trips + legacy-read + flat-wins-on-conflict
- dual-write emit; useDriverMonitorViewModel write-with-telemetry
  (dispatched + started) + throttle + terminal cleanup +
  no-telemetry GPS-only path; useRideMonitorViewModel live-value
  surface + null-when-no-driver + null-when-route-metadata-only.

See `docs/PHASE_10_TURN_5.md` for the full evidence chain.

### 10.3 Stripe Connect return-URL deep-link bridge — 🟡 polish

`useStripeConnectOnboarding.ts:109` references
`https://yeride.com/stripe-return` as the Stripe `return_url`.
For the post-onboarding `WebBrowser.openAuthSessionAsync` sheet to
auto-close, that domain must server-side 302-redirect to the env-
aware deep-link scheme (`yeride-dev://stripe-return` /
`yeride-stage://stripe-return` / `yeride://stripe-return`).
Without the bridge, the driver manually dismisses the sheet and the
`cancel`/`dismiss` branch refreshes status — the flow still works,
but the UX has an extra tap.

**Verdict:** 🟡 — folded into a pre-cutover ops checklist item:
confirm `yeride.com/stripe-return` 302-bridges to the production
deep-link scheme. Not engineering work in the rewrite repo; ops
work on the marketing-domain DNS / web server.

### 10.4 `processing` UIBackgroundMode vs `com.transistorsoft.customtask` mismatch — ✅ closed Turn 4

Documented under §4 above. At v2 the rewrite's
`BGTaskSchedulerPermittedIdentifiers` still declared
`com.transistorsoft.customtask` without the `processing`
UIBackgroundMode Apple requires for `BGProcessingTaskRequest`.

Turn 4 (2026-05-18) resolved this via **Path B — drop the
identifiers** rather than Path A — add `processing`. The decision
was driven by three lines of evidence on the post-Phase-9
v5.1.1 Transistor SDK:

1. **Binary inspection** (decisive). `strings(1)` over
   `ios/Pods/TSLocationManager.xcframework/<slice>/TSLocationManager.framework/TSLocationManager`,
   on both `ios-arm64` and `ios-arm64_x86_64-simulator` slices,
   returns zero hits for `BGTaskScheduler` / `BGProcessingTaskRequest`
   / `BGAppRefreshTaskRequest` / `registerForTaskWithIdentifier` /
   `com.transistorsoft.fetch` / `com.transistorsoft.customtask`. The
   only `bgTask` symbol present is `TSHttpService._bgTask`, an
   instance variable using the legacy
   `UIApplication.beginBackgroundTaskWithName:` API — a completely
   different OS surface from BGTaskScheduler.
2. **Source-grep** in
   `node_modules/react-native-background-geolocation/{ios,src}`
   returns zero matches for BGTaskScheduler references or for the
   two legacy task identifier strings.
3. **The iOS Expo plugin handler is a documented no-op**
   (`node_modules/react-native-background-geolocation/expo/plugin/build/iOSPlugin.js`
   returns the config unchanged with the comment "Nothing to here
   here currently"). So the `app.config.ts` whitelist was pure
   manual carryover from legacy yeride's pre-v5 SDK, not something
   the plugin re-injected.

Removing both identifiers (and the whole `BGTaskSchedulerPermittedIdentifiers`
key, since the array would otherwise be empty) avoids declaring to
the OS that the app intends to register a task it never will.
`processing` was deliberately NOT added: Apple requires it only for
`BGProcessingTaskRequest`, and the v5 SDK provably doesn't schedule
one. Adding it would have inflated the entitlement surface for no
benefit and could prompt App Store review questions about
background-processing usage.

**Verdict:** ✅ — closed in Turn 4 (2026-05-18). See
`docs/PHASE_10_TURN_4.md` for the pre-checklist outcomes, the patch
diff, and the rollback condition (if a future SDK bump
reintroduces BGTaskScheduler usage, re-add both the identifier
whitelist AND the `processing` background mode together).

---

## 11. Sign-off

Mark complete when:

- [ ] Every ❌ row has a Phase 10.x turn shipped or explicit
      de-scope decision recorded.
- [x] Every ⚠️ row has been verified and re-marked ✅ / 🟡 / ❌.
      (Closed Turn 1, 2026-05-18.)
- [ ] Every 🟡 row has been validated as acceptable diff vs legacy.
- [ ] Manual two-device smoke against `yeapp-stage` shows rider +
      driver flows reach equivalent end-states as legacy.
- [x] Audit doc v2 produced (this doc, Turn 1).
- [ ] Audit doc v3 produced after Turns 2-9 close.
- [ ] [PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) §0 gate
      flipped to "cleared."

---

**End of PHASE_10_PARITY_AUDIT.md.** Re-run on a v2 pass once
Phase 10.x turns ship.
