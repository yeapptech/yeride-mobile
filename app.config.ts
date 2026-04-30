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
    [
      'expo-location',
      {
        // Phase 3 turn 3: foreground-only reads from `useCurrentLocation`
        // for centring the rider's home map and resolving the active
        // service area. Phase 4 layers in `react-native-background-
        // geolocation` for the trip-tracking lifecycle (driver side
        // primarily); the strings below cover both surfaces.
        locationAlwaysAndWhenInUsePermission:
          'Allow YeRide Next to use your location so we can show nearby drivers and track trips.',
        locationWhenInUsePermission:
          'Allow YeRide Next to use your location so we can show nearby drivers and plan your ride.',
      },
    ],
    [
      'expo-image-picker',
      {
        // Phase 5 turn 4: drivers attach 5 vehicle photos
        // (front/back/left/right/interior) via the platform image picker.
        // Library is the primary path; camera is reachable via the
        // picker's media-source toggle. iOS hard-fails (RCTFatal) on the
        // first picker call if these strings are missing — see legacy
        // CLAUDE.md image-picker permission troubleshooting note.
        photosPermission:
          'Allow YeRide Next to access your photos so you can attach photos of your vehicle for rider identification.',
        cameraPermission:
          'Allow YeRide Next to use your camera so you can take photos of your vehicle.',
      },
    ],
    [
      // Phase 6 turn 3: in-app card collection via Stripe's React Native
      // SDK. The Expo plugin (a) writes the Apple Pay merchant identifier
      // into the iOS entitlements plist and (b) toggles the Google Pay
      // meta-data flag in AndroidManifest.xml. Apple Pay / Google Pay are
      // NOT enabled this phase — `enableGooglePay` and `includeOnramp`
      // default to false; the merchantIdentifier is a placeholder so the
      // plugin schema is satisfied. Phase 9 polish can flip these on.
      //
      // Card data never touches our app or our server: Stripe tokenizes
      // inside the native SDK. The publishable key is consumed by
      // `<StripeProvider/>` (mounted in App.tsx) — see the `extra` block
      // below.
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: 'merchant.tech.yeapp.yeridenext.dev',
      },
    ],
    // Google Maps API keys → AndroidManifest meta-data + iOS GMSApiKey.
    // No-ops when the env vars aren't set (dev convenience: the runtime
    // falls back to FakeRoutesService in that case).
    './plugins/withGoogleMapsApiKey.js',
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
    // Google Maps API keys — kept under the legacy yeride env-var names so
    // EAS Secrets configuration can be reused 1:1 (REFACTOR_PLAN.md §7
    // Decision 6: same Google project, same keys). NOT prefixed with
    // EXPO_PUBLIC_ because they're consumed via expo-constants's `extra`
    // bag at runtime, not via process.env in the JS bundle. Build-time
    // resolution + runtime read keeps them out of the bundled string blob.
    googleMapsApiKeyAndroid: process.env.GOOGLE_MAPS_APIKEY_ANDROID ?? null,
    googleMapsApiKeyIos: process.env.GOOGLE_MAPS_APIKEY_IOS ?? null,
    // Stripe microservice connection (Phase 6 turn 2). Same out-of-bundle
    // pattern as the Maps keys. The API key is an APP-LEVEL bearer token
    // the stripe-server uses to authenticate this app — not Stripe's
    // secret key, which lives only on the server. Treat as semi-sensitive
    // (rotate on any leak); without both env vars set the DI container
    // falls back to `FakeStripeServerService`.
    stripeServerUrl: process.env.STRIPE_SERVER_URL ?? null,
    stripeServerApiKey: process.env.STRIPE_SERVER_API_KEY ?? null,
    // Stripe publishable key (Phase 6 turn 3). Public-by-design — Stripe
    // intends this key to ship in the client. Read at app boot by
    // `<StripeProvider/>` via `getStripePublishableKey()`. NOT prefixed
    // `EXPO_PUBLIC_*` for consistency with the other Stripe env vars
    // (build-time resolution → runtime read keeps the value out of the
    // bundled string blob even when public). Without this set, the Wallet
    // surface renders an `'unconfigured'` empty state with a loud error.
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
  },
  experiments: {
    typedRoutes: false,
  },
});
