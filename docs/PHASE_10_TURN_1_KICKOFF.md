# Phase 10 Turn 1 Kickoff — Verification pass

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 9 closed**
(latest record `docs/PHASE_9_TURN_18.md`, 2026-05-11). **Phase 10
kickoff has produced two strategy docs** (no code yet):

- `docs/PHASE_10_CUTOVER_PLAN.md` (v2) — the runbook for retiring
  legacy yeride. Locked decisions: path (b) re-sign under the
  original `app.yeride` bundle ID, pivot at the legacy production
  Firebase project, wide-jump versioning (rewrite starts at
  `versionCode: 1000`, legacy reserves `248-999` for hotfixes),
  parallel ship paths for legacy hotfixes during the rollout window.
  Status: **BLOCKED on §0 parity-audit gate**.
- `docs/PHASE_10_PARITY_AUDIT.md` (v1) — first-pass static audit of
  legacy vs rewrite. **4 ❌ rows, 2 🟡 rows, 2 ⚠️ rows** identified.
  ⚠️ rows are this turn's scope.

Your job this session is **Phase 10 Turn 1 — verification pass**.
This is a NO-CODE turn. The deliverable is `PHASE_10_PARITY_AUDIT.md`
v2 with every ⚠️ row resolved to ✅ / 🟡 / ❌, and any newly-discovered
gaps added. Once Turn 1 lands, Turns 2-6 (the actual porting work)
get sized off the v2 audit.

## Required reading (in order)

1. **`CLAUDE.md` at the repo root** — current state and conventions.
   The Phase 10 row in the project status table reads "Pending."
2. **`docs/PHASE_10_CUTOVER_PLAN.md`** §0 (the gate this turn
   contributes to clearing) and §1 (locked decisions). Don't deviate
   from the locked decisions without flagging in your first message.
3. **`docs/PHASE_10_PARITY_AUDIT.md`** in full. This is the
   document you'll be updating. Pay particular attention to §3.5,
   §3.7, §4, and §6 — they contain the ⚠️ rows.
4. **`docs/PHASE_9_TURN_5.md`** if it exists. Phase 9 Turn 5 was
   scoped as "SDK telemetry listeners (`onRouteChanged`,
   `onTrafficUpdated`) — Distance Matrix bypass." The §3.5 rider-ETA
   verification depends on whether this shipped and how. If the file
   doesn't exist, that's itself signal — the turn may have been
   skipped or folded into another turn.
5. **Legacy `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md`** for
   domain context. The legacy app's authoritative version field is
   `version: '1.0.0'` and `buildNumber: 247`.
6. **`src/presentation/features/rider/screens/RideMonitorScreen.tsx`**
   in the rewrite — confirm whether rider sees driver ETA, and
   trace where the ETA value comes from if so.
7. **`app.config.ts`** (rewrite) and `/Users/papagallo/yeapptech/dev/yeride/app.config.js`
   (legacy) — side by side for the §4 plugin-by-plugin verification.

## Starting state — what's already true

- All 160+ test suites green on `main` at the Phase 9 close HEAD.
- Cutover plan v2 and parity audit v1 sit in `docs/`. No code
  changes shipped in Phase 10 yet.
- Legacy and rewrite both ship under `app.yeride` bundle IDs
  (switched 2026-05-07 — legacy production buildNumber is `247`).
- yeapp-stage Firestore is shared between legacy and rewrite per the
  established co-existence model.

## Scope — verification items

For each item below: read the cited files, answer the questions,
and write a 2-4 sentence finding into the audit doc. Re-mark the
row from ⚠️ to ✅ / 🟡 / ❌. If you find new gaps along the way,
add them to the audit doc as new rows.

### Item A — §3.5 Rider ETA / Distance Matrix replacement

**Question:** Does the rider currently see "driver is N min away"
in `RideMonitorScreen`? If yes, where does the value come from?

**Method:**
1. Read `src/presentation/features/rider/screens/RideMonitorScreen.tsx`
   and the rider-side status views in
   `src/presentation/features/rider/components/trip/*` (especially
   `DispatchedView`, `StartedView`).
