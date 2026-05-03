const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Custom Expo config plugin: append a Release-only Xcode build phase that
 * uploads dSYMs to Firebase Crashlytics so production crash reports come
 * back symbolicated.
 *
 * The phase runs the `${PODS_ROOT}/FirebaseCrashlytics/run` script, which
 * is installed automatically when the `Crashlytics` Pod is in the Podfile
 * (the `@react-native-firebase/crashlytics` Expo plugin handles that).
 * The script is gated on `CONFIGURATION == "Release"` so debug + dev-client
 * builds skip the upload entirely (avoids spurious "Crashlytics: missing
 * dSYM" warnings during local development).
 *
 * Input paths declare the dSYM location and the Info.plist so Xcode's build
 * system can incremental-build correctly across runs.
 *
 * Ported from legacy yeride/plugins/withCrashlyticsUploadSymbols.js. The
 * only delta is the import path (`@expo/config-plugins` vs legacy's
 * `expo/config-plugins`) — the rewrite's other plugins all use the
 * scoped form.
 *
 * Idempotent: checks for an existing build phase named
 * `[firebase_crashlytics] Upload dSYMs` (or any name that mentions
 * `firebase_crashlytics`) before adding, so re-running `expo prebuild`
 * doesn't append duplicate phases.
 */

const BUILD_PHASE_NAME = '[firebase_crashlytics] Upload dSYMs';

const SHELL_SCRIPT = [
  'if [ "$CONFIGURATION" != "Release" ]; then',
  '  echo "Skipping Crashlytics dSYM upload for $CONFIGURATION config"',
  '  exit 0',
  'fi',
  '"${PODS_ROOT}/FirebaseCrashlytics/run"',
].join('\\n');

const INPUT_PATHS = [
  '"${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${TARGET_NAME}"',
  '"$(SRCROOT)/$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)"',
];

const withCrashlyticsUploadSymbols = (config) => {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;

    const existingPhases =
      xcodeProject.hash.project.objects.PBXShellScriptBuildPhase || {};
    const alreadyAdded = Object.values(existingPhases).some(
      (phase) =>
        phase &&
        typeof phase === 'object' &&
        typeof phase.name === 'string' &&
        phase.name.includes('firebase_crashlytics'),
    );
    if (alreadyAdded) return config;

    xcodeProject.addBuildPhase(
      [],
      'PBXShellScriptBuildPhase',
      BUILD_PHASE_NAME,
      null,
      {
        shellPath: '/bin/sh',
        shellScript: SHELL_SCRIPT,
        inputPaths: INPUT_PATHS,
      },
    );

    return config;
  });
};

module.exports = withCrashlyticsUploadSymbols;
