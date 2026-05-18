# Phase 10 Turn 3 Kickoff — Material Components Android theme

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 2
closed 2026-05-18** (Firebase iOS SDK pin via
`plugins/withFirebasePodfileFix.js`; see `docs/PHASE_10_TURN_2.md`).
Audit v2 post-Turn-2 shows **6 ❌ / 2 🟡 / 0 ⚠️** — this turn closes
the next highest-severity ❌: the Android Stripe-`CardForm` render
crash.

Turn 3 is **tiny (~½ day)** and **production-blocker priority** —
symmetric to Turn 2 but on the Android side. Without it, Android
users hit a hard crash the moment they try to add a payment method,
which gates the entire rider onboarding flow.

## Context — why this turn now

`@stripe/stripe-react-native@0.63.0`'s `<CardForm/>` component uses
`MaterialCardView` internally on Android (Google's Material
Components library). `MaterialCardView` requires the host
`Activity`'s theme to descend from `Theme.MaterialComponents.*` —
without it, view inflation throws
`IllegalArgumentException: This component requires that you specify
a valid TextAppearance attribute` (or a similar Material-attribute-
not-found error), and the screen crashes on render.

The rewrite's generated `android/app/src/main/res/values/styles.xml`
declares:

```xml
<style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
```

That's vanilla AppCompat — not a Material ancestor. `<CardForm/>` is
used inside `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx:45`,
which is the only path a rider takes to add or update a card before
their first ride. So under any Android build, the rider hits the
Add-Card screen and the app crashes.

The Stripe `<CardForm/>` docs document this requirement:
> Android requires that you set your AppTheme to a Material
> Components theme.

The upstream `@stripe/stripe-react-native` Expo plugin
(`node_modules/@stripe/stripe-react-native/src/plugin/withStripe.ts`)
handles:

- iOS: Apple Pay entitlement, optional Onramp pod, noop Swift file.
- Android: Google Pay meta-data, optional Onramp gradle property.

It does NOT touch `styles.xml`, the AppTheme parent, or the
`com.google.android.material:material` dependency. That's left to
the app developer.

Legacy yeride solves this with `plugins/withMaterialTheme.js` — a
51-line two-step config plugin:

1. `withAndroidStyles` mutates `AppTheme`'s parent attribute.
2. `withAppBuildGradle` adds
   `implementation 'com.google.android.material:material:1.11.0'`
   to the dependencies block.

The rewrite has no equivalent today. Porting the plugin (with one
small adjustment for the rewrite's DayNight theme — see the pre-
checklist) closes this row.

## Required reading (in order)

1. **Legacy `/Users/papagallo/yeapptech/dev/yeride/plugins/withMaterialTheme.js`**
   — the existing plugin (51 lines). Reads top-to-bottom in two
   minutes; the comment header is descriptive enough that the body
   is mostly mechanics.
2. **Rewrite `android/app/src/main/res/values/styles.xml`** — the
   current `AppTheme` declaration (parent `Theme.AppCompat.DayNight.NoActionBar`).
   This is the file the new plugin will mutate. Note the DayNight
   parent — legacy's plugin sets the parent to
   `Theme.MaterialComponents.Light.NoActionBar` (Light only), which
   would FORCE light mode and break the rewrite's dark-mode support.
   **The port must use `Theme.MaterialComponents.DayNight.NoActionBar`
   instead.** See pre-checklist item 2.
3. **Rewrite `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx`**
   — the only `<CardForm/>` consumer in the rewrite (line 45). Read
   so the test plan in your turn doc names the screen this fix
   unblocks.
4. **Upstream Stripe plugin `node_modules/@stripe/stripe-react-native/src/plugin/withStripe.ts`**
   — confirm yourself it does NOT apply a Material theme. The
   `withStripeAndroid` function (lines 138-161) only writes Google
   Pay meta-data + Onramp gradle properties.
5. **`docs/PHASE_10_PARITY_AUDIT.md` §4 `withMaterialTheme` row** —
   the audit's verdict citation that informs this turn's scope.
6. **`docs/PHASE_10_TURN_2.md`** — the prior turn. The patch shape,
   audit-update flow, smoke-test approach, and commit pattern from
   Turn 2 are the model for Turn 3. This turn is structurally a
   twin: port one plugin, wire one entry, smoke-test, flip one
   audit row.

## Starting state — what's already true

- All Turn 2 deliverables landed on `main` at commit `041a4e6`.
  HEAD on the rewrite at Turn 3 start: whatever `main` is at the
  moment you pick this up. Capture and record in the turn doc.
- The pre-existing 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain scoped as Turn 9 — DO NOT try to fix them in this turn.
- The rewrite uses `@stripe/stripe-react-native@0.63.0` per
  `package.json`; this turn does NOT bump that version.
