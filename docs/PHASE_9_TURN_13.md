# Phase 9 Turn 13 — Per-brand SVG glyphs (CardBrandBadge)

**Closed:** May 4, 2026
**Baseline:** Phase 9 Turn 12 close (commit `89f957f`) — 187 suites /
1617 tests
**This turn:** **187 suites / 1619 tests** — +0 suites / +2 tests,
mid-range of the kickoff's "+0 suites / +1 to +3 tests" estimate
band.

## Scope

The smallest of the four Phase 9 polish items Turn 12's close logged
explicitly:

> Future Phase 9 polish (per-brand SVG glyphs / RNFirebase modular
> API / receipt PDF / NavigationSdk teardown telemetry
> L387/L415/L428)

Turn 7 ported the legacy yeride PNG card-brand glyphs and surfaced
them via `<CardBrandBadge brand size>`. The Turn 7 close flagged
SVG explicitly as deferred:

> Per-brand SVG glyphs (option that would have required
> `react-native-svg`) deferred — would have triggered a Fabric
> componentProvider patch mirroring Phase 9 Turn 1's
> `react-native-maps` work, and the visual outcome at receipt-row
> size is the same.

Turn 13 closes that deferral now that Turn 1's componentProvider
infrastructure is proven. Outcome: receipt-row glyphs are
resolution-independent (no pixellation at 2x / 3x display
densities; the reserved `'lg'` 48x30 size variant renders crisply
without re-exporting from a higher-DPI source).

## Pre-checklist (asked at kickoff)

