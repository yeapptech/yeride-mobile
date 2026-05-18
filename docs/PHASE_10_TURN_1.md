# Phase 10 Turn 1 — Verification pass

**Status:** ✅ closed 2026-05-18.

## Why

Phase 10 kickoff produced two strategy docs on 2026-05-18 — the
`PHASE_10_CUTOVER_PLAN.md` runbook (v2, decisions locked) and the
`PHASE_10_PARITY_AUDIT.md` first-pass static audit (v1, **4 ❌ /
2 🟡 / 2 ⚠️ rows**). The audit's ⚠️ rows couldn't be resolved from
static inspection alone — they needed deeper reads against the
codebase to decide. Cutover plan §0 (the parity-audit gate) is
blocked until every ⚠️ resolves and the audit lands as v2.

This turn is the verification pass that resolves the ⚠️ rows.
**No-code-by-default** with one explicit exception: if Item C's
investigation confirmed the `audio` UIBackgroundMode is needed,
the kickoff authorized a one-line `app.config.ts` fix as
verification-cleanup.

## Pre-checklist outcomes

All three pre-checklist items landed cleanly.

1. **`docs/PHASE_9_TURN_5.md` existence.** ✅ exists. Important
   side-finding: the doc shows Phase 9 Turn 5's scope was
   **repurposed** away from the originally-planned "SDK telemetry
   listeners + Distance Matrix bypass" to a passenger-snapshot
   Stripe-gap fix. The NavSdk-telemetry work was never re-picked-
   up — it shows in Phase 8 Turn 2 kickoff line 348 as "Distance
   Matrix bypass and ETA refinement via SDK telemetry land in
   Phase 9 polish," but the polish phase closed at Turn 18 without
   landing it. Material to Item A.

2. **HEAD SHAs.** Recorded:

   ```
   /Users/papagallo/yeapptech/dev/yeride-mobile  f537773 chore(env): split BG_GEOLOCATION_LICENSE_KEY into per-platform vars
   /Users/papagallo/yeapptech/dev/yeride          40b5af1 build: bump version to 247
   ```

   Phase 9 closed at `2a343e9`; five chore commits landed on top
   (CLAUDE.md trims, doc extraction, the bg-geolocation 4→5 SDK
   upgrade and its PR merge, and the env-var split).

3. **Verify gates green at HEAD.** Mixed result:
   - `npm run typecheck` ✅ green.
   - `npm run lint` ✅ green (no output).
   - `npm test` ❌ **21 failed / 1647 passed across 188/189 suites.**
     Every failure lives in
     `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`.

   Root cause traced to the post-Phase-9 chore `56c273c`
   (bg-geolocation 4.19.4 → 5.1.1): the chore added `if (__DEV__)
return Result.ok(true);` short-circuits to every native-method
   path of `BackgroundGeolocationClient` to dodge the Android
   emulator `tslocationmanager:4.1.5` `setPriority(-1)` crash.
   jest-expo defaults `__DEV__ === true`, so the tests' native-
   path assertions fail because the short-circuit returns before
   reaching them.

   This is **not a Phase 10 parity issue** — it's a chore
   regression that landed AFTER Phase 9 close. The audit is a
   static read of source, so this turn proceeded; but the failure
   is captured under §11.1 of the audit and Turn 9 of the §8 plan
   because cutover plan §3.1 (`npm run verify` green at cutover
   SHA) requires it resolved.

## What's in

This is a docs-only turn plus one tiny `app.config.ts` fix.

### 1. `docs/PHASE_10_PARITY_AUDIT.md` v2

Six audit-document changes:

- **Top-of-doc header:** "v2 — verified 2026-05-18" line added.
- **§1 Headline findings rewritten** to summarize the v1 ⚠️ →
  final-status mapping (4 ⚠️ → 1 ✅ post-fix / 2 ✅ / 1 ❌ ; 4 ⚠️
  plugin rows → 2 ✅ / 1 ❌ critical / 1 🟡 / 1 ❌), the three new
  ❌ rows that surfaced (Firebase iOS SDK, Material theme, BG
  geolocation test regression), and the corrected count
  (**7 ❌ / 2 🟡 / 0 ⚠️**).
