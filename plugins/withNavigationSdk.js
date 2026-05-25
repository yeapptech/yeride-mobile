const {
  withAppBuildGradle,
  withDangerousMod,
  withPodfile,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Custom Expo config plugin: integrate
 * `@googlemaps/react-native-navigation-sdk@0.14.1` into the rewrite (Phase 8
 * turn 1).
 *
 * **Minimum patch set** — per Phase 8 kickoff scope decision 3, this turn
 * ships only the patches needed to land the SDK in the dependency graph
 * and keep both platforms compiling alongside the existing
 * `react-native-maps@1.24.0`. Patches that defend against runtime crashes
 * (Firebase BoM 34.0.0 pin for gRPC stream stability under an active
 * Navigation session, MapView constructor `super.onCreate`/`super.onResume`
 * patch for legacy 1.20.x parity, MapView `onPause` NPE swallow for
 * Nav-SDK + RN Maps coexistence) are deferred to Turn 3 and brought in
 * if the device-build smoke catches them.
 *
 * Carry-forwards / no-ops in the rewrite:
 *
 *   - `playServicesLocationVersion = "21.0.1"` is already pinned by
 *     `./plugins/withPlayServicesLocationVersion.js` (Phase 7 turn 2 fix
 *     for the IncompatibleClassChangeError on the GPS shutdown path). Do
 *     NOT duplicate it here — both plugins anchoring on the same Gradle
 *     prefix would race.
 *
 *   - The Compose Compiler Gradle classpath that legacy yeride needs for
 *     the Stripe SDK is not added here. The rewrite's Stripe SDK
 *     integration (Phase 6 turn 3) hasn't required it yet; if a build
 *     under the new Navigation SDK scope catches a Compose-compiler
 *     error, port the legacy block at that point.
 *
 *   - Legacy yeride still ships react-native-maps 1.18.0 + needs the
 *     `setMetalRendererEnabled:` removal patch on `AIRGoogleMapManager.m`.
 *     The rewrite is on react-native-maps@1.24.0, which already dropped
 *     the call — no patch needed here.
 *
 * What this plugin does:
 *
 * **Android (`withAppBuildGradle`):**
 *
 *   1. Enable `coreLibraryDesugaringEnabled true` in `compileOptions`.
 *      The Navigation SDK's bundled native code targets newer Java APIs
 *      that AGP back-fills via desugaring.
 *
 *   2. Add `coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'`
 *      dependency. The `_nio` variant is required for the SDK's I/O calls.
 *
 *   3. Exclude `play-services-maps` at app level. The Navigation SDK
 *      bundles its own Maps SDK; without this exclusion the app would
 *      ship duplicate Maps classes from the transitively-pulled
 *      `play-services-maps` (Firebase / expo-location pull it in) and
 *      hit dex-merge errors. App-level (configurations.all + exclude
 *      group/module) NOT global so react-native-maps can still compile
 *      against it; the duplicates are stripped at packaging time.
 *
 *   4. Force `kotlin-stdlib` (and the four module variants) to 2.0.21.
 *      The Navigation SDK transitively pulls 2.1.x; React Native 0.83.6
 *      compiles with Kotlin 2.0.21, and a mismatched stdlib at runtime
 *      causes `NoSuchMethodError` from kotlin-stdlib calls.
 *
 *   5. Disable `checkDebugAarMetadata` / `checkReleaseAarMetadata`.
 *      Navigation SDK 7.3+ AAR metadata declares `minAgpVersion 8.10.0`,
 *      but RN 0.83.6 ships AGP 8.8.2. The check is metadata-only — the
 *      SDK works at runtime with AGP 8.8.2.
 *      TODO: Remove when RN ships AGP >= 8.10.
 *
 * **iOS (`withDangerousMod`):**
 *
 *   1. Patch `react-native-maps.podspec` (the unified podspec
 *      react-native-maps@1.23+ ships, replacing the older standalone
 *      `react-native-google-maps.podspec`) to align the `Google`
 *      subspec's `GoogleMaps` dep to `10.7.0` and `Google-Maps-iOS-Utils`
 *      to `7.0.0`. The Navigation SDK pulls `GoogleNavigation` which
 *      depends on `GoogleMaps == 10.7.0`; without this patch CocoaPods
 *      refuses to resolve the conflicting version pins (subspec ships
 *      `GoogleMaps '9.3.0'` upstream).
 *
 *   2. Patch `onMapReady` event registrations across react-native-maps's
 *      iOS code to use `RCTDirectEventBlock` instead of
 *      `RCTBubblingEventBlock`. The Navigation SDK registers `onMapReady`
 *      as a direct event; in dev builds RN refuses two registrations
 *      with different bubble flags for the same event name.
 *
 * **iOS (`withPodfile`):**
 *
 *   3. Add CocoaPods git-spec source `https://github.com/CocoaPods/Specs.git`
 *      as a fallback for jsdelivr CDN HTTP/2 framing errors. Order
 *      matters: must be inserted before any pod declarations.
 *
 *   4. Replace the `# @generated begin react-native-maps` block that
 *      Expo's built-in `withMaps` injects (Phase 9 turn 1: previously
 *      stripped because the Expo block emits a `pod 'react-native-google-maps'`
 *      line referencing a podspec that no longer ships in 1.23+). The
 *      replacement emits `pod 'react-native-maps/Google'`, the subspec
 *      form that actually compiles in the unified podspec. This pulls
 *      the AirGoogleMaps view manager (`AIRGoogleMap`) into the build —
 *      required for `provider={PROVIDER_GOOGLE}` on iOS, which the
 *      rewrite uses to escape the Apple Maps Fabric registration
 *      regression on Expo SDK 55 + RN 0.83.6 New Arch (every screen
 *      using `<MapView>` without this falls through to a pink
 *      "Unimplemented component: <RNMapsMapView>" placeholder).
 *      Belt-and-suspenders: also drop any orphan
 *      `pod 'react-native-google-maps' …` line outside the @generated
 *      block in case Expo's emit drifts in future SDK versions.
 */

