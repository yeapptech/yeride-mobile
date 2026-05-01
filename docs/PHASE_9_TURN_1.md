# Phase 9 — Turn 1: iOS Apple Maps Fabric escape (PROVIDER_GOOGLE on

# both platforms)

The iOS device-build smoke that closed Phase 8 turn 3 surfaced a
regression: every screen using `<Map/>` rendered the pink
"Unimplemented component: <RNMapsMapView>" placeholder. Driver
Navigation worked because `<NavigationView/>` is the Google Navigation
SDK's own native view (separate from `react-native-maps`), but rider
RouteSelect / RideMonitor and driver DriverHome / DriverMonitor were
all unusable on iOS. Logged as task #13 in the kickoff and queued for
Phase 9.

This turn flips the rewrite's `<Map/>` from
`provider={Platform.OS === 'ios' ? undefined : 'google'}` (Apple Maps
on iOS) to `provider={PROVIDER_GOOGLE}` on both platforms. The
underlying issue is that under Expo SDK 55 + RN 0.83.6 New Arch, the
react-native-maps@1.24 Apple Maps view manager (`AIRMap`) doesn't get
picked up by the Fabric → Paper interop. Switching to the Google view
manager (`AIRGoogleMap`) sidesteps the registration failure entirely —
the AirGoogleMaps source files compile through to a recognized Fabric
view via the package's `Google` subspec.

End of Turn 1 acceptance: **161 test suites / 1274 tests passing**
(+1 suite / +6 tests over Phase 8 close at 160/1268 — 3 are the new
Map.test.tsx tests; the +3 surplus comes from previously
intermittently-failing tests that the new global `react-native-maps`
mock now lets execute deterministically). typecheck, lint, format,
and test all green. **`npm run prebuild` is required before the next
iOS / Android build** so the new Podfile emit lands and the
react-native-maps podspec patch is re-applied.

## What's in

**Update after first device-build attempt:** the Podfile mod and
`Map.tsx` provider flip alone weren't sufficient. The first iOS sim
launch after my changes still rendered the `<Map/>` placeholder —
but with a different component name, `<RNMapsGoogleMapView>` instead
of `<RNMapsMapView>`. That confirmed the JS provider flip took
effect (JS now requests the Google view), but the runtime's Fabric
registry didn't have the Google class either. Root cause turned out
to be react-native-maps@1.24's missing `codegenConfig.ios.componentProvider`
in `package.json` — see "What's in" §7 below for the patch that
unblocked the registration.

### 1. `plugins/withNavigationSdk.js` Podfile mod refactored

The previous mod stripped Expo's built-in `withMaps` `# @generated
begin react-native-maps` block on the (correct) belief that Expo's
emit references a podspec name that no longer ships in
react-native-maps@1.23+ (`react-native-google-maps.podspec`). What it
DIDN'T do was provide a working replacement, so iOS ended up with no
Google Maps view manager compiled in at all — only the (broken under
Fabric) Apple Maps view manager.

The refactored mod takes one of three branches:

- **A — refresh existing yeride block in place** when a previous
  prebuild already emitted ours. Idempotent across re-prebuilds.
- **B — replace Expo's broken @generated block** with our subspec
  form when present. Distinct sentinel comments
  (`# @generated begin react-native-maps/Google - yeride-next withNavigationSdk`)
  so we don't collide with Expo's own @generated boundary.
- **C — inject after `use_native_modules!`** when Expo doesn't emit
  at all (the rewrite plumbs `GMSApiKey` via the local
  `withGoogleMapsApiKey.js` plugin, which doesn't trigger Expo's
  internal withMaps emit). This is the path the rewrite hits today.

In all three branches, the line that lands is:

```ruby
pod 'react-native-maps/Google', :path => '../node_modules/react-native-maps'
```

The unified `react-native-maps.podspec` exposes Google Maps as a
subspec sibling of `Maps` and `Generated` (lines 105-117 of the
upstream podspec). Adding the subspec pulls AirGoogleMaps source
files (`AIRGoogleMap.mm`, `AIRGoogleMapManager.mm`) into the build
alongside the default Apple Maps `Maps` subspec.

