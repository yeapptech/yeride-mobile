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
 *   1. Patch `react-native-google-maps.podspec` (lives inside
 *      react-native-maps) to align `GoogleMaps` to `10.7.0` +
 *      `Google-Maps-iOS-Utils` to `7.0.0`. The Navigation SDK pulls
 *      `GoogleNavigation` which depends on `GoogleMaps == 10.7.0`;
 *      without this patch CocoaPods refuses to resolve the conflicting
 *      version pins.
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
 *   4. Strip the `# @generated begin react-native-maps` block that
 *      Expo's built-in `withMaps` injects when `ios.config.googleMapsApiKey`
 *      is set (or when the Maps key landed via our local
 *      `withGoogleMapsApiKey` plugin). It emits
 *      `pod 'react-native-google-maps', :path => …`, but
 *      react-native-maps@1.23+ no longer ships that podspec — pod install
 *      fails with "No podspec found for react-native-google-maps". We
 *      keep the Maps API key in Info.plist for the Navigation SDK to
 *      consume; stripping the bogus pod line is the cleanest fix.
 *      Belt-and-suspenders: also drop any orphan
 *      `pod 'react-native-google-maps' …` line outside an @generated
 *      block.
 */

function withNavigationSdkIos(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      // 1. Patch react-native-google-maps podspec to align GoogleMaps version
      //    with Navigation SDK (which requires GoogleMaps 10.7.0 via GoogleNavigation).
      const podspecPath = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/react-native-google-maps.podspec',
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
      const rnMapsIosDir = path.resolve(
        config.modRequest.projectRoot,
        'node_modules/react-native-maps/ios',
      );
      const eventPatchFiles = [
        'AirGoogleMaps/AIRGoogleMapManager.m',
        'AirGoogleMaps/AIRGoogleMap.h',
        'AirGoogleMaps/AIRGoogleMap.m',
        'AirMaps/AIRMapManager.m',
        'AirMaps/AIRMap.h',
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

    // 2. Strip the `# @generated begin react-native-maps` block emitted
    //    by Expo's built-in withMaps. react-native-maps@1.23+ doesn't
    //    ship the `react-native-google-maps` podspec; the bogus pod
    //    line breaks pod install. We keep Maps API key support intact
    //    via our local `withGoogleMapsApiKey` plugin.
    contents = contents.replace(
      /^[ \t]*# @generated begin react-native-maps[\s\S]*?# @generated end react-native-maps\n?/m,
      '',
    );
    // Belt + suspenders: drop any stray `pod 'react-native-google-maps'`
    // line that leaks outside a @generated block.
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
 * Both patches are idempotent — they check for the patched-state string
 * presence before applying. `expo prebuild --clean` does NOT clear
 * node_modules, so a re-prebuild won't re-apply if the file is already
 * patched, which is the desired behaviour.
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
          'catch (NullPointerException e) { /* Nav SDK + RN Maps coexistence NPE */ }',
        )
      ) {
        content = content.replace(pauseObserverOriginal, pauseObserverPatched);
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
