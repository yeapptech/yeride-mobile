# Phase 8 — Turn 3 kickoff: device-build smoke + polish + Phase 8 close

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 8 Turn 2 just
shipped** (commit `269f182`): the driver Google-Navigation surface is
wired end-to-end in JS. End-of-Turn-2 acceptance: 160 suites / 1260
tests passing; typecheck, lint, format, test all green. **No device
build has been run since Phase 8 turn 1's prebuild** — Turn 3's
primary job is to take the JS-complete pipeline through a real iOS +
Android build, drive it on a device / emulator, and close Phase 8.

Your job this session is **Phase 8 Turn 3 — first device-build smoke
+ polish + Phase 8 close**. JS scope is mostly already covered; this
turn is dominated by native-build trial-and-error against the legacy
yeride patches, a manual end-to-end smoke, and the close-of-phase
docs.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state. The Phase 8 row in
   the second phase table shows "turn 1: ✅, turn 2: ✅, turn 3:
   Next".
2. `docs/PHASE_8_TURN_2.md` — what just shipped. Read end-to-end
   before touching anything; the closing acceptance section
   enumerates the manual smoke flow this turn has to actually run.
3. `docs/PHASE_8_TURN_1.md` — the Expo plugin patches landed here
   (`plugins/withNavigationSdk.js`); Turn 3 may need to extend them.
4. `docs/PHASE_8_KICKOFF.md` — the original Phase 8 scope. Confirm
   the "out" list still holds (no floating mute/chat buttons, no
   external-Maps fallback, no `onRouteChanged` / `onTrafficUpdated`,
   no CarPlay / Android Auto, no multi-stop, no rider-side in-app
   navigation).
5. Legacy `plugins/withNavigationSdk.js` (~350 lines, in
   `/Users/papagallo/yeapptech/dev/yeride/plugins/`). Read every
   patch comment. The four legacy patches the rewrite has NOT yet
   ported are the canonical fixes if device builds catch the same
   crashes:
   - **Firebase BoM 34.0.0 pin** (gRPC stream stability under an
     active nav session)
   - **MapView constructor `super.onCreate` / `super.onResume`
     race fix** (NPE on remount-after-logout while Nav SDK is
     loaded)
   - **MapView `onPause(LifecycleOwner)` NPE swallow** (NPE when
     image-picker / camera Activity pauses MainActivity)
   - **Compose Compiler Gradle classpath** (Stripe-related but
     loaded via the same path)

   None of these are precautionary in Turn 3 — port only the ones a
   build catches.
6. Legacy `src/driver/screens/DriverNavigation.js` — for cross-check
   on the manual end-to-end smoke (terms dialog UX, arrival timing,
   what the SDK actually shows on screen).
7. `scripts/patch-podfile.js` — three Podfile patches for
   `@react-native-firebase` 24.x under `useFrameworks: 'static'`.
   The Nav SDK pod itself may add a fourth: if `pod install` errors
   with `'<React/...>' file not found` for a Nav-SDK-related target,
   add a `pod 'X', :modular_headers => true` line to the patch
   script.
8. `app.config.ts` — the Expo plugin block today registers
   `withNavigationSdk.js` after `withPlayServicesLocationVersion.js`
   and before `withBackgroundFetchMaven.js`. Don't reorder unless a
   build catches a regression.
9. `src/presentation/App.tsx` — `<NavigationProvider/>` is mounted
   at App root. The legacy yeride yaml-equivalent ordering (above
   StripeProvider) differs from the rewrite's (below StripeProvider,
   above QueryClientProvider). If a runtime error surfaces around
   ordering, the rewrite's choice is intentional and well-documented
   in the App.tsx JSDoc.
10. `docs/PHASE_7_TURN_1.md` — Phase 7 turn 1 closing notes,
    specifically the BG SDK's Maven plugin patch
    (`plugins/withBackgroundFetchMaven.js`). The Nav SDK may
    similarly need a Maven repo addition if `gradle assembleDebug`
    fails with "Could not find" for a Nav-SDK transitive AAR.

## Starting state — what's already built

- **All 160 test suites / 1260 tests green.** No JS regressions
  expected unless a Turn-3 patch needs a JS-side accommodation.
- **Adapter + fake + DI** locked since Turn 1. No data-layer changes
  expected.
- **Connector + VM + screen + DriverMonitor integration** locked
  since Turn 2. No presentation-layer changes expected unless the
  device-build smoke catches a runtime issue.
