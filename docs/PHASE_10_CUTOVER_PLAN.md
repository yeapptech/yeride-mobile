# Phase 10 — Cutover Plan

**Status:** Draft v2 — runbook. **§0 feature-parity gate cleared
2026-05-30. Phase 10 complete.** Parity-audit Turns 1-9 closed
2026-05-18 → 2026-05-19; Turn 10.5 (rewrite-ahead payment-failure
surfacing) closed 2026-05-26; Turn 10 (audit v3 + final sign-off)
closed 2026-05-30. §1 below is the active workstream. See
`PHASE_10_PARITY_AUDIT.md` §1 (headline `0 ❌ / 2 🟡 (rewrite-ahead) / 0 ⚠️`).
**Owner:** Hernando Sierra (hernando.sierra@yeapp.tech)
**Drafted:** 2026-05-18 · revised 2026-05-18 with versioning +
hotfix posture decisions · §0 status updated post-Turn-1 2026-05-18 ·
§0 gate cleared 2026-05-19 post-Turn-9 pending Turn 10 sign-off ·
Turn 10 closed 2026-05-30 — Phase 10 complete.
**Phase scope:** Half-sprint per REFACTOR_PLAN.md §6 — retire the
legacy yeride app and ship the rewrite as the production binary.

This is a **standalone cutover runbook**, not a turn-by-turn kickoff.
The day-of-cutover on-call engineer reads it top to bottom. Per-turn
PHASE_10_TURN_N.md docs (if work needs to be sliced) land alongside
this file as the prep work executes.

---

## 0. Pre-cutover gate — feature parity

**Status: GATE CLEARED 2026-05-30. Phase 10 complete.**
Turns 1-9 of the parity-audit turn plan
(`PHASE_10_PARITY_AUDIT.md` §8) closed 2026-05-18 → 2026-05-19;
Turn 10.5 (rewrite-ahead synchronous-error payment-failure surfacing)
closed 2026-05-26; Turn 10 (audit v3 re-walk + sign-off + inline
prettier cleanup that unblocked `npm run verify`) closed 2026-05-30.
Headline is now **0 ❌ / 2 🟡 (both rewrite-ahead) / 0 ⚠️**. §1 below
is the active workstream.

The legacy app is in production and carries features that have not
yet been ported to the rewrite. Until the rewrite reaches parity,
the staged-rollout mechanism in §6 cannot start — a user who
auto-updates from legacy to the rewrite must not lose access to a
feature they were using yesterday.

This gate produces a single artifact: a **parity audit doc**
(working name `docs/PHASE_10_PARITY_AUDIT.md`) that lists every
legacy screen, feature, deep link, push payload, and Firestore
field write, marked one of:

- ✅ ported (and tested)
- 🟡 ported with known differences (call out the diff explicitly)
- ❌ not yet ported — Phase 10.x turn required
- ⚠️ ported but the legacy version has bug-fixes the rewrite is missing

The audit work-stream:

1. Walk the legacy app screen-by-screen on a real device against
   `yeapp-prod` (or stage) and check each off against the rewrite.
2. Grep legacy `src/` for every Firestore write call site and every
   Cloud Function callable invocation; confirm the rewrite has a
   matching write/call.
3. Read legacy `app.config.js` and the rewrite's `app.config.ts`
   side-by-side; diff `notifications.iosDisplayInForeground`, scheme
   handlers, deep-link URLs, background modes, intent filters,
   Android `queries`.
4. List every legacy ❌ as a Phase 10.x turn with a sized estimate.
   Ship the turns in priority order before §1 of this doc unlocks.

When the audit lands with only ✅/🟡 rows, the gate clears and §1
takes over.

---

## 1. Locked decisions

The pre-cutover decisions called out in REFACTOR_PLAN.md §7
Decision 1 / Decision 6 + the 2026-05-18 revision are settled:

