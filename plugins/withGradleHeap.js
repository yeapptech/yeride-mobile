const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Custom Expo config plugin: bump `org.gradle.jvmargs` so the Gradle
 * daemon doesn't OOM during `app:assembleDebug`.
 *
 * Why this is needed:
 *
 *   - Default Expo prebuild emits `org.gradle.jvmargs=-Xmx2048m
 *     -XX:MaxMetaspaceSize=512m` into `android/gradle.properties`.
 *
 *   - On Expo SDK 55 / RN 0.83.6 the build pulls in: Navigation SDK
 *     7.3.0 (~150MB of resources including 100+ locale-specific
 *     strings.xml files), react-native-maps + Google Maps SDK, Stripe
 *     React Native (with paymentsheet, financial-connections, etc.),
 *     Firebase BoM 34.10.0 (Auth + Firestore + Functions + Crashlytics +
 *     Storage), and the v5 react-native-background-geolocation
 *     (`tslocationmanager-4.1.5`). Resource merging at
 *     `app:mergeDebugResources` exhausts the 2GB daemon heap and the
 *     daemon dies with `Could not receive a message from the daemon`.
 *
 *   - Legacy yeride pins `-Xmx4096m` directly in
 *     `android/gradle.properties` (committed) and doesn't hit the
 *     crash. Mirror that here for parity.
 *
 *   - Why not `expo-build-properties`: that plugin's schema doesn't
 *     expose `gradleProperties` — only `compileSdkVersion`,
 *     `targetSdkVersion`, `kotlinVersion`, etc. Gradle JVM args have
 *     to be written via `withGradleProperties` directly.
 *
 * Idempotent — looks for the canonical `org.gradle.jvmargs` key and
 * replaces its value if found, otherwise appends.
 *
 * 2026-05-07 — added during the v5 background-geolocation upgrade
 * because the v4-era 2GB heap stopped fitting once v5 + the SDK 55
 * module surface combined to push the resource-merge phase past the
 * limit.
 */

const TARGET_JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=512m';

function withGradleHeap(config) {
  return withGradleProperties(config, (mod) => {
    const props = mod.modResults;
    const idx = props.findIndex(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );
    if (idx >= 0) {
      props[idx] = {
        ...props[idx],
        value: TARGET_JVM_ARGS,
      };
    } else {
      props.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: TARGET_JVM_ARGS,
      });
    }
    return mod;
  });
}

module.exports = withGradleHeap;