- **§3.5 Rider ETA** rewritten ⚠️ → ❌ with verified citations:
  `DispatchedView.tsx:40` / `StartedView.tsx:40` reading static
  `ride.pickup.directions.durationSeconds`;
  `useRiderHomeViewModel.ts:113` writing `tripTracking: null`;
  no `onTrafficUpdated` / `onRouteChanged` / `distanceMatrix`
  references anywhere in `src/`. A 6-bullet Phase 10 turn scope
  added.
- **§3.6 Wallet** re-characterized 🟡 → 🟡 (no status flip, but
  the framing was wrong in v1). Legacy `TransactionHistory.js`
  takes a `tripId` prop — it's a **per-trip** payment list, not a
  Wallet-tab history. Legacy Wallet's "Recent Payments" section
  is disabled in source (GH issue #110 comment). Genuine missing
  surface folds into §3.3 Activity port. Data path documented:
  `subscribeToTripPayments(tripId, …)` → `trips/{tripId}/payments`
  subcollection → already exposed via `ObserveTripPayments` use
  case + `tripPaymentMapper` from Phase 9.
- **§3.7 Trip preview** flipped ⚠️ → ✅ with the corrected
  framing: `TripPreviewModal.js` is the post-trip details surface
  (navigated to from TripHistory / RiderHome / DriverHome /
  Earnings rows), NOT a pre-trip preview. The actual pre-confirm
  surfaces — RouteSelect Confirm button + DriverDispatchScreen
  Accept/Decline — exist in both apps; the rewrite's are richer
  than legacy's (rewrite has explicit screens; legacy has a tap →
  immediate-create rider flow and a native `Alert.alert` driver
  confirm).
