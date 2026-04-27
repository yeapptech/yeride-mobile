#!/usr/bin/env node
/**
 * Post-prebuild patch for ios/ — three coupled fixes for
 * `@react-native-firebase` 24.x under Expo SDK 55's `useFrameworks: 'static'`.
 *
 * Why all three are needed:
 *   - `useFrameworks: 'static'` makes every pod (including RNFB) build as a
 *     static framework with a module map. RNFB's Obj-C wrappers do
 *     `#import <React/RCTBridgeModule.h>`. Clang only allows that import from
 *     inside a framework module if React-Core ALSO has a module map.
 *   - `use_modular_headers!` is supposed to give React-Core a module map.
 *   - BUT: Expo SDK 55 / RN 0.83 ships React-Core as a PREBUILT binary
 *     (env: `RCT_USE_PREBUILT_RNCORE=1`). The prebuilt binary has no module
 *     map and `use_modular_headers!` can't promote it. So we have to opt
 *     out of the prebuilt and let React-Core build from source.
 *
 * The three patches:
 *
 *   1. `Podfile.properties.json`: set `ios.buildReactNativeFromSource: "true"`
 *      so Podfile.rb's prebuilt-RNCore env vars stay unset → React-Core
 *      builds from source → modular headers actually generate.
 *   2. `Podfile`: `$RNFirebaseAsStaticFramework = true` at top level — tells
 *      RNFB Podspecs to declare themselves as static frameworks with proper
 *      module maps.
 *   3. `Podfile`: `use_modular_headers!` inside the target — generates module
 *      maps for every pod, so `<React/...>` imports resolve.
 *
 * Without all three, Clang rejects the RNFB Obj-C wrappers with
 * `-Wnon-modular-include-in-framework-module`.
 *
 * Idempotent. Re-running prebuild + this script does not double-insert.
 *
 * We run this from package.json's `prebuild` script after `expo prebuild`
 * because local Expo config plugins didn't reliably load in our setup.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const podfilePath = path.join(projectRoot, 'ios', 'Podfile');
const propsPath = path.join(projectRoot, 'ios', 'Podfile.properties.json');

if (!fs.existsSync(podfilePath)) {
  console.log(
    '[patch-podfile] No ios/Podfile found, skipping (not iOS prebuild?)',
  );
  process.exit(0);
}

// 0. Patch Podfile.properties.json to disable the prebuilt React-Core.
//    Without this, `use_modular_headers!` can't make React-Core modular
//    because the binary ships without a module map.
let propsMutated = false;
if (fs.existsSync(propsPath)) {
  const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
  if (props['ios.buildReactNativeFromSource'] !== 'true') {
    props['ios.buildReactNativeFromSource'] = 'true';
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n', 'utf8');
    propsMutated = true;
    console.log(
      '[patch-podfile] Set ios.buildReactNativeFromSource=true in Podfile.properties.json',
    );
  } else {
    console.log('[patch-podfile] ios.buildReactNativeFromSource already true');
  }
} else {
  console.warn(
    '[patch-podfile] No ios/Podfile.properties.json found — modular-header fix may not stick',
  );
}

let contents = fs.readFileSync(podfilePath, 'utf8');
let mutated = false;

// 1. $RNFirebaseAsStaticFramework = true — must be at top level, before
//    any target block. Insert immediately after the `platform :ios,...` line
//    which is the last thing before the target block.
if (!contents.includes('$RNFirebaseAsStaticFramework')) {
  const platformLineMatch = contents.match(/^platform\s+:ios.*$/m);
  if (platformLineMatch) {
    const insertAfter = platformLineMatch[0];
    const idx = contents.indexOf(insertAfter) + insertAfter.length;
    contents =
      contents.slice(0, idx) +
      "\n\n# @react-native-firebase 24+ requires this when useFrameworks: 'static'\n" +
      '$RNFirebaseAsStaticFramework = true\n' +
      contents.slice(idx);
    mutated = true;
    console.log('[patch-podfile] Injected $RNFirebaseAsStaticFramework');
  } else {
    console.warn(
      '[patch-podfile] Could not find `platform :ios,...` line; prepending instead',
    );
    contents =
      "# @react-native-firebase 24+ requires this when useFrameworks: 'static'\n" +
      '$RNFirebaseAsStaticFramework = true\n\n' +
      contents;
    mutated = true;
  }
} else {
  console.log('[patch-podfile] $RNFirebaseAsStaticFramework already present');
}

// 2. use_modular_headers! — must be inside the target block. Insert
//    immediately after `target '...' do`.
if (!contents.includes('use_modular_headers!')) {
  const targetMatch = contents.match(/(target\s+'[^']+'\s+do\s*\n)/);
  if (targetMatch) {
    contents = contents.replace(
      targetMatch[0],
      `${targetMatch[0]}  use_modular_headers!\n`,
    );
    mutated = true;
    console.log('[patch-podfile] Injected use_modular_headers!');
  } else {
    console.warn(
      '[patch-podfile] Could not find target block; skipping use_modular_headers!',
    );
  }
} else {
  console.log('[patch-podfile] use_modular_headers! already present');
}

if (mutated || propsMutated) {
  if (mutated) {
    fs.writeFileSync(podfilePath, contents, 'utf8');
  }
  console.log('[patch-podfile] Patches applied. Re-running pod install…');
  // pod install needs to re-run after we modified the Podfile / props. We use
  // execFileSync (not exec) — no shell, no injection surface; the args
  // are static literals.
  execFileSync('pod', ['install'], {
    cwd: path.join(projectRoot, 'ios'),
    stdio: 'inherit',
  });
} else {
  console.log('[patch-podfile] No changes needed');
}