2. Grep for `eta`, `ETA`, `estimatedArrival`, `etaSeconds`,
   `etaMinutes` (case-insensitive) in `src/`.
3. Grep for `onTrafficUpdated`, `onRouteChanged` in
   `src/data/services/NavigationSdkClient.ts` and confirm whether
   driver-side telemetry writes ETA to Firestore for rider to read.
4. If Phase 9 Turn 5 docs exist, read them.

**Outcome shapes:**
- ✅ Rewrite has rider ETA from a domain-shaped path (Nav SDK
  telemetry → Firestore → rider subscription) — flip §3.5 to ✅
  with a one-line citation of where the value flows.
- 🟡 Rewrite has rider ETA but via a different mechanism than legacy
  (e.g. computed from active-ride doc fields) — flip to 🟡 with the
  diff documented.
- ❌ Rider sees no ETA in the rewrite — flip to ❌ and add a sized
  turn to the §8 turn plan ("Restore rider ETA — small, ~1-2 days").

### Item B — §3.7 Trip preview surface

**Question:** Does the rider see a pre-confirm trip-preview screen
between RouteSelect and RideMonitor? Does the driver see a pre-accept
preview between DriverDispatch and accepting?

**Method:**
1. Read `src/presentation/features/rider/screens/RouteSelectScreen.tsx`
   and its view-model. Look for a step between "rider taps a ride
   service" and "ride is created" — is there a confirmation modal /
   sheet / screen?
2. Read `src/presentation/features/driver/screens/DriverDispatchScreen.tsx`
   and its view-model. Look for a step between "driver taps a ride
   in the list" and "ride is dispatched" — is there a preview?
3. Compare to legacy `TripPreviewModal.js` to confirm what surface
   is being matched.

**Outcome shapes:** ✅ / 🟡 / ❌ same as Item A.

### Item C — §4 dropped UIBackgroundMode `audio` and `processing`

**Question:** Does the rewrite need `audio` for Nav SDK voice
guidance? Does it need `processing` for any background work?

**Method:**
1. Read `src/data/services/NavigationSdkClient.ts` and check for
   audio-related calls (`setAudioGuidance`, `setSpeechRate`, etc.)
   or any reference to voice guidance.
2. Read `@googlemaps/react-native-navigation-sdk` docs / type
   definitions in `node_modules/` to confirm voice guidance audio
   plays on the device.
3. If voice guidance is enabled and audio backgrounding is needed,
   add `audio` back to `ios.infoPlist.UIBackgroundModes` in
   `app.config.ts` as part of THIS turn (one-line fix — counts as
   verification-cleanup).
4. For `processing` — grep the rewrite for `BGProcessingTask` or
   `expo-task-manager` usage. Legacy used it for distance-tracking
   background processing; rewrite likely doesn't need it.

**Outcome shapes:**
- ✅ Both modes confirmed not needed — annotate the audit row.
- ❌ One or both needed — fix `app.config.ts` in this turn, then
  flip to ✅ post-fix.

### Item D — §4 missing custom Expo plugins

For each plugin missing from the rewrite, read the legacy plugin
file and decide if its function is needed:

1. **`withMaterialTheme.js`** — legacy uses for Android Material 3
   theming. Rewrite uses NativeWind 4 + Tailwind. Likely retired but
   confirm by reading `plugins/withMaterialTheme.js` in legacy.
2. **`withPackagingOptions.js`** — legacy uses for Android packaging
   workaround. Rewrite has `withGradleHeap` and a different module
   set. Confirm not needed.
3. **`withFmtFix.js`** — likely a format/build fix. Read legacy
   source and confirm rewrite doesn't hit the same issue.
4. **`withStripeIosSdkOverride.js`** — Stripe iOS SDK pin. Rewrite
   uses `@stripe/stripe-react-native@0.63.0` directly. Confirm the
   pin from legacy is no longer needed.
5. **`withFirebaseSdkVersion.js`** — legacy pins Firebase BoM 34.0.0
   via this plugin. Rewrite uses `useFrameworks: 'static'` + a
   different mechanism. Confirm via `scripts/patch-podfile.js` and
   the rewrite's Firebase setup.