- **§4 App config diff table** updated row-by-row:
  - `UIBackgroundModes` row updated to reflect the `audio`
    restoration post-fix (Turn 1 change to `app.config.ts:154`)
    and the residual 🟡 on `processing` vs the persistent
    `com.transistorsoft.customtask` BGTaskScheduler identifier.
  - `withMaterialTheme` → ❌ needed (Stripe `CardForm` Android
    crash; upstream plugin doesn't apply Material theme).
  - `withPackagingOptions` → ✅ retired (functions absorbed by
    `withGradleHeap` + `expo-build-properties` minSdk; Detox-
    specific bits not needed).
  - `withFmtFix` → 🟡 likely retired (RN 0.83.6 → fmt 12.1.0 vs
    legacy's patched fmt 11.0.2; major-version upstream bump
    likely fixed the missing `#ifndef` guard but unverified
    against a real Xcode 26 build).
  - `withStripeIosSdkOverride` → ✅ retired (both fixes baked
    into `@stripe/stripe-react-native@0.63.0`:
    `STPPaymentStatus` declared as `NS_ENUM(NSInteger,...)` in
    its `ios/StripeSwiftInterop.h` and the podspec pins
    `stripe_version = '~> 25.10.0'`).
  - `withFirebaseSdkVersion` → ❌ **CRITICAL** (rnfb 24.0.0's
    `sdkVersions.ios.firebase = 12.10.0`, which carries the
    Swift 6.3 `async let` miscompile that crashes every Cloud
    Function callable on iOS 26.3+; rewrite's
    `withFirebasePodfileFix.js` only handles modular-headers,
    not the SDK version pin). Production blocker for iOS.
  - `react-native-map-link` → ✅ retired (explicitly out-of-
    scope per `PHASE_8_TURN_2_KICKOFF.md:350`; NavSdk error arm
    handles the failure case via in-app retry).
- **§8 Turn plan** updated with Turn 1 closure (~~Turn 1~~ ✅) and
  the new turn-list (~10-15 days total still — new turns are
  absorbed by §3.6 collapsing into §3.3 and §3.7 closing as ✅).
- **New §10 Newly-discovered gaps** captures the four side-
  findings: BG-geolocation tests broken at HEAD (❌), NavSdk
  telemetry never shipped (❌, links to §3.5), Stripe Connect
  return-URL deep-link bridge (🟡 polish — ops work, not
  engineering), and the `processing` UIBackgroundMode vs
  `com.transistorsoft.customtask` BGTaskScheduler identifier
  mismatch (🟡).
- **§11 Sign-off** updated: v2 produced (this turn); v3 awaits
  Turns 2-9 closure; the "every ⚠️ row resolved" checkbox is
  ticked.

### 2. `app.config.ts` audio fix (one-line)

Per the kickoff's authorization for verification-cleanup, the
`audio` UIBackgroundMode is restored. The change is a single line
in `ios.infoPlist.UIBackgroundModes`:

```diff
-      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
+      UIBackgroundModes: ['location', 'fetch', 'remote-notification', 'audio'],
```

The block comment is extended (5 lines) to document why: NavSdk
ships with `VOICE_ALERTS_AND_GUIDANCE` as the default
`AudioGuidance`, voice plays on the device speaker, and iOS
suspends audio output when the app backgrounds (screen lock,
incoming call interrupt) without the `audio` entitlement. Legacy
yeride ships `audio` for the same reason.

The companion `processing` mode — discussed under Item C — is
left for Turn 4 because it requires a Transistor v5 docs check
(does `com.transistorsoft.customtask` still schedule
BGProcessingTaskRequest jobs in v5?), and a Turn-1 one-liner could
introduce a regression if Transistor v5 dropped the customtask in
favor of something else.

## ⚠️ → final-status mapping

| Audit row                        | v1 status | Method                                                                                                                                                                                                                              | v2 status       | Source citation                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.5 Rider ETA                   | ⚠️        | Static read of `DispatchedView.tsx`, `StartedView.tsx`, `useRideMonitorViewModel.ts`, `NavigationSdkClient.ts`, `UserLocation.ts`, and `PHASE_9_TURN_5.md`.                                                                         | ❌              | `DispatchedView.tsx:40` reads `ride.pickup.directions.durationSeconds` (static); `StartedView.tsx:40` reads `ride.dropoff.directions.durationSeconds` (static); `useRiderHomeViewModel.ts:113` writes `tripTracking: null`; no `onTrafficUpdated`/`onRouteChanged` references in `src/`; Phase 9 Turn 5 doc shows scope repurposed. |
| §3.7 Trip preview                | ⚠️        | Static read of `TripPreviewModal.js`, navigation entrypoints, `RideSelect.js` `onRideSelected`, `DriverDispatch.js` `onRideSelected`/`handleDispatchRide`, and rewrite's `RouteSelectScreen.tsx` / `DriverDispatchScreen.tsx`.      | ✅              | `TripPreviewModal` invoked from `TripHistory.js:34` / `RiderHome.js:366` / `DriverHome.js:298` / `Earnings.js:391` — all past-trip taps; rewrite has Confirm button in `RouteSelectScreen.tsx:183-191` and full `'ready'`-arm Accept/Decline in `useDriverDispatchViewModel.ts`.                                                    |
| §4 UIBackgroundMode `audio`      | ⚠️        | NavSdk SDK type-defs in `node_modules/@googlemaps/react-native-navigation-sdk/lib/typescript/src/navigation/types.d.ts:128-155` confirm `AudioGuidance` enum exists with `VOICE_ALERTS_AND_GUIDANCE` as the SDK's expected default. | ✅ (post-fix)   | Restored in `app.config.ts:154` (Turn 1 edit).                                                                                                                                                                                                                                                                                      |
| §4 UIBackgroundMode `processing` | ⚠️        | Grep for `BGProcessingTask` / `expo-task-manager` in `src/` — no matches; but rewrite still ships `com.transistorsoft.customtask` in `BGTaskSchedulerPermittedIdentifiers` at `app.config.ts:155-158`.                              | 🟡              | Conflict: BGProcessingTaskRequest requires `processing` per Apple's BGTaskScheduler contract; rewrite ships customtask in the permitted-identifiers but not the mode. Resolution deferred to Turn 4 (one-liner either way).                                                                                                         |
| §4 `withMaterialTheme`           | ⚠️        | Grep for `CardForm` + read of `@stripe/stripe-react-native@0.63.0` plugin (`node_modules/.../app.plugin.js` → `src/plugin/withStripe.ts`).                                                                                          | ❌              | `AddPaymentMethodScreen.tsx:1` imports `CardForm`. Upstream plugin handles Apple Pay entitlement, Onramp pod, Google Pay meta-data — no Material theme.                                                                                                                                                                             |
| §4 `withPackagingOptions`        | ⚠️        | Read of legacy plugin (heap bump + Detox META-INF excludes + protobuf-lite exclude + Stripe minSdk fix + Stripe androidTest disable) vs rewrite's `withGradleHeap.js` and `expo-build-properties` config.                           | ✅ retired      | Heap covered by `withGradleHeap`; minSdk forced by `expo-build-properties.android.minSdkVersion: 24`; Detox-specific bits not needed (no Detox suite in rewrite — `package.json` has 0 detox refs).                                                                                                                                 |
| §4 `withFmtFix`                  | ⚠️        | Read of legacy plugin + `node_modules/react-native/third-party-podspecs/fmt.podspec` for the rewrite's fmt version.                                                                                                                 | 🟡              | Rewrite uses fmt 12.1.0 (major-version bump past legacy's patched 11.0.2); upstream likely fixed the missing `#ifndef` guard but unverified against a real Xcode 26 prebuild.                                                                                                                                                       |
| §4 `withStripeIosSdkOverride`    | ⚠️        | Read of legacy plugin + `@stripe/stripe-react-native@0.63.0`'s `ios/StripeSwiftInterop.h` + `stripe-react-native.podspec`.                                                                                                          | ✅ retired      | `StripeSwiftInterop.h` already declares `NS_ENUM(NSInteger, STPPaymentStatus)`; podspec pins `stripe_version = '~> 25.10.0'` (newer than legacy plugin's `~> 25.9.0`).                                                                                                                                                              |
| §4 `withFirebaseSdkVersion`      | ⚠️        | Read of legacy plugin + `node_modules/@react-native-firebase/app/package.json` `sdkVersions.ios.firebase` + rewrite's `withFirebasePodfileFix.js` + `scripts/patch-podfile.js`.                                                     | ❌ **CRITICAL** | rnfb 24.0.0's `package.json` declares `sdkVersions.ios.firebase = 12.10.0`; the rewrite's Podfile-fix plugin patches modular-headers only, not `$FirebaseSDKVersion`. Production blocker.                                                                                                                                           |
| §4 `react-native-map-link`       | ⚠️        | Grep for `showLocation` / `react-native-map-link` in rewrite + read of `PHASE_8_TURN_2_KICKOFF.md` "Out (deferred)" list.                                                                                                           | ✅ retired      | Kickoff line 350 explicitly listed external-Maps fallback as out-of-scope; NavSdk error arm handles failure via in-app retry.                                                                                                                                                                                                       |

