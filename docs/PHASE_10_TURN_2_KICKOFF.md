# Phase 10 Turn 2 Kickoff — Firebase iOS SDK pin

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 1
closed 2026-05-18** (verification pass + audit v2 +
`app.config.ts` `audio` UIBackgroundMode restoration; see
`docs/PHASE_10_TURN_1.md`). Audit v2 surfaced
**7 ❌ rows + 2 🟡 rows** — this turn closes the highest-severity ❌:
the iOS Cloud-Function-callable crash on iOS 26.3+ release builds.

Turn 2 is **tiny (~½ day)** and **production-blocker priority** —
without it, `completeTrip` / `cancelTrip` / `tipDriver` callables
crash on every iOS device running iOS 26.3+ in release-mode builds.

## Context — why this turn now

`@react-native-firebase` 24.0.0 declares
`sdkVersions.ios.firebase = 12.10.0` in its
`node_modules/@react-native-firebase/app/package.json`. Every
`@react-native-firebase/<X>.podspec` resolves its Firebase iOS pod
versions off that declaration unless a `$FirebaseSDKVersion` Ruby
global is set at the top of the Podfile.

Firebase iOS SDK **12.10.0** carries a Swift 6.3 `async let`
miscompile bug. The bug is in `Functions/FunctionsContext.swift`'s
three concurrent `async let` statements inside
`FunctionsContext.context(options:)`. Under Xcode 26.4's Swift
6.3 compiler and the release-mode optimizer, the bug aborts the
process via
`swift_task_dealloc → asyncLet_finish_after_task_completion → abort`.

Every `httpsCallable` invocation in the rewrite flows through that
code path. That covers all three of:

- `completeTrip` callable (`useDriverMonitorViewModel`'s
  RequestPayment path)
- `cancelTrip` callable (rider + driver cancel sheets)
- `tipDriver` callable (rider tip flow)

So under iOS 26.3+ release builds, the moment a driver requests
payment / either party cancels / a rider tips, the app crashes.

The upstream fix shipped in **Firebase iOS SDK 12.12.0** (April 6,
2026). See:

- https://github.com/firebase/firebase-ios-sdk/issues/15974
- https://github.com/firebase/firebase-ios-sdk/issues/15994
- https://github.com/invertase/react-native-firebase/issues/8949

`@react-native-firebase` 24.0.0 (and the not-yet-released 24.1.0)
still declare 12.10.0 in their `sdkVersions.ios.firebase`, so
bumping rnfb alone is not sufficient — the override has to land
at the Podfile level.

Legacy yeride solves this with `plugins/withFirebaseSdkVersion.js`,
a dangerous-mod that prepends `$FirebaseSDKVersion = '12.12.0'` to
the iOS `Podfile`. The rewrite has no equivalent today; its
`plugins/withFirebasePodfileFix.js` handles modular-headers /
static-frameworks but does NOT touch the SDK version.

## Required reading (in order)

1. **Legacy `/Users/papagallo/yeapptech/dev/yeride/plugins/withFirebaseSdkVersion.js`**
   — the existing plugin (60 lines). Reads top-to-bottom in two
   minutes; the comment block is half the file and explains the
   bug + the upstream-fix version.
2. **Rewrite `plugins/withFirebasePodfileFix.js`** — the existing
   modular-headers plugin. Read for the dangerous-mod / idempotent-
   patch pattern; the new line is a peer of the existing
   `$RNFirebaseAsStaticFramework = true` injection.
3. **`docs/PHASE_10_PARITY_AUDIT.md` §4 `withFirebaseSdkVersion` row
   and §10.4 (if relevant)** — the audit's verdict citation that
   informs this turn's scope.
4. **`node_modules/@react-native-firebase/app/package.json`** — the
   `sdkVersions.ios.firebase = 12.10.0` declaration. Confirm this
   yourself; if it's already been bumped past 12.12.0 in a chore
   commit since 2026-05-18, this turn collapses to a no-op (and the
   audit row flips to ✅).
5. **`scripts/patch-podfile.js`** — the post-prebuild script that
   already mutates the Podfile in three places. The new injection
   could land here instead of in the Expo plugin; see the "Path
   choice" question below.

## Starting state — what's already true