- `plugins/` directory currently contains six custom plugins after
  Turn 2 (no `withMaterialTheme` yet):
  `withCrashlyticsUploadSymbols.js`, `withFirebasePodfileFix.js`,
  `withGoogleMapsApiKey.js`, `withGradleHeap.js`,
  `withNavigationSdk.js`, `withPlayServicesLocationVersion.js`.
- `@expo/config-plugins` is at `~55.0.8` (the version expo SDK 55
  pulls in transitively). Use the namespaced
  `require('@expo/config-plugins')` import shape, NOT legacy's
  un-namespaced `require('expo/config-plugins')`.
- The rewrite has no `processing` UIBackgroundMode (Turn 4's
  concern). No Android-side equivalent issue blocks this turn.

## Scope — what to ship

A single new plugin file plus the usual audit + turn-doc deliverables.
Two equally-valid implementation paths — pick one in the pre-checklist:

### Path (a) — Port `withMaterialTheme.js` as a separate plugin (recommended)

Create `plugins/withMaterialTheme.js` in the rewrite, modeled on
legacy's 51-line plugin, with three adjustments:

1. **Switch the `require` import line** from
   `require('expo/config-plugins')` to
   `require('@expo/config-plugins')` (rewrite convention — every
   other custom plugin uses the namespaced form).
2. **Change the AppTheme parent from `Theme.MaterialComponents.Light.NoActionBar`
   to `Theme.MaterialComponents.DayNight.NoActionBar`** so the
   rewrite's dark-mode support keeps working. Legacy is Light-only
   because legacy never adopted dark mode at the app-theme level; the
   rewrite's "Honey and the Bee" design system has dark variants.
3. **Pin target — see pre-checklist item 3.** Legacy pins
   `com.google.android.material:material:1.11.0`. Material 1.12.0
   has been the stable release for a while; pick 1.12.0 (latest
   stable) or stay conservative at 1.11.0. See item 3.

Wire it in `app.config.ts` next to the existing custom-plugin
entries. The natural place is the Android-affecting plugin block
(currently runs `withGradleHeap`, `withPlayServicesLocationVersion`,
`withNavigationSdk`, `withGoogleMapsApiKey`). `withMaterialTheme`
runs `withAndroidStyles` + `withAppBuildGradle` — both Android-
specific Expo mods, no cross-effects with other plugins. Order
doesn't matter much; pick after `withGradleHeap` (which sets JVM
args) and before the Firebase plugins.

### Path (b) — Inline into another existing plugin

The natural candidate is `withPlayServicesLocationVersion.js`
(also Android-only, also a small file). But unlike Turn 2's Path
(b), where two plugins were touching the **same** Podfile (and
co-locating prevented a race), the Material work touches different
files (`styles.xml` + `build.gradle`) than `withPlayServicesLocationVersion`
(which touches the top-level Android `build.gradle` ext block).
Co-locating buys nothing and obscures the per-plugin purpose.

Recommendation: **Path (a)** for Turn 3. Reasons:

- The two files this plugin touches are distinct from anything
  every other plugin touches; no race / no co-location benefit.
- Naming a plugin `withMaterialTheme` makes the file's purpose
  searchable and matches the legacy filename for diffability.
- The plugin is a peer of the existing Android-only plugins in the
  rewrite; this is the conventional shape.

### Why NOT the patch-podfile.js / patch-build-gradle.js script

There's no equivalent Android-side patch-script in the rewrite, so
this question is moot here. (Legacy uses an Expo plugin for the
same reason; the prebuild contract is the right boundary.)

## Pre-checklist

Surface these in your first message back if not already resolved:

1. **Confirm the upstream Stripe plugin hasn't started applying a
   Material theme.** Some future minor release of
   `@stripe/stripe-react-native` could add `withAndroidStyles` to
   its plugin and obviate this turn.

   ```bash
   grep -l 'MaterialComponents\|withAndroidStyles' \
     node_modules/@stripe/stripe-react-native/src/plugin/*.ts \
     node_modules/@stripe/stripe-react-native/lib/**/plugin/*.js \
     2>/dev/null
   ```

   If output is non-empty, read the file to check what it does. If
   the upstream plugin is now applying a Material theme on Android,
   this turn collapses to audit-only — flip the §4 row from ❌ to
   ✅ with a "Stripe plugin now applies it as of v<X>" finding.

   If output is empty (most likely — confirmed at 2026-05-18 against
   `@stripe/stripe-react-native@0.63.0`), proceed with the patch.

