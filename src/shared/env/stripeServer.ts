/**
 * Read the Stripe microservice connection config (base URL + Bearer
 * API key) out of `expo-constants`'s `extra` bag (set by `app.config.ts`
 * from the `STRIPE_SERVER_URL` / `STRIPE_SERVER_API_KEY` env vars at
 * build time).
 *
 * Returns `null` when EITHER value is missing — the rewrite treats both
 * as a unit so a half-configured release build doesn't silently use the
 * fake. The DI container's `buildStripeServerService` falls back to
 * `FakeStripeServerService` in that case.
 *
 * The values are NOT prefixed with `EXPO_PUBLIC_*` because they're
 * consumed via `expo-constants`'s `extra` at runtime (build-time
 * resolution → runtime read), not via `process.env` in the JS bundle.
 * This keeps the values out of the bundled string blob.
 *
 * Lazy `require` of `expo-constants` so the helper is callable from
 * test environments where Expo native modules don't load.
 */
export interface StripeServerConfig {
  readonly url: string;
  readonly apiKey: string;
}

export function getStripeServerConfig(): StripeServerConfig | null {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const extra = Constants.default?.expoConfig?.extra;
  if (!extra) return null;
  const url = extra['stripeServerUrl'];
  const apiKey = extra['stripeServerApiKey'];
  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    typeof apiKey !== 'string' ||
    apiKey.length === 0
  ) {
    return null;
  }
  return { url, apiKey };
}

/**
 * Whether the runtime has a usable Stripe server connection configured.
 */
export function isStripeServerConfigured(): boolean {
  return getStripeServerConfig() !== null;
}

/**
 * Read the Stripe publishable key out of `expo-constants`'s `extra` bag
 * (set by `app.config.ts` from the `STRIPE_PUBLISHABLE_KEY` env var at
 * build time).
 *
 * Returns `null` when the key is missing — the rewrite degrades gracefully:
 * `App.tsx` skips mounting `<StripeProvider/>`, the rider Wallet view-model
 * surfaces an `'unconfigured'` UI state, and the rest of the app boots
 * normally. This mirrors the `getGoogleMapsApiKey()` → `FakeRoutesService`
 * fallback pattern.
 *
 * The publishable key is PUBLIC by design — Stripe intends it to ship in
 * the client. Even so we read it via `extra` (NOT `EXPO_PUBLIC_*`) for
 * consistency with the other Stripe env vars and to keep it out of the
 * bundled string blob.
 *
 * Lazy `require` of `expo-constants` so the helper is callable from test
 * environments where Expo native modules don't load.
 */
export function getStripePublishableKey(): string | null {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const extra = Constants.default?.expoConfig?.extra;
  if (!extra) return null;
  const key = extra['stripePublishableKey'];
  if (typeof key !== 'string' || key.length === 0) return null;
  return key;
}
