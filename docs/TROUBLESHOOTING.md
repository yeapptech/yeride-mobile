# Troubleshooting

Known build- and runtime-time problems with root causes and fixes.
When a new one is diagnosed, add it here and link it from the
relevant turn doc.

## iOS build: modular-headers + RNFirebase under static frameworks

`@react-native-firebase` 24.x's Obj-C wrappers do
`#import <React/...>` which Clang rejects under
`useFrameworks: 'static'`. Three coupled fixes applied by
`scripts/patch-podfile.js`:

1. `Podfile.properties.json`: `ios.buildReactNativeFromSource: "true"`
   so React-Core builds from source (the prebuilt binary has no
   module map).
2. `Podfile`: `$RNFirebaseAsStaticFramework = true` at top level.
3. `Podfile`: `use_modular_headers!` inside the target.

If a NEW pod errors with non-modular include, add a targeted
`pod 'X', :modular_headers => true` to the patch script.

## Android: `compileSdkVersion 35` AAR-metadata error

AndroidX libs pulled in transitively (browser/core/core-ktx 1.17+)
require `compileSdk >= 36`. Fixed in `app.config.ts`
`expo-build-properties` block:
`compileSdkVersion: 36, targetSdkVersion: 35`. Bumping `compileSdk`
only opens new APIs at compile time; runtime behavior stays at sdk 35.

## Firebase Auth on Android: `auth/internal-error` on signInWithEmailAndPassword

Driver/dev keystore SHA-1 not registered with the Firebase Android
app for `tech.yeapp.yeridenext.dev`. Get SHA-1 via:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

Add it in Firebase Console → Project Settings → your Android app →
Add fingerprint, re-download `google-services.json`, replace in
`firebase/config/<env>/`, re-run `npm run prebuild && npm run android`.

## Logger says WARN for an info message

Don't use `console.*` directly anywhere except
`src/shared/logger/Logger.ts`. Use `LOG.extend('Module').info(...)`.
The transport correctly routes each level — if you see WARN tags on
info messages, something is calling `console.warn` directly somewhere
it shouldn't be.

## Firestore `.get()` hangs but `onSnapshot` works

Firebase BoM 34.10.0 has gRPC stream stability issues. Legacy yeride
pins to BoM 34.0.0 in its `withNavigationSdk.js`. We don't pin yet;
if this surfaces, look at the legacy plugin for the fix. Watch for
it during heavy `getDoc` use.

## iOS RCTFatal on boot: "missing usage descriptions"

`expo-location` hard-fails (`RCTFatal`) the first time
`requestForegroundPermissionsAsync()` is called if the iOS
Info.plist is missing `NSLocationWhenInUseUsageDescription` /
`NSLocationAlwaysAndWhenInUseUsageDescription`. Crashes the entire
app on boot.

The strings ARE configured in `app.config.ts` under the
`expo-location` plugin block — but only a fresh `npm run prebuild`
writes them into `ios/<app>/Info.plist`. If you edited the plugin
block (or the iOS native folder was generated before the plugin was
added) the plist falls out of sync.

Fix: `npm run prebuild` to regenerate the iOS native tree (also
re-runs `pod install` and the `patch-podfile.js` Podfile fixes). A
native rebuild (`npm run ios`) is required either way — a JS reload
won't pick up the plist change.

## iOS: `<RNMapsMapView>` placeholder pink screen

Under Expo SDK 55 + RN 0.83.6 New Arch, the react-native-maps Apple
Maps view manager (`AIRMap`) doesn't get picked up by the
Fabric → Paper interop. Fix: use `provider={PROVIDER_GOOGLE}` on
both platforms (already wired in the shared `<Map/>` component).
The patches in `plugins/withNavigationSdk.js` (Podfile Google
subspec emit, podspec patch, `package.json` `componentProvider`
patch) are required for the Google view manager to register
correctly. `npm run prebuild` + a fresh `pod install` + a clean
Xcode build are required after touching either the plugin or
`react-native-maps`.

## Android: `Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`

Modern npm hoists `react-native-background-fetch` to top-level
`node_modules/`, putting its local `libs/` flatdir out of reach of
`:app:debugRuntimeClasspath`. The custom
`plugins/withBackgroundFetchMaven.js` injects the correct repo
into `android/build.gradle`'s `allprojects.repositories`. Run
`npm run prebuild` after touching this plugin.

## `TurboModuleRegistry.getEnforcing(...): 'NavViewModule' not found`

New Architecture got disabled. `@googlemaps/react-native-navigation-sdk`
0.14.1 ships only a codegen TurboModule spec with no legacy bridge
fallback. Verify `newArchEnabled=true` in
`android/gradle.properties` and that `ios/Podfile.properties.json`
does NOT set `"newArchEnabled": "false"`, then
`cd ios && pod install` and rebuild.
