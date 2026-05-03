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
  // EAS owner / project linkage (Phase 9 turn 2 sub-turn 2a — May 2026).
  // Distinct from legacy yeride's project (different bundle ids:
  // tech.yeapp.yeridenext.* vs tech.yeapp.yeride). The `extra.eas.projectId`
  // bag is what `Notifications.getExpoPushTokenAsync({projectId})` reads
  // to mint Expo-wrapped push tokens (sub-turn 2b's adapter consumes
  // this via `Constants.expoConfig.extra.eas.projectId`).
  owner: 'yeapptech',
  scheme: SCHEME_BY_ENV[APP_ENV],
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // New Architecture is the default in Expo SDK 55+; no flag needed.
  ios: {
    bundleIdentifier: BUNDLE_BY_ENV[APP_ENV],
    supportsTablet: false,
    ...(iosFirebaseConfig ? { googleServicesFile: iosFirebaseConfig } : {}),
    infoPlist: {
      // Phase 7: background-mode entitlements + Transistor BGTask identifiers
      // required by `react-native-background-geolocation`. The SDK's iOS
      // background-fetch hook will refuse to schedule the OS task without the
      // identifiers below; `UIBackgroundModes` `location` + `fetch` are the
      // entitlements the OS checks to allow GPS callbacks while the app is
      // backgrounded. The motion-usage description is required because the
      // SDK reads CMMotionActivityManager to gate the moving/stationary
      // state machine.
      //
      // Foreground location-permission strings (`NSLocationWhenInUseUsageDescription`
      // + `NSLocationAlwaysAndWhenInUseUsageDescription`) are emitted by the
      // existing `expo-location` plugin block below, so we don't restate them
      // here.
      // Phase 9 turn 2 sub-turn 2b adds `remote-notification` so APNs
      // payloads can wake the app in the background — required for
      // notification taps to fire `addNotificationResponseReceivedListener`
      // when the user opens a push from the lock screen / notification
      // center while the app is suspended (cold-start taps still flow
      // through `getLastNotificationResponseAsync()` instead).
      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
      BGTaskSchedulerPermittedIdentifiers: [
        'com.transistorsoft.fetch',
        'com.transistorsoft.customtask',
      ],
      NSMotionUsageDescription:
        'YeRide Next uses motion-activity data to detect when your trip starts and stops, improving battery life.',
    },
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
      // Phase 9 turn 2 sub-turn 2b: `expo-notifications` plugin block.
      // The plugin patches AndroidManifest.xml with the FCM default-icon /
      // default-color meta-data and writes the iOS aps-environment
      // entitlement. We rely on Expo's push API at runtime
      // (`getExpoPushTokenAsync({projectId})`) so the deployed
      // `yeride-functions/lib/notifications.js` `sendNotification` can
      // route via Expo's API server-side — no Cloud Function changes
      // required for the rewrite to plug in alongside legacy yeride.
      //
      // Icons / sounds default to the platform's app-icon notification
      // render until the rewrite ships branded notification assets in a
      // Phase 9 polish turn.
      //
      // `mode` controls iOS's `aps-environment` entitlement:
      //   - 'development' for debug / devClient / EAS internal builds
      //   - 'production'  for App Store / TestFlight builds
      // Phase 9 turn 2's smoke targets `yeapp-stage` from a debug build,
      // so 'development' is correct for dev + stage environments. The
      // production env flips to 'production' so EAS production builds
      // get the right APNs entitlement automatically.
      'expo-notifications',
      { mode: APP_ENV === 'production' ? 'production' : 'development' },
    ],
    [
      // Phase 7: background-aware location + geofence pipeline. The SDK's
      // Expo plugin (a) writes the iOS `BGTaskSchedulerPermittedIdentifiers`
      // helper config and patches Android `AndroidManifest.xml` with the
      // foreground-service permissions / notification channel scaffolding,
      // and (b) bakes the license key into the native bundle. The license is
      // consumed at BUILD time only — there is no runtime read. Without the
      // env var set, the SDK runs in time-limited debug mode (fine for dev,
      // blocks release builds). `npm run prebuild` is required after this
      // plugin lands so the native config takes effect.
      'react-native-background-geolocation',
      { license: process.env.BG_GEOLOCATION_LICENSE_KEY ?? '' },
    ],
    // The SDK's own plugin only registers a maven URL for its own libs/.
    // `react-native-background-fetch` is a sibling peer dep with its own
    // flatdir AAR (`tsbackgroundfetch:1.0.4`); without this extra repo
    // entry, Gradle's `:app:processDebugResources` fails with "Could not
    // find com.transistorsoft:tsbackgroundfetch:1.0.4". Must run AFTER
    // the SDK plugin so the merge anchor lands inside the same repos block.
    './plugins/withBackgroundFetchMaven.js',
    // Phase 7 turn 2 (post-device-smoke fix): pin
    // `playServicesLocationVersion = "21.0.1"` so the SDK selects the
    // `tslocationmanager-v21` AAR (binary-compatible with
    // `FusedLocationProviderClient` as an interface). Without this pin,
    // the SDK defaults to 20.0.0 and pulls the legacy AAR that expects
    // `FusedLocationProviderClient` to be a CLASS — at runtime,
    // dependencies (Firebase, expo-location, etc.) drag in a newer
    // play-services-location where `FusedLocationProviderClient` is an
    // INTERFACE, and `TSLocationManager.stop()` crashes with
    // `IncompatibleClassChangeError`. Legacy yeride applies the same
    // pin in its `android/build.gradle`'s top-level `ext { }` block.
    './plugins/withPlayServicesLocationVersion.js',
    // Phase 8 turn 1: integrate `@googlemaps/react-native-navigation-sdk`.
    // The SDK doesn't ship its own `app.plugin.js`, so the local plugin
    // covers everything: Android core library desugaring +
    // play-services-maps exclusion + kotlin-stdlib alignment + AAR
    // metadata check disable; iOS GoogleMaps podspec alignment +
    // RCTDirectEventBlock event-type fix + CocoaPods CDN fallback +
    // strip the orphan `pod 'react-native-google-maps'` line that
    // Expo's withMaps emits for legacy react-native-maps. Minimum
    // patch set per kickoff decision 3 — Firebase BoM 34.0.0 pin and
    // MapView NPE patches are deferred until Turn 3's device build
    // smoke catches them. `npm run prebuild` is required after this
    // plugin lands so the native config takes effect.
    './plugins/withNavigationSdk.js',
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
      ? [
          '@react-native-firebase/app',
          '@react-native-firebase/crashlytics',
          './plugins/withFirebasePodfileFix.js',
          './plugins/withCrashlyticsUploadSymbols.js',
        ]
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
          // Phase 8 turn 1: bumped 15.1 → 16.0 because
          // `@googlemaps/react-native-navigation-sdk@0.14.1`'s podspec
          // declares `:ios => "16.0"` as its minimum platform. CocoaPods
          // refuses to resolve the dependency otherwise (`could not find
          // compatible versions for pod "react-native-navigation-sdk"`).
          // Legacy yeride is already on iOS 16+; the rewrite's earlier
          // 15.1 was a hold-over from before the Navigation SDK landed.
          // Practical user-base impact: drops iPhone 6s / 7 / SE-1, all
          // released ≥ 9 years ago.
          deploymentTarget: '16.0',
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
    // EAS project linkage (Phase 9 turn 2 sub-turn 2a). Required by
    // `Notifications.getExpoPushTokenAsync({projectId})` to mint
    // Expo-wrapped push tokens. Distinct project from legacy yeride
    // (different bundle ids → different EAS project from Expo's POV).
    // Hardcoded — not env-driven — because the project is a single
    // identity across dev/stage/production builds; the per-env split
    // happens at the Firebase / APNs configuration layer instead.
    eas: {
      projectId: 'adb0a788-bf99-4a60-9424-f23266127854',
    },
  },
  experiments: {
    typedRoutes: false,
  },
});