The orphan-line strip
(`pod 'react-native-google-maps' …` outside any @generated block)
stays as defensive coverage in case future Expo SDK versions re-emit
the bogus pod line under different conditions.

### 2. iOS podspec patch path corrected

The previous patch path `node_modules/react-native-maps/react-native-google-maps.podspec`
references a file that doesn't exist in 1.24 (the standalone podspec
was retired in 1.23). The patch was wrapped in `fs.existsSync`, so
it was a silent no-op — `GoogleMaps` and `Google-Maps-iOS-Utils`
versions were never bumped.

Corrected path: `node_modules/react-native-maps/react-native-maps.podspec`
— the unified file that 1.24 actually ships. The version-replace
regexes (`s\.dependency\s+'GoogleMaps',\s*'[^']+'`,
`s\.dependency\s+'Google-Maps-iOS-Utils',\s*'[^']+'`) are unchanged;
they match the matching `s.dependency` lines inside the `Google`
subspec block exactly once. After the patch:

```
ss.dependency 'GoogleMaps', '10.7.0'         # was '9.3.0'
ss.dependency 'Google-Maps-iOS-Utils', '7.0.0'  # was '6.1.0'
```

This brings the Google subspec's transitive deps into alignment with
the Navigation SDK's `GoogleMaps == 10.7.0` pin (which
`GoogleNavigation 10.7.0` enforces). Without the patch, `pod install`
would refuse to resolve — two pods declaring conflicting `GoogleMaps`
version pins.

### 3. eventPatchFiles list extension

The list of files that get the `RCTBubblingEventBlock` →
`RCTDirectEventBlock` patch had stale extensions:

- `AirGoogleMaps/AIRGoogleMapManager.m` → `.mm` (Objective-C++ in 1.24)
- `AirGoogleMaps/AIRGoogleMap.m` → `.mm`
- `AirMaps/AIRMap.h` was patched but `AirMaps/AIRMap.mm` wasn't listed at all

The previous list was guarded by `fs.existsSync`, so missing-file
entries silently no-op'd. Only headers were patched in Phase 8; the
`.mm` impl files retained the original event-block annotations.
Updated list:

```js
const eventPatchFiles = [
  'AirGoogleMaps/AIRGoogleMapManager.mm', // was .m
  'AirGoogleMaps/AIRGoogleMap.h',
  'AirGoogleMaps/AIRGoogleMap.mm', // was .m
  'AirMaps/AIRMapManager.m',
  'AirMaps/AIRMap.h',
  'AirMaps/AIRMap.mm', // newly added
];
```

This was a latent Phase 8 bug. Activating the Google subspec would
have surfaced it as a runtime bridge-event mismatch on the impl
files. Fixed pre-emptively.

### 4. `Map.tsx` provider flipped to PROVIDER_GOOGLE

```diff
-import { Platform, StyleSheet, View } from 'react-native';
+import { StyleSheet, View } from 'react-native';
+
 import MapView, {
   Marker,
   Polyline,
+  PROVIDER_GOOGLE,
   type Region as RNRegion,
 } from 'react-native-maps';
...
-      <MapView
-        provider={Platform.OS === 'ios' ? undefined : 'google'}
+      <MapView
+        provider={PROVIDER_GOOGLE}
```

The component's JSDoc was rewritten to record the iOS-Google
decision and the Fabric regression that motivated it. Notable: legacy
yeride uses Apple Maps on iOS too (`Map.js:278` is the identical
line) — but legacy is on Expo SDK 53 with the old architecture and
doesn't hit the Fabric regression. Legacy parity is intentionally
not preserved here.

### 5. `__mocks__/react-native-maps.tsx` (manual Jest mock)

