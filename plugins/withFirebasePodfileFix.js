const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Custom Expo config plugin: apply multiple fixes to the iOS Podfile so
 * `@react-native-firebase` 24.x compiles and runs correctly.
 *
 * Three independent patches, all idempotent and safe to re-run:
 *
 * 1. `$RNFirebaseAsStaticFramework = true` — documented by
 *    @react-native-firebase. Setting this Ruby global at top level (before
 *    any target block) makes the RNFB Podspecs declare themselves as
 *    static frameworks with proper module maps. Required when the project
 *    uses `useFrameworks: 'static'`. Without this, Clang rejects every
 *    `#import <React/RCTBridgeModule.h>` style import in the RNFB .h files
 *    with `-Wnon-modular-include-in-framework-module`.
 *
 * 2. `$FirebaseSDKVersion = '12.12.0'` — pin the underlying Firebase iOS
 *    SDK past the Xcode 26.4 / Swift 6.3 `async let` miscompile bug.
 *    Firebase iOS SDK <= 12.10.0 uses three concurrent `async let`
 *    statements in `FunctionsContext.context(options:)` (the path every
 *    `httpsCallable` invocation flows through), and the Swift 6.3 release
 *    optimizer aborts the process via
 *    `swift_task_dealloc → asyncLet_finish_after_task_completion → abort`.
 *    Under iOS 26.3+ release builds, that crashes the app on every
 *    `completeTrip` / `cancelTrip` / `tipDriver` Cloud Function call.
 *    Firebase iOS SDK 12.12.0 (April 6, 2026) ships the upstream fix.
 *    See:
 *      https://github.com/firebase/firebase-ios-sdk/issues/15974
 *      https://github.com/firebase/firebase-ios-sdk/issues/15994
 *      https://github.com/invertase/react-native-firebase/issues/8949
 *    `@react-native-firebase` 24.0.0 still declares
 *    `sdkVersions.ios.firebase = 12.10.0`, so bumping rnfb alone is not
 *    sufficient. Every RNFB*.podspec honors a `$FirebaseSDKVersion` Ruby
 *    global; setting it at top level pins every `Firebase/*` pod to
 *    12.12.0 at once.
 *    Remove this patch once `@react-native-firebase` ships a release whose
 *    `sdkVersions.ios.firebase` is 12.12.0 or newer.
 *
 * 3. `use_modular_headers!` — generates module maps for every pod (incl.
 *    React-Core) inside the target block as a second-line guarantee. So
 *    even if any other library has the same modular-include issue, it
 *    gets fixed for free.
 */
function withFirebasePodfileFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile',
      );
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // 1. $RNFirebaseAsStaticFramework = true — must be at top level,
      //    BEFORE any target block. Insert just after the Podfile's `require`
      //    block.
      if (!contents.includes('$RNFirebaseAsStaticFramework')) {
        const requireBlockEnd = contents.match(
          /^require\s+['"][^'"]+['"]\s*$/gm,
        );
        if (requireBlockEnd && requireBlockEnd.length > 0) {
          // Insert after the LAST require line.
          const lastRequire = requireBlockEnd[requireBlockEnd.length - 1];
          const idx = contents.lastIndexOf(lastRequire) + lastRequire.length;
          contents =
            contents.slice(0, idx) +
            "\n\n# @react-native-firebase 24+ requires this when useFrameworks: 'static'\n" +
            '$RNFirebaseAsStaticFramework = true\n' +
            contents.slice(idx);
        } else {
          // Fallback: prepend.
          contents =
            "# @react-native-firebase 24+ requires this when useFrameworks: 'static'\n" +
            '$RNFirebaseAsStaticFramework = true\n\n' +
            contents;
        }
      }

      // 2. $FirebaseSDKVersion — must be at top level, BEFORE any target
      //    block. Sentinel-based idempotency check (per legacy yeride's
      //    `withFirebaseSdkVersion.js`) keeps re-runs safe. Insert just
      //    after the $RNFirebaseAsStaticFramework block (or, if that
      //    block was already present, after the last `require` line).
      const FIREBASE_SDK_PIN_SENTINEL = '# yeride:firebase-sdk-version';
      const FIREBASE_SDK_PIN_VERSION = '12.12.0';
      if (!contents.includes(FIREBASE_SDK_PIN_SENTINEL)) {
        const block =
          `\n${FIREBASE_SDK_PIN_SENTINEL} — pin Firebase iOS SDK past the\n` +
          `# Xcode 26.4 / Swift 6.3 async let miscompile (firebase-ios-sdk\n` +
          `# #15974). @react-native-firebase 24.0.0 still declares\n` +
          `# sdkVersions.ios.firebase = 12.10.0, which carries the bug.\n` +
          `# Remove this once @react-native-firebase ships a release whose\n` +
          `# sdkVersions.ios.firebase is ${FIREBASE_SDK_PIN_VERSION} or newer.\n` +
          `$FirebaseSDKVersion = '${FIREBASE_SDK_PIN_VERSION}'\n`;

        if (contents.includes('$RNFirebaseAsStaticFramework')) {
          // Insert immediately after the $RNFirebaseAsStaticFramework
          // assignment line.
          contents = contents.replace(
            /(\$RNFirebaseAsStaticFramework\s*=\s*true\s*\n)/,
            `$1${block}`,
          );
        } else {
          // Fallback: insert after the last `require` line.
          const requireLines = contents.match(
            /^require\s+['"][^'"]+['"]\s*$/gm,
          );
          if (requireLines && requireLines.length > 0) {
            const lastRequire = requireLines[requireLines.length - 1];
            const idx = contents.lastIndexOf(lastRequire) + lastRequire.length;
            contents =
              contents.slice(0, idx) + '\n' + block + contents.slice(idx);
          } else {
            contents = block + '\n' + contents;
          }
        }
      }

      // 3. use_modular_headers! — must be inside the target block. Insert
      //    immediately after `target '...' do`.
      if (!contents.includes('use_modular_headers!')) {
        contents = contents.replace(
          /(target\s+'[^']+'\s+do\s*\n)/,
          '$1  use_modular_headers!\n',
        );
      }

      fs.writeFileSync(podfilePath, contents, 'utf8');
      return cfg;
    },
  ]);
}

module.exports = withFirebasePodfileFix;