function withNavigationSdkIos(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      // 0. Patch react-native-maps' package.json to declare its Fabric
      //    components via `codegenConfig.ios.componentProvider`. RN 0.74+
      //    requires every package to map JS Fabric component names to
      //    the iOS class names via this field; without it, the app's
      //    `RCTThirdPartyComponentsProvider.mm` (auto-generated under
      //    `ios/build/generated/ios/ReactCodegen/`) doesn't list ANY of
      //    react-native-maps' components, and the runtime renders the
      //    pink "Unimplemented component: <RNMapsGoogleMapView>" /
      //    "<RNMapsMapView>" placeholders for every <Map/>.
      //
      //    react-native-maps@1.24 ships a hand-written
      //    `node_modules/react-native-maps/ios/generated/RCTThirdPartyComponentsProvider.mm`
      //    with the right 4 mappings, but that file is `exclude_files`'d
      //    in the podspec and never actually compiled. The mappings
      //    have to live in `package.json` for the app's codegen to read
      //    them at `pod install` time.
      //
      //    Phase 9 turn 1: this patch is what makes the Apple Maps
      //    Fabric escape (Map.tsx provider flip) actually take effect
      //    at runtime. Without it, both `<RNMapsMapView>` (Apple) and
      //    `<RNMapsGoogleMapView>` (Google) come back as "Unimplemented".
      //
      //    Run order: this mutation lands at prebuild time, so when
      //    `pod install` runs (either inside prebuild or from the
      //    user's `(cd ios && pod install)`), the codegen step picks
      //    up the new componentProvider entries.
      const rnMapsPkgPath = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/package.json',
      );
      if (fs.existsSync(rnMapsPkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(rnMapsPkgPath, 'utf-8'));
        if (pkg.codegenConfig && typeof pkg.codegenConfig === 'object') {
          const desiredProvider = {
            RNMapsMapView: 'RNMapsMapView',
            RNMapsGoogleMapView: 'RNMapsGoogleMapView',
            RNMapsMarker: 'RNMapsMarkerView',
            RNMapsGooglePolygon: 'RNMapsGooglePolygonView',
          };
          const currentIos = pkg.codegenConfig.ios ?? {};
          const currentProvider = currentIos.componentProvider ?? {};
          const merged = { ...desiredProvider, ...currentProvider };
          // Only write if the merged result differs from what's on disk
          // (idempotency: avoids touching mtime on every prebuild).
          const equal =
            JSON.stringify(currentProvider) === JSON.stringify(merged);
          if (!equal) {
            pkg.codegenConfig.ios = {
              ...currentIos,
              componentProvider: merged,
            };
            fs.writeFileSync(
              rnMapsPkgPath,
              JSON.stringify(pkg, null, 2) + '\n',
            );
          }
        }
      }

      // 1. Patch react-native-maps' unified podspec to align the `Google`
      //    subspec's GoogleMaps dep with the Navigation SDK
      //    (which requires GoogleMaps 10.7.0 via GoogleNavigation).
      //
      //    Phase 9 turn 1: the path was previously
      //    `react-native-google-maps.podspec`, a separate podspec that
      //    react-native-maps shipped through 1.22.x. Starting in 1.23,
      //    the package consolidated to a single `react-native-maps.podspec`
      //    with `Generated` / `Maps` / `Google` subspecs. The old
      //    standalone podspec no longer exists, so the previous patch
      //    was a silent no-op (guarded by `fs.existsSync`). The Google
      //    subspec ships `GoogleMaps '9.3.0'` upstream — without the
      //    bump below, adding `pod 'react-native-maps/Google'` to the
      //    Podfile fails to resolve against `GoogleNavigation == 10.7.0`.
      const podspecPath = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/react-native-maps.podspec',
      );
      if (fs.existsSync(podspecPath)) {
        let podspec = fs.readFileSync(podspecPath, 'utf-8');
        podspec = podspec.replace(
          /s\.dependency\s+'GoogleMaps',\s*'[^']+'/,
          "s.dependency 'GoogleMaps', '10.7.0'",
        );
        podspec = podspec.replace(
          /s\.dependency\s+'Google-Maps-iOS-Utils',\s*'[^']+'/,
          "s.dependency 'Google-Maps-iOS-Utils', '7.0.0'",
        );
        fs.writeFileSync(podspecPath, podspec);
      }

      // 2. Fix onMapReady event-type conflict between react-native-maps and
      //    @googlemaps/react-native-navigation-sdk. Both register a
      //    topMapReady event; react-native-maps uses RCTBubblingEventBlock
      //    while the Navigation SDK uses RCTDirectEventBlock. In dev
      //    builds RN refuses the second registration. Coerce
      //    react-native-maps to use RCTDirectEventBlock to match.
      //
      //    Phase 9 turn 1: file extensions corrected — Manager / Map
      //    impls in `react-native-maps@1.24.0` ship as `.mm`, not `.m`.
      //    The previous list also missed `AirMaps/AIRMap.mm` outright.
      //    Without these, the patch silently no-op'd on the impl files
      //    via `fs.existsSync`; only the headers were updated.
      const rnMapsIosDir = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/ios',
      );
      const eventPatchFiles = [
        'AirGoogleMaps/AIRGoogleMapManager.mm',
        'AirGoogleMaps/AIRGoogleMap.h',
        'AirGoogleMaps/AIRGoogleMap.mm',
        'AirMaps/AIRMapManager.m',
        'AirMaps/AIRMap.h',
        'AirMaps/AIRMap.mm',
      ];
      for (const relPath of eventPatchFiles) {
        const filePath = path.resolve(rnMapsIosDir, relPath);
        if (fs.existsSync(filePath)) {
          let content = fs.readFileSync(filePath, 'utf-8');
          if (
            content.includes('RCTBubblingEventBlock') &&
            content.includes('onMapReady')
          ) {
            content = content.replace(
              /^(.*onMapReady.*)RCTBubblingEventBlock(.*)/gm,
              '$1RCTDirectEventBlock$2',
            );
            content = content.replace(
              /^(.*)RCTBubblingEventBlock(.*onMapReady.*)/gm,
              '$1RCTDirectEventBlock$2',
            );
            fs.writeFileSync(filePath, content);
          }
        }
      }

      return config;
    },
  ]);
}

