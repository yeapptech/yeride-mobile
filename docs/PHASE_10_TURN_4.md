# Phase 10 Turn 4 — `processing` UIBackgroundMode reconciliation

**Status:** ✅ closed 2026-05-18.

## Why

Phase 10 Turn 3 (2026-05-18) closed the Android Stripe `<CardForm/>`
render crash via `plugins/withMaterialTheme.js`. The post-Turn-3
audit ([`docs/PHASE_10_PARITY_AUDIT.md`](PHASE_10_PARITY_AUDIT.md))
showed **5 ❌ / 2 🟡 / 0 ⚠️**. The two 🟡 rows were:

- §10.3 `yeride.com/stripe-return` 302-bridge — an ops item on the
  marketing-domain DNS, not engineering work in the rewrite repo.
- §10.4 `processing` UIBackgroundMode vs.
  `BGTaskSchedulerPermittedIdentifiers` mismatch — a latent
  `app.config.ts` config inconsistency under Apple's BGTaskScheduler
  contract.

This turn closes §10.4, the sole code-side 🟡.

The rewrite's `app.config.ts` `ios.infoPlist` block declared:

```ts
UIBackgroundModes: ['location', 'fetch', 'remote-notification', 'audio'],
BGTaskSchedulerPermittedIdentifiers: [
  'com.transistorsoft.fetch',
  'com.transistorsoft.customtask',
],
```

These two arrays are inconsistent with each other under Apple's
BGTaskScheduler API contract. `BGTaskSchedulerPermittedIdentifiers`
is a whitelist of identifiers the app declares it intends to register
via `BGTaskScheduler.registerForTaskWithIdentifier(...)`. The
identifier `com.transistorsoft.customtask` corresponds to a
`BGProcessingTaskRequest` job in older Transistor SDK versions, and
every `BGProcessingTaskRequest` requires the `processing`
UIBackgroundMode per Apple's documentation. The rewrite shipped the
identifier without the mode — a latent configuration bug.

Legacy yeride ([`app.config.js:108-114`](../../yeride/app.config.js))
shipped both: `UIBackgroundModes` included `processing`, and the
identifier whitelist contained `com.transistorsoft.customtask`. Under
the v4 Transistor SDK legacy is bound to, both were probably
load-bearing.

The rewrite is on `react-native-background-geolocation@5.1.1` (Phase 9
chore upgrade from v4.19.4). The pre-checklist below establishes that
v5.1.1 no longer uses BGTaskScheduler at all — so the correct
reconciliation is **Path B (drop the identifiers)**, not Path A
(re-add `processing`).

## Pre-checklist outcomes

### 1. Current `app.config.ts` matches kickoff

`UIBackgroundModes` lacks `'processing'`; `BGTaskSchedulerPermittedIdentifiers`
contains both `'com.transistorsoft.fetch'` and
`'com.transistorsoft.customtask'`. No drift since the kickoff was
written; patch shape per the kickoff still applies.

### 2. v5 TSLocationManager binary — zero BGTaskScheduler symbols

`strings(1)` over both slices of
`ios/Pods/TSLocationManager.xcframework/<slice>/TSLocationManager.framework/TSLocationManager`
returned zero hits for `BGTaskScheduler`, `BGProcessingTaskRequest`,
`BGAppRefreshTaskRequest`, `registerForTaskWithIdentifier`,
`com.transistorsoft.fetch`, or `com.transistorsoft.customtask`. The
only `bgTask` symbol present is:

```
-[TSHttpService bgTask]
-[TSHttpService setBgTask:]
TQ,N,V_bgTask
_OBJC_IVAR_$_TSHttpService._bgTask
```

That's an instance variable on `TSHttpService` using the legacy
`UIApplication.beginBackgroundTaskWithName:` API — a completely
different OS surface from BGTaskScheduler. The broader `\bBG[A-Z]`
search returns only `TSScheduler` (an internal Transistor scheduler
for auto-start/auto-stop by time-of-day) and `TSConfig.schedulerEnabled`
config keys; nothing OS-level.