| #   | Decision                                                                                                                                                                                                                                                                                                            | Rationale                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Path (b): re-sign under the original `yeride` bundle ID.** Single App Store / Play listing preserved. Existing users get the rewrite as a normal in-place update.                                                                                                                                                 | Retention across the update is the deciding factor. Path (a) would have forced every existing rider/driver to re-download under a new listing, breaking install-base continuity.                                                                                                                                                                                                              |
| 2   | **Pivot `yeride-next` at the legacy production Firebase project.** No fresh `yeride-next-prod` project; no production data migration. The new binary points at the existing prod `yeapp-prod` Firestore + Functions + Storage at cutover.                                                                           | Mirrors the dev/stage co-existence model that's already proven across Phases 2–9. The dual-write compat code carries over unchanged. Lowest-risk data path.                                                                                                                                                                                                                                   |
| 3   | **Bundle IDs already match — no provisioning surgery needed.** Legacy `app.config.js` and the rewrite's `app.config.ts` BOTH ship `app.yeride.dev` / `app.yeride.stage` / `app.yeride` for the three envs (switched 2026-05-07 to inherit the Transistor SDK license).                                              | Path (b) reduces to a version bump on the existing listings. Same Apple Team ID, same Play signing key, same APNs auth key, same FCM server key.                                                                                                                                                                                                                                              |
| 4   | **Wide-jump versioning. Legacy reserves `buildNumber`/`versionCode` `248-999` as the hotfix headroom range. Rewrite starts at `1000`.** Marketing version is bumped to `2.0.0` for the rewrite; legacy stays on `1.x` for any hotfix releases.                                                                      | Decouples rewrite rollout from legacy hotfix sequence — both can ship in parallel under the same App Store / Play listings without versionCode collisions. The 752-build gap is comfortably more headroom than legacy will use during a 2-week rollout window.                                                                                                                                |
| 5   | **Parallel ship paths for legacy hotfixes.** Any P0 surfacing in the legacy app DURING the rewrite rollout window gets fixed and shipped on the legacy codebase under the reserved `248-999` versionCode block, in parallel with the in-flight rewrite rollout. Rewrite rollout does NOT pause for legacy hotfixes. | Legacy is in production and may need fixes during cutover — pausing the rewrite rollout for each one would stretch cutover indefinitely. Both binaries write to the same Firestore + Cloud Functions, so a hotfix in legacy doesn't risk schema divergence. Requires legacy repo stays buildable on a hotfix branch throughout cutover (see §10 — do NOT archive until 100% rollout settles). |

**Implication of (1) + (3) combined:** the cutover IS a single App
Store + Play submission under the existing `app.yeride` listings,
versioned past the legacy app's current `buildNumber: 247` /
`versionCode: 247`. There is no separate listing to flip, no DNS
swap, no Firestore export/import. The "cutover" is the moment the
first user device auto-updates.

---

## 2. Architecture of the parallel-run window

For one full release cycle (~2 weeks of staged rollout), the legacy
and rewrite binaries run **in production simultaneously**, both
writing to `yeapp-prod` Firestore. The data co-existence patterns
already proven in dev/stage carry over verbatim:

- **DTO permissive parsing stays put.** `seat`/`seatCapacity`,
  `polyline`/`encodedPolyline`, the legacy nested
  `stripe = { id, charges_enabled, … }` Stripe Connect shape, the
  three-shape `defaultPaymentMethod` accepter — all of it must keep
  reading legacy writes for the duration of the rollout window.
- **Canonical-and-legacy dual writes stay put.** `userMapper` writes
  both nested `stripe = {…}` and the canonical flat fields. Trip
  writes stay on `setDoc { merge: true }`.
- **Cloud Functions stay deployed once, called by both apps.** Byte-
  identical signatures. `completeTrip` / `cancelTrip` / `tipDriver`
  in `us-east1` already serve both binaries.
- **Firestore security rules stay deployed once.** Both binaries
  authenticate as the same end users; the rules don't distinguish
  client versions.

