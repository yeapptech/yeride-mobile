# Phase 9 — Turn 2: push notifications (Expo + FCM via legacy Cloud Functions)

Phase 9 turn 1 unblocked the iOS smoke; turn 2 closes the biggest
functional gap before the legacy yeride cutover: the rewrite app now
registers Expo push tokens against Firestore on the same shape legacy
yeride uses, drives an iOS / Android-portable soft-ask UX, and routes
notification taps to the right screen via React Navigation's
`navigationRef`.

The deployed `yeride-functions/lib/notifications.js` `sendNotification`
needs zero changes: it routes Expo-wrapped tokens through Expo's API
and raw FCM tokens through the Firebase Admin SDK via
`Expo.isExpoPushToken()`. The rewrite emits Expo-wrapped tokens
exactly the same way legacy does
(`getExpoPushTokenAsync({projectId})`), so the deployed handlers find
`tripData.passenger.pushToken` / `tripData.driver.pushToken` /
`users/{uid}.pushToken` and fan out without a function-side change.

Turn 2 split into three sub-turns to keep each commit independently
verifiable:

- **2a** — domain + data plumbing for `pushToken` (no behavior change)
- **2b** — install `expo-notifications`, build the real adapter, ship
  `RegisterPushToken` use case + `usePushTokenRegistration` hook +
  soft-ask sheet, prove token writes to Firestore on real device
- **2c** — `HandleNotificationResponse` use case +
  `useNotificationResponseHandler` hook + tap routing to RideMonitor /
  RideReceipt / DriverDispatch / DriverEarnings via shared
  `navigationRef`

End-of-Turn-2 acceptance: **169 test suites / 1391 tests passing**
(+8 suites / +117 tests over Phase 9 turn 1's 161/1274). Typecheck,
lint, format, and test all green. Token registration proven on iPhone
17 simulator against `yeapp-stage` Firestore (the simulator can
register Expo tokens but doesn't deliver pushes — full delivery + tap
routing requires a physical device). Owner-side EAS project for the
rewrite linked: `yeride-next`, projectId
`adb0a788-bf99-4a60-9424-f23266127854`. **`npm run prebuild` is
required before the next iOS / Android build** so the
`expo-notifications` plugin's native config (iOS `aps-environment`
entitlement, Android FCM default-icon meta-data, `'remote-notification'`
in `UIBackgroundModes`) lands.

## What's in

### Sub-turn 2a — domain + data plumbing

#### 1. `PushToken` branded value object

`src/domain/entities/PushToken.ts` — `Brand<string, 'PushToken'>` with
a `static create(value)` factory returning
`Result<PushToken, ValidationError>`. Two on-the-wire formats accepted:

- **Expo wrapped** — matches `^ExponentPushToken\[.+\]$`. Issued by
  `Notifications.getExpoPushTokenAsync({projectId})`. This is what
  legacy yeride writes and what the rewrite's adapter emits.
- **Raw FCM / APNs** — matches `^[A-Za-z0-9:_\-/+=]+$`. Accepted
  defensively so a future swap to native tokens (e.g. for iOS
  critical alerts) doesn't need a domain-level change.

Validation rejects on length (max 1000), empty string, non-string, and
character-set failures with distinct error codes
(`push_token_too_long`, `push_token_empty`, `push_token_not_a_string`,
`push_token_invalid_format`). `PushToken.isExpoWrapped(token)` exposed
as a helper for tests + observability — though in practice the
deployed `lib/notifications.js` re-checks via `Expo.isExpoPushToken()`.

#### 2. `PushPermissionStatus` literal type

`src/domain/entities/PushPermissionStatus.ts` — `'granted' | 'denied' |
'undetermined'` 3-arm union. iOS `provisional` (delivered-quiet without
prompt) collapsed to `'granted'` at the adapter boundary so the domain
enum stays small.

#### 3. `pushToken` field on User entity + `setPushToken` helper

`src/domain/entities/User.ts` extended:

- `UserBase.pushToken: PushToken | null` (lives on the base, not
  role-specific — both riders and drivers carry tokens).
- `makeRider({pushToken?})` and `makeDriver({pushToken?})` accept the
  optional arg; default `null`.