// Runs in the 'podfile' mod stream so it chains after Expo's built-in
// `withMaps` (which injects the orphan `pod 'react-native-google-maps'`
// block via the same stream). Dangerous mods run with precedence -2 —
// BEFORE withMaps — so stripping there is a no-op. `withPodfile` puts us
// in the same stream and our callback runs after Expo's core plugins.
function withNavigationSdkPodfile(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;

    // 1. Add git spec repo source as a CDN-outage fallback.
    if (!contents.includes("source 'https://github.com/CocoaPods/Specs.git'")) {
      contents = contents.replace(
        /require 'json'/,
        "require 'json'\n\nsource 'https://github.com/CocoaPods/Specs.git'",
      );
    }

    // 2. Replace the `# @generated begin react-native-maps` block emitted
    //    by Expo's built-in withMaps with the corrected subspec form.
    //
    //    What Expo emits (broken):
    //      pod 'react-native-google-maps', :path => '../node_modules/react-native-maps'
    //
    //    react-native-maps@1.23+ retired the standalone
    //    `react-native-google-maps.podspec`; that pod line fails to
    //    resolve. The package now exposes Google Maps as a subspec of
    //    the unified `react-native-maps.podspec` (`Maps`, `Google`,
    //    `Generated` siblings). The corrected emit pulls the AirGoogleMaps
    //    view manager (`AIRGoogleMap`, `AIRGoogleMapManager`) into the
    //    build — required for `provider={PROVIDER_GOOGLE}` on iOS,
    //    which the rewrite uses to escape the Apple Maps Fabric
    //    registration regression on Expo SDK 55 + RN 0.83.6 New Arch
    //    (every screen using `<MapView>` falls through to a pink
    //    "Unimplemented component: <RNMapsMapView>" placeholder
    //    otherwise — see Phase 9 turn 1 record).
    //
    //    Why replace instead of strip + manual emit elsewhere: this
    //    keeps the @generated boundary intact so re-running prebuild
    //    is idempotent. Each prebuild Expo emits the broken block; we
    //    rewrite it to the working form. No drift.
    const RN_MAPS_GENERATED_BLOCK =
      /^([ \t]*)# @generated begin react-native-maps[\s\S]*?# @generated end react-native-maps\n?/m;
    // Our own @generated block — distinct sentinel so we can refresh
    // in place across prebuilds without colliding with Expo's. The
    // sentinel strings have no regex-special chars so we can match
    // them literally.
    const YERIDE_GENERATED_BLOCK =
      /^([ \t]*)# @generated begin react-native-maps\/Google - yeride-next withNavigationSdk[\s\S]*?# @generated end react-native-maps\/Google\n?/m;

    const buildBlock = (indent) =>
      [
        `${indent}# @generated begin react-native-maps/Google - yeride-next withNavigationSdk (Phase 9 turn 1)`,
        `${indent}pod 'react-native-maps/Google', :path => '../node_modules/react-native-maps'`,
        `${indent}# @generated end react-native-maps/Google\n`,
      ].join('\n');

    if (YERIDE_GENERATED_BLOCK.test(contents)) {
      // Already emitted by a previous prebuild — refresh in place
      // (handles indent / version drift across prebuilds).
      contents = contents.replace(YERIDE_GENERATED_BLOCK, (_match, indent) =>
        buildBlock(indent),
      );
    } else if (RN_MAPS_GENERATED_BLOCK.test(contents)) {
      // Replace Expo's broken @generated block with our subspec form.
      contents = contents.replace(RN_MAPS_GENERATED_BLOCK, (_match, indent) =>
        buildBlock(indent),
      );
    } else {
      // Expo didn't emit (e.g. withMaps is no-op'd because we don't set
      // `ios.config.googleMapsApiKey` — the rewrite plumbs `GMSApiKey`
      // via the local `withGoogleMapsApiKey` plugin). Inject the pod
      // line directly after `use_native_modules!` inside the app target
      // block so autolinking has resolved before our explicit subspec
      // pin lands.
      const useNativeMatch = contents.match(
        /^([ \t]*)config = use_native_modules!\([^\n]*\)\n/m,
      );
      if (useNativeMatch) {
        // buildBlock already ends with a trailing `\n`; add ONE blank
        // line of separation between `use_native_modules!` and our
        // begin marker. Don't add another `\n` at the end — that would
        // produce a double-blank gap before `use_frameworks!`.
        contents = contents.replace(
          useNativeMatch[0],
          `${useNativeMatch[0]}\n${buildBlock(useNativeMatch[1])}`,
        );
      }
    }
    // Belt + suspenders: drop any stray `pod 'react-native-google-maps'`
    // line that leaks outside a @generated block (the legacy podspec
    // name; would still fail to resolve).
    contents = contents.replace(
      /^[ \t]*pod\s+['"]react-native-google-maps['"][^\n]*\n/gm,
      '',
    );

    config.modResults.contents = contents;
    return config;
  });
}