Nothing about the new code's data behavior changes at cutover. The
prod pivot is purely a config swap (which Firebase project the
rewrite's `production` env resolves to).

---

## 3. Pre-cutover gates

These must ALL be green before submitting binaries to App Store
Connect / Play Console for review:

### 3.1 CI & verify gates

- `npm run verify` (typecheck + lint + format + jest) green on
  `main` at the cutover SHA. **Status (2026-05-30, post-Turn-10):
  verify green — 213 suites / 1986 tests passing / 0 failing.**
  Turn 9 closed the BG-geolocation test regression; Turn 10
  cleaned up the 2 pre-existing prettier format-check failures
  (`docs/PHASE_10_TURN_7.md`, `RouteSelectScreen.tsx`) inline so
  the full chain exits 0 cleanly. No outstanding verify-gate
  blockers at the cutover SHA `d0c3603` (yeride-mobile) /
  `343e668` (yeride-functions).
- Detox `smoke`, `auth`, `rider`, `driver`, `screenshots` suites all
  green on iOS AND Android (REFACTOR_PLAN.md §8 DoD #2).
- Use-case test coverage ≥ 100% for `app/usecases/*`
  (REFACTOR_PLAN.md §8 DoD #4).
- Domain test coverage ≥ 100% for `domain/services/*` and value
  objects (REFACTOR_PLAN.md §8 DoD #5).

### 3.2 Manual parity smoke

Walk a single device through every rider screen + every driver
screen against `yeapp-prod`, comparing side-by-side with the legacy
binary on a second device:

- Rider: register → email verify → Stripe customer → request ride →
  route select → ride monitor → receipt → tip → cancel.
- Driver: register → Stripe Connect → vehicle registration → photo
  upload → driver-home → dispatch → in-app navigation → request
  payment → completion → earnings dashboard → cancel.
- Cross-side: rider creates trip while driver online; both observe
  trip events live; chat round-trips.

Diff observations in a parity sheet. Any P0/P1 gap = block submission.

### 3.3 Beta validation

- TestFlight beta cohort + Play Internal Testing cohort have been
  running the rewrite against the SAME bundle ID's beta track for ≥
  1 full release cycle without P0 regressions (REFACTOR_PLAN.md §8
  DoD #6).
- Crashlytics non-fatal rate ≤ legacy app's non-fatal rate on the
  same cohort.
- Zero pending P0/P1 reports from beta testers in Asana / Linear (or
  wherever the beta intake lives).

### 3.4 Backend health

- `yeride-functions` deployed to `yeapp-prod` at the SHA the rewrite
  expects (the callable signatures `completeTrip` / `cancelTrip` /
  `tipDriver` are versioned in the legacy app's HEAD; the rewrite
  must match).
- `yeride-stripe-server` deployed to Cloud Run for `yeapp-prod` and
  reachable at `STRIPE_SERVER_URL` baked into the new binary.
- Firestore rules + indexes deployed and unchanged from legacy app's
  HEAD (REFACTOR_PLAN.md §8 DoD #7).

---

## 4. Production Firebase pivot

The single config change that flips production over:

### 4.1 Drop in prod Firebase config files

```
firebase/config/production/
├── GoogleService-Info.plist     # downloaded from yeapp-prod
└── google-services.json         # downloaded from yeapp-prod
```

`app.config.ts:62-79` reads these by precedence; check-in to repo
(NOT committed under EAS Secrets — these files contain non-secret
public API keys but ARE the production identity, so they belong in
git for build reproducibility).

### 4.2 Wire prod Firebase env vars in EAS

For the production EAS profile, set:

- `EXPO_PUBLIC_APP_ENV=production`
- `EXPO_PUBLIC_USE_FIREBASE=true`
- `STRIPE_SERVER_URL` → prod Cloud Run URL
- `STRIPE_SERVER_API_KEY` → prod API key (EAS Secret)
- `BG_GEOLOCATION_LICENSE_KEY_ANDROID` → prod JWT (NOT the dev/stage
  JWT)
- `BG_GEOLOCATION_LICENSE_KEY_IOS` → prod JWT
- `GOOGLE_MAPS_APIKEY_ANDROID` / `GOOGLE_MAPS_APIKEY_IOS` → prod
  keys (different from dev/stage in legacy; verify by reading
  legacy's prod EAS profile)

### 4.3 Verify against legacy's prod config

Read legacy `yeride/app.config.js` production branch (the
`appEnv === 'production'` block) and confirm:

- Same APNs auth key uploaded to Firebase Console for `yeapp-prod`.
- Same FCM Server Key in Firebase Console for `yeapp-prod`.
- Same Google Maps API key whitelist (the new build's bundle ID
  `app.yeride` is identical, so the existing whitelist applies).
- Same Stripe publishable key (`STRIPE_PUBLISHABLE_KEY`).

The new binary should drop into the same backend slot the legacy
binary occupied — no Firebase Console permission changes needed.

---

## 5. Bundle-ID re-sign (light)

Because path (b) is already half-done (bundle IDs match), the
"re-sign" reduces to:

### 5.1 EAS credentials

For the production profile in `eas.json`:

- iOS: same Apple Team ID as legacy, same distribution cert, same
  provisioning profile (or regenerate the provisioning profile for
  `app.yeride` if it's expired — `eas credentials` handles this).
- Android: same upload key + same Play App Signing key. If the
  rewrite's EAS project has a different upload key from legacy,
  REKEY the rewrite's EAS project to the legacy upload key before
  building. Mismatched upload keys = Play rejects the upload.

### 5.2 Version bump — wide jump (per §1 Decision 4)

Legacy's last published prod buildNumber / versionCode is `247`.
**The rewrite's first prod build is `1000`**, leaving `248-999` as
a reserved hotfix block for the legacy codebase. Set:

```ts
// app.config.ts production branch
ios.buildNumber = '1000';
android.versionCode = 1000;
version = '2.0.0';
```

Marketing version `2.0.0` signals "major release" externally without
calling out "rewrite" — release notes can stay bland ("Performance
improvements and bug fixes") per §13 open question 4.

**Legacy hotfix range convention:** legacy's `app.config.js`
production branch should ALSO be bumped (on a separate hotfix
branch) to `versionCode/buildNumber: 248` immediately, NOT as a
release but as a documented reservation. If a hotfix has to ship,
it's 248 → 249 → 250 → ... up to 999 if absolutely necessary.
Realistically expect 1–3 hotfixes over the rollout window. Marketing
version on legacy stays in the `1.x` band (`1.0.1`, `1.0.2`, ...).

Sanity check at build time:

```bash
# rewrite production build must be >= 1000
cd /Users/papagallo/yeapptech/dev/yeride-mobile
grep -E "buildNumber|versionCode" app.config.ts | grep -E "1[0-9]{3}"

# legacy hotfix branch must be in 248-999
cd /Users/papagallo/yeapptech/dev/yeride
git checkout hotfix/<short-name>
grep -E "buildNumber|versionCode" app.config.js | grep -E "[2-9][0-9]{2}"
```

### 5.3 Build & sanity-check

```bash
eas build --profile production --platform ios
eas build --profile production --platform android
```

Pull the IPA / AAB locally, install on a fresh device, smoke the
first-launch path:

- Sign in with a real prod user.
- Verify push token registers against `yeapp-prod` (check Firestore
  `users/{uid}.pushToken`).
- Verify Crashlytics dSYM upload succeeded (Crashlytics console
  shows `app.yeride` as a recognized app).
- Verify the Transistor SDK accepts the bundle (no
  `LICENSE VALIDATION FAILURE` in adb logcat).

---

## 6. Staged rollout

Rollout is the slowest part of cutover — DO NOT shortcut it.

### 6.1 Internal track first (1–2 days)

- iOS: TestFlight internal testers (Apple Team members) get build
  `1000`.
- Android: Play Console Internal Testing track gets build `1000`.
- Both groups run a parity-smoke pass against prod and report.

### 6.2 Closed beta track (3–5 days)

- iOS: TestFlight external testers (existing beta cohort, ~10–30
  users).
- Android: Play Console Closed Testing track (same cohort).
- Monitor Crashlytics dashboard daily. P0 crash = halt, fix, restart.

### 6.3 Production phased / staged rollout (7–10 days)

- iOS: App Store Connect → Phased Release for Automatic Updates
  enabled. Daily auto-expanding cohort (1% → 2% → 5% → 10% → 20% →
  50% → 100% over 7 days).
- Android: Play Console Production track with staged rollout:
  - Day 1: 5%
  - Day 3: 20%
  - Day 6: 50%
  - Day 9: 100%

At each step, check:

- Crashlytics non-fatal + fatal rate vs the prior day's legacy
  baseline.
- Stripe webhook server logs for unexpected `payment_failed` rate
  spikes.
- Cloud Functions error logs in GCP Console for `yeapp-prod`.
- Backend latency dashboards (legacy + new traffic flow through the
  same functions/server).

If any metric spikes ≥ 2× baseline: **pause rollout** in the
relevant console, triage, decide rollback vs forward-fix.

### 6.4 Hold the rollout if...

- Crash-free user rate < 99.5% on the new binary cohort.
- Any P0 (trip cannot be requested, payment cannot be taken,
  registration loops).
- Stripe payment success rate on the new cohort < legacy cohort by
  > 1%.

---

## 7. Cutover-day runbook

The "cutover day" is the day production rollout starts (Step 6.3
Day 1). Pre-flight checklist for that morning:

```
[ ] Section 3 gates ALL green (verify the morning of)
[ ] Firebase Console open in a tab on yeapp-prod for live monitoring
[ ] Crashlytics dashboard open
[ ] GCP Console open for Cloud Functions logs
[ ] Stripe Dashboard open for prod webhook + balance monitoring
[ ] Play Console + App Store Connect open with the build in
    "Ready for Sale / Released" state
[ ] On-call engineer (Hernando) reachable by phone for 8 hours
[ ] Rollback decision tree (Section 9) printed / open in a separate doc
[ ] Beta cohort has been running build 1000 for the prior 3+ days
    without P0
```

Trigger order:

1. Confirm Play Console staged-rollout is enabled at 5%.
2. Confirm App Store Connect phased release is enabled (1%).
3. Watch dashboards for 2 hours. If clean: end of day 1.
4. End-of-day: snapshot Crashlytics + Stripe + Functions metrics for
   the rollout report.

Repeat daily through Step 6.3's expansion schedule.

---

## 8. Post-cutover cleanup

After 100% rollout has been live for ≥ 1 week with no P0 regressions:

### 8.1 Drop dual-write compat code

In order of safety (safest first):

1. **`userMapper`: drop the nested `stripe = {…}` write.** Read
   path keeps the alias (some prod docs will still have the legacy
   shape for years). The flat fields stay canonical.
2. **DTO permissive aliases — drop the WRITE side, keep the READ
   side.** Documents written by the legacy binary in the rollout
   window must still parse forever. New writes go canonical-only.
3. **Trip write `merge: true` review.** Audit which fields the
   rewrite doesn't track (lastSeenByRiderAt, messages subcollection
   per CLAUDE.md). For any field the rewrite NOW tracks, drop the
   merge guard. For fields it doesn't track, keep merge.
4. **Mapper-test fixtures.** Keep the legacy-shape fixtures —
   they're documentation of historical disk formats. Add a comment
   `// legacy on-disk shape, pre-Phase 10 rollout — read-only` at
   each fixture site.

### 8.2 Retire the legacy-only ESLint boundaries override

Per CLAUDE.md, the boundaries-rule override list is just
`container.ts` already (Turn 17). No legacy-cutover-related override
to remove.

### 8.3 Confirm zero traffic on legacy binary

Query Firestore `users` collection for `appBuildNumber` (or
equivalent telemetry field if it exists) to confirm <0.5% of active
users are still on the legacy binary. Below that threshold, archive.

---

## 9. Rollback strategy

Rollback under path (b) is HARDER than under path (a) because there
is no parallel listing to flip back to. The mitigations:

### 9.1 Pre-stage the legacy binary as a fallback build

- iOS: legacy's last published build (247) stays in App Store
  Connect's build list. Apple's "Expedite a review for a critical
  bug fix" path can re-promote a previous build within 24–48 hours
  if the new build's review is reversed.
- Android: Play Console supports halting rollout AND uploading a
  prior APK / AAB if the new one has a P0. Play does NOT let you
  decrement `versionCode`, so the actual rollback path is:
  1. Halt the new staged rollout.
  2. Upload a NEW build from the **legacy hotfix branch** at the
     next versionCode in the reserved `248-999` range
     (e.g. `versionCode: 248`, then `249`, etc.).
  3. Stage-rollout the rebuilt legacy.

Per §1 Decision 5, the legacy repo MUST stay buildable on a hotfix
branch (`hotfix/<short-name>`) throughout the rollout window. Keep
the hotfix branch's `versionCode: 248` build pre-prepared but not
submitted, ready to publish in under 2 hours.

Note that the rewrite (`versionCode: 1000+`) will continue to
outrank the legacy hotfix builds in Play / App Store's "latest
version" sort, so the rollback path under (2) is NOT a "users
auto-update back to legacy" — it requires explicitly halting the
rewrite rollout AND re-promoting the legacy hotfix as the active
build at the listing level. The Play Console "Halt rollout" path
demotes the rewrite from the production track; the legacy hotfix
then becomes the highest-versionCode build on production.

### 9.2 Rollback decision tree

```
P0 surfaced during staged rollout?
├── Is it in the REWRITE binary (versionCode ≥ 1000)?
│   ├── Yes
│   │   ├── Can a hot-fix ship in < 6 hours?
│   │   │   ├── Yes → halt rollout, fix, build versionCode 1001,
│   │   │   │         restart rollout
│   │   │   └── No  → see below
│   │   ├── Is it a data-corruption bug?
│   │   │   ├── Yes → halt rollout AND deploy a Firestore Cloud Function
│   │   │   │         to repair affected docs (PI-on-call decides scope)
│   │   │   └── No  → halt rollout, communicate to beta cohort, fix forward
│   │   └── Is the rate getting WORSE over time?
│   │       └── Yes → invoke 9.1 (Android: legacy hotfix branch builds
│   │                  versionCode 248 / iOS: expedited re-review of
│   │                  build 247)
│   └── No (legacy binary, versionCode 247 — still in use by un-updated users)
│       └── Ship a legacy hotfix on the reserved 248-999 block per
│          §1 Decision 5; rewrite rollout continues in parallel
│          (do NOT pause rewrite for legacy hotfix)
└── No → continue rollout per schedule
```

### 9.3 Communication template (P0)

Have a pre-written status-page / email template ready for the
"we shipped a bad version, here's what we're doing" message. Owner:
Hernando. Reviewed by: legal if user-impacting payment bug, support
if user-impacting UX bug.

---

## 10. Legacy repo archive

**Do NOT archive while the rewrite rollout is in flight.** §1
Decision 5 commits to parallel ship paths for legacy hotfixes,
which means the legacy repo MUST stay buildable on `main` + any
`hotfix/*` branches throughout the rollout window.

Archive only AFTER Section 8.3's threshold is met (zero traffic
on legacy binary):

```bash
cd /Users/papagallo/yeapptech/dev/yeride
git tag last-known-good-pre-rewrite-2026-MM-DD
git push origin last-known-good-pre-rewrite-2026-MM-DD
# Mark the repo read-only in GitHub repo settings
# Update repo README to point at /Users/papagallo/yeapptech/dev/yeride-mobile/
```

The legacy repo stays accessible (not deleted) for:

- Historical reference when reading mapper test fixtures.
- Re-pulling for emergency rollback rebuilds (Section 9.1).
- Restoring any legacy doc-on-disk shape that turns up in a future
  forensic investigation.

Do NOT delete `node_modules`-locked dependency versions — the
rollback build path needs them buildable.

---

## 11. Risks

| Risk                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                     | Owner    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **Apple review rejects the new binary.** The IPA's contents differ substantially from build 247; Apple's automated screening may flag it.                                             | Use Apple's "Notes for the Reviewer" field to explicitly call out: "This release is a clean-architecture rewrite of the same product; bundle ID, features, and entitlements unchanged." Have a TestFlight build of the previous (legacy 247) ready as proof of feature parity. | Hernando |
| **Play Console flags the upload as a different app.** Less likely (Play matches on `applicationId` not on binary fingerprint), but possible if the upload key differs.                | Section 5.1 — verify EAS production credentials match legacy's upload key BEFORE the first build.                                                                                                                                                                              | Hernando |
| **A field the rewrite stopped writing breaks a legacy user's flow.** E.g. legacy reads `seat` but rewrite writes only `seatCapacity`.                                                 | DTO permissive read stays in place throughout rollout (Section 2). The WRITE side stays dual-shape until 100% rollout + 1 week (Section 8.1).                                                                                                                                  | Hernando |
| **A field the legacy app stops writing breaks a rewrite user mid-rollout.** Less likely (legacy code is frozen at cutover) but possible if a Cloud Function or webhook changes shape. | Freeze `yeride-functions` and `yeride-stripe-server` `main` branches the day of cutover. Any backend change during the rollout window goes through Hernando.                                                                                                                   | Hernando |
| **Push notifications double-deliver.** During the parallel-run window, both binaries may register tokens for the same user; old tokens may not be invalidated.                        | Verify on a test prod account: install legacy → uninstall → install rewrite → confirm only ONE push fires per `sendPushNotification` call. The token-replacement logic in `usePushTokenRegistration` should handle this. If not, ship a fix BEFORE Section 6.3.                | Hernando |
| **Transistor SDK license rejects the prod build.** The current license is bound to `app.yeride.*` (per `app.config.ts` 2026-05-07 comment) — should work for prod too, but verify.    | Section 5.3 includes the Transistor logcat check. If `LICENSE VALIDATION FAILURE` appears, contact Transistor support to confirm the JWT covers the production bundle ID.                                                                                                      | Hernando |
| **Crashlytics for the rewrite floods the dashboard with non-fatals from the legacy-write compat code.**                                                                               | Section 2's dual-read compat is at `LOG.warn` (per CLAUDE.md "LOG.warn does NOT fan out to recordError"). Spot-check the FirebaseCrashlyticsAdapter call path on the day-of for any errant `LOG.error` on a legacy-shape doc.                                                  | Hernando |

---

## 12. Sign-off checklist

The cutover is "done" when ALL of these tick:

- [ ] Section 0 parity-audit gate cleared (no ❌ rows remaining)
- [ ] Section 3 gates green at the cutover SHA
- [ ] Section 4 prod Firebase pivot config landed on `main`
- [ ] Section 5 production EAS build green at `versionCode: 1000`,
      smoke-passed on real devices
- [ ] Legacy repo hotfix branch pre-prepared at `versionCode: 248`
      (per §1 Decision 5 and §9.1)
- [ ] Section 6.1 internal track green for 1+ days
- [ ] Section 6.2 closed beta green for 3+ days
- [ ] Section 6.3 phased rollout reached 100% without rollback
- [ ] Section 8 cleanup landed (or scheduled as PHASE_10_TURN_N follow-up)
- [ ] Section 10 legacy archive tag pushed
- [ ] REFACTOR_PLAN.md §8 DoD all eight items ticked
- [ ] CLAUDE.md `Project status` table updated: Phase 10 → ✅
- [ ] CLAUDE.md `Data co-existence with legacy yeride` section
      updated to reflect that legacy is retired and the dual-write
      compat is being unwound on a per-field schedule

---

## 13. Open questions

These need answers before Section 6.3 (production staged rollout)
starts:

1. **Do we want a kill-switch in the rewrite?** A
   Firestore-backed feature flag the new binary reads at boot,
   defaulting to "on," which we can flip "off" remotely to force
   the app into a maintenance screen if Section 9's rollback path
   needs more than 6 hours. Cost: 4–6 hours of work + one Firestore
   read per app open. Recommend: yes, for the rollout window only,
   removed at Section 8 cleanup.
2. **Asana / Linear / Notion ticket for tracking the rollout?**
   The day-to-day Section 6.3 metrics need a tracking surface that
   isn't this doc. Recommend: create a Linear `INFRA-PHASE10`
   project, one ticket per rollout day.
3. **Customer support pre-brief.** If support gets a flood of
   "the app looks different" tickets day 1 of 100% rollout, they
   need a playbook. Recommend: write a 1-page internal support
   doc, share 1 week before Section 6.3.
4. **Marketing / release-notes coordination.** What goes in the App
   Store "What's New" field? Recommend: bland (e.g. "Performance
   improvements and bug fixes") — the rewrite is INTERNAL; users
   don't need to know. Avoid marketing the change.

---

**End of PHASE_10_CUTOVER_PLAN.md.** Read top to bottom on the
morning of cutover.
