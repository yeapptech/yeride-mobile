```markdown
You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 8 just
closed** (commit `d2a67b4`, May 1 2026): the full driver-side
Google Navigation SDK integration shipped end-to-end across three
turns and was driven through a real two-device manual smoke
(iPhone 17 sim + Pixel 10 Pro emulator against `yeapp-stage`
Firestore). End-of-Phase-8 acceptance: 160 suites / 1268 tests
passing; typecheck, lint, format, test all green. The driver
navigation flow is operational against real `<NavigationView/>`
turn-by-turn guidance.

Your job this session is **Phase 9 — push notifications +
Crashlytics + polish**. Phase 9 is the catch-all polish phase
between Phase 8's nav-SDK integration and Phase 10's legacy
yeride cutover. It collects everything that surfaced as
"deferred to Phase 9" or "Phase 9 follow-up" across Phases 3-8,
plus the two large new-scope features (push notifications and
Crashlytics).

Because Phase 9 has wide scope, plan it as multiple turns. The
proposed turn breakdown below is ordering by smoke-criticality —
feel free to reorder if a different sequence makes sense, but
the iOS Apple Maps fix is highest priority because it unblocks
the iOS smoke for any future phase that needs to drive a rider
flow on iOS.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state. The Phase 9 row
   in the second phase table reads "Push notifications +
   Crashlytics + polish (incl. iOS Apple Maps fix) — Next".
2. `docs/PHASE_8_TURN_3.md` — close-of-Phase-8 record. The
   "Risks surfaced (Phase 9 scope)" section lists three concrete
   items that need landing.
3. `docs/PHASE_8_KICKOFF.md` — original Phase 8 scope. The "out"
   list at the bottom enumerates several items deferred to
   Phase 9: floating mute / chat / exit buttons inside
   DriverNavigation, `onRouteChanged` / `onTrafficUpdated`
   listeners, Distance Matrix bypass + ETA refinement.
4. Legacy `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` for
   any push-notification + Crashlytics integration history. The
   legacy app uses Expo's push token + Firebase Cloud Messaging
   (FCM) — same pattern to port. Crashlytics integration there
   is via `@react-native-firebase/crashlytics`.
5. `src/presentation/components/map/Map.tsx` — the iOS Apple
   Maps regression originates here (`provider={Platform.OS ===
   'ios' ? undefined : 'google'}`). The fix candidate is
   documented in PHASE_8_TURN_3.md §"Risks surfaced".
6. `plugins/withNavigationSdk.js` — the rewrite's Expo plugin.
   The iOS Apple Maps fix likely needs a podspec patch addition
   here (add `react-native-maps/Google` subspec).

## Starting state — what's already built

- All 160 test suites / 1268 tests green at HEAD (`d2a67b4`).
- Phase 8 driver navigation surface fully wired and proven
  end-to-end on Android.
- iOS device build boots through to home screens but
  `<RNMapsMapView>` placeholder appears on every screen using
  `<Map/>` (the regression to fix this phase).
- Three Phase-3 latent bugs caught + patched in Phase 8 turn 3
  (cancelTrip wire format, RideDoc legacy cancel shape,
  useCurrentLocation fallback). Test suite + smoke confirm the
  fixes work end-to-end against real Firebase + Cloud Functions.
- The rewrite's existing `pushToken` plumbing (passenger snapshot
  + driver snapshot already carry `pushToken: string | null`),
  but no actual notification delivery wired yet.
- Crashlytics: not integrated. `@react-native-firebase/crashlytics`
  is not in the dep set.

## Proposed turn breakdown (re-order if needed)

| Turn | Scope | Priority | Estimated tests |
| ---- | ----- | -------- | --------------- |
| 1 | iOS Apple Maps Fabric fix (`RNMapsMapView` placeholder) | **High** — unblocks iOS smoke | +2 to +4 tests |
| 2 | Push notifications: register + deliver via FCM/APNs | High — operational gap | +8 to +12 tests |
| 3 | Crashlytics integration | Medium — observability gap | +4 to +6 tests |
| 4 | DriverNavigation polish: mute / chat / exit buttons | Low — UX polish | +6 to +10 tests |
| 5 | SDK telemetry listeners: `onRouteChanged`, `onTrafficUpdated` | Low — Distance Matrix bypass | +4 to +8 tests |
| 6 | Cleanup grab-bag (require-cycle, double-write, brand badges) | Low — tech debt | +2 to +6 tests |

Open question: turns 4-6 could collapse into one "polish"
turn if the scope per item is small enough. Decide that as you
go — the kickoff for each turn determines its own boundary.

## Pre-Phase-9 manual checklist (Turn 1)

Before kicking off Turn 1's iOS Apple Maps fix, surface in the
first message back if these aren't already done:

1. **Confirm legacy yeride's iOS Maps configuration.** The
   legacy app uses Google Maps on iOS — verify by checking
   `/Users/papagallo/yeapptech/dev/yeride/Map.js` or wherever
   the legacy app mounts `<MapView>`. Does it set
   `provider={PROVIDER_GOOGLE}` on iOS? That's the legacy parity
   target.

2. **Confirm `react-native-maps/Google` subspec compatibility
   with the Nav SDK's `GoogleMaps 10.7.0` pin.** The rewrite's
   `withNavigationSdkIos` plugin patches the
   `react-native-google-maps.podspec` to align GoogleMaps to
   10.7.0 — adding the subspec to the Podfile will pull this
   patched podspec, so version conflicts shouldn't happen, but
   verify by reading `node_modules/react-native-maps/react-
   native-google-maps.podspec` and the Nav SDK's
   `GoogleNavigation.podspec` to confirm matching transitive
   versions.

3. **For Turn 2 (push notifications):** Confirm Firebase
   Console push notification setup is complete for both iOS
   (APNs auth key uploaded to Firebase) and Android (FCM
   server key). Without those, the push-token registration
   succeeds but delivery silently drops.

## Scope per turn (in / out)

### Turn 1 — iOS Apple Maps fix

**In:**

- Add `pod 'react-native-maps/Google', :path =>
  '../node_modules/react-native-maps'` to the Podfile via the
  `withNavigationSdkPodfile` plugin patch (or a new sibling
  plugin if appropriate).
- Change `Map.tsx` to use `provider={PROVIDER_GOOGLE}` on iOS
  too (matches legacy yeride parity).
- `npm run prebuild` clean. `pod install` should resolve the
  new subspec without conflicts (the podspec is already patched
  by `withNavigationSdkIos` to align GoogleMaps 10.7.0).
- `npm run ios` — verify the `<RNMapsMapView>` placeholder is
  gone and Apple's `RNMapsMapView` is replaced by Google's
  `AIRGoogleMap` (different view manager, codegen-registered
  separately).
- Manual smoke on iOS rider: RouteSearch → RouteSelect → request
  → confirm map renders with polylines and markers.
- Add a regression test: render `<Map/>` on iOS in a test env
  and assert it doesn't fall through to the unimplemented
  placeholder.

**Out:**

- Switching ALL maps to a custom branded marker style. That's a
  separate design polish item.
- Migrating off `react-native-maps` entirely. The Nav SDK has
  its own `<NavigationView/>` for the navigation surface, but
  RiderHome / RouteSelect / RideMonitor / DriverHome /
  DriverMonitor still use `<MapView>`.

### Turn 2 — Push notifications

**In:**

- Wire the existing `pushToken` plumbing through to a real token
  delivery path: `expo-notifications` for cross-platform token
  registration, FCM/APNs configured in Firebase Console.
- Push-token write to `users/{uid}.pushToken` on app start (after
  auth resolves and permission is granted).
- Token refresh handler (FCM rotates tokens periodically).
- Permission request UX: a soft-ask before the system prompt
  (legacy parity).
- Cloud Function or Firestore-trigger that fires push messages
  on relevant trip events: ride dispatched (rider notification),
  ride accepted (rider), driver arrived at pickup (rider), trip
  completed (rider).

**Out:**

- In-app notification UI / banner / inbox. Phase 10 cleanup or
  later.
- iOS critical alerts entitlement.
- Notification action buttons (e.g., "Accept" / "Decline" inline
  on the dispatched-ride notification).
- Push-token cleanup on sign-out (good hygiene but lower
  priority — the token re-registers on next sign-in).

### Turn 3 — Crashlytics

**In:**

- `@react-native-firebase/crashlytics` to dep set.
- Native config plumbing (the package's own Expo plugin handles
  most of it).
- App-startup `crashlytics().setCrashlyticsCollectionEnabled(true)`
  in production builds; disabled in dev.
- User identifier set after auth via `setUserId(uid)`.
- Custom keys for active service area + driver vehicle id (helps
  triage by population).
- Logger transport to `crashlytics().log(...)` for ERROR-level
  log lines so the most recent N logs land in any crash report.
- Test that `setUserId` is called after auth resolves.

**Out:**

- Performance Monitoring (separate package, separate effort).
- Custom non-fatal error reporting beyond what the logger
  transport surfaces.

### Turn 4 — DriverNavigation polish

**In:**

- Floating mute button on `DriverNavigationScreen` — toggles
  voice guidance on/off via the SDK's
  `setSpeechSynthesizerVolume(0)` / `(1)` (or equivalent —
  check the SDK API).
- Floating chat button — opens a rider-driver chat surface
  (legacy yeride has this; check `legacy/src/driver/screens/
  DriverChat.js` or similar for the pattern).
- Floating exit button — alternative path to "End Navigation"
  (the bottom-pinned CTA may be hard to reach during driving).

**Out:**

- Brand new chat backend. Use whatever the legacy yeride uses
  if it's available.
- Multi-tap-to-confirm on the exit (one tap is enough).

### Turn 5 — SDK telemetry listeners

**In:**

- `onRouteChanged` listener in `useDriverNavigationViewModel` —
  pipes ETA updates back to DriverMonitor.
- `onTrafficUpdated` listener — same, traffic-segmented ETA.
- `setOnRemainingTimeOrDistanceChanged` — every-minute ETA
  refresh on the rider's RideMonitor.
- Removes the Distance Matrix bypass — currently the rewrite
  may use the Routes API or Distance Matrix for ETA. SDK
  telemetry is more accurate during an active session.

**Out:**

- Driving-mode-aware ETA (e.g., adjusting for fatigue / breaks).
- Multi-leg ETAs.

### Turn 6 — Cleanup grab-bag

**In:**

- Resolve the require-cycle warning between
  `presentation/hooks/index.ts` and
  `presentation/queries/ride.queries.ts`. Probably move
  `useActiveRideForGeofence` out of `hooks/index.ts` or break
  the back-link via a separate barrel.
- Remove the documented double-write in
  `useDriverMonitorViewModel.ts` lines 218-248
  (`lastWrittenCoordsRef`-deduped foreground push that
  overlaps with `useGpsLifecycle`'s per-delivery write).
- Photo brand badges for Wallet (deferred from Phase 6 turn 3 —
  Visa / Mastercard / Amex glyph assets in WalletCardRow).
- Onboarding runbook entry for the Android emulator FLP
  single-point quirk (`adb emu geo fix` workaround).
- Geofence-exit warning UI polish (Phase 7 turn 3 left it
  functional but not branded).

**Out:**

- Anything not on this list. Keep grab-bag turns from sprawling.

## Suggested approach

Ordered for high-ROI first:

1. Turn 1 (iOS Apple Maps fix) — single-day turn, unblocks the
   iOS smoke for everything that follows.
2. Turn 2 (Push notifications) — biggest functional gap; legacy
   parity needed for a real cutover.
3. Turn 3 (Crashlytics) — observability before cutover is
   table-stakes.
4. Turn 4 OR collapse Turns 4-6 into a single "polish" turn if
   the scope per item is small.

After the iOS map fix lands, the manual smoke flow can be run
on iOS too — useful when scope-testing push notifications since
APNs is iOS-only.

## Risks + mitigations

- **iOS Apple Maps fix may not fully resolve the regression.**
  Adding the `react-native-maps/Google` subspec brings in the
  Google Maps view manager (`AIRGoogleMap`) — but if the actual
  root cause is something else (Fabric codegen issue, podspec
  alignment, etc.), the placeholder may persist. Have a
  fallback: change `provider={'google'}` and verify Google view
  manager IS registered (codegen output for `AIRGoogleMap`
  should be present in `node_modules/react-native-maps`'s build
  artifacts post-prebuild).

- **Push notifications cross-platform parity.** APNs and FCM
  have different token formats and delivery semantics.
  expo-notifications papers over most of this, but iOS critical
  alerts, Android notification channels, and background-handler
  semantics still differ. Test both platforms.

- **Crashlytics dSYM upload pipeline.** Production builds need
  dSYMs uploaded to Firebase for symbolicated stack traces. The
  Crashlytics plugin handles this for EAS builds but local
  builds may need manual upload.

- **DriverNavigation floating buttons may interact with the SDK's
  own UI.** The SDK renders its own header / bottom panel inside
  `<NavigationView/>`. Adding floating buttons over that could
  collide with the SDK's controls (zoom, recenter, etc.). Test
  carefully — may need to position above the SDK's bottom panel.

- **`onRouteChanged` / `onTrafficUpdated` may fire often.**
  Throttle / debounce listeners to avoid TanStack Query thrash
  on the rider's RideMonitor. Legacy yeride has telemetry on
  this — check rate limits.

## Acceptance for end of Phase 9

Per-turn acceptance is its own kickoff doc. Phase-9-close
acceptance:

- iOS device-build smoke: full end-to-end driver navigation flow
  works on iOS sim too (after Turn 1 fix), with the same shape
  as the Android smoke that closed Phase 8.
- Push notifications operational on both platforms: rider gets
  notified when their ride is dispatched, accepted, etc.
- Crashlytics live: a forced crash in dev appears in the
  Firebase Console (with `setCrashlyticsCollectionEnabled(true)`
  toggled on for the test).
- DriverNavigation has the three legacy-parity floating buttons
  (mute, chat, exit) — assuming Turn 4 lands.
- ETA on the rider's RideMonitor refreshes from SDK telemetry
  during an active driver session — assuming Turn 5 lands.
- Test suite still green; net delta likely +20 to +50 tests
  across the whole phase.
- `CLAUDE.md` updated: Phase 9 row → all turns ✅; Phase 10 →
  Next.
- `docs/PHASE_9_TURN_<n>.md` per turn + final Phase-9-close
  summary.
- `npm run verify` green at the end of every turn.

## Conventions (non-negotiable — same as Phases 3-8)

- **`Result.ok` / `Result.err`** for all expected failures.
- **Synchronous unsubscribe / cleanup** on all subscriptions.
- **No `console.*` outside the logger** — use `LOG.extend('NAME')`.
- **Domain interfaces stay in `domain/`**, data layer concrete
  in `data/`, presentation hooks in `presentation/hooks` or
  `presentation/features/<area>`.
- **No data-layer imports from domain.** boundaries-rule
  exceptions only for legitimate composition-root files
  (`presentation/di/container.ts`, the SDK seam hooks).
- **TanStack Query owns server state; Zustand owns UI state.**
- **Tests against in-memory fakes**; real adapters tested
  separately if at all.
- **Status-router pattern** for new screens that branch on a
  domain enum.
- **`Run npm run verify`** before committing.
- **Use the sandbox `GIT_INDEX_FILE` plumbing pattern** for
  committing from the agent if needed (memory note —
  virtiofs blocks plain `git commit`'s 2nd invocation in
  the sandbox).

## Start with

Read `CLAUDE.md` then `docs/PHASE_8_TURN_3.md` to ground
yourself in what just shipped. Confirm with the user which turn
they want to start with (default: Turn 1 — iOS Apple Maps fix
unblocks the iOS smoke and is single-session in scope). Then
propose the exact step-by-step plan for that turn as a numbered
punch list and wait for confirmation before kicking off.

Tip: don't try to do all of Phase 9 in one session. Scope each
turn tightly — the previous phases averaged 3-5 turns over
multiple sessions. Phase 9's scope is wide enough that 5-6
turns is realistic.
```
