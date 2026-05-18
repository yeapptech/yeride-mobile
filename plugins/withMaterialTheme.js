const {
  withAndroidStyles,
  withAppBuildGradle,
} = require('@expo/config-plugins');

/**
 * Custom Expo config plugin: enable Material Components theme on Android so
 * Stripe's `<CardForm/>` component renders without crashing.
 *
 * Why this is needed:
 *
 *   - `@stripe/stripe-react-native@0.63.0`'s `<CardForm/>` uses
 *     `MaterialCardView` internally on Android. `MaterialCardView` requires
 *     the host Activity's theme to descend from `Theme.MaterialComponents.*`
 *     — without it, view inflation throws
 *     `IllegalArgumentException: This component requires that you specify a
 *     valid TextAppearance attribute`, and `AddPaymentMethodScreen` crashes
 *     on first render. That screen is the only path a rider takes to add or
 *     update a card before their first ride, so without this plugin the
 *     Android rider-onboarding flow is blocked.
 *
 *   - The upstream `@stripe/stripe-react-native` Expo plugin
 *     (`node_modules/@stripe/stripe-react-native/src/plugin/withStripe.ts`)
 *     handles Apple Pay entitlement (iOS) and Google Pay meta-data
 *     (Android) but does NOT touch `styles.xml`, the AppTheme parent, or
 *     the `com.google.android.material:material` dependency. That's left
 *     to the app developer.
 *
 *   - Stripe's own `<CardForm/>` docs document the requirement:
 *     "Android requires that you set your AppTheme to a Material
 *     Components theme."
 *
 * Two independent patches:
 *
 *   1. `withAndroidStyles` — replace `AppTheme`'s parent attribute with
 *      `Theme.MaterialComponents.DayNight.NoActionBar`. Idempotent: a
 *      second run that finds the parent already set to a Material variant
 *      is a no-op.
 *
 *      NOTE — divergence from legacy yeride: legacy's `withMaterialTheme.js`
 *      sets the parent to `Theme.MaterialComponents.Light.NoActionBar`
 *      (Light only) because legacy never adopted app-theme-level dark mode.
 *      The rewrite's "Honey and the Bee" design system has dark variants,
 *      so this port uses `DayNight` instead — otherwise we'd force light
 *      mode on every Android device regardless of OS preference.
 *
 *   2. `withAppBuildGradle` — inject
 *      `implementation 'com.google.android.material:material:1.11.0'` into
 *      the `app/build.gradle` dependencies block. Idempotent via a
 *      substring check on `com.google.android.material:material`.
 *
 * Pin choice — 1.11.0 matches legacy yeride. Material Components 1.12.0
 * is the latest stable as of 2024-Q4 but bumping introduces unrelated
 * change surface for a plugin whose only job is unblocking Stripe
 * CardForm; the pin can be re-evaluated in a future polish turn.
 *
 * Removal exit condition: drop this plugin if `@stripe/stripe-react-native`
 * ever ships a release whose own Expo plugin applies the Material theme,
 * OR if the rewrite stops using `<CardForm/>` in favour of a Stripe
 * primitive that doesn't depend on `MaterialCardView`.
 */

const MATERIAL_THEME_PARENT = 'Theme.MaterialComponents.DayNight.NoActionBar';
const MATERIAL_DEPENDENCY_VERSION = '1.11.0';
const MATERIAL_DEPENDENCY_LINE = `implementation 'com.google.android.material:material:${MATERIAL_DEPENDENCY_VERSION}'`;

function withMaterialTheme(config) {
  // Patch 1: change AppTheme's parent to a Material Components variant.
  config = withAndroidStyles(config, (config) => {
    const styles = config.modResults;
    const resources = styles.resources;

    if (resources.style) {
      for (const style of resources.style) {
        if (style.$.name === 'AppTheme') {
          style.$.parent = MATERIAL_THEME_PARENT;
        }
      }
    }

    return config;
  });

  // Patch 2: inject the Material Components dependency into app/build.gradle.
  // Sentinel-style idempotency check — substring on the package coordinate
  // (not the full line) so any version pin counts as "already injected".
  config = withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (!contents.includes('com.google.android.material:material')) {
      config.modResults.contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${MATERIAL_DEPENDENCY_LINE}`,
      );
    }

    return config;
  });

  return config;
}

module.exports = withMaterialTheme;