- **Native config** is whatever Turn 1's prebuild produced. **A
  fresh `npm run prebuild` is REQUIRED** at the start of Turn 3 to
  pick up Turn 2's `app.config.ts` changes (App.tsx imports the SDK
  module — that's a build-time mod) AND any Turn 3 plugin
  extensions. The first `prebuild` run is the canonical surface for
  catching plugin / podspec issues before they bite at build time.
- **No device builds have been run since the JS work landed.** Turn
  3 is the first time the actual SDK module loads against the real
  RN runtime in this rewrite.

## Pre-Turn-3 manual checklist

These have to happen on the user's machine / Cloud Console BEFORE
the build smoke. Surface them in the first message back if they
haven't happened yet:

1. **Enable Navigation SDK APIs in Cloud Console** for the Maps
   Platform project hosting `GOOGLE_MAPS_APIKEY_ANDROID` /
   `GOOGLE_MAPS_APIKEY_IOS`:
   - Navigation SDK for Android
   - Navigation SDK for iOS

   If they're not enabled, `init()` returns
   `NavigationSessionStatus.NOT_AUTHORIZED` →
   `AuthorizationError({code: 'navigation_api_not_authorized'})`,
   surfaced via Toast on DriverMonitor. The smoke can't proceed
   without enabling.

2. **`npm run prebuild`** (clean) at the start of Turn 3. This
   regenerates `ios/` and `android/` from the current `app.config.ts`
   + plugins. Verify both succeed without throwing — plugin errors
   surface here.

3. **`pod install` from `ios/`** as a separate step (the prebuild
   should chain it, but a manual run after a plugin tweak is the
   fastest iteration loop).

4. **Confirm New Architecture** stays enabled:
   - `android/gradle.properties`: `newArchEnabled=true`
   - `ios/Podfile.properties.json` does NOT set
     `"newArchEnabled": "false"`

   The Nav SDK is TurboModule-only; New Arch off → module fails to
   register at runtime.

## Scope (in / out)

**In:**

- **Native-build smoke (iOS + Android).**
  - `npm run prebuild` clean run.
  - iOS: `cd ios && pod install`. Verify no
    non-modular-include errors; if any, extend
    `scripts/patch-podfile.js`. Then `npm run ios`. Verify the app
    boots through the auth flow.
  - Android: `npm run android` against an emulator OR physical
    device. Verify Maven resolution succeeds, the Nav SDK
    TurboModule registers, the app boots through auth.
  - **Both platforms** must reach the DriverHome screen with a
    signed-in driver before declaring the build smoke green.

- **Patch-as-needed from the legacy `withNavigationSdk.js`.** Port
  patches one at a time, test, repeat. Don't pre-emptively port all
  four — each comes with cost (gradle warnings, build time, future
  maintenance) and isn't free.
  - **Likely first hit:** Firebase BoM 34.0.0 pin if `.get()` /
    Firestore reads hang during the active nav session smoke.
  - **Possible second hit:** the MapView constructor /
    `super.onResume` race patch if Android crashes on
    DriverMonitor remount post-logout while Nav SDK is loaded.
  - **Possible third hit:** the MapView `onPause` NPE swallow if
    Android crashes when an image-picker / camera Activity pauses
    MainActivity (vehicle-photos flow).
  - **Possibly nothing:** modern RN 0.83 + AGP 8.10 may have made
    several legacy patches obsolete. Test before porting.