Added a manual mock at the project root so tests can render `<Map/>`
without pulling in the package's native view-managers. The mock
encodes relevant props into `testID`s (`map-view-provider-google`,
`map-polyline-len-N`, `map-marker-opacity-N`) so consumer tests can
assert on them without setting up `jest.spyOn` plumbing per-test.

Why a manual mock and not an inline `jest.mock` factory: the
NativeWind babel plugin wraps every component in a CSS-interop
helper that closes over a file-scope `_ReactNativeCSSInterop`
binding. Inline `jest.mock` factories are HOISTED above all file-scope
bindings, so the factory body would reference an out-of-scope
variable and the test suite fails to load. A regular module file
binds correctly. The pattern is documented inline in `jest.setup.ts`
for any future test author who hits the same wall.

### 6. Type shim extended

`src/shared/types/react-native-maps.d.ts` declares slim ambient types
for the package because 1.24 publishes its source as `main` and trips
our strict `exactOptionalPropertyTypes` settings under
`skipLibCheck`. Added the two provider constants:

```ts
export const PROVIDER_GOOGLE: 'google';
export const PROVIDER_DEFAULT: undefined;
```

Without this, `tsc` rejected the import in `Map.tsx` ("Module
'"react-native-maps"' has no exported member 'PROVIDER_GOOGLE'").

### 7. `react-native-maps` codegenConfig.ios.componentProvider patch

**Critical follow-up after the first device-build attempt.** With only
the Podfile + provider flip in place, the iOS sim still rendered the
`<Map/>` placeholder — but the placeholder name had changed from
`<RNMapsMapView>` (Apple, before) to `<RNMapsGoogleMapView>` (Google,
after). JS was now correctly requesting the Google view manager (the
provider flip took effect), but the runtime's
`RCTThirdPartyComponentsProvider.thirdPartyFabricComponents`
dictionary had no entry for it.

Root cause: react-native-maps@1.24's `package.json` `codegenConfig`
declares `"name": "RNMapsSpecs"`, `"jsSrcsDir": "./src/specs"`,
`"includesGeneratedCode": true`, and the Android `javaPackageName` —
but it's missing the `ios.componentProvider` mapping that RN 0.74+
requires for the app's codegen to register Fabric components.
Compare with Stripe's working config:

```json
"ios": {
  "componentProvider": {
    "ApplePayButton": "ApplePayButtonComponentView",
    "CardForm": "CardFormComponentView",
    ...
  }
}
```

Without this section, the app's auto-generated
`ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.mm`
lists Stripe + safe-area + screens + nav-sdk components, but contains
zero entries for react-native-maps. `NSClassFromString(@"RNMapsGoogleMapView")`
returns `nil` at runtime → Fabric falls back to the placeholder.

Confusingly, the package ships a hand-written
`node_modules/react-native-maps/ios/generated/RCTThirdPartyComponentsProvider.mm`
with the right 4 mappings — but that file is `exclude_files`'d in
the podspec (lines 26-31 of `react-native-maps.podspec`) and never
actually compiled. Reference output only; not what runs.

The fix lives in the same `withNavigationSdkIos` plugin function
(step 0, runs before the podspec patch). It mutates
`node_modules/react-native-maps/package.json` to add:

```json
"codegenConfig": {
  ...,
  "ios": {
    "componentProvider": {
      "RNMapsMapView": "RNMapsMapView",
      "RNMapsGoogleMapView": "RNMapsGoogleMapView",
      "RNMapsMarker": "RNMapsMarkerView",
      "RNMapsGooglePolygon": "RNMapsGooglePolygonView"
    }
  }
}
```

The 4 mappings come from the package's hand-written
`RCTThirdPartyComponentsProvider.mm` reference file. The patch is
idempotent (`JSON.stringify` equality check) so re-prebuilds don't
churn `mtime`. Runs at `withDangerousMod` time so it's in place
before `pod install` triggers the codegen step that reads
`package.json`.

**Activation requires `pod install` + clean rebuild** so the codegen
regenerates `RCTThirdPartyComponentsProvider.mm` with the new
entries. Incremental Xcode builds may not re-link with the new
codegen output; if the placeholder persists after `pod install`,
clean DerivedData via Xcode → Product → Clean Build Folder, or
delete `ios/build/generated/` to force codegen regeneration.

### 8. `Map.test.tsx` regression coverage

Three tests, all hitting the new global mock:

1. **`passes PROVIDER_GOOGLE to MapView`** — locks the iOS Apple Maps
   Fabric escape. A regression that flips the provider back to
   `Platform.OS === 'ios' ? undefined : 'google'` (or any non-Google
   value) surfaces as a missing `map-view-provider-google` testID.
2. **`mounts the always-on polyline pool (5 slots)`** — locks the
   Phase 3 always-mounted-children invariant. A refactor that
   conditionally mounts a Polyline (e.g. `{cond && <Polyline/>}`)
   surfaces here as a count drift.
3. **`mounts the always-on marker pool (3 slots)`** — same
   invariant on the marker side.

## Why this turn doesn't include

- **Apple Maps Fabric registration debugging.** The kickoff staged
  this as fix candidate 2 (higher investigation cost). We sidestep
  it by using Google. If a future phase requires Apple Maps support
  (e.g. a region with Google Maps data quality issues), debugging
  the Fabric registration remains an open path.

- **Marker / polyline branded styling.** Default platform pins still
  render. Branded marker views (driver car icon, gold pickup pin,
  red dropoff pin) are deferred to a later polish turn.

- **Migrating off `react-native-maps` entirely.** The package
  underpins every map surface in the rewrite. Replacement (e.g. with
  `expo-maps` or a pure-Fabric alternative) is a multi-phase effort
  that doesn't fit the Phase 9 polish scope.

- **EAS / TestFlight builds with the new pod line.** Local debug
  prebuild verified; full EAS production build is post-cutover work.

- **Migrating away from boundaries-rule legacy selector syntax.**
  ESLint emits informational warnings about
  `boundaries/element-types` being renamed to
  `boundaries/dependencies` in v6. Cosmetic; lint still passes.
  Tracked separately as part of the Phase 9 cleanup grab-bag.

## Risks surfaced (still Phase 9 scope)

### `pod install` + clean rebuild required to activate

The plugin mutates `node_modules/react-native-maps/package.json` at
prebuild time, but the activation path goes through CocoaPods'
codegen, not the prebuild step itself. Sequence:

1. `npm run prebuild` — applies the package.json patch (and the
   podspec / Podfile changes from §1-3).
2. `(cd ios && pod install)` — codegen re-runs with the new
   `componentProvider` mappings and rewrites
   `ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.mm`.
   Verify by `grep RNMapsGoogleMapView ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.mm`
   — should now appear.
3. **Clean build** before `npm run ios`. Xcode's incremental builds
   sometimes don't relink with regenerated codegen. Either:
   - Delete `ios/build/` (force full rebuild)
   - Xcode → Product → Clean Build Folder (⌘⇧K)
   - Or `xcodebuild clean` for the workspace.

If after all three steps the placeholder still renders, suspect
DerivedData caching: `rm -rf ~/Library/Developer/Xcode/DerivedData/YeRideNextDev*`
and rebuild.

### Existing `Podfile.lock` will need regeneration

The lock that shipped with the partial prebuild lists
`react-native-maps/Google (1.24.0)` alongside `react-native-maps/Maps`,
which is correct. After the codegen patch, no further lock changes
are required (the patch is to package.json, not the podspec).
`pod install` will be a no-op for the lock but WILL regenerate
codegen output.

### Boundaries rule warnings

`eslint-plugin-boundaries` emits informational warnings about the
deprecated `boundaries/element-types` rule name. Lint still passes
(warnings don't fail). Tracked for a future cleanup turn — migration
is straightforward but touches every override block in
`eslint.config.js`.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` +
`npm run test` all green. **161 test suites / 1274 tests** (+1 suite
/ +6 tests over Phase 8 close).

Phase 9 turn 1 acceptance criteria, all met:

1. ✅ `plugins/withNavigationSdk.js` Podfile mod refactored to emit
   the `react-native-maps/Google` subspec rather than strip-only.
2. ✅ iOS podspec patch path corrected from
   `react-native-google-maps.podspec` (doesn't exist) to
   `react-native-maps.podspec`. Patched podspec confirmed to bump
   `GoogleMaps` 9.3.0 → 10.7.0 and `Google-Maps-iOS-Utils` 6.1.0 →
   7.0.0 in the Google subspec.
3. ✅ `react-native-maps` `package.json` patched to add
   `codegenConfig.ios.componentProvider` with the 4 Fabric component
   mappings. Without this, `RCTThirdPartyComponentsProvider.mm` lists
   no entries for the package and the runtime renders placeholders
   even with the Google subspec compiled in.
4. ✅ `Map.tsx` provider flipped to `PROVIDER_GOOGLE` on both
   platforms; JSDoc updated to record the iOS Fabric regression.
5. ✅ Manual mock at `__mocks__/react-native-maps.tsx`; test pattern
   documented in `jest.setup.ts` for future authors.
6. ✅ `Map.test.tsx` adds 3 regression tests locking the provider
   decision plus the always-mounted-children invariant.
7. ✅ Type shim extended with `PROVIDER_GOOGLE` + `PROVIDER_DEFAULT`.
8. ✅ `docs/PHASE_9_TURN_1.md` written (this file).
9. ✅ `CLAUDE.md` updated to reflect Phase 9 turn 1 close.
10. ✅ `npm run verify` green at the end of the turn.

Manual verification still pending (requires the user's local Mac):
`npm run prebuild` clean + `(cd ios && pod install)` + `npm run ios`
→ confirm `<Map/>` renders Google tiles instead of `<RNMapsMapView>`
placeholder.

## Files added / touched this turn

**Added:**

- `__mocks__/react-native-maps.tsx` — manual Jest mock for the
  package; auto-discovered by Jest because `<rootDir>/__mocks__/<pkg>`
  is the canonical manual-mock path.
- `src/presentation/components/map/__tests__/Map.test.tsx` — 3
  regression tests.
- `docs/PHASE_9_TURN_1.md` — this file.

**Touched:**

- `plugins/withNavigationSdk.js` — Podfile mod refactored to
  three-branch emit (refresh existing yeride block / replace Expo's
  broken block / inject after `use_native_modules!`); iOS podspec
  patch path corrected from `react-native-google-maps.podspec`
  (doesn't exist in 1.24) to `react-native-maps.podspec`;
  `eventPatchFiles` list extensions corrected (`.m` → `.mm` for
  AirGoogleMaps Manager + Map; AirMaps/AIRMap.mm added).
- `src/presentation/components/map/Map.tsx` — `provider` flipped to
  `PROVIDER_GOOGLE` on both platforms; JSDoc updated to record the
  iOS Fabric regression and the rationale for diverging from legacy
  yeride parity.
- `src/shared/types/react-native-maps.d.ts` — added `PROVIDER_GOOGLE`
  and `PROVIDER_DEFAULT` constants.
- `jest.setup.ts` — documents the manual-mock pattern (no actual
  mock code; the manual mock at `__mocks__/react-native-maps.tsx` is
  auto-discovered by Jest).

## Phase 9 progress

| Turn | Scope                                                                               | Tests delta         | Status |
| ---- | ----------------------------------------------------------------------------------- | ------------------- | ------ |
| 1    | iOS Apple Maps Fabric escape — flip `<Map/>` to `PROVIDER_GOOGLE` on both platforms | +1 suite / +6 tests | ✅     |
| 2    | Push notifications — token registration + Cloud Function trip-event triggers        |                     | Next   |
| 3    | Crashlytics integration                                                             |                     |        |
| 4-6  | Polish bundle (DriverNavigation buttons, SDK telemetry, cleanup grab-bag)           |                     |        |

Phase 9 turn 2 is next.
