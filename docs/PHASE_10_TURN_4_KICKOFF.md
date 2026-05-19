# Phase 10 Turn 4 Kickoff — `processing` UIBackgroundMode reconciliation

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 3
closed 2026-05-18** (Material Components Android theme via
`plugins/withMaterialTheme.js`; see `docs/PHASE_10_TURN_3.md`). Audit
v2 post-Turn-3 shows **5 ❌ / 2 🟡 / 0 ⚠️** — this turn closes the
sole 🟡 that's a true config inconsistency (the other 🟡, §10.3
`stripe-return` deep-link bridge, is an ops concern outside the
rewrite repo).

Turn 4 is **tiny (~½ day)** and resolves a latent BGTaskScheduler
misconfiguration. It is NOT a production blocker, but it removes a
"why is this here?" line item before cutover and ensures the
rewrite's iOS background-mode entitlements match what the v5
TSLocationManager pod actually uses.

## Context — why this turn now

The rewrite's `app.config.ts` currently declares:

```ts
UIBackgroundModes: ['location', 'fetch', 'remote-notification', 'audio'],
BGTaskSchedulerPermittedIdentifiers: [
  'com.transistorsoft.fetch',
  'com.transistorsoft.customtask',
],
```

These two arrays are inconsistent under Apple's BGTaskScheduler
contract. `BGTaskSchedulerPermittedIdentifiers` is a whitelist of
identifiers the app intends to register via
`BGTaskScheduler.registerForTaskWithIdentifier(...)`. The identifier
`com.transistorsoft.customtask` corresponds to a
`BGProcessingTaskRequest` job in older Transistor SDK versions, and
**every `BGProcessingTaskRequest` requires the `processing`
UIBackgroundMode** per Apple's documentation. The rewrite ships the
identifier without the mode — a latent configuration bug.

Legacy yeride (`/Users/papagallo/yeapptech/dev/yeride/app.config.js:108-114`)
ships both: `UIBackgroundModes` includes `processing`, and the
`BGTaskSchedulerPermittedIdentifiers` array contains
`com.transistorsoft.customtask`. So under the v4 background-
geolocation SDK that legacy is bound to, both were probably load-
bearing.

The rewrite is on `react-native-background-geolocation@5.1.1` (post-
v5 upgrade landed mid-Phase-9). A **strong preliminary finding**
from a v5 binary inspection (run during this kickoff): the v5
TSLocationManager binary contains **no BGTaskScheduler API
references** at all. Specifically, `strings` on
`ios/Pods/TSLocationManager/TSLocationManager.xcframework/<slice>/TSLocationManager.framework/TSLocationManager`
shows:

- ✅ `UIBackgroundModes` — referenced (looking for `'location'`).
- ✅ `bgTask` / `beginBackgroundTaskWithName` (the legacy
  `UIApplication.beginBackgroundTask` API).
- ❌ `BGTaskScheduler` / `BGProcessingTaskRequest` /
  `BGAppRefreshTaskRequest` / `scheduleNotificationProcessing` /
  `registerForTaskWithIdentifier` — none.
- ❌ `com.transistorsoft.fetch` / `com.transistorsoft.customtask` —
  neither identifier appears in v5.

If this finding survives the pre-checklist verification below, the
correct fix is **Path B (drop the identifiers from
`BGTaskSchedulerPermittedIdentifiers`)** — not Path A (re-add
`processing`). Adding `processing` for an SDK that doesn't use it
would inflate the app's entitlement surface for no benefit and
potentially raise App Store review questions.

But the binary-string search is suggestive, not conclusive — the
pre-checklist below confirms via the Transistor v5 docs + a
runtime probe.

## Required reading (in order)

1. **Rewrite `app.config.ts:130-180`** — the iOS Info.plist block
   that owns `UIBackgroundModes` + `BGTaskSchedulerPermittedIdentifiers`.
   Note the lines are within the larger `ios.infoPlist:` object;
   the surrounding context (motion-usage description,
   background-geolocation license, etc.) is what the patch will
   sit next to.

2. **Legacy `/Users/papagallo/yeapptech/dev/yeride/app.config.js:103-115`** —
   the legacy reference. Legacy ships `processing` in UIBackgroundModes
   AND `customtask` in the identifier whitelist. Pre-v5 SDK behavior.

3. **`docs/PHASE_10_PARITY_AUDIT.md` §4 row for `processing`** —
   the audit's verdict citation that informs this turn's scope.

4. **`docs/PHASE_10_PARITY_AUDIT.md` §10.4** — Turn-1 discovery
   write-up that surfaced this gap. Reads in two minutes.