- **First end-to-end smoke** (manual, against the device build).
  Pin a real ride from the legacy yeride staging Firestore (or
  create one) and walk a driver through:
  1. Sign in as a driver.
  2. Go online; accept a dispatched ride.
  3. Land on DriverMonitor; status `'dispatched'`.
  4. Tap "Open Navigation" on EnRouteToPickupView.
  5. **First launch only:** terms dialog renders. Tap Accept.
  6. `<NavigationView/>` mounts; voice guidance starts; the screen
     fills with the SDK's UI.
  7. Drive (or simulate) into the 200m pickup geofence. Phase 7's
     auto-flip to `'at_pickup'` doesn't fire on this screen
     (DriverMonitor isn't visible) — but our current
     auto-pop-on-arrival path DOES fire if the SDK reports
     `isFinalDestination: true`. Verify the auto-pop OR tap "End
     Navigation" to manually return to DriverMonitor.
  8. DriverMonitor should now show AtPickupView (geofence
     auto-flipped state, Phase 7 turn 3).
  9. Tap "Start ride". Status flips to `'started'`.
  10. Tap "Open Navigation" on StartedView. Verify the
      `<NavigationView/>` mounts and uses the rider's selected
      `routeToken` (when present).
  11. Drive (or simulate) to the dropoff. Auto-pop OR manual end.
  12. Tap "Request payment". Existing Phase 4/6 fare flow runs.

  Document any UX surprises in `docs/PHASE_8_TURN_3.md`.

- **Polish items uncovered by the smoke.** The kickoff explicitly
  out-lists CarPlay, multi-stop, mute/chat buttons, etc. — none
  of those land here. But the smoke may surface:
  - Toast copy that doesn't render legibly against the
    SDK's full-screen UI.
  - Spinner-overlay timing on `'initializing'` (current 1.2s
    arrival overlay may need tweaking).
  - End Navigation button placement under the SDK's footer panel.
  - The "Open Navigation" CTA padding under `gap-2` on the views
    (visual-only).

- **Phase 8 close-of-phase artifacts.**
  - `docs/PHASE_8_TURN_3.md` — close-of-turn record. Document
    everything that needed patching, what didn't, and the smoke
    results.
  - `CLAUDE.md`:
    - Top status block: "**Phase 8 closed.** Across three turns
      Phase 8 brought…"
    - Phase 8 row → all turns ✅, Phase 9 → Next.
    - Reference the Turn 3 doc.
  - Bump test counts only if Turn 3 added tests (most likely 0
    — this is mostly device-build work).
  - **Do NOT pre-emptively start Phase 9 work.** The kickoff for
    Phase 9 is a separate session.

**Out (deferred — do not build in Turn 3):**

- **JS-side new behaviour.** Connector hook, view-models, screen,
  status-router views are all locked. Only touch them if the device
  build forces a JS-side accommodation (rare).
- **Phase 9 polish work** — push notifications, Crashlytics, the
  floating mute / chat / exit buttons inside DriverNavigationScreen,
  `onRouteChanged` / `onTrafficUpdated` / Distance Matrix bypass,
  ETA refinement via SDK telemetry.
- **External-Google-Maps fallback** on init failure. Per Phase 8
  kickoff "out" list. The Toast warn message stays the user-facing
  surface.
- **CarPlay / Android Auto.** Hard-out per kickoff.
- **Multi-stop trips.** Single-leg only.
- **Rider-side in-app navigation.**
- **E2E test suite** (Detox-style). Manual smoke is the acceptance
  this phase; automated E2E lands in Phase 9 or post-cutover.
- **Native build for production** (EAS / TestFlight / Play Console).
  Local debug build only this turn.

## Suggested approach (single turn)

Time-boxed. If any step blocks for >60min, document the block in
`docs/PHASE_8_TURN_3.md` and surface it to the user with options
rather than burning the turn.

1. **Pre-flight.** Confirm Cloud Console APIs enabled. Run
   `npm run prebuild`. Run `npm run verify` to confirm green
   baseline before any native work.
2. **iOS build smoke.** `cd ios && pod install`. If errors, patch
   `scripts/patch-podfile.js`. `npm run ios`. Boot through auth.
   Land on DriverHome. Document the boot path.
3. **Android build smoke.** `npm run android`. If Gradle resolution
   fails, examine the legacy `withNavigationSdk.js` Android sub-plugin
   for the right patch and port. Boot through auth. Land on
   DriverHome.
4. **Manual end-to-end smoke** on whichever platform built first.
   Walk the 12-step flow above. Document everything.
5. **Repeat the smoke on the other platform** (briefer — confirm
   parity).
6. **Patch-as-needed.** If the smoke crashed:
   - Find the matching legacy patch.
   - Port it minimally to `plugins/withNavigationSdk.js`.
   - `npm run prebuild`. Rebuild. Re-smoke.
   - Document each patch in `docs/PHASE_8_TURN_3.md` with the
     symptom + fix + cite of the legacy reference.
7. **Polish items** uncovered by the smoke (only the highest-impact
   ones; defer the rest to Phase 9).
8. **Close-of-phase docs.**
   - `docs/PHASE_8_TURN_3.md`.
   - `CLAUDE.md` updates (Phase 8 closed; Phase 9 → Next).
9. **Final verify.** `npm run verify` green. Commit.

## Risks + mitigations

- **Native modular-headers under static frameworks.** Same family as
  the existing fixes. Extend `scripts/patch-podfile.js` if `pod
  install` fails. Pattern: add a targeted
  `pod 'X', :modular_headers => true` to the patch script.

- **Firebase BoM 34.0.0 pin.** Legacy yeride pins to BoM 34.0.0
  specifically because BoM 34.10.0+ has gRPC stream stability issues
  while a Navigation session is active. The rewrite uses default
  RNFirebase versioning. **If `.get()` / Firestore reads hang during
  the active nav session smoke**, port the legacy pin verbatim.
  Symptom in `adb logcat`: gRPC `UNAVAILABLE` errors with stuck
  promises.

- **MapView constructor / onPause NPEs (Android).** Legacy patches
  in `withNavigationSdk.js` swallow these defensively. Port verbatim
  if the device build catches:
  - NPE on remount-after-logout (constructor patch)
  - NPE on Activity pause when image-picker / camera launches (the
    `onPause(LifecycleOwner)` swallow)

  Don't try to reproduce these without the legacy reference — they
  were earned through field crashes.

- **Stripe SDK / Compose Compiler classpath.** Legacy uses it; the
  rewrite's Stripe integration (Phase 6 turn 3) hasn't tripped a
  Compose-compiler error so far. If a build catches one, port the
  legacy classpath block.

- **`<NavigationProvider/>` mount ordering vs. StripeProvider.** The
  rewrite has these reversed from legacy. If a runtime error
  surfaces around context resolution, document and fix — don't just
  match legacy unless there's a clear signal.

- **`getCurrentActivity()` null-after-`<NavigationView/>` on
  Android.** Already mitigated by the Turn 2 init-in-DriverMonitor
  pattern. Verify on first device run that
  `useDriverMonitorViewModel.onLaunchNavigation` actually runs
  `init()` against a non-null activity (look for the
  `'navigation_api_not_authorized'` error in logs as a smoke
  indicator the controller IS connected).

- **Manual smoke against staging Firestore.** The legacy yeride
  staging Firebase project doubles as the rewrite's dev/stage
  backend. Don't accidentally run the smoke against `yeapp-prod` —
  verify `EXPO_PUBLIC_APP_ENV === 'development'` and the Firebase
  config files in `firebase/config/development/` point at the
  staging project before running the smoke.

- **Test suite drift during native iteration.** Each prebuild +
  rebuild cycle takes 5-15 minutes. If you find yourself iterating
  on JS in parallel, run `npm test` between runs to catch
  regressions early. The JS changes are unlikely but possible — a
  patched plugin or app config might force a JS-side accommodation.

## Acceptance for end of Phase 8 / Turn 3

- iOS + Android device builds boot through to DriverHome with a
  signed-in driver.
- Manual end-to-end smoke: a signed-in driver successfully launches
  navigation for the pickup leg, sees the terms dialog on first
  launch, accepts, sees `<NavigationView/>` render, walks/drives
  through, returns to DriverMonitor, starts the trip, launches the
  dropoff leg, returns, and requests payment. The full flow
  completes without crashes.
- Whatever device-build patches were needed to get there are
  documented in `docs/PHASE_8_TURN_3.md` with clear
  symptom-fix-reference links to the legacy patches.
- Test suite still green. Net delta: **0 to +20 tests** (estimate;
  most likely 0 — this is dominantly native-build work, but
  uncovered JS regressions during the smoke may need a defensive
  test).
- `CLAUDE.md` updated: Phase 8 row → all turns ✅; Phase 9 → Next;
  Project-status block bumps to "Phase 8 closed" with the
  three-turn arc summary.
- `docs/PHASE_8_TURN_3.md` written with the full close-of-phase
  record.
- `npm run verify` green.

## Conventions (non-negotiable — same as Phases 3-8)

- **No JS-side new behaviour without a clear smoke-driven motive.**
  This turn defaults to "the device build doesn't compile / crashes
  / misbehaves; what's the minimum patch?". Don't refactor the
  existing JS just because you're touching native code.
- **Plugin patches must be minimal.** Port only what the symptom
  dictates. Each patch comment cites the legacy reference + the
  observed symptom.
- **`Result.ok` / `Result.err`** still apply if you do touch JS.
- **Synchronous unsubscribe / cleanup** still apply.
- **Logger only.** `LOG.extend('NAV')` for adapter logs,
  `LOG.extend('DriverNavigationScreen')` for screen logs.
- **No external-Maps fallback.** Init failure → Toast warn only.
- **Run `npm run verify` before committing.**

## Start with

Read `CLAUDE.md`, then `docs/PHASE_8_TURN_2.md`, then the legacy
`plugins/withNavigationSdk.js` end-to-end. Confirm with the user
that the Cloud Console APIs are enabled before running prebuild.
Then propose **Turn 3's exact step-by-step plan** as a numbered
punch list (prebuild → iOS build → manual smoke → patch as needed
→ Android build → manual smoke → close-of-phase docs) and wait for
confirmation before kicking off the build.

Tip: Turn 3 is dominantly native trial-and-error. Resist the urge
to write speculative JS. Each plugin patch is a chance to introduce
new bugs; minimum patch set wins.
