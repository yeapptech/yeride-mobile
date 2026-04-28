const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require('@expo/config-plugins');

/**
 * Custom Expo config plugin: inject Google Maps API keys into the native
 * projects so `react-native-maps` can authenticate to Google.
 *
 * The plugin reads two keys from `extra` in `app.config.ts`:
 *   - `extra.googleMapsApiKeyAndroid`  → AndroidManifest meta-data
 *   - `extra.googleMapsApiKeyIos`      → Info.plist `GMSApiKey`
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
  } else {
    console.warn(
      '[withGoogleMapsApiKey] GOOGLE_MAPS_APIKEY_IOS is not set; ' +
        'iOS maps will fail at runtime. Set the env var or run with the FakeRoutesService.',
    );
  }

  return next;
}

module.exports = withGoogleMapsApiKey;