/**
 * Patch `node_modules/react-native-maps/.../MapView.java` to:
 *
 *   1. Call `super.onCreate(null)` + `super.onResume()` synchronously in
 *      the MapView constructor, before `super.getMapAsync(this)`.
 *      Background: react-native-maps 1.24+ dropped the synchronous
 *      `super.onCreate(null)` / `super.onResume()` calls from its
 *      MapView constructor and routes them through a lifecycle observer
 *      (`onCreate(LifecycleOwner)`) instead. When the host Activity is
 *      already in RESUMED state at MapView construction time (the
 *      common case after the Nav SDK loads its bundled Maps SDK), the
 *      observer's `onCreate(LifecycleOwner)` fires AFTER the Nav SDK
 *      has done internal Maps setup that expects the gms MapView's
 *      lifecycle to already be in CREATED state. The `super.onCreate(null)`
 *      that finally runs from the observer NPEs in
 *      `com.google.android.libraries.navigation.internal.nt.ct.b` — the
 *      crash signature both legacy yeride and the rewrite hit on first
 *      render of any map screen. Patching the constructor to call both
 *      synchronously matches the 1.20.x behaviour the Nav SDK was
 *      designed against.
 *
 *   2. Wrap the `super.onPause()` calls in `onPause(LifecycleOwner)`
 *      with try/catch for NullPointerException. Same family of NPE in
 *      `libraries.navigation.internal.agf.df.aE` fires when the
 *      Activity pauses (e.g. image picker / camera Activity starts)
 *      while a MapView is in a partially-initialized state. The
 *      observer's bookkeeping (`map.setMyLocationEnabled(false)`,
 *      `paused` flag) still runs; the swallow just keeps the Activity
 *      pause transaction from cratering on a transient Nav-SDK
 *      delegate state.
 *
 *   3. Wrap the `MapView.this.onResume()` call in `onResume(LifecycleOwner)`
 *      with the same NPE swallow. Sibling generated method
 *      (`libraries.navigation.internal.agf.df.aD`) fires on the resume
 *      path — symptoms identical to (2) but on background→foreground,
 *      permission-dialog dismissal, screen-unlock, etc. Legacy yeride
 *      surfaced only the pause path; the rewrite catches the resume
 *      path on first idle DriverHome → background → foreground (the
 *      BackgroundGeolocation Always-permission system dialog drives
 *      MainActivity through pause/resume within ~60s of boot on real
 *      devices). The observer's bookkeeping (`paused = false`,
 *      `setMyLocationEnabled`, `setLocationSource`) still runs.
 *
 * All three patches are idempotent — they check for the patched-state
 * string presence before applying. `expo prebuild --clean` does NOT
 * clear node_modules, so a re-prebuild won't re-apply if the file is
 * already patched, which is the desired behaviour.
 */
