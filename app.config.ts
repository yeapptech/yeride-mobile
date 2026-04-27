import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App config for the YeRide rewrite ("yeride-next" parallel bundle).
 *
 * - Bundle identifiers are intentionally distinct from the production `yeride` app
 *   so testers can install both side-by-side until Phase 10 cutover.
 * - Environment is selected via APP_ENV ("development" | "stage" | "production").
 *   Defaults to "development".
 * - Firebase config files (GoogleService-Info.plist / google-services.json)
 *   are env-specific. Path order: env var (CI / EAS) → checked-in repo path
 *   → unset (skip Firebase config — fall back to in-memory fakes for local
 *   dev). See docs/FIREBASE_SETUP.md.
 */

type AppEnv = 'development' | 'stage' | 'production';

function getAppEnv(): AppEnv {
  const value = process.env.APP_ENV ?? 'development';
  if (value === 'stage' || value === 'production' || value === 'development') {
    return value;
  }
  throw new Error(
    `Invalid APP_ENV "${value}". Expected one of: development, stage, production.`,
  );
}

const APP_ENV = getAppEnv();

const NAME_BY_ENV: Record<AppEnv, string> = {
  development: 'YeRide Next (Dev)',
  stage: 'YeRide Next (Stage)',
  production: 'YeRide Next',
};

const BUNDLE_BY_ENV: Record<AppEnv, string> = {
  development: 'tech.yeapp.yeridenext.dev',
  stage: 'tech.yeapp.yeridenext.stage',
  production: 'tech.yeapp.yeridenext',
};

const SCHEME_BY_ENV: Record<AppEnv, string> = {
  development: 'yeridenext-dev',
  stage: 'yeridenext-stage',
  production: 'yeridenext',
};

/**
 * Resolve a Firebase config file by precedence:
 *   1. explicit env var (set by EAS Secrets in CI builds)
 *   2. checked-in repo path: `firebase/config/<env>/<filename>`
 *   3. undefined → omit the field, app boots without Firebase
 *
 * Until the user drops in config files (per docs/FIREBASE_SETUP.md), case
 * (3) is the active path.
 */
function resolveFirebaseConfig(
  envVar: string,
  fileName: string,
): string | undefined {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  const repoPath = path.resolve(
    __dirname,
    `firebase/config/${APP_ENV}/${fileName}`,
  );
  return fs.existsSync(repoPath) ? repoPath : undefined;
}

const iosFirebaseConfig = resolveFirebaseConfig(
  'GOOGLE_SERVICES_INFOPLIST',
  'GoogleService-Info.plist',
);
const androidFirebaseConfig = resolveFirebaseConfig(
  'GOOGLE_SERVICES_JSON',
  'google-services.json',
);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME_BY_ENV[APP_ENV],
  slug: 'yeride-next',
  scheme: SCHEME_BY_ENV[APP_ENV],
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // New Architecture is the default in Expo SDK 55+; no flag needed.
  ios: {
    bundleIdentifier: BUNDLE_BY_ENV[APP_ENV],
    supportsTablet: false,
    ...(iosFirebaseConfig ? { googleServicesFile: iosFirebaseConfig } : {}),
  },
  android: {
    package: BUNDLE_BY_ENV[APP_ENV],
    ...(androidFirebaseConfig
      ? { googleServicesFile: androidFirebaseConfig }
      : {}),
  },
  web: {
    bundler: 'metro',
  },
  plugins: [
    'expo-dev-client',
    // Firebase plugins are gated on config-file presence. If we list them
    // when GoogleService-Info.plist / google-services.json are missing, the
    // plugins fail prebuild. Once you complete docs/FIREBASE_SETUP.md and
    // drop the files in, both plugins activate automatically on the next
    // `npm run prebuild`.
    // Firebase plugins. The custom `withFirebasePodfileFix` injects
    // `use_modular_headers!` into the Podfile so the @react-native-firebase
    // Obj-C wrappers can `#import <React/...>` headers under
    // `useFrameworks: 'static'`. Without it, Clang's
    // -Wnon-modular-include-in-framework-module diagnostic blocks the
    // build. Order matters: the fix plugin must run AFTER expo-build-properties
    // sets useFrameworks but the Podfile mutation happens at the dangerous-mod
    // stage which runs after all native config plugins.
    ...(iosFirebaseConfig && androidFirebaseConfig
      ? ['@react-native-firebase/app', './plugins/withFirebasePodfileFix.js']
      : []),
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 24,
          // compileSdkVersion bumped from 35 → 36 because the AndroidX
          // browser/core/core-ktx libs pulled in transitively (via Firebase
          // 24.x and expo-modules-core) declare an AAR-metadata requirement
          // of compileSdk >= 36. targetSdkVersion stays at 35 because that
          // controls runtime behavior — bumping compileSdk only opens up
          // newer APIs at compile time and is the recommended fix per
          // AndroidX's own AAR metadata error.
          compileSdkVersion: 36,
          targetSdkVersion: 35,
          // Firebase BoM pin (carry-forward from legacy yeride CLAUDE.md
          // troubleshooting — gRPC stream stability under BoM 34.10.0).
          extraMavenRepos: [],
        },
        ios: {
          deploymentTarget: '15.1',
          // Required so Firebase Swift pods (FirebaseAuth, FirebaseFirestore,
          // FirebaseFunctions, ...) can resolve their non-modular Obj-C
          // dependencies (GoogleUtilities, FirebaseAppCheckInterop, etc.).
          // Without this, `pod install` fails with "depends upon ... which
          // do not define modules". `static` makes Firebase's modular-
          // headers Podfile additions take effect via the
          // @react-native-firebase Expo plugin.
          useFrameworks: 'static',
        },
      },
    ],
  ],
  extra: {
    appEnv: APP_ENV,
    firebaseConfigured: Boolean(iosFirebaseConfig && androidFirebaseConfig),
  },
  experiments: {
    typedRoutes: false,
  },
});
