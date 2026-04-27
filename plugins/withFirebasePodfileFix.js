const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Custom Expo config plugin: patch the iOS Podfile so `@react-native-firebase`
 * 24.x's Obj-C wrappers compile under `useFrameworks: 'static'`.
 *
 * The fix is documented by @react-native-firebase: set the global Ruby
 * variable `$RNFirebaseAsStaticFramework = true` BEFORE the target block,
 * which makes the RNFB Podspecs declare themselves as static frameworks
 * with proper module maps. Without this, Clang rejects every
 * `#import <React/RCTBridgeModule.h>` style import in the RNFB .h files
 * with `-Wnon-modular-include-in-framework-module`.
 *
 * We also add `use_modular_headers!` globally inside the target as a
 * second-line guarantee — this generates module maps for every pod (incl.
 * React-Core), so even if any other library has a similar issue, it gets
 * fixed for free.
 *
 * Idempotent. Safe to re-run.
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

      // 2. use_modular_headers! — must be inside the target block. Insert
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