function withNavigationSdkRnMapsPatches(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const mapViewPath = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/android/src/main/java/com/rnmaps/maps/MapView.java',
      );
      if (!fs.existsSync(mapViewPath)) return config;

      let content = fs.readFileSync(mapViewPath, 'utf-8');
      let changed = false;

      // 1. Constructor patch — insert `super.onCreate(null);` +
      //    `super.onResume();` before `super.getMapAsync(this);`.
      //    Guard against re-patching by checking for the patched
      //    three-line block exactly (the unpatched file just has the
      //    `super.getMapAsync(this);` line on its own).
      const ctorMarker = 'super.getMapAsync(this);';
      const ctorPatched =
        'super.onCreate(null);\n        super.onResume();\n        ' +
        ctorMarker;
      if (content.includes(ctorMarker) && !content.includes(ctorPatched)) {
        content = content.replace(ctorMarker, ctorPatched);
        changed = true;
      }

      // 2. `onPause(LifecycleOwner)` NPE swallow — wrap super.onPause()
      //    AND MapView.this.onPause() in try/catch(NullPointerException).
      //    The literal block we anchor on matches what 1.24.0 ships;
      //    bumps may need to refresh the anchor.
      const pauseObserverOriginal =
        '    public void onPause(LifecycleOwner owner) {\n' +
        '        super.onPause();\n' +
        '        if (hasPermissions() && map != null) {\n' +
        '            //noinspection MissingPermission\n' +
        '            map.setMyLocationEnabled(false);\n' +
        '        }\n' +
        '        synchronized (MapView.this) {\n' +
        '            if (!destroyed) {\n' +
        '                MapView.this.onPause();\n' +
        '            }\n' +
        '            paused = true;\n' +
        '        }\n' +
        '    }';
      const pauseObserverPatched =
        '    public void onPause(LifecycleOwner owner) {\n' +
        '        try { super.onPause(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '        if (hasPermissions() && map != null) {\n' +
        '            //noinspection MissingPermission\n' +
        '            map.setMyLocationEnabled(false);\n' +
        '        }\n' +
        '        synchronized (MapView.this) {\n' +
        '            if (!destroyed) {\n' +
        '                try { MapView.this.onPause(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '            }\n' +
        '            paused = true;\n' +
        '        }\n' +
        '    }';
      if (
        content.includes(pauseObserverOriginal) &&
        !content.includes(
          '                try { MapView.this.onPause(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(pauseObserverOriginal, pauseObserverPatched);
        changed = true;
      }

      // 3-pre. `onCreate(LifecycleOwner)` NPE swallow — production
      //    Crashlytics (yeapp-prod, build 247) showed nt.ct.b NPE
      //    thrown synchronously from MapView.<init> when
      //    LifecycleRegistry.addObserver dispatches CREATED to the
      //    freshly-registered observer. super.onCreate routes into the
      //    Nav SDK's rerouted GMS MapView delegate before it has been
      //    initialized for this instance.
      const createObserverOriginal =
        '    public void onCreate(LifecycleOwner owner) {\n' +
        '        super.onCreate(null);\n' +
        '    }';
      const createObserverPatched =
        '    public void onCreate(LifecycleOwner owner) {\n' +
        '        try { super.onCreate(null); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '    }';
      if (
        content.includes(createObserverOriginal) &&
        !content.includes(
          'try { super.onCreate(null); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(
          createObserverOriginal,
          createObserverPatched,
        );
        changed = true;
      }

      // 3a. `onStart(LifecycleOwner)` NPE swallow — defensive. Same
      //    family of NPE can fire on `super.onStart()` during the same
      //    background→foreground transition as onResume. The activity
      //    moves CREATED → STARTED → RESUMED, calling onStart before
      //    onResume. If onStart NPEs, we never reach onResume.
      const startObserverOriginal =
        '    public void onStart(LifecycleOwner owner) {\n' +
        '        super.onStart();\n' +
        '    }';
      const startObserverPatched =
        '    public void onStart(LifecycleOwner owner) {\n' +
        '        try { super.onStart(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '    }';
      if (
        content.includes(startObserverOriginal) &&
        !content.includes(
          'try { super.onStart(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(startObserverOriginal, startObserverPatched);
        changed = true;
      }

      // 3b. `onStop(LifecycleOwner)` NPE swallow — defensive. Sibling
      //    of onStart on the foreground→background transition.
      const stopObserverOriginal =
        '    public void onStop(LifecycleOwner owner) {\n' +
        '        super.onStop();\n' +
        '    }';
      const stopObserverPatched =
        '    public void onStop(LifecycleOwner owner) {\n' +
        '        try { super.onStop(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '    }';
      if (
        content.includes(stopObserverOriginal) &&
        !content.includes(
          'try { super.onStop(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(stopObserverOriginal, stopObserverPatched);
        changed = true;
      }

      // 3c. `onDestroy(LifecycleOwner)` NPE swallow — defensive. The
      //    `doDestroy()` call dispatches to the gms MapView's destroy
      //    path, which the Nav SDK can NPE through.
      const destroyObserverOriginal =
        '    public void onDestroy(LifecycleOwner owner) {\n' +
        '        MapView.this.doDestroy();\n' +
        '    }';
      const destroyObserverPatched =
        '    public void onDestroy(LifecycleOwner owner) {\n' +
        '        try { MapView.this.doDestroy(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '    }';
      if (
        content.includes(destroyObserverOriginal) &&
        !content.includes(
          'try { MapView.this.doDestroy(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(
          destroyObserverOriginal,
          destroyObserverPatched,
        );
        changed = true;
      }

      // 4. `onResume(LifecycleOwner)` NPE swallow — symmetric to (2).
      //    Same family of NPE
      //    (`com.google.android.libraries.navigation.internal.agf.df.aD()`
      //    — sibling generated method to the `aE()` that fires on the
      //    pause path). Triggered by background→foreground transitions,
      //    OS permission dialog dismissals, screen-lock unlocks, anything
      //    that drives the Activity through an `onResume` cycle while the
      //    Nav SDK has rewired `com.google.android.gms.maps.MapView`'s
      //    delegate. Legacy yeride didn't surface this path because its
      //    integration testing focused on the image-picker pause flow;
      //    the rewrite hits it on first idle DriverHome → background →
      //    foreground (within ~60s on real devices, when BackgroundGeolocation
      //    requests Always-permission and the system dialog pauses MainActivity).
      //    Wrap `MapView.this.onResume()` in try/catch(NullPointerException) —
      //    the observer's own bookkeeping (`paused = false`,
      //    `setMyLocationEnabled` / `setLocationSource`) still runs, and
      //    Activity resume completes instead of cratering the whole
      //    transaction.
      //
      //    Note: unlike onPause, the observer does NOT call
      //    `super.onResume()` — only `MapView.this.onResume()` — so this
      //    patch is single-call.
      const resumeObserverOriginal =
        '    public void onResume(LifecycleOwner owner) {\n' +
        '        if (hasPermissions() && map != null) {\n' +
        '            //noinspection MissingPermission\n' +
        '            map.setMyLocationEnabled(showUserLocation);\n' +
        '            map.setLocationSource(fusedLocationSource);\n' +
        '        }\n' +
        '        synchronized (MapView.this) {\n' +
        '            if (!destroyed) {\n' +
        '                MapView.this.onResume();\n' +
        '            }\n' +
        '            paused = false;\n' +
        '        }\n' +
        '    }';
      const resumeObserverPatched =
        '    public void onResume(LifecycleOwner owner) {\n' +
        '        if (hasPermissions() && map != null) {\n' +
        '            //noinspection MissingPermission\n' +
        '            map.setMyLocationEnabled(showUserLocation);\n' +
        '            map.setLocationSource(fusedLocationSource);\n' +
        '        }\n' +
        '        synchronized (MapView.this) {\n' +
        '            if (!destroyed) {\n' +
        '                try { MapView.this.onResume(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }\n' +
        '            }\n' +
        '            paused = false;\n' +
        '        }\n' +
        '    }';
      if (
        content.includes(resumeObserverOriginal) &&
        !content.includes(
          '                try { MapView.this.onResume(); } catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(
          resumeObserverOriginal,
          resumeObserverPatched,
        );
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(mapViewPath, content);
      }
      return config;
    },
  ]);
}

