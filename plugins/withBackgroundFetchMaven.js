const { withProjectBuildGradle } = require('@expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

/**
 * Custom Expo config plugin: register `react-native-background-fetch`'s
 * local flat-dir Maven repo into the project-level `android/build.gradle`
 * `allprojects.repositories` block so Gradle can resolve
 * `com.transistorsoft:tsbackgroundfetch:1.0.4` at `:app:debugRuntimeClasspath`
 * resolution time.
 *
 * Why this is needed:
 *
 *   - `react-native-background-geolocation`'s own Expo plugin injects a
 *     Maven URL pointing at `${project(':react-native-background-geolocation').projectDir}/libs`
 *     so `tslocationmanager:3.7.0` resolves. It does NOT inject one for
 *     the sibling `react-native-background-fetch` package's `libs/` flat-
 *     dir, where `tsbackgroundfetch:1.0.4` lives.
 *
 *   - In legacy yeride, this was a non-issue because npm nested
 *     `react-native-background-fetch` under
 *     `node_modules/react-native-background-geolocation/node_modules/...`.
 *     Modern npm in the rewrite hoists `react-native-background-fetch` to
 *     the top-level `node_modules/`, and the fetch subproject's own
 *     `repositories { maven { url './libs' } }` block isn't visible to the
 *     transitive resolution at `:app` level (Gradle's project-level repo
 *     scope dominates).
 *
 *   - Without this plugin, `app:processDebugResources` fails with
 *     `Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`.
 *
 * The injected URL uses `project(':react-native-background-fetch').projectDir`
 * so it stays valid regardless of where the package lives in `node_modules/`.
 *
 * Order matters: this plugin must run AFTER the SDK's own plugin (which
 * inserts the first `maven { url ... }` block); we anchor on `maven {`
 * with offset 1, same shape as the SDK's `applyMavenUrl`.
 *
 * Idempotent — `mergeContents` tags the inserted block and skips if
 * already present.
 */
function withBackgroundFetchMaven(config) {
  return withProjectBuildGradle(config, ({ modResults, ...subConfig }) => {
    if (modResults.language !== 'groovy') {
      return { modResults, ...subConfig };
    }
    modResults.contents = mergeContents({
      tag: 'react-native-background-fetch-maven',
      src: modResults.contents,
      newSrc:
        '\tmaven { url "${project(":react-native-background-fetch").projectDir}/libs" }',
      anchor: /maven\s\{/,
      offset: 1,
      comment: '//',
    }).contents;
    return { modResults, ...subConfig };
  });
}

module.exports = withBackgroundFetchMaven;