- All Turn 1 deliverables landed on `main`:
  - `docs/PHASE_10_TURN_1.md` written
  - `docs/PHASE_10_PARITY_AUDIT.md` at v2
  - `docs/PHASE_10_CUTOVER_PLAN.md` §0 status updated
  - `app.config.ts:154` includes `'audio'` in `UIBackgroundModes`
- HEAD SHA on the rewrite at Turn 2 start: whatever `main` is at
  the moment you pick this up. Capture and record in the turn doc.
- The pre-existing 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  are scoped as Turn 9 — DO NOT try to fix them in this turn.
- The rewrite uses `@react-native-firebase@24.0.0` per
  `package.json`; this turn does NOT bump that version.
- No Firebase config files in `firebase/config/production/` yet —
  this turn lands the source change; a real `pod install` exercise
  has to wait for production EAS build at cutover-prep time.

## Scope — what to ship

A single source change that injects
`$FirebaseSDKVersion = '12.12.0'` into the iOS Podfile, plus the
usual turn-doc deliverable. Two equally-valid implementation paths
— pick one in the pre-checklist:

### Path (a) — Port `withFirebaseSdkVersion.js` as a separate plugin

Copy `withFirebaseSdkVersion.js` from
`/Users/papagallo/yeapptech/dev/yeride/plugins/withFirebaseSdkVersion.js`
into `/Users/papagallo/yeapptech/dev/yeride-mobile/plugins/withFirebaseSdkVersion.js`
with two adjustments:

1. Update the comment block's `@react-native-firebase` version
   reference from `23.8.8` (legacy's pin) to `24.0.0` (rewrite's
   pin). Keep the "Remove this plugin once @react-native-firebase
   ships sdkVersions.ios.firebase >= 12.12.0" exit condition
   wording.
2. Switch the `require` import line from
   `require('expo/config-plugins')` to
   `require('@expo/config-plugins')` (which is what the rewrite's
   other plugins use — `withGradleHeap.js`, `withFirebasePodfileFix.js`,
   `withGoogleMapsApiKey.js`, `withPlayServicesLocationVersion.js`
   — legacy still uses the un-namespaced `expo/config-plugins`).

Wire it in `app.config.ts` next to the existing
`withFirebasePodfileFix.js` entry (immediately after, so order is
preserved — the SDK-version pin lives at the top of the Podfile,
the modular-headers fix mutates the middle).

### Path (b) — Inline into `withFirebasePodfileFix.js` (recommended)

Add a third numbered patch to the existing `withFirebasePodfileFix.js`
between the current "1. `$RNFirebaseAsStaticFramework = true`" and
"2. `use_modular_headers!`" blocks. The new patch:

- Sentinel string: `# yeride:firebase-sdk-version` (per legacy's
  pattern — makes the idempotency check trivial).
- Inserts `$FirebaseSDKVersion = '12.12.0'` at the top of the
  Podfile (or right after the `require` block, mirroring how the
  existing static-framework patch finds its insertion point).
- Comment-block prefix: cite firebase-ios-sdk#15974 + the rnfb
  24.0.0 `sdkVersions.ios.firebase = 12.10.0` constraint + the
  remove-when-rnfb-ships-12.12.0+ exit condition.

Rename the plugin file to `withFirebasePodfilePatches.js` (or
similar — the name `Fix` was singular for a reason; this plugin
now applies multiple fixes) OR keep the name and let the JSDoc
header note the broader scope. **Recommend keep the name** — file
renames break git blame on every line and the rewrite's existing
docs reference `withFirebasePodfileFix.js` by that name.

Recommendation: **Path (b)**. Two reasons:

