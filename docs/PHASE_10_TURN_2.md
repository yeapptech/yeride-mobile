# Phase 10 Turn 2 — Firebase iOS SDK pin

**Status:** ✅ closed 2026-05-18.

## Why

Phase 10 Turn 1 (2026-05-18) closed the parity-audit verification pass
and surfaced **7 ❌ / 2 🟡 / 0 ⚠️** rows blocking
[PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) §6 staged rollout.
The highest-severity ❌ is the `withFirebaseSdkVersion` plugin gap (§4
of the audit / §8 Turn 2 of the plan): rnfb 24.0.0's
`node_modules/@react-native-firebase/app/package.json` declares
`sdkVersions.ios.firebase = 12.10.0`, and Firebase iOS SDK 12.10.0
carries the Swift 6.3 `async let` miscompile (firebase-ios-sdk
[#15974](https://github.com/firebase/firebase-ios-sdk/issues/15974)
/ [#15994](https://github.com/firebase/firebase-ios-sdk/issues/15994))
inside `FunctionsContext.context(options:)`. Under Xcode 26.4's Swift
6.3 release optimizer, every `httpsCallable` invocation aborts the
process via `swift_task_dealloc → asyncLet_finish_after_task_completion →
abort`. The rewrite calls three callables (`completeTrip` /
`cancelTrip` / `tipDriver`) through `CloudFunctionsService` — so a
release-mode iOS build on iOS 26.3+ crashes the app on every trip
completion, cancellation, or rider tip.

Firebase iOS SDK 12.12.0 (April 6, 2026) ships the upstream fix.
Every `@react-native-firebase` 24.0.0 podspec honors a
`$FirebaseSDKVersion` Ruby global; setting it at top level of the iOS
Podfile pins every `Firebase/*` pod to the chosen version, which
pulls the upstream fix without bumping rnfb itself. Legacy yeride
solves this with `plugins/withFirebaseSdkVersion.js`; the rewrite had
no equivalent before this turn.

This turn lands a single source change — inline the SDK-version
injection into the existing `plugins/withFirebasePodfileFix.js` — and
the usual audit + turn-doc deliverables.

## Pre-checklist outcomes

All four pre-checklist items resolved without surprises.

1. **rnfb iOS SDK pin confirmed at 12.10.0.**
   `node_modules/@react-native-firebase/app/package.json` ·
   `sdkVersions.ios.firebase = 12.10.0` (rnfb version 24.0.0). Patch
   is required.

2. **Path choice — (b) inline into `withFirebasePodfileFix.js`.**
   Picked over (a) port as a separate plugin. Two reasons (per the
   kickoff): both plugins would `withDangerousMod` the same iOS
   Podfile in the same prebuild stage — running them in sequence
   doubles the failure surface, and the existing plugin's
   idempotency / insertion-point pattern is the same shape the new
   patch needs (copy-paste-extend over build-from-scratch).

3. **Pin target — 12.12.0** (legacy's pick, matches the kickoff's
   recommendation). Firebase iOS SDK has likely shipped 12.13.x /
   12.14.x by 2026-05-18, but bumping further is unrelated change
   surface for a turn whose only job is closing this one bug. 12.12.0
   is the known-good first version with the upstream fix.

4. **`$FirebaseSDKVersion` Ruby global confirmed as the right knob.**
   `node_modules/@react-native-firebase/app/RNFBApp.podspec:55-60`
   reads `$FirebaseSDKVersion = ENV['FIREBASE_SDK_VERSION']` then
   `if defined?($FirebaseSDKVersion) ... firebase_sdk_version = $FirebaseSDKVersion`.
   Every other rnfb 24.0.0 podspec (auth, crashlytics, firestore,
   functions, storage) mirrors the pattern via
   `if defined?($FirebaseSDKVersion) ... firebase_sdk_version = $FirebaseSDKVersion`.
   Setting the global at top-level of the Podfile applies to every
   `Firebase/*` pod.

5. **HEAD SHAs.** Recorded:

   ```
   /Users/papagallo/yeapptech/dev/yeride-mobile  f537773 chore(env): split BG_GEOLOCATION_LICENSE_KEY into per-platform vars
   /Users/papagallo/yeapptech/dev/yeride          40b5af1 build: bump version to 247
   ```

   Same HEAD as Turn 1 (no chore commits landed in between).

## What's in

A single source change plus the audit / turn-doc deliverables.

### 1. `plugins/withFirebasePodfileFix.js` — new patch #2

`withDangerousMod` now applies three independent, idempotent patches
to the iOS Podfile (was two):

| #   | Patch                                 | Pre-Turn-2  | Post-Turn-2                      |
| --- | ------------------------------------- | ----------- | -------------------------------- |
| 1   | `$RNFirebaseAsStaticFramework = true` | ✅ existing | ✅ unchanged                     |
| 2   | `$FirebaseSDKVersion = '12.12.0'`     | ❌ missing  | ✅ **new**                       |
| 3   | `use_modular_headers!`                | ✅ existing | ✅ unchanged (renumbered from 2) |

The new patch #2 inserts a sentinel-guarded comment block + the
`$FirebaseSDKVersion = '12.12.0'` Ruby global at top level of the
Podfile, immediately after the existing `$RNFirebaseAsStaticFramework`
assignment (the two globals are peers — both must be set before any
`target ... do` block). Sentinel: `# yeride:firebase-sdk-version` (per
legacy's pattern). The plugin's JSDoc header was extended to document
all three patches and the rationale for each.

Critical aspects of the implementation:

- **Idempotent.** Sentinel-based check (`contents.includes('# yeride:firebase-sdk-version')`)
  means a second `expo prebuild` run is a no-op for this patch. Smoke-
  tested against a representative Podfile fixture: first-pass output
  byte-equal to second-pass output.
- **Order-preserving.** `$RNFirebaseAsStaticFramework` stays before
  `$FirebaseSDKVersion`, and both stay before the `target` block
  (verified in the smoke test: `idxStatic < idxSdk < idxTarget`).
- **Insertion-point fallback.** Primary anchor is the existing
  `$RNFirebaseAsStaticFramework = true` line (always present in the
  rewrite because patch #1 runs first); fallback anchor is the last
  `require '...'` line (matches the same shape patch #1 uses); final
  fallback is a top-of-file prepend.
- **Removal path documented.** Comment block tells the next reader
  to drop the patch once `@react-native-firebase` ships a release
  whose `sdkVersions.ios.firebase` is 12.12.0 or newer.

The full diff:

```diff
--- a/plugins/withFirebasePodfileFix.js
+++ b/plugins/withFirebasePodfileFix.js
@@ -5,21 +5,42 @@
 /**
- * Custom Expo config plugin: patch the iOS Podfile so `@react-native-firebase`
- * 24.x's Obj-C wrappers compile under `useFrameworks: 'static'`.
- *
- * The fix is documented by @react-native-firebase: set the global Ruby
- * variable `$RNFirebaseAsStaticFramework = true` BEFORE the target block...
- * (...truncated existing JSDoc...)
+ * Custom Expo config plugin: apply multiple fixes to the iOS Podfile so
+ * `@react-native-firebase` 24.x compiles and runs correctly.
+ *
+ * Three independent patches, all idempotent and safe to re-run:
+ *
+ * 1. `$RNFirebaseAsStaticFramework = true` — (existing, unchanged).
+ * 2. `$FirebaseSDKVersion = '12.12.0'` — pin the underlying Firebase
+ *    iOS SDK past the Xcode 26.4 / Swift 6.3 `async let` miscompile.
+ *    See firebase-ios-sdk#15974 + invertase/react-native-firebase#8949.
+ *    Remove once rnfb ships sdkVersions.ios.firebase >= 12.12.0.
+ * 3. `use_modular_headers!` — (existing, unchanged, renumbered).
  */
@@ existing patch #1 unchanged @@
+
+      // 2. $FirebaseSDKVersion — sentinel-guarded, top-level injection.
+      const FIREBASE_SDK_PIN_SENTINEL = '# yeride:firebase-sdk-version';
+      const FIREBASE_SDK_PIN_VERSION = '12.12.0';
+      if (!contents.includes(FIREBASE_SDK_PIN_SENTINEL)) {
+        const block =
+          `\n${FIREBASE_SDK_PIN_SENTINEL} — pin Firebase iOS SDK past the\n` +
+          `# Xcode 26.4 / Swift 6.3 async let miscompile (firebase-ios-sdk\n` +
+          `# #15974). @react-native-firebase 24.0.0 still declares\n` +
+          `# sdkVersions.ios.firebase = 12.10.0, which carries the bug.\n` +
+          `# Remove this once @react-native-firebase ships a release whose\n` +
+          `# sdkVersions.ios.firebase is ${FIREBASE_SDK_PIN_VERSION} or newer.\n` +
+          `$FirebaseSDKVersion = '${FIREBASE_SDK_PIN_VERSION}'\n`;
+
+        if (contents.includes('$RNFirebaseAsStaticFramework')) {
+          contents = contents.replace(
+            /(\$RNFirebaseAsStaticFramework\s*=\s*true\s*\n)/,
+            `$1${block}`,
+          );
+        } else {
+          // ...require-line fallback + top-of-file fallback...
+        }
+      }

       // 3. use_modular_headers! — (existing, unchanged, renumbered from 2).
```

### 2. Smoke test — patch logic against a representative Podfile

Before running the verify gates, I exercised the plugin's mutation
function against a staged Podfile fixture that mirrors what
`expo prebuild` typically generates (RN autolinking + RCT_NEW_ARCH +
`target 'YeRide' do ... end` block). Three assertions:

```
contains $RNFirebaseAsStaticFramework:  true
contains $FirebaseSDKVersion:           true
contains use_modular_headers!:          true
contains yeride sentinel:               true
order static < sdk < target:            true
idempotent (re-run produces same file): true
```

All green. The first-pass output matches expectations: the
`$RNFirebaseAsStaticFramework` line lands after the last `require
'json'`, `$FirebaseSDKVersion = '12.12.0'` lands immediately below it,
and `use_modular_headers!` lands inside the target block.

### 3. `docs/PHASE_10_PARITY_AUDIT.md` updates

- **Header status line:** `Turn 2 closed 2026-05-18` sublabel added
  (keeps doc at v2 — Turn 10 will produce v3 per §11 sign-off).
- **§1 headline count:** 7 ❌ → 6 ❌ (annotation explains Turn 2's role).
- **§1 withFirebaseSdkVersion bullet:** marked closed in Turn 2 with
  code-path reference.
- **§4 row for `withFirebaseSdkVersion`:** flipped ❌ → ✅ with
  citation `plugins/withFirebasePodfileFix.js:86-118` and the
  removal-when-rnfb-ships-12.12.0+ exit condition.
- **§4 action-items list:** corresponding bullet flipped ❌ → ✅.
- **§8 turn plan:** Turn 2 row marked ✅ closed with link to this doc.

## Acceptance criteria

- [x] Plugin patch landed in `plugins/withFirebasePodfileFix.js` as
      a new numbered patch #2.
- [x] Sentinel `# yeride:firebase-sdk-version` + idempotency check in
      place — verified by smoke-test re-run yielding byte-equal output.
- [x] Audit doc §4 `withFirebaseSdkVersion` row flipped ❌ → ✅ with
      code-path citation.
- [x] Audit §1 headline count updated 7 ❌ → 6 ❌.
- [x] `PHASE_10_TURN_2.md` written (this doc).
- [x] `npm run typecheck` ✅ green.
- [x] `npm run lint` ✅ green (no output).
- [x] `npm run format:check` ✅ green for the plugin file
      (`prettier --write` applied once; the lone remaining warning is
      pre-existing on `CLAUDE.md` at HEAD `f537773` — unrelated to
      this turn, and the file was not edited).
- [x] `npm test` — 1647 passed / 21 failed (carried-over Turn 9 BG-
      geolocation regression; no new failures introduced).
- [x] No regression: existing `$RNFirebaseAsStaticFramework = true`
      and `use_modular_headers!` injections remain in place and still
      idempotent (smoke test verified).

## Native rebuild

**Required for the change to take effect.** The plugin mutates
`ios/Podfile`, which is generated by `expo prebuild`. Any developer
building locally after pulling this turn must run `npm run prebuild`
(which re-runs `pod install` against the patched Podfile, picking up
Firebase iOS SDK 12.12.0). EAS builds pick up the change
automatically.

No Android-side change — the Swift 6.3 `async let` bug is iOS-only.

## What's NOT in this turn

Explicit deferrals (per the kickoff's out-of-scope list):

- **Bumping `@react-native-firebase`.** rnfb may have a 24.1.x
  release that already declares 12.12.0+; chasing that is a
  separate dependency-update concern with its own native-rebuild
  testing. The `$FirebaseSDKVersion` Podfile global survives
  unchanged across rnfb minor bumps. When rnfb's
  `sdkVersions.ios.firebase` ships ≥ 12.12.0, the next-reader exit
  condition fires and patch #2 can be deleted.
- **Android Firebase BoM pin.** Android-specific; iOS-only bug.
- **Verifying behavior on a real iOS 26.3 device.** Cutover plan
  §5.3 covers this as the production-build smoke-pass before §6.1
  internal track.
- **Fixing the 21 BG-geolocation jest failures.** Scoped as Turn 9.
- **Production EAS build / `firebase/config/production/` files.**
  Cutover plan §4.1 covers that separately.
- **Material Components Android theme** (`withMaterialTheme`),
  Turn 3 (next).
- **`processing` UIBackgroundMode reconciliation**, Turn 4.

## Decision log

Notable judgment calls in this turn:

1. **Path (b) inline, not (a) separate plugin.** Per the kickoff's
   recommendation. Keeping the JSDoc + numbered-patches structure in
   one file reduces the chance two `withDangerousMod` callbacks race
   on the same Podfile and one overwrites the other's text. Also lets
   the next reader see all three Firebase Podfile patches in one
   place.

2. **Keep filename `withFirebasePodfileFix.js`** (singular "Fix") even
   though the plugin now applies multiple fixes. Renaming would break
   git blame on every existing line and would orphan the
   `withFirebasePodfileFix` reference in `app.config.ts`. The JSDoc
   header now opens with "apply multiple fixes" so the broader scope
   is documented inline.

3. **Pin 12.12.0 specifically, not "latest 12.x".** Conservative —
   12.12.0 is the first version with the upstream fix and is what
   legacy yeride pins. Bumping further introduces unrelated change
   surface for a turn whose only job is closing one bug. If a later
   turn audits Firebase iOS SDK versions across the board, that turn
   can re-evaluate.

4. **Audit doc stays v2 with a Turn-2 sublabel, not bumped to v3.**
   §11 sign-off names "Audit doc v3 produced after Turns 2-9 close"
   as the next version milestone. Bumping after every closed turn
   would inflate the version count. The sublabel approach matches the
   Turn 1 convention.

5. **Smoke-test the patch against a fixture before running the verify
   gates.** Cheaper than waiting for a real `expo prebuild` to flag
   a regex regression. The patch's sentinel + insertion-point logic
   has three branches; only the smoke test exercises all of them.

## Sources

- [PHASE_10_PARITY_AUDIT.md](PHASE_10_PARITY_AUDIT.md) — the audit row this turn closes
- [PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) — §0 gate this turn unblocks
- [PHASE_10_TURN_1.md](PHASE_10_TURN_1.md) — Turn 1 context and conventions
- [PHASE_10_TURN_2_KICKOFF.md](PHASE_10_TURN_2_KICKOFF.md) — this turn's scope
- Legacy [plugins/withFirebaseSdkVersion.js](../../yeride/plugins/withFirebaseSdkVersion.js) — reference implementation
- firebase-ios-sdk [#15974](https://github.com/firebase/firebase-ios-sdk/issues/15974) — root-cause upstream issue
- firebase-ios-sdk [#15994](https://github.com/firebase/firebase-ios-sdk/issues/15994) — duplicate / linked issue
- invertase/react-native-firebase [#8949](https://github.com/invertase/react-native-firebase/issues/8949) — rnfb-side tracking
