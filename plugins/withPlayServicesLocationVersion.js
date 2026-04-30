const { withProjectBuildGradle } = require('@expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

/**
 * Custom Expo config plugin: prepend an `ext { playServicesLocationVersion =
 * "21.0.1" }` block to the top of `android/build.gradle`.
 *
 * Why this is needed:
 *
 *   - `react-native-background-geolocation`'s `android/build.gradle` reads
 *     `playServicesLocationVersion` from the project's `ext { }` block, with
 *     a default of `"20.0.0"` (DEFAULT_PLAY_SERVICES_LOCATION_VERSION).
 *     With that default the SDK pulls the legacy `tslocationmanager` AAR,
 *     which was compiled against `play-services-location:20.x` where
 *     `FusedLocationProviderClient` was a CLASS.
 *
 *   - Other Android dependencies in the build graph (Firebase, expo-
 *     location, etc.) drag in newer `play-services-location:21.x` where
 *     `FusedLocationProviderClient` was repromoted to an INTERFACE. At
 *     runtime the legacy AAR's binary references resolve against the
 *     newer Play Services library and Android throws
 *     `IncompatibleClassChangeError: Found interface ..., but class was
 *     expected` from `TSLocationManager.stop()`, taking the whole app
 *     down on first GPS lifecycle event.
 *
 *   - Pinning `playServicesLocationVersion = "21.0.1"` flips the SDK's
 *     own selection (lines 76–81 of its `build.gradle`) to the
 *     `tslocationmanager-v21` AAR, which is binary-compatible with
 *     `FusedLocationProviderClient` as an interface. Legacy yeride
 *     applies the exact same pin in `android/build.gradle`'s top-level
 *     `ext { }` block.
 *
 *   - The version is hard-coded here rather than threaded through env so
 *     a local checkout can't drift away from the working pin. Bumping it
 *     should be a deliberate, versioned change.
 *
 * Idempotent via `mergeContents` tag (`'play-services-location-version'`).
 * Anchor: `// Top-level build file` — Expo's prebuild always emits that
 * comment on line 1 of `android/build.gradle`.
 */

const PLAY_SERVICES_LOCATION_VERSION = '21.0.1';

function withPlayServicesLocationVersion(config) {
  return withProjectBuildGradle(config, ({ modResults, ...subConfig }) => {
    if (modResults.language !== 'groovy') {
      return { modResults, ...subConfig };
    }
    modResults.contents = mergeContents({
      tag: 'play-services-location-version',
      src: modResults.contents,
      newSrc: [
        'ext {',
        `\tplayServicesLocationVersion = "${PLAY_SERVICES_LOCATION_VERSION}"`,
        '}',
      ].join('\n'),
      anchor: /^/,
      offset: 0,
      comment: '//',
    }).contents;
    return { modResults, ...subConfig };
  });
}

module.exports = withPlayServicesLocationVersion;