6. **`react-native-map-link`** plugin — legacy uses for cross-app
   "open in Maps" / "navigate via Waze" links. Confirm rewrite
   doesn't need (likely Nav SDK in-app replaces this).

**Outcome shapes:** For each: ✅ retired (with one-line reason) or
❌ needed (add to turn plan with size estimate).

### Item E — Wallet TransactionHistory location

**Question (re §3.6, which is 🟡 not ⚠️ but cheap to verify here):**
Where does the legacy app read transaction history from? Per-user
subcollection? Stripe API? Cloud Function?

**Method:**
1. Read `src/components/TransactionHistory.js` in legacy.
2. Identify the data source (likely a Firestore query or Stripe
   API call via the microservice).
3. Update §3.6's "Phase 10 turn scope" bullet list with the
   discovered data path so the next turn can build it without
   re-discovering.

**Outcome:** No status flip — §3.6 stays 🟡. Just enrich the doc
with the discovered data path.

### Item F — Cross-check for newly-discovered gaps

While reading the rewrite's screens / view-models, watch for:

- Any TODO / FIXME / `// Phase 10` / `Phase 3.5` / `deferred` comment.
- Any feature flag / `__DEV__` gate that hides a surface in
  production.
- Any `@ts-expect-error` or `as any` cast that might hide a missing
  type / missing repo method.

If any are found, add a row to the audit doc under the appropriate
section.

## Out of scope (defer to later turns)

- Building any of the ❌ features (Turns 2-6 cover those).
- Manual device smoke against `yeapp-stage` — that's Turn 7 / the
  final pre-cutover gate.
- Changes to the cutover plan doc — the cutover plan is locked.
- Changes to legacy yeride code.

## Pre-checklist

Surface these in your first message back if not already done:

1. **Confirm `docs/PHASE_9_TURN_5.md` exists / doesn't.** If it
   doesn't, mention that — it changes how you investigate Item A.
2. **Confirm both repos are at the expected HEAD.** Run
   `git log -1 --oneline` in `/Users/papagallo/yeapptech/dev/yeride`
   and `/Users/papagallo/yeapptech/dev/yeride-mobile`. Note the SHAs
   in the turn doc.
3. **Confirm rewrite verify gates are green at HEAD** (no in-flight
   regression that would muddy the audit):
   `npm run typecheck && npm run lint && npm test`.

## Deliverable

A single PR / commit on `main` containing:

1. **Updated `docs/PHASE_10_PARITY_AUDIT.md`** — every ⚠️ row
   resolved; the §1 headline finding count updated; the §8 turn plan
   updated if new gaps surfaced; a new "v2 — verified 2026-MM-DD"
   line at the top.
2. **(If Item C found `audio` is needed)** A one-line fix to
   `app.config.ts` adding `audio` back to `UIBackgroundModes`.
3. **A new `docs/PHASE_10_TURN_1.md`** documenting:
   - What was verified
   - Each ⚠️ → final status mapping with citations (file:line)
   - Any newly-discovered gaps
   - Updated total turn-plan estimate
   - Decision log (anything you decided differently from the v1
     audit, with reasoning)

No code changes beyond the optional `app.config.ts` fix.

## Sign-off criteria

- [ ] Every ⚠️ row in `PHASE_10_PARITY_AUDIT.md` is now ✅ / 🟡 / ❌.
- [ ] If any ❌ rows were added, they're in the §8 turn plan with a
      size estimate.
- [ ] Audit v2 has a new dated header.
- [ ] `PHASE_10_TURN_1.md` written, follows the format of recent
      `PHASE_9_TURN_*.md` docs.
- [ ] If `app.config.ts` was touched, `npm run verify` is green.
- [ ] Cutover plan §0 status (currently "not started") updated to
      reflect Turn 1 closure but parity-audit gate still blocked on
      Turns 2-6.

---

**End of PHASE_10_TURN_1_KICKOFF.md.** Read this top to bottom on a
new session and execute. Ask if any pre-checklist item surfaces a
blocker.