- Both plugins do `withDangerousMod` on the same iOS Podfile in
  the same prebuild stage; two separate plugins running in
  sequence write the file twice, which doubles the failure
  surface (a race on which one's text the other sees).
- The existing plugin already has the idempotency pattern + the
  insertion-point logic the new patch needs — copy-paste-extend is
  cheaper than build-from-scratch.

### Why NOT the patch-podfile.js script

`scripts/patch-podfile.js` runs AFTER `expo prebuild`, which is
fine for some patches but worse for this one because:

- The Podfile must contain `$FirebaseSDKVersion` BEFORE
  `pod install` runs. `expo prebuild` runs `pod install` as part
  of its native-files generation; if the patch runs after, you
  have to call `pod install` a second time (which `patch-podfile.js`
  already does for the static-framework injection, so it's not
  fatal — but adds a slow extra step).
- Plugin-mod patches are part of the Expo config-plugin contract
  and stay in sync with `expo prebuild --clean` workflows. Script-
  based patches don't run on `--clean` until the prebuild fully
  completes.

If Path (b) turns out blocked by a quirk I haven't anticipated
(e.g., the existing plugin's insertion regex doesn't accommodate a
second peer-level injection), fall back to a `patch-podfile.js`
addition for this one line. Note the decision in the turn doc.

## Pre-checklist

Surface these in your first message back if not already resolved:

1. **Confirm rnfb's iOS SDK version pin hasn't moved.**

   ```bash
   cd /sessions/clever-upbeat-ramanujan/mnt/yeride-mobile
   cat node_modules/@react-native-firebase/app/package.json | \
     python3 -c "import sys, json; print(json.load(sys.stdin)['sdkVersions']['ios']['firebase'])"
   ```

   If the output is `12.12.0` or newer, this turn collapses to
   audit-only: flip the §4 `withFirebaseSdkVersion` row from ❌ to
   ✅ in the audit doc with a one-line "rnfb already pins 12.12.0+
   as of node_modules state at HEAD `<SHA>`" finding, write the
   turn doc, no Podfile patch needed.

   If the output is `12.10.0` (most likely), proceed with the
   patch.

2. **Path choice — (a) port as separate plugin vs (b) inline into
   `withFirebasePodfileFix.js`.** Recommended: (b). Confirm or
   override.

3. **Pin target version — 12.12.0 vs latest 12.x.** Legacy pins
   12.12.0; the bug fix was confirmed in that version. By
   2026-05-18, Firebase iOS SDK has likely shipped 12.13.x /
   12.14.x. Two reasonable options:

   - **12.12.0** (legacy's pick, known-good for the fix).
     Conservative. Recommended.
   - **Latest 12.x stable** at the time of the turn. Slightly
     newer surface area; potentially picks up unrelated bug
     fixes; verify the `Firebase` CocoaPod's master spec for the
     current "Latest" tag before deciding.

   Recommended: 12.12.0 unless there's a specific reason to bump.
   Bumping further is unrelated change surface for a turn whose
   only job is closing this one bug.

4. **Confirm `$FirebaseSDKVersion` is still the right knob.** Read
   one of the @react-native-firebase 24.0.0 podspecs (e.g.
   `node_modules/@react-native-firebase/auth/RNFBAuth.podspec`) and
   confirm it references `$FirebaseSDKVersion` (typically via
   `firebase_sdk_version` Ruby variable). If rnfb 24 changed the
   knob name, the legacy plugin's `$FirebaseSDKVersion` injection
   needs adjustment; investigate before patching.

5. **Capture HEAD SHA of both repos.** Same pattern as Turn 1's
   pre-checklist item 2 — record in the turn doc.

## Suggested approach

1. **Pre-checklist first.** Answer items 1-4 above before writing
   any code. Item 1 may collapse the entire turn.

2. **Apply the patch.** Path (b) recommended:
   - Edit `plugins/withFirebasePodfileFix.js`.
   - Add the SDK-version injection block following the existing
     idempotency / insertion-point pattern. Sentinel string:
     `# yeride:firebase-sdk-version` per legacy.
   - Update the JSDoc header to note the broader scope ("multiple
     fixes to the iOS Podfile for `@react-native-firebase` 24.x").

3. **Update `node_modules/@react-native-firebase/app/package.json`
   reference in the comment block.** The legacy plugin's comment
   block references rnfb 23.8.8 / 24.0.0 declaring 12.10.0; the
   rewrite is on 24.0.0 only — simplify accordingly.

4. **Verify gates.**

   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck   # should be green — no .ts changes
   npm run lint        # should be green — plugin is .js, untouched by ESLint config? check
   npm run format:check # plugin patch may need prettier --write
   npm test            # 21 BG-geolocation failures remain (Turn 9); no new failures
   ```

5. **(Optional) Smoke prebuild.** If Firebase config files are in
   place locally, run `npm run prebuild` and grep the generated
   `ios/Podfile` for `$FirebaseSDKVersion = '12.12.0'`. If not,
   skip — the source change is correct; a real exercise lands at
   cutover-prep EAS build time.

6. **Audit + turn doc.**
   - Flip `docs/PHASE_10_PARITY_AUDIT.md` §4 `withFirebaseSdkVersion`
     row from ❌ to ✅ with the citation `plugins/withFirebasePodfileFix.js:<line>-<line>`
     (or whatever path you picked).
   - Update §1 headline finding count from "7 ❌ / 2 🟡 / 0 ⚠️"
     to "6 ❌ / 2 🟡 / 0 ⚠️".
   - Update §8 turn plan: mark Turn 2 ✅ closed.
   - Update audit header status line: "v3 — 2026-MM-DD post-Turn-2"
     OR keep v2 with a "Turn 2 closed YYYY-MM-DD" sublabel —
     decide based on whether you expect Turns 3-4 to land
     same-day (then bundle the audit bump into the last of them).
   - Write `docs/PHASE_10_TURN_2.md` following the
     `PHASE_10_TURN_1.md` format. Short — this is a tiny turn,
     and the turn doc should be tiny too.

## Out of scope (defer to later turns)

- **Bumping `@react-native-firebase`.** rnfb may have a 24.1.x
  release that already declares 12.12.0+; chasing that is a
  separate dependency-update concern with its own native-rebuild
  testing. This turn's mechanism (`$FirebaseSDKVersion` Podfile
  global) survives unchanged across rnfb minor bumps.
- **Android Firebase BoM pin.** The `async let` bug is iOS-only.
  Legacy Android Firebase pin (`expo-build-properties` /
  `extraMavenRepos`) is already at the rewrite's intended version
  per Phase 7. Don't touch.
- **Fixing the 21 BG-geolocation jest failures.** Scoped as Turn 9.
- **Verifying behavior on a real iOS 26.3 device.** Cutover plan
  §5.3 covers this as the production-build smoke-pass before §6.1
  internal track. This turn delivers source change only.
- **Updating Firebase config files in `firebase/config/production/`.**
  Cutover plan §4.1 covers that as a separate item; this turn
  doesn't need them.

## Deliverable

A single PR / commit on `main` containing:

1. **`plugins/withFirebasePodfileFix.js`** (Path b) OR a new
   `plugins/withFirebaseSdkVersion.js` + `app.config.ts` wiring
   (Path a). One file changed plus one config wire, OR one
   file extended.
2. **`docs/PHASE_10_PARITY_AUDIT.md`** updated — §1 count, §4
   row status, §8 turn plan, header.
3. **`docs/PHASE_10_TURN_2.md`** documenting:
   - Pre-checklist outcomes (rnfb version confirmed; path chosen;
     pin target; podspec knob confirmed)
   - The patch itself (diff-style or before/after)
   - Acceptance criteria
   - Out-of-scope list

`npm run verify` should be green except for the carried-over 21
BG-geolocation failures (those remain Turn 9's job).

## Sign-off criteria

- [ ] Plugin patch landed in `plugins/withFirebasePodfileFix.js`
      (or new file per Path a).
- [ ] Sentinel string + idempotency check in place — re-running
      `expo prebuild` does not double-inject `$FirebaseSDKVersion`.
- [ ] Audit doc §4 `withFirebaseSdkVersion` row flipped ❌ → ✅
      with a code-path citation.
- [ ] Audit §1 headline count updated.
- [ ] `PHASE_10_TURN_2.md` written.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green; jest carries the 21 pre-existing failures only.
- [ ] No regression: the existing
      `$RNFirebaseAsStaticFramework = true` and
      `use_modular_headers!` injections remain in place and still
      idempotent.

## Native rebuild

**Required for the change to take effect** — touches `ios/Podfile`.
Practical implication: any developer building locally after pulling
this turn must run `npm run prebuild` (which re-runs `pod install`).
EAS builds pick up the change automatically.

No Android-side change.

---

**End of PHASE_10_TURN_2_KICKOFF.md.** Read top to bottom on a new
session and execute. Ask if any pre-checklist item surfaces a
blocker.