## Newly-discovered gaps (added to audit §10)

Four side-findings surfaced during the verification reads:

1. **`BackgroundGeolocationClient` jest regression** at HEAD — 21
   failing tests in `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
   from the `__DEV__` short-circuit added in `56c273c`. Not a parity
   issue, but blocks cutover plan §3.1 (`npm run verify` green at
   cutover SHA). Added as Turn 9 in the §8 turn plan.
2. **NavSdk telemetry → live ETA** never shipped. Documented in
   §10.2; links to §3.5; the Phase 8 Turn 2 kickoff deferred this
   to Phase 9 polish and the polish phase closed without picking it
   up.
3. **Stripe Connect return-URL deep-link bridge** —
   `https://yeride.com/stripe-return` needs a server-side 302 to
   the env-aware deep-link scheme. Captured as a pre-cutover ops
   item (NOT engineering work in the rewrite repo).
4. **`processing` UIBackgroundMode vs `com.transistorsoft.customtask`
   mismatch** — rewrite declares the BGTaskScheduler identifier but
   not the required UIBackgroundMode. Resolution deferred to
   Turn 4.

## Updated turn-plan estimate

The §8 turn plan was rewritten to reflect Turn 1's closure:

| Turn                                     | Size                | Notes                                                     |
| ---------------------------------------- | ------------------- | --------------------------------------------------------- |
| ~~1~~                                    | ~~small (1d)~~      | ✅ closed this turn                                       |
| 2 Firebase iOS SDK pin                   | tiny (½d)           | New — surfaced by Item D                                  |
| 3 Material Components theme              | tiny (½d)           | New — surfaced by Item D                                  |
| 4 `processing`/customtask reconciliation | tiny (½d)           | New — Item F side-finding                                 |
| 5 Rider live ETA                         | small-medium (1-2d) | Replaces v1's "verification" — now real ETA-port work     |
| 6 Activity tab (rider + driver)          | large (3-5d)        | Carries through; absorbs §3.6 per-trip TransactionHistory |
| 7 Scheduled rides creation UI            | medium (2-3d)       | Carries through                                           |
| 8 Chat                                   | medium (2-3d)       | Carries through                                           |
| 9 BG-geolocation test regression         | small (1d)          | New — Item F side-finding; unblocks §3.1 gate             |
| 10 Audit v3 + sign-off                   | small (½d)          | Carries through                                           |

