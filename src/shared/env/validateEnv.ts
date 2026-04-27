import { z } from 'zod';

/**
 * Validate the runtime environment at app start. Fails fast with a readable
 * error if any required variable is missing or malformed — better to crash
 * on launch than to send a half-configured app to users.
 *
 * Naming convention:
 *   - `EXPO_PUBLIC_*` is exposed to the JS bundle (visible in shipped APK/IPA).
 *     Use only for non-secret config.
 *   - Truly secret values must be configured via EAS Secrets and consumed in
 *     Cloud Functions — never bundled into the app.
 *
 * Phase 0 has no required env vars yet. Each phase will append to this schema
 * as it onboards Firebase, Stripe, Google Maps, etc.
 */

const Schema = z.object({
  EXPO_PUBLIC_APP_ENV: z
    .enum(['development', 'stage', 'production'])
    .default('development'),
});

export type Env = z.infer<typeof Schema>;

export function validateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Check your .env file or EAS Secrets configuration.',
    );
  }
  return parsed.data;
}

/**
 * Convenience: validate and freeze. Call once at app startup; everywhere else
 * import the resulting object.
 */
export const ENV: Env = validateEnv();