- `setPushToken(user, pushToken, now)` — immutable update helper.
  No-op short-circuit when `user.pushToken === pushToken` (the
  `RegisterPushToken` use case relies on this so the on-launch
  registration doesn't churn `updatedAt` and invalidate user-doc
  caches when the token hasn't changed).

#### 4. UserDocSchema + userMapper round-trip

`src/data/dto/UserDoc.ts` — `pushToken: z.string().nullish()` on
`BaseUserDocSchema`. Top-level field, matches the legacy
`yeride/src/api/firebase/AuthUser.js:savePushToken` shape exactly.

`src/data/mappers/userMapper.ts` — `parsePushToken(raw, uid)` helper
runs `PushToken.create` on hydration and falls back to `null` (with a
`LOG.warn`) on shape failure rather than crashing the whole user
hydration. `toDoc` writes `String(user.pushToken)` (or `null` when
unset).

#### 5. `PushNotificationService` domain interface

`src/domain/services/PushNotificationService.ts`. 7 methods:

- `getPermissionStatus()` — read without prompting
- `requestPermissions()` — show the OS prompt
- `getCurrentToken()` — `Result<PushToken | null, NetworkError |
AuthorizationError | ValidationError>`
- `subscribeToTokenChanges(cb)` — synchronous unsubscribe
- `subscribeToNotificationResponse(cb)` — synchronous unsubscribe;
  warm-state taps only (cold-start uses the next method)
- `getLastNotificationResponse()` — read SDK-buffered cold-start tap
- `setupAndroidChannel()` — Android default channel registration;
  no-op on iOS

Plus two domain types (`NotificationData` + `NotificationResponse`)
and the `NavigationIntent` union (used by sub-turn 2c's tap-handler
use case).

#### 6. `FakePushNotificationService`

`src/shared/testing/FakePushNotificationService.ts` — programmable
in-memory implementation mirroring the real adapter 1:1. Surface
follows the project pattern (`FakeStripeServerService` /
`FakeBackgroundGeolocationClient`):

- `seedPermission`, `seedToken`, `seedLastNotificationResponse`
- `emitTokenChange`, `emitNotificationResponse`
- `failNext({method, error})` — one-shot per-method failure injection
- `spies` getter — counters for every method invocation
- `reset()` — wipe seed + spy + failure state
- Read-only introspection: `isAndroidChannelConfigured`,
  `getTokenSubscriberCount`, `getResponseSubscriberCount`

#### 7. DI container wiring

`src/presentation/di/container.ts`:

- `Container.pushNotifications: PushNotificationService` slot added
  alongside `bgGeolocation` and `navigationSdk`.
- `buildPushNotificationService()` helper. Sub-turn 2a wired the fake
  in production unconditionally (loud `LOG.warn`); sub-turn 2b
  swapped in env-aware logic (real `ExpoNotificationsAdapter` when
  `Constants.expoConfig.extra.eas.projectId` is present, fake
  otherwise).
- `makeUseCases({...pushNotifications})` threaded so the
  `RegisterPushToken` use case (sub-turn 2b) gets the dependency.
- New `usePushNotificationService()` DI hook (sibling of
  `useBackgroundGeolocation()` / `useNavigationSdk()`).

`src/shared/testing/TestContainerProvider.tsx` — optional
`pushNotifications?: FakePushNotificationService` override slot,
default-constructed otherwise.

#### 8. Snapshot VMs source pushToken from user

- `useRouteSelectViewModel.ts` — `PassengerSnapshot.pushToken` now
  reads `user.pushToken !== null ? String(user.pushToken) : null`
  (was hardcoded `null`).
- `useDriverDispatchViewModel.ts` — same on `DriverSnapshot.pushToken`.

Two new tests in `useDriverDispatchViewModel.test.tsx` covering the
populated and unregistered paths.

### Sub-turn 2b — registration + write to Firestore

#### 9. `expo-notifications` install + native config

- `expo-notifications@~55.0.22` installed.
- `app.config.ts` `plugins` block extended with the
  `expo-notifications` plugin (`mode` env-aware: `'development'` for
  dev/stage, `'production'` for production builds).
- `UIBackgroundModes` extended with `'remote-notification'` (alongside
  the existing `'location'` and `'fetch'` from Phase 7).
- `extra.eas.projectId: 'adb0a788-bf99-4a60-9424-f23266127854'`
  hardcoded — `getExpoPushTokenAsync({projectId})` reads this.
- `app.config.ts.owner: 'yeapptech'` set so the EAS project link
  resolves correctly.

**`npm run prebuild` required after these changes** so the plugin's
native config takes effect.

#### 10. Global `expo-notifications` Jest mock

`jest.setup.ts` extended with the SDK mock following the same pattern
as `react-native-background-geolocation` /
`@googlemaps/react-native-navigation-sdk`:

- Constants the adapter reads at module-load (`AndroidImportance`,
  `PermissionStatus`).
- Async stubs (`getPermissionsAsync`, `requestPermissionsAsync`,
  `getExpoPushTokenAsync`, `getDevicePushTokenAsync`,
  `setNotificationChannelAsync`, `getLastNotificationResponseAsync`)
  with happy-path defaults; tests override per-call.
- Listener registrars (`addPushTokenListener`,
  `addNotificationResponseReceivedListener`) returning
  `{remove}` Subscription.
- `__emitTokenChange`, `__emitResponse`, `__reset` test-only helpers.

#### 11. Real `ExpoNotificationsAdapter`

`src/data/services/ExpoNotificationsAdapter.ts` — implements
`PushNotificationService` against `expo-notifications`. Highlights:

- Reads EAS projectId via lazy `require('expo-constants').default
.expoConfig.extra.eas.projectId`. Returns `Result.err(NetworkError({
code: 'push_no_eas_project_id'}))` when missing.
- Maps SDK permission status to domain enum
  (`'provisional'` → `'granted'`).
- Listener-level dedup on the token-refresh path (consecutive
  identical SDK deliveries don't fan out twice).
- Single underlying SDK subscription shared across multiple domain
  subscribers — torn down when the last domain subscriber
  disconnects so we don't leak across sign-out / sign-in.
- `normalizeResponse(rawSdkEvent)` projects the SDK's
  `NotificationResponse` shape into the domain's
  `{title, body, data, receivedAt}` form. Survives malformed input
  (returns nulls + empty data instead of crashing).
- Error mapping: SDK throws on token mint → `NetworkError` (common on
  simulators); permission throws → `AuthorizationError`; SDK returns
  malformed token string → `ValidationError`.

25 unit tests against the global mock cover every path.

#### 12. `RegisterPushToken` use case

`src/app/usecases/notifications/RegisterPushToken.ts`. Idempotent. Auth-
gated (caller must be signed in; reads `currentUserId` from the auth
repo). Returns a structured `RegisterPushTokenOutcome` with
`{token, written, skippedReason}` so the caller can distinguish:

- `'no_change'` — `user.pushToken === currentToken`; skip the write.
- `'no_token'` — SDK has no token (permission denied, simulator
  without APNs).
- `null` skippedReason → `written === true` → token was persisted.

9 unit tests covering happy path, idempotency, drivers, missing user,
and bubbled errors.

#### 13. `useNotificationPermissionUiStore`

`src/presentation/stores/useNotificationPermissionUiStore.ts` —
Zustand UI store with two fields:

- `permissionStatus: PushPermissionStatus` mirrored from the SDK
- `softDismissedAt: number | null` — timestamp when the user tapped
  "Not now" on the soft-ask sheet (null = not dismissed this session)

Two selector hooks (`useNotificationPermissionStatus`,
`useNotificationSoftDismissedAt`). Reset on sign-out.

#### 14. `usePushTokenRegistration(user)` hook

`src/presentation/hooks/usePushTokenRegistration.ts` — AppContent-only
mount. Three effects:

1. **One-shot init** — `setupAndroidChannel()` + read permission status
   into the UI store. `useRef`-guarded so hot-reload doesn't re-init.
2. **Token registration on grant** — when `user` is set AND permission
   is `'granted'`, fire `RegisterPushToken`. The use case's idempotency
   check is the throttle.
3. **Token-refresh subscription** — single SDK listener for the
   lifetime of the hook. Each refresh re-fires the use case.

Returns `{promptForPermission}` for the soft-ask sheet to call.

8 unit tests + new `usePushNotificationService()` DI hook in
`ContainerProvider.tsx`.

#### 15. `NotificationPermissionSheet`

`src/presentation/components/notifications/NotificationPermissionSheet.tsx`
— Modal-based sheet (mirror of `CancelReasonSheet`). Title, body, two
CTAs:

- **Enable notifications** — calls `onEnable` (which fires the OS
  prompt via `promptForPermission`).
- **Not now** — calls `onDismiss` (which sets the soft-dismiss flag).

`isSubmitting` prevents double-tap on Enable. Backdrop tap +
Android back also dismiss. Edge-to-edge-safe via
`statusBarTranslucent` + `navigationBarTranslucent`. 5 unit tests.

#### 16. AppContent integration

`src/presentation/AppContent.tsx`:

- Mounts `usePushTokenRegistration(userForPush)` once, where
  `userForPush = enabled ? user : null` — same registration-complete
  gate as `useGpsLifecycle`.
- Renders `<NotificationPermissionSheet/>` conditioned on
  `enabled && permissionStatus === 'undetermined' && softDismissedAt === null`.
- Sign-out cleanup extended: `useNotificationPermissionUiStore.reset()`
  alongside the existing `useGpsStore.reset()`.

### Sub-turn 2c — tap routing

#### 17. `HandleNotificationResponse` use case

`src/app/usecases/notifications/HandleNotificationResponse.ts` — pure
function from `NotificationResponse` to `NavigationIntent`. Routing
table:

| `data.type`                                                                                                    | Target                 | Audience |
| -------------------------------------------------------------------------------------------------------------- | ---------------------- | -------- |
| `awaiting_driver`, `scheduled`                                                                                 | `'driver_dispatch'`    | driver   |
| `driver_dispatched`, `driver_pickup_arrived`, `payment_failed`, `scheduled_driver_accepted`, `pickup_reminder` | `'rider_ride_monitor'` | rider    |
| `payment_succeeded`                                                                                            | `'rider_ride_receipt'` | rider    |
| `tip_succeeded`                                                                                                | `'driver_earnings'`    | driver   |
| anything else                                                                                                  | `'unknown'` (no-op)    | -        |

Validates `data.type` (non-empty string) and, for the types that need
it, `data.tripId` via `RideId.create`. Synchronous (no IO) so the
hook can dispatch in the SDK's tap-handler chain without an `await`.
19 unit tests covering every branch + every validation arm.

Wired into `Container.useCases.handleNotificationResponse`.

#### 18. `navigationRef` shared module

`src/presentation/navigation/navigationRef.ts` — wraps
`createNavigationContainerRef()` with a fallback-object pattern. Why
the fallback: many view-model test files mock
`@react-navigation/native` per-test via
`jest.mock('@react-navigation/native', () => ({useNavigation: ...}))`,
which omits `createNavigationContainerRef` from the module exports.
Calling it at module-load would crash every file that imports the
`@presentation/hooks` barrel transitively. The fallback is a real
plain object (no Proxy) so `jest.spyOn(navigationRef, 'isReady')`
works correctly in the tap-routing hook tests.

Production always hits the `typeof === 'function'` branch and uses
the real React Navigation ref.

`<NavigationContainer ref={navigationRef}/>` wired in `App.tsx`.

#### 19. `useNotificationResponseHandler` hook

`src/presentation/hooks/useNotificationResponseHandler.ts` —
AppContent-only mount. **Not gated on registration** — taps should
always route, even before registration completes (a deep-link from a
prior tap should still land the user on the right screen).

Two effects:

1. **Warm-state subscription** — `pushService.subscribeToNotificationResponse`
   for taps that arrive while the JS runtime is alive.
2. **Cold-start path** — `useRef`-guarded one-shot call to
   `pushService.getLastNotificationResponse()` for the SDK's buffered
   launching tap.

Each tap goes through `HandleNotificationResponse` → `dispatchIntent`
→ `navigationRef.dispatch(navigateAction(name, params))`. The
hand-rolled `navigateAction` builds the NAVIGATE action shape inline
because `CommonActions.navigate` returns `{payload: ResetState |
undefined}` which conflicts with `dispatch`'s
`exactOptionalPropertyTypes`-narrowed `{payload?: object}` arg type.

`waitForNavigationReady(3_000)` polls `navigationRef.isReady()` at
100ms intervals before dispatch — covers the cold-start race where
the SDK delivers a buffered tap before the navigator tree has
mounted its first screen.

Routing details:

- `rider_ride_monitor` → `dispatch(NAVIGATE 'RideMonitor', {rideId})`
- `rider_ride_receipt` → `dispatch(NAVIGATE 'RideReceipt', {rideId})`
- `driver_dispatch` → `dispatch(NAVIGATE 'DriverDispatch', {rideId})`
- `driver_earnings` → `dispatch(NAVIGATE 'DriverTabs', {screen: 'Earnings'})`
- `unknown` → no-op (logged at debug)

10 unit tests covering warm-state routing, cold-start, malformed
payload survival, and the cold-start race timeout.

#### 20. AppContent integration

`useNotificationResponseHandler()` mounted as a sibling of
`usePushTokenRegistration()` in AppContent. No conditional gating.

## Why this turn doesn't include

- **Cloud Function changes.** The deployed `lib/notifications.js`'s
  `sendNotification` is shape-agnostic via `Expo.isExpoPushToken()`,
  so emitting Expo-wrapped tokens stays compatible with both legacy
  yeride and the rewrite without server-side coordination.
- **In-app banner / inbox.** Out of scope for this phase.
- **Notification action buttons** (e.g. inline Accept / Decline on a
  dispatched-ride notification). Higher implementation cost; not on
  the cutover critical path.
- **Push-token cleanup on sign-out.** Currently the worst case is
  User A signs out, User B signs in on the same device, B's token
  registration overwrites A's pointer on the device. Self-correcting
  on B's first registration. Lower-priority hygiene; deferred to a
  Phase 9 polish turn.
- **iOS critical alerts entitlement.** Domain enum collapses
  `'provisional'` to `'granted'`; expanding to support critical
  alerts would touch every consuming `switch`. Defer.
- **Re-architecture of the existing notification handlers.** Sub-turn
  2c smoked tap routing against the deployed handlers as-is.
- **Geofence-derived local notifications** (the legacy
  `scheduleGeofenceNotification` path). Phase 7's geofence pipeline
  drives in-app banners, not OS notifications — separate path.

## Risks surfaced (still Phase 9 scope)

### `npm run prebuild` required for native config to take effect

The `expo-notifications` plugin's iOS aps-environment entitlement,
the Android FCM `default_notification_icon` /
`default_notification_color` meta-data, and the
`'remote-notification'` `UIBackgroundModes` entry only land via
`expo prebuild`. Without it, the dev-client app boots but
`getExpoPushTokenAsync` fails at runtime because the iOS push
entitlement isn't present.

Sequence:

1. `npm run prebuild` — applies the plugin's config + the
   `withGoogleMapsApiKey` / `withNavigationSdk` / etc. mods.
2. `(cd ios && pod install)` — picks up any new pods (the
   `expo-notifications` pod is auto-linked, no manual entry needed).
3. `npm run ios` / `npm run android` — should boot with the new
   entitlement in place.

### Token rotation during a long-lived session

If FCM rotates a token mid-session, the token-refresh subscription
fires `RegisterPushToken` again and the user doc updates. The
`PassengerSnapshot.pushToken` baked into in-flight trips at
trip-creation time does NOT update retroactively — the legacy app
has the same limitation. Trips created AFTER the rotation pick up
the new token. Acceptable for Phase 9.

### Boundaries rule warnings (still Phase 9 turn 1 scope)

`eslint-plugin-boundaries` continues to emit informational warnings
about the deprecated `boundaries/element-types` rule name. Lint still
passes. Tracked for a future cleanup turn.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` +
`npm run test` all green. **169 test suites / 1391 tests** (+8 suites
/ +117 tests over Phase 9 turn 1's 161/1274 baseline).

End-of-Turn-2 acceptance criteria, all met:

1. ✅ `pushToken` plumbed through User entity, UserDoc schema, and
   userMapper — round-trip preserves the field.
2. ✅ `PushToken` branded value object validates Expo wrapped + raw
   FCM/APNs shapes.
3. ✅ `PushNotificationService` domain interface defined; real
   `ExpoNotificationsAdapter` implements it; `FakePushNotificationService`
   mirrors it 1:1 for tests.
4. ✅ `RegisterPushToken` use case writes the token to
   `users/{uid}.pushToken` idempotently.
5. ✅ `usePushTokenRegistration` hook drives the SDK lifecycle from
   AppContent.
6. ✅ Soft-ask sheet shown when permission is `'undetermined'` and
   user is fully registered + not soft-dismissed this session.
7. ✅ EAS project `yeride-next` linked, `extra.eas.projectId` wired
   into `app.config.ts`.
8. ✅ Real-device smoke (iPhone 17 sim) confirmed token writes to
   `yeapp-stage` Firestore (`users/XnCnxmBPICRK0hfyn557FzodOyt1.pushToken`
   populated within seconds of sign-in; Container log line confirms
   `using ExpoNotificationsAdapter`).
9. ✅ `HandleNotificationResponse` use case maps every Cloud Function
   `data.type` value to the right `NavigationIntent` target.
10. ✅ `useNotificationResponseHandler` hook routes warm-state +
    cold-start taps via the shared `navigationRef`.
11. ✅ `docs/PHASE_9_TURN_2.md` written (this file).
12. ✅ `CLAUDE.md` updated to reflect Phase 9 turn 2 close.
13. ✅ `npm run verify` green at the end of the turn.

Manual two-device smoke (legacy app drives a ride against the
rewrite-app driver, and vice versa) is still pending — requires two
physical devices since iOS sim doesn't deliver pushes. Logged for the
user's local validation.

## Files added / touched this turn

**Added (sub-turn 2a):**

- `src/domain/entities/PushToken.ts` + tests (9)
- `src/domain/entities/PushPermissionStatus.ts`
- `src/domain/services/PushNotificationService.ts`
- `src/shared/testing/FakePushNotificationService.ts` + tests (13)

**Added (sub-turn 2b):**

- `src/data/services/ExpoNotificationsAdapter.ts` + tests (25)
- `src/app/usecases/notifications/RegisterPushToken.ts` + tests (9)
- `src/presentation/hooks/usePushTokenRegistration.ts` + tests (8)
- `src/presentation/stores/useNotificationPermissionUiStore.ts`
- `src/presentation/components/notifications/NotificationPermissionSheet.tsx`
  - tests (5)

**Added (sub-turn 2c):**

- `src/app/usecases/notifications/HandleNotificationResponse.ts` +
  tests (19)
- `src/presentation/hooks/useNotificationResponseHandler.ts` + tests
  (10)
- `src/presentation/navigation/navigationRef.ts`
- `docs/PHASE_9_TURN_2.md` — this file

**Touched:**

- `app.config.ts` — `expo-notifications` plugin block, `'remote-notification'`
  background mode, `extra.eas.projectId`, `owner: 'yeapptech'`
- `jest.setup.ts` — global `expo-notifications` mock
- `package.json` — `expo-notifications` dependency
- `src/domain/entities/User.ts` — `pushToken` on `UserBase`, `setPushToken`
  helper, factory threading
- `src/domain/services/index.ts` — barrel re-exports for new types
- `src/data/dto/UserDoc.ts` — `pushToken` field
- `src/data/mappers/userMapper.ts` — `parsePushToken` round-trip
- `src/presentation/di/container.ts` — `pushNotifications` slot,
  `buildPushNotificationService` env-aware builder, `registerPushToken`
  - `handleNotificationResponse` use case wiring
- `src/presentation/di/ContainerProvider.tsx` — new
  `usePushNotificationService()` DI hook
- `src/presentation/di/index.ts` — barrel re-exports
- `src/shared/testing/TestContainerProvider.tsx` — `pushNotifications?`
  override slot
- `src/shared/testing/index.ts` — barrel re-exports
- `src/presentation/stores/index.ts` — barrel re-exports
- `src/presentation/hooks/index.ts` — barrel re-exports
- `src/presentation/AppContent.tsx` — hook mounts + sheet render +
  sign-out cleanup
- `src/presentation/App.tsx` — `<NavigationContainer ref={navigationRef}/>`
- `src/presentation/features/rider/view-models/useRouteSelectViewModel.ts`
  — `pushToken` sourced from user
- `src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts`
  — same on driver snapshot
- `src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx`
  — new tests for snapshot-pushToken population
- `src/data/mappers/__tests__/userMapper.test.ts` — round-trip tests
  for the new field
- `src/domain/entities/__tests__/User.test.ts` — `setPushToken` +
  factory-default tests

## Phase 9 progress

| Turn | Scope                                                                               | Tests delta            | Status |
| ---- | ----------------------------------------------------------------------------------- | ---------------------- | ------ |
| 1    | iOS Apple Maps Fabric escape — flip `<Map/>` to `PROVIDER_GOOGLE` on both platforms | +1 suite / +6 tests    | ✅     |
| 2    | Push notifications — Expo registration + tap routing                                | +8 suites / +117 tests | ✅     |
| 3    | Crashlytics integration                                                             |                        | Next   |
| 4-6  | Polish bundle (DriverNavigation buttons, SDK telemetry, cleanup grab-bag)           |                        |        |

Phase 9 turn 3 (Crashlytics) is next.