5. **`docs/PHASE_10_TURN_3.md`** — the prior turn. The patch shape
   for tiny `app.config.ts` edits, the audit-update flow, and the
   commit pattern are the model for Turn 4 (this turn is even
   simpler — one or two lines in `app.config.ts` plus the audit
   updates).

6. **Transistor v5 release notes / migration guide** —
   `node_modules/react-native-background-geolocation/CHANGELOG.md` if
   present, OR the upstream
   https://github.com/transistorsoft/react-native-background-geolocation/blob/master/CHANGELOG.md
   (WebFetch fallback). Search the changelog for "BGTask",
   "BGProcessingTask", "customtask", "fetch identifier", and any
   "v5.0.0" / "5.0.0" / "v5 migration" sections. The kickoff's
   binary-string finding suggests v5 deprecated BGTaskScheduler
   usage — confirm in writing before committing.

## Starting state — what's already true

- All Turn 3 deliverables landed on `main` at commit `cc09c85`.
  HEAD on the rewrite at Turn 4 start: whatever `main` is at the
  moment you pick this up. Capture and record in the turn doc.
- The pre-existing 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain scoped as Turn 9 — DO NOT try to fix them in this turn.
- The rewrite uses `react-native-background-geolocation@5.1.1` per
  `package.json`; this turn does NOT bump that version.
- `plugins/` directory currently contains seven custom plugins after
  Turn 3 (`withMaterialTheme.js` just landed):
  `withCrashlyticsUploadSymbols.js`, `withFirebasePodfileFix.js`,
  `withGoogleMapsApiKey.js`, `withGradleHeap.js`,
  `withMaterialTheme.js`, `withNavigationSdk.js`,
  `withPlayServicesLocationVersion.js`. None of them touch
  `UIBackgroundModes` or `BGTaskSchedulerPermittedIdentifiers` —
  both arrays are owned directly by `app.config.ts:ios.infoPlist`.
- The v5 SDK upgrade also bumped iOS minimum deployment target to
  16.0; no app-side bump needed for this turn.

## Scope — what to ship

A one-or-two-line `app.config.ts` patch plus the usual audit +
turn-doc deliverables. Two paths — pre-checklist picks one:

### Path A — Re-add `processing` to UIBackgroundModes (conservative parity)

Add `'processing'` to the `UIBackgroundModes` array so it matches
legacy yeride's `['location', 'fetch', 'processing', 'remote-notification', 'audio']`.
Net diff: one line added to `app.config.ts`. Leaves the identifier
whitelist alone. Choose Path A if:

- The Transistor v5 docs confirm `BGTaskScheduler` usage is still
  active for `customtask` / `fetch` in v5.
- OR the pre-checklist surfaces a runtime "missing UIBackgroundMode
  processing" error from a real iOS launch.
- OR you cannot conclusively rule out v5 BGTask usage from docs +
  binary inspection.

### Path B — Drop both identifiers from BGTaskSchedulerPermittedIdentifiers (v5-aware cleanup)

Remove `'com.transistorsoft.fetch'` and `'com.transistorsoft.customtask'`
from `BGTaskSchedulerPermittedIdentifiers`. Choose Path B if the
pre-checklist confirms v5 does NOT use BGTaskScheduler:

- The TSLocationManager v5 binary lacks BGTaskScheduler symbols
  (confirmed at kickoff time — see Context section).
- Transistor v5 changelog / migration guide confirms the move away
  from BGTaskScheduler (or never mentions it).
- No runtime crash / warning surfaces from a launch test.

If both identifiers are removed and the array becomes empty, drop
the whole key from `infoPlist` rather than leaving an empty array
— the key is meaningless without entries.

### Why NOT a "do both" approach

Don't add `processing` AND keep the identifiers as a "defense in
depth" hedge. Either the SDK uses BGTaskScheduler (both belong) or
it doesn't (neither belongs). Carrying a now-unused identifier
declares to the OS the app intends to register a task it never
will — Apple's BGTaskScheduler validates the registration at runtime
and logs a warning if the identifier isn't claimed within a few
seconds of app launch.

## Pre-checklist

Surface these in your first message back if not already resolved.

1. **Confirm the current rewrite state matches the kickoff
   description.**

   ```bash
   grep -n -A8 'UIBackgroundModes\|BGTaskSchedulerPermittedIdentifiers' \
     /Users/papagallo/yeapptech/dev/yeride-mobile/app.config.ts | head -20
   ```

   Expected: `UIBackgroundModes` does NOT contain `'processing'`;
   `BGTaskSchedulerPermittedIdentifiers` contains both
   `'com.transistorsoft.fetch'` and `'com.transistorsoft.customtask'`.
   If the file has drifted, the patch shape changes (e.g. if
   `processing` is already there, the turn collapses to a Path-B
   identifier-cleanup only).