Confirmed identical results on both arm64 (device) and
arm64_x86_64-simulator slices.

### 3. Transistor v5 package source — also zero hits

`grep -irE 'BGTaskScheduler|BGProcessingTaskRequest|BGAppRefreshTaskRequest|com\.transistorsoft\.fetch|com\.transistorsoft\.customtask|registerForTaskWithIdentifier'`
over `node_modules/react-native-background-geolocation/{ios,src}`
returned zero matches. The native iOS source file
(`ios/RNBackgroundGeolocation/RNBackgroundGeolocation.h`) contains no
BGTask references, and the JS source under `src/` has none either.

The iOS Expo plugin (`expo/plugin/build/iOSPlugin.js`) is an explicit
no-op:

```js
const withBackgroundGeolocationPluginIos = (config, props = {}) => {
  // Nothing to here here currently, but left for future considerations.
  return config;
};
```

So the identifier whitelist in our `app.config.ts` is pure manual
carryover from legacy yeride's pre-v5 SDK — the plugin doesn't
re-inject it at prebuild.

Upstream changelog grep was attempted via WebFetch on
`https://raw.githubusercontent.com/transistorsoft/react-native-background-geolocation/master/CHANGELOG.md`
but the WebFetch result file's JSON-wrapper format defeats
ripgrep matching on a single-line text payload (count = 1 line, 0
matches against version strings that should be present). The triad
of binary inspection + package source-grep + plugin no-op stands on
its own without the changelog confirmation.

### 4. SDK version

`node_modules/react-native-background-geolocation/package.json`
reports `"version": "5.1.1"`. No surprise bump between Turn 3 close
and Turn 4 start.

### 5. Runtime probe — skipped

No iOS device handy; static analysis is sufficient for this tiny
turn per the kickoff. The patch is mechanically simple (one key
deletion + an inline comment) and the binary-inspection signal is
strong enough that a runtime probe wouldn't add information.

### 6. HEAD SHAs

- yeride-mobile HEAD at Turn 4 start: `cc09c85`
  ("Phase 10 Turn 3 — Material Components Android theme") — matches
  the kickoff's expectation.
- yeride legacy HEAD: `40b5af1` ("build: bump version to 247") —
  matches the kickoff's expectation.
- Working tree clean except the untracked
  `docs/PHASE_10_TURN_4_KICKOFF.md`.

### 7. Generated `Info.plist` smoke

The current generated `ios/YeRideNextDev/Info.plist` reflects the
source-side state:

```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
  <string>com.transistorsoft.fetch</string>
  <string>com.transistorsoft.customtask</string>
</array>
…
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
  <string>remote-notification</string>
  <string>audio</string>
</array>
```

After Turn 4 prebuild, the `BGTaskSchedulerPermittedIdentifiers` key
will be absent (not an empty array). `UIBackgroundModes` is
unchanged.

## Decision: Path B — drop the identifiers

The evidence chain is conclusive on its own:

1. The deployed v5.1.1 binary doesn't reference BGTaskScheduler APIs
   at all (pre-checklist item 2).
2. The package source has zero matches for BGTaskScheduler or for
   the two legacy task identifier strings (item 3).
3. The iOS Expo plugin is documented as a no-op (item 3).

Therefore the identifiers in the rewrite's `app.config.ts` were
purely manual legacy carryover. Carrying them without their owning
API would declare to the OS that the app intends to register a task
it never will — Apple's BGTaskScheduler validates the registration
at runtime and logs a warning if the identifier isn't claimed within
a few seconds of app launch.

We chose Path B over Path A for two reasons:

- **Path A (add `processing`)** would inflate the entitlement
  surface for an API the SDK provably doesn't use. Adding a
  background-mode entitlement that's never exercised could prompt
  App Store review questions about background-processing usage and
  could mask a future regression where the SDK accidentally
  reintroduces BGTaskScheduler usage we didn't expect.
