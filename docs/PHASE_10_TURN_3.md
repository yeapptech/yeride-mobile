# Phase 10 Turn 3 — Material Components Android theme

**Status:** ✅ closed 2026-05-18.

## Why

Phase 10 Turn 2 (2026-05-18) closed the highest-severity ❌ on the
parity-audit list (Firebase iOS SDK pin via
`plugins/withFirebasePodfileFix.js`'s new patch #2). The post-Turn-2
audit shows **6 ❌ / 2 🟡 / 0 ⚠️**. This turn closes the next ❌:
the Android Stripe `<CardForm/>` render crash.

`@stripe/stripe-react-native@0.63.0`'s `<CardForm/>` component uses
`MaterialCardView` internally on Android. `MaterialCardView` requires
the host `Activity`'s theme to descend from `Theme.MaterialComponents.*`
— without it, view inflation throws
`IllegalArgumentException: This component requires that you specify a
valid TextAppearance attribute`, and the screen crashes on render.

The rewrite's generated `android/app/src/main/res/values/styles.xml`
declared `parent="Theme.AppCompat.DayNight.NoActionBar"` — vanilla
AppCompat, not Material. `<CardForm/>` is used inside
`src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx:45`,
which is the only path a rider takes to add or update a card before
their first ride. So on Android, every rider hits the Add-Card screen
and the app crashes — gating the entire rider-onboarding flow.

The upstream `@stripe/stripe-react-native` Expo plugin only handles
Apple Pay entitlement (iOS) and Google Pay meta-data / Onramp (Android).
It does NOT touch `styles.xml`, the AppTheme parent, or the
`com.google.android.material:material` dependency. That's left to the
app developer. Legacy yeride solves this with `plugins/withMaterialTheme.js`;
the rewrite had no equivalent before this turn.

## Pre-checklist outcomes

All six pre-checklist items resolved without surprises.

1. **Upstream Stripe plugin still doesn't apply a Material theme.**

   ```bash
   grep -l 'MaterialComponents\|withAndroidStyles' \
     node_modules/@stripe/stripe-react-native/src/plugin/*.ts \
     node_modules/@stripe/stripe-react-native/lib/**/plugin/*.js
   # (no output)
   ```

   Confirmed at 2026-05-18 against `@stripe/stripe-react-native@0.63.0`.
   Patch required.

2. **Rewrite's current `AppTheme` parent confirmed as
   `Theme.AppCompat.DayNight.NoActionBar`.** The expected starting
   state; the plugin's replacement target (`Theme.MaterialComponents.DayNight.NoActionBar`)
   is appropriate.

3. **Pin target — 1.11.0** (legacy's pick, conservative, known-working
   with Stripe 0.63.0). Bumping to 1.12.0 would be unrelated change
   surface for a turn whose only job is closing one bug.

4. **`AddPaymentMethodScreen` confirmed using `<CardForm/>`** (not
   the deprecated `<CardField/>`):
   `src/presentation/features/rider/screens/AddPaymentMethodScreen.tsx:1, 45`.
   Material requirement applies, full priority.

5. **HEAD SHAs.** Recorded:

   ```
   /Users/papagallo/yeapptech/dev/yeride-mobile  041a4e6 Phase 10 Turn 2 — Firebase iOS SDK pin
   /Users/papagallo/yeapptech/dev/yeride          40b5af1 build: bump version to 247
   ```

   Same yeride HEAD as Turn 2; yeride-mobile HEAD is Turn 2's
   landed commit (no other commits between).

6. **Smoke-test approach.** Mutation-function smoke against staged
   `styles.xml` + `build.gradle` fixtures, mirroring Turn 2's
   pattern. Faster and equally diagnostic for a regex/idempotency
   check than waiting on a real `npm run prebuild`.

## What's in

A single new plugin file plus the usual audit + turn-doc deliverables.

### 1. `plugins/withMaterialTheme.js` — new file

A two-patch Expo config plugin modeled on legacy's 51-line plugin
with three rewrite-specific adjustments:

| Adjustment        | Legacy                                       | Rewrite                                         | Why                                                                                                                                       |
| ----------------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Module import     | `require('expo/config-plugins')`             | `require('@expo/config-plugins')`               | Rewrite convention. Every other rewrite plugin uses the namespaced form.                                                                  |
| `AppTheme` parent | `Theme.MaterialComponents.Light.NoActionBar` | `Theme.MaterialComponents.DayNight.NoActionBar` | Rewrite has app-theme-level dark mode (Honey and the Bee design system). Legacy's `Light` would force light mode on every Android device. |
| Idempotency note  | (implicit via includes check on gradle side) | (same shape, documented explicitly in JSDoc)    | Re-running `expo prebuild` must be a no-op for both patches.                                                                              |

Patch 1 (`withAndroidStyles`): replaces `AppTheme`'s `parent`
attribute with `Theme.MaterialComponents.DayNight.NoActionBar`.
Re-runs are no-ops because the second pass sets the same value
that's already there.

Patch 2 (`withAppBuildGradle`): inserts
`implementation 'com.google.android.material:material:1.11.0'` at
the top of the `dependencies { ... }` block. Sentinel-style
idempotency check (substring on the package coordinate
`com.google.android.material:material`, not the full version string,
so any version pin counts as already-injected and a future bump
isn't blocked).

JSDoc header documents:

- Why the patch is needed (`MaterialCardView` requirement; Stripe's
  upstream plugin scope).
- The two-patch structure and idempotency strategy.
- The DayNight divergence from legacy (with a NOTE block so the next
  reader sees why we don't copy legacy's `Light`).
- The pin choice (1.11.0 = legacy match; 1.12.0 deferred as
  unrelated change surface).
- The removal exit condition: drop this plugin if Stripe's upstream
  plugin ever applies the Material theme itself, OR if the rewrite
  stops using `<CardForm/>`.

### 2. `app.config.ts` — wire the plugin

Inserted `'./plugins/withMaterialTheme.js'` into the `plugins:` array
immediately after `withGradleHeap` (kickoff's recommended slot:
after JVM-args setup, before the Firebase plugin block). A
multi-line comment block above the entry explains the Phase 10 Turn 3
provenance, why the upstream Stripe plugin isn't sufficient, and the
DayNight-parent choice. No ordering hazards: the two files this
plugin mutates (`styles.xml`, `app/build.gradle`) are disjoint from
what every other plugin touches.

### 3. Smoke test — patch logic against staged fixtures

Before running the verify gates, I exercised both mutation
callbacks against fixtures that mirror the rewrite's actual
`styles.xml` (AppTheme + Theme.App.SplashScreen) and a representative
`app/build.gradle` dependencies block. Eleven assertions, all green:

```
✓ styles: AppTheme parent → Material DayNight
✓ styles: AppTheme parent is NOT legacy Light
✓ styles: Splash style parent unchanged (still AppTheme)
✓ styles: AppTheme items preserved
✓ styles: idempotent (pass2 parent still Material DayNight)
✓ gradle: Material dep injected
✓ gradle: existing react-android dep preserved
✓ gradle: existing core-ktx dep preserved
✓ gradle: dependencies { block intact
✓ gradle: idempotent (single material occurrence after pass2)
✓ gradle: byte-equal pass1 vs pass2
```

The `Theme.App.SplashScreen` style (which inherits from `AppTheme`)
remains structurally untouched — only the parent attribute on
`AppTheme` itself is rewritten. Since `Theme.MaterialComponents.*`
supports `android:windowBackground`, the splash-screen styling
continues to work conceptually.

### 4. `docs/PHASE_10_PARITY_AUDIT.md` updates

- **Header status line:** `Turn 3 closed 2026-05-18` sublabel added
  (keeps doc at v2 — Turn 10 will produce v3 per §11 sign-off).
- **§1 headline count:** 6 ❌ → 5 ❌ (annotation explains Turn 3's role).
- **§1 `withMaterialTheme` bullet:** marked closed in Turn 3 with
  code-path reference.
- **§4 row for `withMaterialTheme`:** flipped ❌ → ✅ with citation
  `plugins/withMaterialTheme.js:67-101` and the "AppTheme parent:
  DayNight (not legacy's Light)" annotation. Removal exit condition
  documented.
- **§4 action-items list:** corresponding bullet flipped ❌ → ✅.
- **§8 turn plan:** Turn 3 row marked ✅ closed with link to this doc.

## Acceptance criteria

- [x] Plugin patch landed in `plugins/withMaterialTheme.js` (Path a).
- [x] Idempotency check in place — re-running `expo prebuild` does
      not double-inject the material dependency or re-modify the
      already-Material `AppTheme` parent. Verified by smoke test:
      11/11 assertions green, including byte-equal pass1-vs-pass2
      check on the gradle file.
- [x] AppTheme parent is `Theme.MaterialComponents.DayNight.NoActionBar`
      (NOT legacy's `Light` variant).
- [x] Audit doc §4 `withMaterialTheme` row flipped ❌ → ✅ with a
      code-path citation.
- [x] Audit §1 headline count updated 6 ❌ → 5 ❌.
- [x] `PHASE_10_TURN_3.md` written (this doc).
- [x] `npm run typecheck` ✅ green (no .ts changes beyond the
      `app.config.ts` comment + wire entry).
- [x] `npm run lint` ✅ green (no output).
- [x] `npm run format:check` ✅ green for the plugin file and
      `app.config.ts`. Targeted check via
      `npx prettier --check plugins/withMaterialTheme.js app.config.ts`
      reports "All matched files use Prettier code style!" The lone
      remaining warning is pre-existing on `CLAUDE.md` at HEAD
      `041a4e6` — unrelated to this turn, and the file was not
      edited.
- [x] `npm test` — 1647 passed / 21 failed (carried-over Turn 9 BG-
      geolocation regression; no new failures introduced).
- [x] No regression: existing `Theme.App.SplashScreen` style
      (which inherits from `AppTheme`) remains structurally
      untouched. Material themes support `android:windowBackground`,
      so the splash render path is conceptually preserved.

## Native rebuild

**Required for the change to take effect.** The plugin mutates two
generated Android files: `android/app/src/main/res/values/styles.xml`
and `android/app/build.gradle`. Any developer building locally
after pulling this turn must run `npm run prebuild`. EAS builds
pick up the change automatically.

No iOS-side change — Material Components is Android-only.

## What's NOT in this turn

Explicit deferrals (per the kickoff's out-of-scope list):

- **Bumping `@stripe/stripe-react-native`.** A future minor release
  could add Material theme application to the upstream plugin (or
  not). Either way it's a separate dependency-update concern with
  its own native-rebuild testing. The `withMaterialTheme` plugin
  survives a rnstripe minor bump unchanged.
- **Rewriting `AddPaymentMethodScreen` to use a different Stripe
  primitive.** The screen is fine as-is; this turn just gates its
  rendering layer.
- **Dark-mode Material theme styles.** `Theme.MaterialComponents.DayNight.NoActionBar`
  auto-switches based on `Configuration.UI_MODE_NIGHT_*`. The
  rewrite's NativeWind theming is independent — both layers coexist.
  If a future polish turn wants explicit `night/styles.xml`, that's
  separate work.
- **`processing` UIBackgroundMode reconciliation** — Turn 4.
- **Rider live ETA** — Turn 5.
- **Activity tab** — Turn 6.
- **Scheduled rides** — Turn 7.
- **Chat** — Turn 8.
- **BG-geolocation test regression** — Turn 9.
- **Verifying behavior on a real Android device.** Cutover plan §5.3
  covers this as the production-build smoke-pass before §6.1 internal
  track. This turn delivers source change only.

## Decision log

Notable judgment calls in this turn:

1. **Path (a) port as a separate plugin, not (b) inline.** Per the
   kickoff's recommendation. The two files this plugin touches
   (`styles.xml` + `app/build.gradle`) are disjoint from anything
   every other plugin in the rewrite touches — no race / no
   co-location benefit. Naming a plugin `withMaterialTheme` makes
   its purpose searchable and matches the legacy filename for
   diffability across the repo boundary.

2. **`Theme.MaterialComponents.DayNight.NoActionBar`, not the
   legacy `Light` variant.** Legacy never adopted app-theme-level
   dark mode; the rewrite's "Honey and the Bee" design system
   does. Copying legacy verbatim would force light mode on every
   Android device, regressing the user-facing theming. The DayNight
   variant auto-switches with the OS preference and supports the
   same `MaterialCardView` surface that Stripe needs.

3. **Material Components pin at 1.11.0 (legacy's pick), not
   1.12.0 (latest stable).** Conservative. The pin can be re-
   evaluated in a future polish turn; bumping now is unrelated
   change surface for a turn whose only job is unblocking
   `<CardForm/>` render.

4. **Substring-only idempotency on the gradle side
   (`com.google.android.material:material`, not the full version
   string).** A future minor-version bump (1.11.0 → 1.12.0) should
   replace the dependency line on the next `expo prebuild`, not
   double-inject alongside it. The substring check on the package
   coordinate counts ANY pin as "already injected" and leaves the
   single line in place — the bump replaces the constant in the
   plugin source, and the next prebuild swaps the line cleanly.

5. **Audit doc stays v2 with a Turn-3 sublabel, not bumped to v3.**
   §11 sign-off names "Audit doc v3 produced after Turns 2-9 close"
   as the next version milestone. Bumping after every closed turn
   would inflate the version count. The sublabel approach matches
   the Turn 1 + Turn 2 convention.

6. **Smoke-test the patch against fixtures before running the
   verify gates.** Cheaper than waiting for a real `expo prebuild`
   to flag a regex regression. The 11-assertion smoke covers both
   patches' happy-path mutation AND both patches' idempotency on
   re-run, which is exactly the failure surface a real prebuild
   would catch.

## Sources

- [PHASE_10_PARITY_AUDIT.md](PHASE_10_PARITY_AUDIT.md) — the audit row this turn closes
- [PHASE_10_CUTOVER_PLAN.md](PHASE_10_CUTOVER_PLAN.md) — §0 gate this turn unblocks
- [PHASE_10_TURN_2.md](PHASE_10_TURN_2.md) — Turn 2's pattern (Firebase iOS SDK pin)
- [PHASE_10_TURN_3_KICKOFF.md](PHASE_10_TURN_3_KICKOFF.md) — this turn's scope
- Legacy [plugins/withMaterialTheme.js](../../yeride/plugins/withMaterialTheme.js) — reference implementation
- Stripe `<CardForm/>` Material Components requirement — `node_modules/@stripe/stripe-react-native/lib/typescript/src/components/CardForm.d.ts`