**New estimated total: ~10-15 days.** Same band as v1, even after
adding three new small turns — because §3.6 collapsed into §3.3
(net –0d, since it was already a §3.3-blocked dependency) and §3.7
closed at ✅ (net –½d).

## Decision log

Notable judgment calls in this turn:

1. **`processing` UIBackgroundMode — defer the fix.** The kickoff
   suggested the rewrite likely doesn't need `processing`; the
   investigation showed the rewrite still declares
   `com.transistorsoft.customtask` in `BGTaskSchedulerPermittedIdentifiers`,
   which means SOMEONE expected the customtask scheduler to work
   (and customtask is a `BGProcessingTaskRequest` per Apple's
   contract, which requires `processing` in `UIBackgroundModes`).
   Resolving this needs a docs check against the Transistor SDK v5
   to confirm whether customtask is still in use. Deferred to Turn 4
   (one-line decision either way) rather than guess-fixing it in
   this turn.

2. **`withFmtFix` — mark 🟡 not ✅.** The fmt 11.0.2 → 12.1.0 jump
   is a major-version upgrade; common practice when a vendor fixes
   a long-standing bug like the missing `#ifndef` guard is to ship
   the fix in the next major. But I haven't been able to verify
   directly against fmt 12.1.0's `include/fmt/base.h` (the file
   lives in a CocoaPod cache, not `node_modules`, and only
   materializes after `pod install`). Conservative call: mark 🟡
   with an explicit "verify on first Xcode 26 prebuild" note,
   rather than ✅ which would imply we've confirmed retirement.

3. **§3.7 framing correction → close as ✅, don't open a new ❌.**
   The v1 audit characterized `TripPreviewModal` as a pre-confirm
   surface; close reading shows it's the post-trip details surface
   reached from past-trip taps in Activity / Wallet / Earnings.
   That's actually a sub-problem of §3.3 (Activity tab), so it
   doesn't deserve its own ❌ — it collapses into the already-
   ❌-row §3.3 work. The pre-confirm surfaces themselves (rider
   Confirm button + driver Accept/Decline screen) ARE present in
   the rewrite, in fact richer than legacy's.