2. **Re-run the v5 binary inspection that informed the kickoff
   recommendation.**

   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   TSLM_BIN="ios/Pods/TSLocationManager/TSLocationManager.xcframework/ios-arm64_x86_64-simulator/TSLocationManager.framework/TSLocationManager"
   strings "$TSLM_BIN" | grep -iE 'BGTask|BGProcessing|BGAppRefresh|customtask|registerForTaskWithIdentifier|com\.transistor.*fetch' | sort -u
   ```

   Expected: empty output (no BGTaskScheduler API references and no
   v4 task identifiers in v5). If this surfaces NEW BGTaskScheduler
   symbols not seen at kickoff time, that flips the recommendation
   to Path A.

3. **Check the Transistor v5 changelog / migration guide for
   explicit BGTaskScheduler discussion.**

   ```bash
   find node_modules/react-native-background-geolocation -maxdepth 3 \
     -iname 'CHANGELOG.md' -o -iname 'MIGRATION*.md' | head -3
   ```

   If a local changelog exists, grep for `BGTask` / `customtask` /
   `5.0.0`. If absent, WebFetch the upstream GitHub changelog (the
   path is in the Required-reading list). Look for any mention of
   removing the BGTaskScheduler dependency in v5 / "no longer
   requires BGTaskSchedulerPermittedIdentifiers" / similar.

4. **Confirm `react-native-background-geolocation@5.1.1` (no
   surprise bump).**

   ```bash
   node -e "console.log(require('./node_modules/react-native-background-geolocation/package.json').version)"
   ```

   Expected: `5.1.1`. If a chore commit landed between Turn 3 and
   Turn 4 that bumped the version, re-run check 2 against the new
   binary.

5. **(Optional, recommended) Quick runtime probe.** If the
   reviewer has an iOS device or simulator already booted with a
   recent rewrite build, check Console.app for any log line like
   `Missing required UIBackgroundMode 'processing'` or
   `BGTaskScheduler: identifier ... not whitelisted`. The absence
   of those is corroborating evidence; their presence flips the
   recommendation. Skip if no device handy — the static-analysis
   path is sufficient for this tiny turn.

6. **Capture HEAD SHA of both repos.** Same pattern as Turn 2/3
   pre-checklists. Expected: Turn 4 yeride-mobile HEAD == `cc09c85`
   (Turn 3 close), yeride legacy HEAD == `40b5af1`, unless other
   commits land between.

7. **Decide whether to smoke-test the prebuild locally.** This
   turn touches only `app.config.ts` — `npm run prebuild` will
   regenerate `ios/<App>/Info.plist`. Smoke-grep the generated
   plist for the resulting `UIBackgroundModes` / `BGTaskSchedulerPermittedIdentifiers`
   shape. Cheap (~30s) and worth doing if iOS files are already
   prebuilt; not strictly required.

## Suggested approach

1. **Pre-checklist first.** Resolve items 1-6 above before
   touching any code. Items 2 and 3 are the decision drivers; the
   strong default per the kickoff's preliminary binary inspection
   is **Path B** (drop identifiers).

2. **Apply the one-line patch.**

   - **If Path B (recommended):** delete the
     `BGTaskSchedulerPermittedIdentifiers` array entirely (both
     entries). Leave a comment block above the deleted region
     explaining the v5 cleanup and citing the binary-string finding,
     so future readers don't reintroduce it from a vague "legacy
     parity" instinct. Net diff: array deleted, comment added.
   - **If Path A:** add `'processing'` to `UIBackgroundModes`
     between `'fetch'` and `'remote-notification'` (matches legacy
     ordering). Add an inline comment explaining the
     BGProcessingTask requirement.

3. **(Optional) Smoke-test the generated plist.** If iOS is already
   prebuilt, run `npm run prebuild` and grep the regenerated
   `ios/<App>/<App>/Info.plist` (or equivalent) for the new shape:

   ```bash
   grep -A20 'UIBackgroundModes\|BGTaskSchedulerPermittedIdentifiers' \
     ios/YeRideNextDev/YeRideNextDev/Info.plist
   ```

   Verify the array reflects the chosen path. Skip if iOS isn't
   prebuilt; the source change is mechanically simple enough that
   prebuild verification mostly catches typos.

4. **Verify gates.**

   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck    # green — `infoPlist` is loosely typed; deletion is safe
   npm run lint         # green — no JS-side change to lint
   npm run format:check # green or pre-existing CLAUDE.md warning only
   npm test             # 21 BG-geolocation failures remain (Turn 9); no new failures
   ```