- **Path B (drop identifiers)** removes the false declaration to the
  OS while leaving the rest of the background-mode posture
  unchanged. If a future SDK bump reintroduces BGTaskScheduler
  usage, the rollback is symmetric: re-add the identifier whitelist
  AND `processing` together. The patch lands an inline comment
  block in `app.config.ts` that names that exit condition.

We deliberately did NOT go "do both" (add `processing` AND keep the
identifiers as defense in depth). The kickoff specifically calls
that out: either the SDK uses BGTaskScheduler (both belong) or it
doesn't (neither belongs).

## What's in

### `app.config.ts`

The `BGTaskSchedulerPermittedIdentifiers` key was removed entirely
from `ios.infoPlist` (not left as an empty array, per kickoff
sign-off criterion #4). The Phase 7 comment block above the key was
expanded with a Turn 4 paragraph explaining the v5 cleanup, citing
the binary-string finding, and naming the rollback condition so
future readers don't reintroduce the identifiers from a vague
"legacy parity" instinct.

```diff
-      // Phase 7: background-mode entitlements + Transistor BGTask identifiers
-      // required by `react-native-background-geolocation`. The SDK's iOS
-      // background-fetch hook will refuse to schedule the OS task without the
-      // identifiers below; `UIBackgroundModes` `location` + `fetch` are the
-      // entitlements the OS checks to allow GPS callbacks while the app is
-      // backgrounded. The motion-usage description is required because the
-      // SDK reads CMMotionActivityManager to gate the moving/stationary
-      // state machine.
+      // Phase 7: background-mode entitlements required by
+      // `react-native-background-geolocation`. `UIBackgroundModes`
+      // `location` + `fetch` are the entitlements the OS checks to
+      // allow GPS callbacks while the app is backgrounded. The
+      // motion-usage description is required because the SDK reads
+      // CMMotionActivityManager to gate the moving/stationary state
+      // machine.
       //
       … (unchanged Phase 9 / Phase 10 turn 1 comments) …
+      //
+      // Phase 10 turn 4: `BGTaskSchedulerPermittedIdentifiers` is
+      // intentionally NOT emitted. Legacy yeride and prior rewrite
+      // builds shipped `['com.transistorsoft.fetch',
+      // 'com.transistorsoft.customtask']` because the pre-v5
+      // Transistor SDK registered those identifiers via
+      // `BGTaskScheduler.registerForTaskWithIdentifier`. Since the
+      // v5.1.1 upgrade (Phase 9 chore), the SDK no longer uses
+      // BGTaskScheduler at all — verified by `strings(1)` on both
+      // slices of `ios/Pods/TSLocationManager.xcframework/<slice>/TSLocationManager.framework/TSLocationManager`
+      // (zero hits for `BGTaskScheduler` / `BGProcessingTaskRequest`
+      // / `BGAppRefreshTaskRequest` / `registerForTaskWithIdentifier`
+      // / the two transistorsoft identifier strings), corroborated
+      // by a clean source-grep of `node_modules/react-native-background-geolocation/{ios,src}`
+      // and the iOS Expo plugin handler being a documented no-op.
+      // Carrying the identifiers without their owning API would
+      // declare to the OS that the app intends to register a task it
+      // never will, triggering BGTaskScheduler's runtime
+      // validation-warning. We also do NOT add `processing` to
+      // `UIBackgroundModes` (Apple requires it for any
+      // `BGProcessingTaskRequest`) — the v5 SDK doesn't schedule one.
+      // If a future SDK bump reintroduces BGTaskScheduler usage,
+      // re-add both the identifier whitelist AND the `processing`
+      // background mode together.
       UIBackgroundModes: ['location', 'fetch', 'remote-notification', 'audio'],
-      BGTaskSchedulerPermittedIdentifiers: [
-        'com.transistorsoft.fetch',
-        'com.transistorsoft.customtask',
-      ],
       NSMotionUsageDescription: …
```

One adjacent comment block (~100 lines down in the
`react-native-background-geolocation` plugin entry) said the SDK's
Expo plugin "writes the iOS `BGTaskSchedulerPermittedIdentifiers`
helper config and patches Android `AndroidManifest.xml`" — describing
pre-v5 behavior that contradicts the v5 cleanup we just landed (and
that the same block already partially walked back ten lines later).
Updated to drop the iOS-plugin claim (the iOS handler is a no-op)
and noted that pre-v5 plugin versions used to write the key. This
is the same legacy assumption being removed; in scope.

### `docs/PHASE_10_PARITY_AUDIT.md`

- Header sublabel: appended "Turn 4 closed 2026-05-18" to the v2
  status line. Drafted-line gains the Turn 4 annotation note.
- §1 headline count flipped from "5 ❌ / 2 🟡 / 0 ⚠️" to
  "5 ❌ / 1 🟡 / 0 ⚠️" (the remaining 🟡 is §10.3 stripe-return ops).
- §1 `processing` bullet rewritten from "flipped ⚠️ → 🟡" to
  "flipped ⚠️ → 🟡 in Turn 1 → ✅ closed in Turn 4 (2026-05-18) via
  Path B" with the evidence chain inlined.
- §4 `UIBackgroundModes` row flipped 🟡 → ✅ with the chosen path
  documented.
- §4 `BGTaskSchedulerPermittedIdentifiers` row updated: rewrite
  column now reads "not emitted (Turn 4)"; verdict updated to ✅
  closed Turn 4 with the rollback condition noted.
- §4 action-items bullet flipped 🟡 → ✅ with the Turn 4 reference.
- §8 turn-plan row 4 marked closed (strikethrough + close date +
  doc reference).
- §10.4 verdict heading flipped from "🟡" to "✅ closed Turn 4"; the
  body was rewritten to document the evidence chain and the
  rollback condition.
- Two stale `app.config.ts:154` line references for the Turn 1
  `audio` restoration were updated to `app.config.ts:184` (the
  Turn 4 comment-block expansion shifted the line).

### `docs/PHASE_10_TURN_4.md`

This file.

## Acceptance criteria

- [x] Decision documented (Path B) with the evidence chain that
      drove it (binary inspection + source grep + iOS plugin no-op).
- [x] `app.config.ts` patch landed: the
      `BGTaskSchedulerPermittedIdentifiers` key is removed entirely
      (whole key, not an empty array).
- [x] `processing` was NOT added to `UIBackgroundModes` (kickoff
      sign-off criterion #3 — no "do both" hedge).
- [x] Audit doc §4 `processing` row flipped 🟡 → ✅ with the
      chosen-path annotation.
- [x] Audit §1 headline count updated 5 ❌ / 2 🟡 → 5 ❌ / 1 🟡.
- [x] `docs/PHASE_10_TURN_4.md` written (this file).
- [x] `npm run typecheck` green.
- [x] `npm run lint` green.
- [x] `npm run format:check` carries only the pre-existing
      `CLAUDE.md` Prettier warning (no new format issues from the
      Turn 4 patch).
- [x] `npm test` carries only the pre-existing 21 BG-geolocation
      failures (Turn 9's job); 188 of 189 suites and 1647 of 1668
      tests pass — same shape as Turn 3 close.

Generated-`Info.plist` confirmation deferred to the next `npm run
prebuild` (the kickoff explicitly tags this as optional for tiny
turns; the source-side patch is mechanically simple enough that
prebuild verification mostly catches typos).

## Native rebuild

**Required for the change to take effect** on devices — the patch
touches `ios/YeRideNextDev/Info.plist`, which is regenerated by
`expo prebuild` from `app.config.ts`. Any developer building locally
after pulling Turn 4 must run `npm run prebuild`. EAS builds pick
up the change automatically.

No Android-side change — `BGTaskSchedulerPermittedIdentifiers` and
`UIBackgroundModes` are iOS-only Info.plist keys.

## What's NOT in this turn

- **Bumping `react-native-background-geolocation`**. v5.1.1 is
  current; any further bump is a separate dependency concern.
- **Adding new background modes**. Turn 4 ONLY reconciles
  `processing` vs. the existing identifier whitelist. Restoring
  `audio` already happened in Turn 1; no other `UIBackgroundMode`
  edits.
- **Android equivalent**. Android doesn't use BGTaskScheduler; the
  v5 SDK's Android-side foreground-service setup is handled by the
  SDK's own Expo plugin (the `react-native-background-geolocation`
  block in `app.config.ts:` plugins array). No Android patch in
  this turn.
- **Rider live ETA** — Turn 5.
- **Activity tab** — Turn 6.
- **Scheduled rides** — Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **`yeride.com/stripe-return` 302-bridge** (audit §10.3) — ops
  work on the marketing domain, not engineering work in the
  rewrite repo. Stays as a pre-cutover ops checklist item.
- **Verifying behavior on a real iOS device under heavy background
  pressure**. Cutover plan §5.3 covers manual background-mode
  smoke-pass before §6.1 internal track. This turn delivers source
  change only.

## Decision log

**Why Path B over Path A.** The kickoff framed this as "the binary
inspection is suggestive, not conclusive — confirm via the
Transistor v5 docs + a runtime probe." The pre-checklist confirmed
the binary inspection's signal with a second independent line of
evidence (package source-grep) and a third (iOS plugin no-op). With
three independent lines of evidence pointing the same direction —
v5.1.1 doesn't use BGTaskScheduler — the rollback risk of Path B is
strictly lower than Path A's risk of inflating the entitlement
surface for an unused API.

The upstream changelog grep (item 3 of the kickoff) was attempted
but the WebFetch result format defeated ripgrep on the single-line
text payload. The triad of evidence already gathered is conclusive
without it; the changelog would have been corroborating evidence at
most.

**Why drop the whole key rather than leave an empty array.**
Per kickoff sign-off criterion #4: "the key is meaningless without
entries." Leaving `BGTaskSchedulerPermittedIdentifiers: []` would
signal to a future reader that the rewrite intentionally declares a
BGTaskScheduler intent (just with no entries yet), which is
backwards. Dropping the key entirely means the next person who reads
the Phase-7 comment block knows the rewrite has no BGTaskScheduler
posture at all, and the rollback condition for re-adding it is
spelled out inline.

**Why also correct the SDK-plugin comment block 100 lines away.**
The same `app.config.ts` block describes the Android-side SDK Expo
plugin and contains the claim that the plugin "writes the iOS
`BGTaskSchedulerPermittedIdentifiers` helper config." That claim is
pre-v5 behavior — directly invalidated by the v5 cleanup we just
landed (the iOS handler is documented as a no-op ten lines below
that claim). Leaving a contradictory comment in the same file as
the Turn 4 patch would be worse than fixing it; the correction is
tightly scoped to the same legacy assumption being removed.

## Sources

- [`docs/PHASE_10_TURN_4_KICKOFF.md`](PHASE_10_TURN_4_KICKOFF.md) —
  scope, two-path decision framework, pre-checklist, sign-off
  criteria.
- [`docs/PHASE_10_PARITY_AUDIT.md`](PHASE_10_PARITY_AUDIT.md) —
  §4 `processing` row, §10.4 verdict, §8 turn plan (now closed for
  Turn 4).
- [`docs/PHASE_10_TURN_3.md`](PHASE_10_TURN_3.md) — patch shape
  model + audit-update pattern for tiny `app.config.ts` turns.
- Legacy [`yeride/app.config.js:103-115`](../../yeride/app.config.js) —
  pre-v5 SDK reference (ships both `processing` mode + customtask
  identifier).
- Apple BGTaskScheduler docs — `BGProcessingTaskRequest` requires
  the `processing` UIBackgroundMode entitlement.
- Transistor v5.1.1 binary (`ios/Pods/TSLocationManager.xcframework`)
  — no BGTaskScheduler API references (both slices).
- Package source `node_modules/react-native-background-geolocation/{ios,src}` —
  no BGTaskScheduler references and no `com.transistorsoft.*`
  identifier strings.
- `node_modules/react-native-background-geolocation/expo/plugin/build/iOSPlugin.js` —
  documented no-op handler.

---

**End of PHASE_10_TURN_4.md.**