function withNavigationSdkAndroid(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 1. Core library desugaring
    if (!contents.includes('coreLibraryDesugaringEnabled')) {
      if (contents.match(/compileOptions\s*\{/)) {
        contents = contents.replace(
          /compileOptions\s*\{/,
          `compileOptions {\n        coreLibraryDesugaringEnabled true`,
        );
      } else {
        contents = contents.replace(
          /(compileSdk\s+.*)/,
          `$1\n\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }`,
        );
      }
    }

    // 2. Desugaring dependency
    if (!contents.includes('desugar_jdk_libs')) {
      contents = contents.replace(
        /^dependencies\s*\{/m,
        `dependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4'`,
      );
    }

    // 3. Exclude play-services-maps at app level. The Navigation SDK
    //    bundles its own Maps SDK; without this exclusion the app would
    //    ship duplicate Maps classes (Firebase / expo-location pull
    //    `play-services-maps` transitively) and hit dex-merge errors.
    //    App-level (configurations.all + exclude group/module) NOT
    //    global so react-native-maps can still compile against it; the
    //    duplicates are stripped at packaging time.
    //
    //    NOTE — kotlin-stdlib is intentionally NOT pinned here. Legacy
    //    yeride forced it down to 2.0.21 because its older Compose
    //    stack on Expo SDK 53 didn't use Kotlin 2.1+ stdlib classes.
    //    The rewrite is on Expo SDK 55, whose Compose runtime
    //    transitively pulls `com.composables:core` compiled against
    //    Kotlin 2.1.x — that library references
    //    `kotlin.coroutines.jvm.internal.SpillingKt`, which exists in
    //    2.1.x stdlib but NOT in 2.0.21. Forcing the stdlib down
    //    therefore strips a class the Compose modal-bottom-sheet path
    //    needs at runtime, crashing the app on first render with
    //    `NoClassDefFoundError: Lkotlin/coroutines/jvm/internal/SpillingKt`.
    //    Letting Gradle's natural "highest-version-wins" resolution
    //    pick 2.1.x stdlib is safe — Kotlin stdlib has strong binary
    //    compat across minor versions, so expo-modules-core compiled
    //    against 2.0.21 source runs cleanly on 2.1.x stdlib at runtime.
    if (!contents.includes("module: 'play-services-maps'")) {
      contents = contents.replace(
        /^android\s*\{/m,
        [
          '// Navigation SDK bundles its own Maps SDK; exclude play-services-maps',
          '// at app level to prevent duplicate classes in the final APK.',
          'configurations.all {',
          "    exclude group: 'com.google.android.gms', module: 'play-services-maps'",
          '}',
          '',
          'android {',
        ].join('\n'),
      );
    }

    // 4. Disable AAR-metadata check for Navigation SDK AGP version
    //    requirement. Navigation SDK 7.3.0+ declares minAgpVersion
    //    8.10.0; RN 0.83.6 ships AGP 8.8.2. The check is metadata-only
    //    — the SDK works at runtime with AGP 8.8.2. Disabling just the
    //    debug + release variants of the check task avoids the build
    //    failure without affecting runtime.
    //    TODO: Remove when RN ships AGP >= 8.10.
    if (!contents.includes('checkDebugAarMetadata')) {
      contents += `
tasks.matching { it.name == 'checkDebugAarMetadata' || it.name == 'checkReleaseAarMetadata' }.configureEach {
    enabled = false
}
`;
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withNavigationSdk(config) {
  config = withNavigationSdkIos(config);
  config = withNavigationSdkPodfile(config);
  config = withNavigationSdkRnMapsPatches(config);
  config = withNavigationSdkAndroid(config);
  return config;
}

module.exports = withNavigationSdk;
