const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Custom Expo config plugin: inject Google Maps API keys into the native
 * projects so `react-native-maps` can authenticate to Google.
 *
 * The plugin reads two keys from `extra` in `app.config.ts`:
 *   - `extra.googleMapsApiKeyAndroid`  → AndroidManifest meta-data
 *   - `extra.googleMapsApiKeyIos`      → Info.plist `GMSApiKey`
 *                                      → AppDelegate.swift `GMSServices.provideAPIKey(...)`
 *
 * Both can be `null` (development fallback when the env vars aren't set);
 * the plugin then skips that platform and prints a warning. The runtime
 * already falls back to `FakeRoutesService` in that case (see container.ts).
 *
 * Why a custom plugin instead of `app.config.ts -> { android: { config: { googleMaps: { apiKey } } } }`:
 *   - That Expo-managed knob predates the SDK 55 + RN 0.83 stack and
 *     applies to `expo-location` rather than `react-native-maps` proper.
 *   - The native keys we inject here have to live at the
 *     `<meta-data android:name="com.google.android.geo.API_KEY" .../>`
 *     element on the iOS side `GMSApiKey` Info.plist key, which is what
 *     `react-native-maps` reads.
 *   - Doing it in a plugin keeps app.config.ts free of platform-specific
 *     mutations and makes the behaviour explicit — read the plugin to know
 *     what gets written.
 *
 * **iOS — why both Info.plist AND AppDelegate (Phase 9 turn 1 follow-up):**
 *
 * Google Maps iOS SDK 10.x retired the implicit Info.plist `GMSApiKey`
 * lookup; you MUST call `GMSServices.provideAPIKey(...)` programmatically
 * before any `GMSMapView` is constructed, otherwise
 * `+[GMSServices checkServicePreconditions]` throws a fatal NSException
 * the first time `<MapView provider="google"/>` mounts. Symptom under
 * Expo SDK 55 + RN 0.83.6 New Arch: `RNMapsGoogleMapView.updateProps` →
 * `AIRGoogleMapManager.view` → `[GMSMapView initWithOptions:]` →
 * `+[GMSServices checkServicePreconditions]` → SIGABRT.
 *
 * The Info.plist write is kept (Google Maps SDK still respects it for
 * its own diagnostics + the legacy yeride config bag), and the
 * AppDelegate mod reads from Info.plist at runtime so the key lives in
 * one place. The mod is idempotent — re-prebuilds detect the existing
 * call and skip.
 *
 * Idempotent: re-running prebuild updates the existing meta-data element
 * in place rather than appending duplicates.
 *
 * Pinned reasons for `react-native-maps` vs `react-native-google-maps` (or
 * Mapbox): the legacy yeride app depends on `react-native-maps` 1.24.0 and
 * the rewrite carries forward that pin per the Phase 3 scope decision
 * (§docs/PHASE_3_TURN_1.md). The pin reasons are documented in legacy
 * CLAUDE.md (AIRMap NSRangeException workaround on iOS New Arch + Android
 * pause-NPE patch in withNavigationSdk.js).
 */

/**
 * Inject `import GoogleMaps` and a `GMSServices.provideAPIKey(...)` call
 * into AppDelegate.swift. Reads the key at runtime from Info.plist's
 * `GMSApiKey` (which `withGoogleMapsApiKey` writes via `withInfoPlist`),
 * so the key lives in a single source.
 *
 * Anchors:
 *   - Import: appended after the last existing `import` line at top of
 *     file (above `@main`).
 *   - Call: inserted as the first statement inside
 *     `application(_:didFinishLaunchingWithOptions:)`, BEFORE
 *     `factory.startReactNative` and any other map-touching code.
 *
 * Idempotent: if `GMSServices.provideAPIKey` already appears in the
 * file, the mod is a no-op.
 */
function withAppDelegateGoogleMapsBootstrap(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;
      // AppDelegate lives at <platformRoot>/<projectName>/AppDelegate.swift.
      // Find the singular xcodeproj sibling; mirrors how Expo prebuild
      // names the iOS app folder.
      const iosDir = platformRoot;
      const candidates = fs
        .readdirSync(iosDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            entry.name !== 'Pods' &&
            entry.name !== 'build' &&
            entry.name !== 'PrivacyInfo' &&
            !entry.name.endsWith('.xcodeproj') &&
            !entry.name.endsWith('.xcworkspace'),
        )
        .map((entry) => path.join(iosDir, entry.name));

      let appDelegatePath = null;
      for (const dir of candidates) {
        const p = path.join(dir, 'AppDelegate.swift');
        if (fs.existsSync(p)) {
          appDelegatePath = p;
          break;
        }
      }

      if (!appDelegatePath) {
        console.warn(
          '[withGoogleMapsApiKey] AppDelegate.swift not found under ' +
            `${iosDir}; skipping GMSServices.provideAPIKey injection. ` +
            'iOS Google Maps will crash at runtime.',
        );
        return config;
      }

      let contents = fs.readFileSync(appDelegatePath, 'utf-8');

      // Idempotency guard.
      if (contents.includes('GMSServices.provideAPIKey')) {
        return config;
      }

      // 1. Insert `import GoogleMaps` after the last existing import.
      if (!/^\s*import\s+GoogleMaps\b/m.test(contents)) {
        const importMatches = [...contents.matchAll(/^.*import .+$/gm)];
        if (importMatches.length > 0) {
          const lastImport = importMatches[importMatches.length - 1];
          const lastImportEnd = lastImport.index + lastImport[0].length;
          contents =
            contents.slice(0, lastImportEnd) +
            '\nimport GoogleMaps' +
            contents.slice(lastImportEnd);
        }
      }

      // 2. Insert the provideAPIKey call as the first statement inside
      //    `didFinishLaunchingWithOptions`. Anchor on the opening brace
      //    of the method body — this is robust to surrounding ExpoAppDelegate
      //    boilerplate changes.
      //
      //    The call reads from Info.plist so the key still lives in a
      //    single source (the env-var-backed `GMSApiKey` that
      //    `withInfoPlist` writes earlier in this plugin).
      const didFinishLaunching =
        /(public\s+override\s+func\s+application\s*\(\s*_\s+application:\s+UIApplication,\s*didFinishLaunchingWithOptions[^{]+\{\s*\n)/m;
      if (didFinishLaunching.test(contents)) {
        contents = contents.replace(didFinishLaunching, (match) => {
          return (
            match +
            [
              '    // Phase 9 turn 1: Google Maps SDK 10.x requires programmatic',
              '    // provideAPIKey before any GMSMapView is created. Reads from',
              '    // Info.plist `GMSApiKey` (written by withGoogleMapsApiKey).',
              '    if let mapsKey = Bundle.main.object(forInfoDictionaryKey: "GMSApiKey") as? String,',
              '       !mapsKey.isEmpty {',
              '      GMSServices.provideAPIKey(mapsKey)',
              '    }',
              '',
            ].join('\n')
          );
        });
      } else {
        console.warn(
          '[withGoogleMapsApiKey] Could not find ' +
            '`application(_:didFinishLaunchingWithOptions:)` anchor in ' +
            `${appDelegatePath}; the GoogleMaps API key won't be ` +
            'provided programmatically and iOS maps will crash at ' +
            'runtime. Inspect the AppDelegate signature and update the ' +
            'plugin regex.',
        );
      }

      fs.writeFileSync(appDelegatePath, contents);
      void projectRoot;
      return config;
    },
  ]);
}

function withGoogleMapsApiKey(config) {
  const androidKey = config.extra?.googleMapsApiKeyAndroid ?? null;
  const iosKey = config.extra?.googleMapsApiKeyIos ?? null;

  let next = config;

  if (androidKey) {
    next = withAndroidManifest(next, async (cfg) => {
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
        cfg.modResults,
      );
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        application,
        'com.google.android.geo.API_KEY',
        androidKey,
      );
      return cfg;
    });
  } else {
    console.warn(
      '[withGoogleMapsApiKey] GOOGLE_MAPS_APIKEY_ANDROID is not set; ' +
        'Android maps will fail at runtime. Set the env var or run with the FakeRoutesService.',
    );
  }

  if (iosKey) {
    next = withInfoPlist(next, (cfg) => {
      cfg.modResults.GMSApiKey = iosKey;
      return cfg;
    });
    next = withAppDelegateGoogleMapsBootstrap(next);
  } else {
    console.warn(
      '[withGoogleMapsApiKey] GOOGLE_MAPS_APIKEY_IOS is not set; ' +
        'iOS maps will fail at runtime. Set the env var or run with the FakeRoutesService.',
    );
  }

  return next;
}

module.exports = withGoogleMapsApiKey;
