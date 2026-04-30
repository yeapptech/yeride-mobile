/**
 * Read the app's URL scheme out of `expo-constants`'s `expoConfig` (set
 * by `app.config.ts`'s `SCHEME_BY_ENV` table). The scheme is per-env:
 *
 *   - development → `yeridenext-dev`
 *   - stage       → `yeridenext-stage`
 *   - production  → `yeridenext`
 *
 * Used by Phase 6 turn 4 to build the `returnUrl` and `refreshUrl` for
 * Stripe Connect onboarding (`{scheme}://stripe-return`). Callers should
 * surface `null` as a fail-loud configuration error rather than silently
 * falling through to a hardcoded scheme — a missed env in `app.config.ts`
 * would produce a return URL the system can't route, which would strand
 * the driver in the browser indefinitely.
 *
 * Lazy `require` of `expo-constants` so the helper is callable from test
 * environments where Expo native modules don't load.
 */
export function getDeepLinkScheme(): string | null {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { scheme?: unknown } };
  };
  const scheme = Constants.default?.expoConfig?.scheme;
  if (typeof scheme !== 'string' || scheme.length === 0) return null;
  return scheme;
}

/**
 * Build a `{scheme}://{path}` deep-link URL for the current env. Returns
 * `null` if the scheme is unconfigured — the caller should treat that as
 * a build-time configuration error.
 *
 * Path is passed through verbatim (no leading slash). Example:
 *
 *   buildDeepLink('stripe-return') → 'yeridenext-dev://stripe-return'
 */
export function buildDeepLink(path: string): string | null {
  const scheme = getDeepLinkScheme();
  if (scheme === null) return null;
  return `${scheme}://${path}`;
}