2. **Confirm the rewrite's current `AppTheme` parent.**

   ```bash
   grep 'AppTheme.*parent' android/app/src/main/res/values/styles.xml
   ```

   Expected: `parent="Theme.AppCompat.DayNight.NoActionBar"`. If
   the prebuild output has drifted to a different parent (Light,
   non-DayNight, or already Material), the plugin's
   replacement logic and choice of new parent need to adjust:
   - Already `Theme.MaterialComponents.DayNight.NoActionBar` →
     plugin is a no-op; audit closes as ✅ without a code change.
   - Some other `Theme.AppCompat.*.NoActionBar` variant → plugin
     replacement target is correct; pick the matching Material
     variant (DayNight, Light, or NoActionBar Dark).
   - Already `Theme.MaterialComponents.Light.NoActionBar` →
     **regression alert** — this would force light mode. Don't
     leave it; switch to DayNight in this turn.

3. **Pin target — `com.google.android.material:material:1.11.0`
   (legacy's pick) vs `1.12.0` (latest stable as of 2024-Q4).** Two
   reasonable options:
   - **1.11.0** (legacy's pick, conservative, known-working with
     Stripe 0.63.0). Recommended.
   - **1.12.0** (latest stable). Slightly newer surface area;
     potentially picks up unrelated bug fixes.

   Recommended: **1.11.0** unless there's a specific reason to bump.
   Bumping is unrelated change surface for a turn whose only job is
   closing one bug.

4. **Confirm the rewrite's `AddPaymentMethodScreen` still uses
   `<CardForm/>`** (not the deprecated `<CardField/>` — legacy used
   `CardField` before migrating). Should be `CardForm` per
   `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx:1`.
   If it's `CardField`, the Material requirement is less strict and
   this turn's priority may drop — but verify before deciding.

5. **Capture HEAD SHA of both repos.** Same pattern as Turn 2's
   pre-checklist item 5 — record in the turn doc. Expected: Turn 3
   HEAD == Turn 2 HEAD == `041a4e6` (unless other commits land
   between).

6. **Decide whether to smoke-test the prebuild locally.** Turn 2's
   user-side prebuild run (real device) caught the
   `RNFBApp: Using user specified Firebase SDK version '12.12.0'`
   confirmation. For Turn 3, the analogous signal is `npm run prebuild`
   succeeding AND the generated `android/app/src/main/res/values/styles.xml`
   showing `parent="Theme.MaterialComponents.DayNight.NoActionBar"`
   AND `android/app/build.gradle` showing
   `implementation 'com.google.android.material:material:1.11.0'`.
   Locally smoke-test is fast (~30s for `expo prebuild` Android
   side) and worth doing if Android files are already prebuilt; not
   strictly required for the patch to be correct, but it's the
   cheapest pre-EAS sanity check.

## Suggested approach

1. **Pre-checklist first.** Answer items 1-5 above before writing
   any code. Item 1 may collapse the entire turn; item 2 may change
   the patch's target parent.

2. **Create the plugin.** Path (a) recommended:
   - New file `plugins/withMaterialTheme.js`. Use the namespaced
     `@expo/config-plugins` import.
   - Step 1 (`withAndroidStyles`): replace `AppTheme`'s parent with
     `Theme.MaterialComponents.DayNight.NoActionBar` (DayNight, NOT
     Light — flag this in a code comment so the next reader sees
     why the rewrite diverges from legacy).
   - Step 2 (`withAppBuildGradle`): insert
     `implementation 'com.google.android.material:material:1.11.0'`
     into the dependencies block. Use a sentinel-style idempotency
     check (e.g., `if (!contents.includes('com.google.android.material:material'))`)
     so re-running `expo prebuild` is a no-op for an already-patched
     file.
   - JSDoc header: cite the Stripe `CardForm` Material requirement +
     the rewrite's DayNight choice + the removal exit condition
     ("Remove if @stripe/stripe-react-native ever ships a plugin
     that applies the Material theme itself, OR if the rewrite
     stops using `<CardForm/>`").

3. **Wire it in `app.config.ts`.** Append a new entry to the
   `plugins:` array. Place it after `withGradleHeap` and before the
   Firebase plugin block; the Android-only ordering relative to
   other plugins doesn't matter for this one.

4. **Smoke-test the patch logic against a fixture (optional but
   recommended).** Same shape as Turn 2's `/tmp/test_podfile_plugin.js`
   smoke test — capture the mutation function via a monkey-patched
   `withAndroidStyles` / `withAppBuildGradle`, run it against a
   staged styles.xml + build.gradle pair, verify both files mutate
   correctly and re-running is idempotent.

5. **Verify gates.**

   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck   # green — no .ts changes
   npm run lint        # green — plugin is .js
   npm run format:check # plugin patch may need prettier --write
   npm test            # 21 BG-geolocation failures remain (Turn 9); no new failures
   ```

6. **(Optional) Smoke prebuild.** If Android files are already
   prebuilt locally, run `npm run prebuild` and grep the generated
   `android/app/src/main/res/values/styles.xml` for the new parent
   AND `android/app/build.gradle` for the material dependency. If
   not, skip — the source change is correct; a real exercise lands
   at cutover-prep EAS build time.

7. **Audit + turn doc.**
   - Flip `docs/PHASE_10_PARITY_AUDIT.md` §4 `withMaterialTheme`
     row from ❌ to ✅ with a citation
     `plugins/withMaterialTheme.js:<line>-<line>` and an
     "AppTheme parent: DayNight (not legacy's Light)" annotation.
   - Update §1 headline finding count from "6 ❌ / 2 🟡 / 0 ⚠️"
     to "5 ❌ / 2 🟡 / 0 ⚠️".
   - Update §1 `withMaterialTheme` bullet to indicate Turn 3
     closure.
   - Update §4 action-items bullet for `withMaterialTheme`.
   - Update §8 turn plan: mark Turn 3 ✅ closed.
   - Update audit header status line: append "Turn 3 closed
     YYYY-MM-DD" sublabel (keep v2 — Turn 10 will produce v3).
   - Write `docs/PHASE_10_TURN_3.md` following the
     `PHASE_10_TURN_2.md` format. Short — this is a tiny turn,
     and the turn doc should be tiny too.

## Out of scope (defer to later turns)

- **Bumping `@stripe/stripe-react-native`.** A future minor release
  could add the Material theme application to the upstream plugin
  (or not). Either way it's a separate dependency-update concern
  with its own native-rebuild testing. The `withMaterialTheme`
  plugin survives a rnstripe minor bump unchanged.
- **Rewriting AddPaymentMethodScreen to use a different Stripe
  primitive.** The screen is fine as-is; this turn just gates its
  rendering layer.
- **Dark-mode Material theme.** `Theme.MaterialComponents.DayNight.NoActionBar`
  auto-switches based on `Configuration.UI_MODE_NIGHT_*`. The
  rewrite's NativeWind theming is independent — both layers
  coexist. If a future polish turn wants explicit
  `night/styles.xml`, that's separate work.
- **`processing` UIBackgroundMode reconciliation** — Turn 4.
- **Rider live ETA** — Turn 5.
- **Activity tab** — Turn 6.
- **Scheduled rides** — Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **Verifying behavior on a real Android device.** Cutover plan
  §5.3 covers this as the production-build smoke-pass before §6.1
  internal track. This turn delivers source change only.

## Deliverable

A single PR / commit on `main` containing:

1. **`plugins/withMaterialTheme.js`** (Path a) OR an extension of
   another plugin (Path b — not recommended). One new file plus one
   `app.config.ts` wire.
2. **`docs/PHASE_10_PARITY_AUDIT.md`** updated — §1 count, §1
   bullet, §4 row status, §4 action items, §8 turn plan, header
   sublabel.
3. **`docs/PHASE_10_TURN_3.md`** documenting:
   - Pre-checklist outcomes (Stripe plugin still doesn't apply
     Material; current AppTheme parent; pin target; CardForm vs
     CardField; HEAD SHAs)
   - The patch itself (diff-style or before/after)
   - Acceptance criteria
   - Out-of-scope list

`npm run verify` should be green except for the carried-over 21
BG-geolocation failures (those remain Turn 9's job).

## Sign-off criteria

- [ ] Plugin patch landed in `plugins/withMaterialTheme.js` (or
      whichever path is chosen).
- [ ] Idempotency check in place — re-running `expo prebuild` does
      not double-inject the material dependency or re-modify the
      already-Material `AppTheme` parent.
- [ ] AppTheme parent is `Theme.MaterialComponents.DayNight.NoActionBar`
      (NOT legacy's `Light` variant).
- [ ] Audit doc §4 `withMaterialTheme` row flipped ❌ → ✅ with a
      code-path citation.
- [ ] Audit §1 headline count updated 6 ❌ → 5 ❌.
- [ ] `PHASE_10_TURN_3.md` written.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green; jest carries the 21 pre-existing failures only.
- [ ] No regression: the existing
      `Theme.App.SplashScreen` style (which inherits from
      `AppTheme`) remains unaffected by the parent change —
      verify the splash-screen styling still works conceptually
      (the splash-screen style only sets `windowBackground`, which
      Material themes also support).

## Native rebuild

**Required for the change to take effect** — touches
`android/app/src/main/res/values/styles.xml` and
`android/app/build.gradle`. Practical implication: any developer
building locally after pulling this turn must run `npm run prebuild`.
EAS builds pick up the change automatically.

No iOS-side change — Material Components is Android-only.

---

**End of PHASE_10_TURN_3_KICKOFF.md.** Read top to bottom on a new
session and execute. Ask if any pre-checklist item surfaces a
blocker.