4. **§3.6 framing correction → keep as 🟡 but re-characterize.**
   Same shape as the §3.7 correction. Legacy Wallet doesn't show
   recent transactions (the source comment confirms the section is
   "temporarily disabled — GH issue #110"). The rewrite's Wallet is
   at parity. The missing surface is per-trip TransactionHistory,
   which is part of the trip-detail view reached from the Activity
   tab — folded into §3.3 scope rather than tracked as its own
   turn.

5. **BG-geolocation test fix — Turn 9 (small), not Turn 1 (tiny).**
   The simplest fix would be to remove the `__DEV__` short-circuit
   and find another mitigation for the emulator crash; but that
   would re-introduce the kill loop the chore was patching. A
   proper fix needs a test-injection seam (e.g., a constructor flag
   defaulting to `__DEV__` short-circuit but flippable for tests),
   which is a small piece of refactor. Deferred to Turn 9 so this
   turn stays scoped to verification.

## Acceptance

- ✅ Every v1 ⚠️ row resolved to ✅ / 🟡 / ❌.
- ✅ Audit v2 has a "v2 — verified 2026-05-18" header.
- ✅ Three new ❌ rows in the §8 turn plan with size estimates.
- ✅ Cutover plan §0 status updated (next message in the doc trail).
- ✅ One-line `app.config.ts` fix applied + `npm run verify` re-run.
  Typecheck + lint green; jest still has the pre-existing 21
  `BackgroundGeolocationClient` failures from the post-Phase-9
  chore — not introduced by this turn (HEAD before turn already
  had them).

## Native rebuild

**Required for the `audio` UIBackgroundMode change** to take
effect on iOS. The change touches `ios.infoPlist.UIBackgroundModes`,
which is baked into the app's Info.plist at `expo prebuild` time.
Practical implication: any developer building locally after pulling
this turn must run `npm run prebuild` once before `npm run ios`.
EAS builds pick up the change automatically.

No Android-side native change in this turn (Android background
modes are handled via permissions, not a `UIBackgroundModes`
equivalent).

## What's NOT in this turn

Explicit deferrals:

- **No code beyond the one-line `app.config.ts` fix.** The kickoff
  authorized verification-cleanup only; all the ❌ rows that surfaced
  (Firebase pin, Material theme, rider ETA, BG-geolocation test fix)
  are scoped as separate turns in §8.
- **No manual device smoke against `yeapp-stage`.** Cutover plan §3.2
  covers that as the final pre-cutover gate; this turn was static-
  inspection only.
- **No cutover-plan changes.** The cutover plan is locked at v2.
  Section §0 status note (Turn 1 closure but parity-audit gate
  still blocked on Turns 2-9) lands in the cutover-plan update
  that accompanies this turn.
- **No legacy yeride code changes.** Read-only against legacy.

## Sources

- [PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) — §0 gate,
  §1 locked decisions
- [PHASE_10_PARITY_AUDIT.md](PHASE_10_PARITY_AUDIT.md) — the audit
  this turn updates
- [PHASE_10_TURN_1_KICKOFF.md](PHASE_10_TURN_1_KICKOFF.md) —
  this turn's scope
- [PHASE_9_TURN_5.md](PHASE_9_TURN_5.md) — Phase 9 Turn 5's
  actual (repurposed) scope
- [PHASE_8_TURN_2_KICKOFF.md](PHASE_8_TURN_2_KICKOFF.md) — Phase 8
  Turn 2's "Out (deferred)" list with the external-Maps and NavSdk
  telemetry deferrals
- Legacy [CLAUDE.md](../../yeride/CLAUDE.md) — domain context
- Rewrite [CLAUDE.md](../CLAUDE.md) — current conventions