| #   | Question                                                    | Answer                                                            | Notes                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SVG asset source                                            | **Hand-author from PNGs (Recommended)**                           | Trace the 6 existing PNGs into hand-authored `<Svg><Path/></Svg>` components. Full visual control, legacy fidelity preserved, no licensing risk, no transitive deps. ~30 min of authoring work. The npm-package and issuer-portal alternatives carry license review and dep-sprawl trade-offs.  |
| 2   | Generic fallback                                            | **SVG-ize the generic fallback too (Recommended)**                | Hand-authored `GenericCard.tsx` so the entire rendering pipeline is uniformly SVG. The alternative (keep `card.png` for the unknown-brand fallback) defeats the point of the turn for that branch — visual consistency at high DPI requires SVG everywhere.                                     |
| 3   | Fabric componentProvider patch (mirroring Turn 1's pattern) | **Verify after install, only patch if missing (Recommended)**     | `react-native-svg@15.15.3` ships a complete `codegenConfig.ios.componentProvider` block with all 28 component mappings (RNSVGSvgView / RNSVGPath / RNSVGRect / etc.) — verified post-install. **No plugin patch required.** Turn 1's `react-native-maps` escape doesn't apply.                  |
| 4   | Test strategy                                               | **Preserve testID tests, add SVG mock smoke tests (Recommended)** | Existing 20 testID-based tests preserved verbatim — robust against the rendering-pipeline flip. +2 new smoke tests assert SVG mock fires via reference identity on `Svg` / `Path` / `Rect`. Snapshot-test alternative rejected (brittle; prior turns explicitly avoid snapshot-heavy patterns). |

## What shipped

### One new dependency

`react-native-svg@15.15.3` — installed via `npx expo install
react-native-svg`. Auto-linked by Expo. **No Expo plugin block** in
`react-native-svg`'s `package.json` so `app.config.ts` did not need
a new entry.

**Verification:** `node_modules/react-native-svg/package.json`
ships a complete `codegenConfig.ios.componentProvider` block with
all 28 Fabric component mappings (`RNSVGCircle`, `RNSVGClipPath`,
`RNSVGDefs`, `RNSVGEllipse`, `RNSVGFeBlend`, `RNSVGFeColorMatrix`,
`RNSVGFeComposite`, `RNSVGFeFlood`, `RNSVGFeGaussianBlur`,
`RNSVGFeMerge`, `RNSVGFeOffset`, `RNSVGFilter`,
`RNSVGForeignObject`, `RNSVGGroup`, `RNSVGImage`, `RNSVGLine`,
`RNSVGLinearGradient`, `RNSVGMarker`, `RNSVGMask`, `RNSVGPath`,
`RNSVGPattern`, `RNSVGRadialGradient`, `RNSVGRect`, `RNSVGSvgView`,
`RNSVGSymbol`, `RNSVGTSpan`, `RNSVGText`, `RNSVGTextPath`,
`RNSVGUse`). Turn 1's `withNavigationSdk.js` `react-native-maps`
patch (L143-L173) is NOT mirrored — there's nothing to patch.

**Prebuild required** before the next iOS / Android build so the
new auto-linked native module gets included in the generated
projects. See "Prebuild requirement" section below.

### Six per-brand SVG components

Hand-authored under `src/presentation/components/payment/assets/svg/`:

| File              | viewBox     | Visual                                                                                |
| ----------------- | ----------- | ------------------------------------------------------------------------------------- |
| `Visa.tsx`        | `0 0 60 40` | Navy `#1A1F71` card body, white "VISA" wordmark approximation, yellow `#F7B600` bar   |
| `Mastercard.tsx`  | `0 0 60 40` | White card, red `#EB001B` left circle + yellow `#F79E1B` right circle, orange overlap |
| `Amex.tsx`        | `0 0 60 40` | Amex blue `#016FD0` card, white "AMEX" wordmark approximation                         |
| `Discover.tsx`    | `0 0 60 40` | White card, dark text-bar, prominent orange `#FF6000` disc with `#FF8533` highlight   |
| `Diners.tsx`      | `0 0 60 40` | White card, two interlocking blue `#0079BE` discs                                     |
| `GenericCard.tsx` | `0 0 60 40` | Slate-grey `#5A6772` body, gold `#D4A55F` chip outline, two grey `#9AA5AF` bars       |

All six exported as default function components with signature
`({width, height}: {readonly width: number; readonly height:
number}) => JSX.Element`. The viewBox is `0 0 60 40` across all six
(3:2 aspect, matching the size dimensions: `sm` 28x18 / `md` 36x22 /
`lg` 48x30) so the glyph fills its parent without distortion.

### `CardBrandBadge.tsx` flipped

Public API unchanged (`{brand: CardBrand, size?: 'sm' | 'md' |
'lg'}`) — `WalletCardRow` (`'sm'`) and `RideReceiptScreen` (`'md'`)
need no edits. Internal change:

- `BRAND_ASSETS` (PNG `ImageSourcePropType` records) → `BRAND_GLYPHS`
  (`ComponentType<{width, height}>` records).
- Render path: `<Image source={asset} resizeMode="contain"/>` →
  `<Glyph width={dims.width} height={dims.height}/>`.
- Outer `<View/>` with explicit width/height + per-brand testID
  unchanged for layout invariance + test compatibility.
- `accessible={false}` on the prior `<Image/>` is dropped — SVG
  children are not announced by screen readers by default.

JSDoc updated: prior deferral note replaced with the SVG path
explanation, the `react-native-svg@15.15.3` componentProvider
verification result, and the prebuild requirement.

### Manual mock at `__mocks__/react-native-svg.tsx`

Mirrors Phase 9 Turn 1's `__mocks__/react-native-maps.tsx` pattern
verbatim. Initial attempt to inline-mock via `jest.mock(
'react-native-svg', () => {...})` in `jest.setup.ts` collided with
NativeWind's babel plugin: the plugin auto-injects a file-scope
`_ReactNativeCSSInterop` helper around any `View` reference, and
`jest.mock` factories are hoisted above all file-scope bindings —
so the factory body fails with "module factory ... not allowed to
reference any out-of-scope variables" the moment it touches `View`
from `react-native`. A regular module file at
`__mocks__/<package>` is auto-resolved by Jest without hoisting,
so NativeWind's transform binds correctly.

Each SVG primitive (`Svg` / `Path` / `Rect` / `Circle` / `Ellipse`
/ `Line` / `Polygon` / `Polyline` / `G` / `Text` / `TSpan` / `Defs`
/ `LinearGradient` / `RadialGradient` / `Stop` / `ClipPath` /
`Mask` / `Pattern` / `Symbol` / `Use`) is exported as a `jest.fn()`
that renders its `children` inside a `<View/>`. Tests assert via
reference identity:

```ts
import { Svg, Path } from 'react-native-svg';
render(<CardBrandBadge brand="visa" />);
expect(Svg).toHaveBeenCalled();
expect(Path).toHaveBeenCalled();
```

The default export is `Svg` so `import Svg from 'react-native-svg'`
also resolves to the mock.

`jest.setup.ts` carries a comment-only block in the same shape as
the `react-native-maps` block, pointing at the manual mock and
documenting the NativeWind hoisting issue.

### Two new regression tests

`src/presentation/components/payment/__tests__/CardBrandBadge.test.tsx`
gains a new describe block `'SVG rendering pipeline (Phase 9 turn
13)'` with two tests:

1. `mounts the per-brand SVG glyph for branded brands` — renders
   `<CardBrandBadge brand="visa" />` and asserts `Svg`, `Path`,
   `Rect` were all called. Pins the SVG path fired (and the legacy
   PNG `<Image>` path is gone).
2. `mounts the GenericCard SVG glyph for the unknown brand
fallback` — renders `<CardBrandBadge brand="unknown" />` and
   asserts `Svg`, `Rect`, `Path` were all called. Pins the
   GenericCard SVG glyph is rendered via the SVG pipeline (not a
   PNG remnant) — important because Q2 chose to SVG-ize the
   fallback.

`beforeEach` clears the three mock invocation counts so cross-test
state doesn't pollute. The 20 existing testID-based tests are
preserved verbatim and continue to pass — the rendering-pipeline
flip is invisible to them because the testID lives on the OUTER
`<View/>` in `CardBrandBadge`, which is unaffected by the SVG
sub-tree below.

### Six PNG files orphaned

`src/presentation/components/payment/assets/{visa,mastercard,amex,
discover,diners-club,card}.png` are no longer imported anywhere.
Sandbox virtiofs blocks `unlink()`, so they're left in place for
this turn; document for any non-sandbox checkout to remove. They
add no runtime weight (Metro tree-shakes unused asset imports).

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + chunked `npm test` all green.

**187 test suites / 1619 tests** passing.

Delta vs. Phase 9 Turn 12 close baseline (187 suites / 1617 tests):
**+0 suites / +2 tests**. Mid-range of the kickoff's "+0 suites /
+1 to +3 tests" estimate band — both new tests landed in the
existing `CardBrandBadge.test.tsx` suite (no new suite) and cover
the SVG-rendering smokes that pre-checklist Q4 specified.

Test-suite breakdown verified across 5 chunks:

| Chunk pattern                                                                                         | Suites | Tests |
| ----------------------------------------------------------------------------------------------------- | -----: | ----: |
| `src/(domain\|app)`                                                                                   |     88 |   662 |
| `src/(shared\|presentation/(di\|hooks\|components))`                                                  |     34 |   308 |
| `src/presentation/features/(rider\|driver)`                                                           |     38 |   292 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent\|__tests__)` |      8 |    61 |
| `src/data`                                                                                            |     19 |   296 |
| **Total**                                                                                             |    187 |  1619 |

Chunk 2 carries the +2 delta (the two new SVG-rendering smoke
tests in `CardBrandBadge.test.tsx`, which lives under
`src/presentation/components/payment/__tests__/`). All other
chunks unchanged from Turn 12.

End-of-Turn-13 acceptance criteria, all met:

1. `react-native-svg@15.15.3` installed; verified
   `codegenConfig.ios.componentProvider` ships all 28 Fabric
   component mappings; no plugin patch required.
2. Six hand-authored per-brand SVG components shipped under
   `src/presentation/components/payment/assets/svg/` (Visa,
   Mastercard, Amex, Discover, Diners, GenericCard).
3. `CardBrandBadge.tsx` rendering-pipeline flipped from PNG
   `<Image>` to SVG glyph components. Public API
   (`{brand, size?}`) unchanged; consumer call sites
   (`WalletCardRow`, `RideReceiptScreen`) untouched.
4. Manual mock at `__mocks__/react-native-svg.tsx` exposes all 20
   SVG primitives as `jest.fn()` passthroughs (mirrors Turn 1's
   `react-native-maps` pattern; sidesteps the NativeWind / babel
   hoisting collision).
5. Two new regression tests added; 20 existing testID-based tests
   preserved verbatim.
6. All four verify gates green (each step individually under the
   sandbox's 45s bash timeout; chunked test run as in prior turns).
7. `docs/PHASE_9_TURN_13.md` written (this file).
8. `CLAUDE.md` top status block + phase-tables row updated.
9. Smoke checklist documented for user-driven validation
   (visual eyeball; pure UI polish, no telemetry follow-up).
10. Clean commit on `main` via the sandbox `GIT_INDEX_FILE`
    shadow plumbing pattern.

## Prebuild requirement

A fresh `npm run prebuild` is **required** before the next iOS or
Android build. Reason: `react-native-svg` is auto-linked by Expo
but the autolinking step runs during prebuild — the generated iOS
podspec and Android Gradle config don't yet reference the new
package. Without prebuild, the build will fail with module
resolution errors for `RNSVGSvgView` etc. on iOS, or compilation
errors for `com.horcrux.svg.*` on Android.

`react-native-svg` does NOT ship an Expo config plugin, so no
`app.config.ts` `plugins:` entry is needed. Prebuild simply
regenerates the native projects to include the auto-linked native
module.

## Smoke checklist (user-driven)

The smoke for this turn is pure visual eyeball — no telemetry to
verify. Steps after the next deploy lands on `yeapp-stage`:

1. **Run prebuild** locally before re-deploying:
   ```bash
   npm run prebuild
   (cd ios && pod install)  # if iOS
   ```
2. **iOS simulator + Android emulator** — open the app on both,
   sign in as a rider against `yeapp-stage`. Add at least one
   Visa, Mastercard, Amex, Discover, and Diners card via Wallet
   → Add payment method (use Stripe test cards).
3. **Wallet tab smoke** — navigate to Wallet. For each card, the
   `CardBrandBadge` (`'sm'` 28x18) renders crisply at the device's
   native pixel density. The pre-Turn-13 PNG glyphs should look
   identical at 1x but visibly sharper at 2x / 3x.
4. **RideReceipt smoke** — complete a trip end-to-end. On the
   completed receipt the payment row shows the `'md'` 36x22 glyph
   for the rider's chosen card brand. Same crispness check.
5. **Optional: 'lg' size variant** — there are no production call
   sites yet, but render `<CardBrandBadge brand="visa" size="lg"/>`
   in a dev shortcut to confirm the 48x30 size renders without
   blur (a future ManageCard / AddPaymentMethod confirmation
   screen would consume this).

Compare side-by-side with the pre-Turn-13 captures (the PNG path
ships the same legacy yeride asset set; visual fidelity should
match at 1x and exceed at 2x+).

### What to do if a glyph looks wrong

The hand-authored SVGs trace the legacy yeride brand-mark visual
identity. If a brand reads as wrong (e.g. the Visa wordmark
approximation looks too far from the canonical Visa wordmark, or
the Mastercard circles overlap is positioned poorly), the fix
lives in the per-brand `.tsx` file in
`src/presentation/components/payment/assets/svg/`. Edit the SVG
paths, re-run the typecheck + lint + format + chunked tests, and
commit. No native rebuild required for SVG-content tweaks.

The 6 orphan PNG files in `src/presentation/components/payment/
assets/` can serve as the visual reference for tracing — they're
the legacy yeride brand-mark assets. Treat them as input, not
output.

## Why this turn was the right size

- **One dependency, one SDK seam.** No new `app.config.ts` plugin
  block (no Expo plugin shipped by `react-native-svg`); no new
  config plugin patch (Turn 1's componentProvider work landed in
  upstream `react-native-svg@15.15.3` directly, no need to
  re-derive). The dep brings native code, but pre-checklist Q3's
  componentProvider verification proved no patches are required.
- **Pure component-internal change.** `CardBrandBadge`'s public
  API surface (`{brand, size?}`) is byte-identical pre-Turn-13 vs
  post-Turn-13 — `WalletCardRow` (one consumer, `'sm'` size) and
  `RideReceiptScreen` (one consumer, `'md'` size) needed zero
  edits. The blast radius is bounded to one component file + one
  asset directory.
- **Test surface preserved.** The 20 existing testID-based tests
  pass verbatim after the rendering-pipeline flip — they assert on
  the outer `<View/>`'s testID, which lives at the same DOM level
  pre- and post-flip. The 2 new smoke tests use the manual SVG
  mock's `jest.fn()` reference identity, a clean idiom that
  matches the rest of the codebase's mocking patterns.
- **One footgun, one documented escape.** The NativeWind / babel
  hoisting collision on inline `jest.mock('react-native-svg',
...)` factories was the only non-mechanical surprise. Resolved
  by mirroring Turn 1's `__mocks__/react-native-maps.tsx` pattern
  verbatim; the precedent makes the resolution near-mechanical.
- **No domain or app-layer surface touched.** No changes to
  entities, use cases, or repositories. No DI container changes.
  No cross-repo work (`yeride-functions` / `yeride-stripe-server`
  unchanged).

## What's left for Phase 9

Turn 12's close logged four future Phase 9 polish items. Turn 13
closed one (per-brand SVG glyphs). Three remain:

1. **RNFirebase modular API migration** — RNFirebase 24.x supports
   both the legacy namespaced API (`firestore().collection(...)`)
   and the new modular API (`getFirestore() + collection(getFirestore(),
...)`). The rewrite uses the namespaced form throughout. The
   modular API is the going-forward path; migration is mostly
   mechanical but touches every Firestore-using adapter.
2. **Receipt PDF** — the `RideReceiptScreen` currently surfaces a
   "share receipt" stub that's wired to nothing. Generating a PDF
   on the rider device + handing to `<Share/>` (or wiring an email
   receipt via a Cloud Function) would close the rider-side
   receipt UX. Out of scope for the trip flow itself; deferrable.
3. **NavigationSdk teardown telemetry (L387 / L415 / L428)** —
   Turn 12's stays-warn audit table classified these three sites
   as cleanup-best-effort (one-line tags); they could be flipped
   to `LOG.error` if the cleanup-failure mode becomes interesting
   in Crashlytics, but the next session re-init recovers cleanly
   so the telemetry value is low.

Phase 9 has been the longest phase by turn count (13 turns vs. the
prior longest, Phase 4's 5 turns) because each turn has been
small, surgical, and field-validated. The remaining three items
together would be ~2 more turns of work; alternatively they could
be folded into Phase 10's cutover prep if production readiness
becomes the priority over polish.

---

**End of `docs/PHASE_9_TURN_13.md`.**