5. **Audit + turn doc.**

   - Flip `docs/PHASE_10_PARITY_AUDIT.md` §4 `processing` row from
     🟡 to ✅ with the chosen path documented.
   - Update §1 headline count from "5 ❌ / 2 🟡 / 0 ⚠️" to
     "5 ❌ / 1 🟡 / 0 ⚠️" (the remaining 🟡 is §10.3
     `stripe-return` deep-link bridge — an ops item, not a
     code-side row).
   - Update §1 `processing` bullet to indicate Turn 4 closure with
     the chosen path.
   - Update §4 action-items 🟡 bullet for `processing`.
   - Update §10.4 verdict line.
   - Update §8 turn plan: mark Turn 4 ✅ closed (strike + close
     date).
   - Update audit header status line: append "Turn 4 closed
     YYYY-MM-DD" sublabel (keep v2 — Turn 10 produces v3).
   - Write `docs/PHASE_10_TURN_4.md` following
     `PHASE_10_TURN_3.md`'s format. Short — this turn is genuinely
     one line of code change + audit edits.

## Out of scope (defer to later turns)

- **Bumping `react-native-background-geolocation`.** v5.1.1 is
  current; any further bump is a separate dependency concern.
- **Adding new background modes.** This turn ONLY reconciles
  `processing` vs. the existing identifier whitelist. Restoring
  `audio` already happened in Turn 1; no other UIBackgroundMode
  edits.
- **Android equivalent.** Android doesn't use BGTaskScheduler;
  the v5 SDK's Android-side foreground-service setup is handled
  by the SDK's own Expo plugin (`react-native-background-geolocation`
  in the plugin block, lines 252-273 of `app.config.ts`). No
  Android patch in this turn.
- **Rider live ETA** — Turn 5.
- **Activity tab** — Turn 6.
- **Scheduled rides** — Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **`yeride.com/stripe-return` 302-bridge** (§10.3) — ops work on
  the marketing domain, not engineering work in the rewrite repo.
  Stays as a pre-cutover ops checklist item.
- **Verifying behavior on a real iOS device under heavy
  background pressure.** Cutover plan §5.3 covers manual
  background-mode smoke-pass before §6.1 internal track. This turn
  delivers source change only.

## Deliverable

A single PR / commit on `main` containing:

1. **`app.config.ts`** — one-line patch per the chosen path,
   with an inline comment explaining the v5 SDK behavior or the
   BGProcessingTask requirement.
2. **`docs/PHASE_10_PARITY_AUDIT.md`** updated — §1 count, §1
   bullet, §4 row status, §4 action items, §8 turn plan, §10.4
   verdict, header sublabel.
3. **`docs/PHASE_10_TURN_4.md`** documenting:
   - Pre-checklist outcomes (current `app.config.ts` state,
     v5 binary-string findings, changelog grep result,
     SDK version, HEAD SHAs)
   - The decision (Path A or Path B) with the evidence chain
   - The patch (diff-style or before/after)
   - Acceptance criteria
   - Out-of-scope list

`npm run verify` should be green except for the carried-over 21
BG-geolocation failures (Turn 9's job).

## Sign-off criteria

- [ ] Decision documented (Path A vs Path B) with the evidence
      chain that drove it.
- [ ] `app.config.ts` patch landed — either `processing` added to
      `UIBackgroundModes` (Path A) OR identifiers dropped from
      `BGTaskSchedulerPermittedIdentifiers` (Path B).
- [ ] No "do both" / "defense in depth" hedge.
- [ ] If Path B and the array becomes empty, the whole
      `BGTaskSchedulerPermittedIdentifiers` key is removed (not
      left as an empty array).
- [ ] Audit doc §4 `processing` row flipped 🟡 → ✅ with the
      chosen-path annotation.
- [ ] Audit §1 headline count updated 5 ❌ / 2 🟡 → 5 ❌ / 1 🟡
      (or further if §10.3 stripe-return also moves — but that's
      not this turn's job).
- [ ] `PHASE_10_TURN_4.md` written.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green; jest carries the 21 pre-existing failures only.
- [ ] (If iOS prebuilt) Generated Info.plist confirmed to reflect
      the chosen path.

## Native rebuild

**Required for the change to take effect** — touches
`ios/<App>/<App>/Info.plist` (regenerated by `expo prebuild` from
`app.config.ts`). Practical implication: any developer building
locally after pulling this turn must run `npm run prebuild`. EAS
builds pick up the change automatically.

No Android-side change — `BGTaskSchedulerPermittedIdentifiers` and
`UIBackgroundModes` are iOS-only.

---

**End of PHASE_10_TURN_4_KICKOFF.md.** Read top to bottom on a new
session and execute. Ask if any pre-checklist item surfaces a
blocker — especially if the v5 binary string inspection (item 2)
returns BGTaskScheduler symbols that weren't present at kickoff
time. That would flip the recommendation from Path B to Path A.
