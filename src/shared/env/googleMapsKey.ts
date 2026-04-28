import { Platform } from 'react-native';

/**
 * Read the Google Maps API key for the current platform out of
 * `expo-constants`'s `extra` bag (set by `app.config.ts` from the
 * `GOOGLE_MAPS_APIKEY_ANDROID` / `GOOGLE_MAPS_APIKEY_IOS` env vars at
 * build time).
 *
 * Returns `null` when the key isn't configured. Callers should treat that
 * as "Routes API not available in this build" — the DI container falls
 * back to `FakeRoutesService` exactly the way it falls back to in-memory
 * fakes when Firebase config files are absent.
 *
 * Lazy `require` of `expo-constants` so the helper is callable from
 * test environments where Expo native modules don't load.
 */
export function getGoogleMapsApiKey(): string | null {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const extra = Constants.default?.expoConfig?.extra;
  if (!extra) return null;
  const key =
    Platform.OS === 'android'
      ? extra['googleMapsApiKeyAndroid']
      : extra['googleMapsApiKeyIos'];
  if (typeof key !== 'string' || key.length === 0) return null;
  return key;
}

/**
 * Whether the runtime has a usable Google Maps API key configured.
 * Used by the DI container to decide between the real
 * `GoogleRoutesService` and the `FakeRoutesService`.
 */
export function isGoogleMapsConfigured(): boolean {
  return getGoogleMapsApiKey() !== null;
}
