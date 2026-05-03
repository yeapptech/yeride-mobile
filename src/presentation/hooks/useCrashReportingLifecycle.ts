import { useEffect, useRef } from 'react';

import type { User } from '@domain/entities/User';
import { useCrashReporting } from '@presentation/di';
import { LOG } from '@shared/logger';

const logger = LOG.extend('CrashReportingLifecycle');

/**
 * Single owner of the Crashlytics SDK lifecycle.
 *
 * **AppContent-only**. Mount this hook exactly once, at the very top of
 * the React tree, inside `AppContent.tsx`. Screens and view-models do
 * NOT consume the Crashlytics adapter directly — they emit through the
 * logger (`LOG.extend('SCOPE').error(...)`), which the
 * `CrashlyticsLogTransport` (sub-turn 3a) routes into the breadcrumb
 * buffer + non-fatal-error stream.
 *
 * Responsibilities (Phase 9 turn 3 sub-turn 3b):
 *
 *   1. **Collection toggle.** First time the hook mounts (per JS
 *      runtime), call `setCollectionEnabled(__DEV__ ? false : true)`.
 *      A `useRef`-guarded flag prevents a re-fire on subsequent
 *      re-renders or sign-out / sign-in cycles. The toggle is
 *      persistent inside the SDK, so re-firing would be a no-op
 *      anyway, but the guard keeps the spy count predictable.
 *
 *      Decision: collection is ON for stage AND production builds, off
 *      only in dev. The kickoff documents this as the project rule —
 *      stage builds need real telemetry to triage release-candidate
 *      regressions. Dev builds stay quiet so a debugger session
 *      doesn't pollute the Console with developer-induced crashes.
 *
 *   2. **Identity tagging.** When the `user` prop transitions from
 *      `null` to a resolved entity, call `setUserId(user.id)` followed
 *      by `setAttributes({ role: user.role, env })`. Mirrors the
 *      legacy `yeride/AppContent.js` post-userSubscribe block (lines
 *      ~380-390): the same `role` + `env` pair, set right after the
 *      user-doc resolves. The custom keys appear on every subsequent
 *      crash report and let the triage view filter by role / env.
 *
 *   3. **Identity clear.** When the `user` prop transitions from a
 *      resolved entity to `null` (sign-out), call `setUserId(null)`.
 *      The adapter normalizes to the SDK's empty-string clear
 *      semantic (legacy parity). Attributes are NOT cleared — the SDK
 *      doesn't expose a per-key clear API, and the next sign-in will
 *      overwrite them.
 *
 * Failure handling:
 *   - Every Result-returning call's `Result.err` is logged at warn and
 *     swallowed. **Telemetry must never break user flow.** If the
 *     native module is unavailable (sticky `crashlytics_native_unavailable`
 *     after the first hit), all subsequent calls short-circuit to err
 *     without re-attempting — but we still log the warn so a stage
 *     build smoke surfaces the misconfiguration.
 *
 * Lifecycle vs. transport split:
 *   - This hook owns *configuration* of the Crashlytics SDK
 *     (collection state, identity, attributes). The
 *     `CrashlyticsLogTransport` (attached at runtime from
 *     `<ContainerProvider/>` — see sub-turn 3a) owns *delivery* of
 *     breadcrumb + non-fatal-error events. Both reach the same SDK
 *     singleton via the DI container's `crashReporting` slot.
 *
 * What this hook is NOT:
 *   - The global JS error handler. That's a sibling hook
 *     (`useGlobalErrorHandler`) — kickoff decision (c). Both mount in
 *     AppContent, but separating the configuration from the
 *     uncaught-throw capture keeps each hook small and independently
 *     testable.
 *   - The Force-crash entry point. Sub-turn 3c will add a dev-only
 *     button somewhere reachable that calls
 *     `crashReporting.crash()` to verify the dSYM upload pipeline
 *     end-to-end.
 *   - An ErrorBoundary. Component-stack capture is a Turn 6 cleanup
 *     item.
 */

export interface UseCrashReportingLifecycleArgs {
  /**
   * The current user, or `null` when no one is signed in. The hook
   * tags / clears identity based on transitions of `user?.id`.
   *
   * Pass `useCurrentUserQuery().data ?? null` from AppContent — the
   * same source that drives `useGpsLifecycle`'s `userId` arg, so the
   * three lifecycle hooks see the same authentication snapshot.
   */
  readonly user: User | null;
  /**
   * Build environment tag — one of `'development' | 'stage' | 'production'`.
   * Pass `ENV.EXPO_PUBLIC_APP_ENV` from AppContent. Surfaces in the
   * Firebase Console as a custom key on every crash report; lets the
   * triage view filter dev / stage / prod separately.
   *
   * Legacy yeride uses `APP_VARIANT` from `@env`; the rewrite's
   * `validateEnv.ts` exposes the same value as `ENV.EXPO_PUBLIC_APP_ENV`.
   */
  readonly env: string;
}

export function useCrashReportingLifecycle(
  args: UseCrashReportingLifecycleArgs,
): void {
  const { user, env } = args;
  const crashReporting = useCrashReporting();

  // One-shot guard for the collection-enabled toggle. Use a ref so
  // flipping it doesn't re-render the consumer.
  const collectionToggledRef = useRef(false);

  // Track the last-tagged identity so a re-render with the same
  // resolved user + env doesn't re-fire setUserId / setAttributes
  // (the SDK would no-op, but the spy count would inflate and the
  // test expectations would drift). Composite key is `<id>|<env>`
  // so an env-change for the same user (rare; tests exercise it)
  // does re-tag.
  const lastTaggedKeyRef = useRef<string | null>(null);

  /* ──────────────── 1. Collection toggle (one-shot) ──────────────── */

  useEffect(() => {
    if (collectionToggledRef.current) return;
    collectionToggledRef.current = true;
    const enabled = !__DEV__;
    void (async () => {
      const r = await crashReporting.setCollectionEnabled(enabled);
      if (!r.ok) {
        logger.warn('setCollectionEnabled failed', r.error);
      }
    })();
  }, [crashReporting]);

  /* ──────────────── 2. Identity tagging / clearing ──────────────── */

  useEffect(() => {
    const currentKey = user ? `${String(user.id)}|${env}` : null;
    if (currentKey === lastTaggedKeyRef.current) {
      // No transition — same authenticated user + env (or both null).
      // The SDK already has the correct identity / attributes.
      return;
    }
    lastTaggedKeyRef.current = currentKey;

    if (user === null) {
      // Sign-out: clear identity. The adapter normalizes null to the
      // SDK's empty-string clear semantic. Attributes are NOT cleared
      // — the SDK doesn't expose a per-key clear API, and the next
      // sign-in will overwrite them.
      void (async () => {
        const r = await crashReporting.setUserId(null);
        if (!r.ok) logger.warn('setUserId(null) failed', r.error);
      })();
      return;
    }

    // Sign-in (or env change for the same user): tag identity then
    // attributes. Two awaited calls in sequence — order matches
    // legacy yeride's
    // `crashlytics().setUserId(uid); crashlytics().setAttributes(...)`
    // ordering. Failures are logged + swallowed individually so a
    // setUserId failure doesn't block the setAttributes call (the
    // SDK happily accepts attributes against an empty user id).
    void (async () => {
      const idR = await crashReporting.setUserId(user.id);
      if (!idR.ok) logger.warn('setUserId failed', idR.error);
      const attrR = await crashReporting.setAttributes({
        role: user.role,
        env,
      });
      if (!attrR.ok) logger.warn('setAttributes failed', attrR.error);
    })();
  }, [crashReporting, user, env]);
}
