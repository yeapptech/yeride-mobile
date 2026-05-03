# Phase 9 — Turn 3 sub-turn 3b kickoff

> Kickoff prompt for the **next-session Claude**. Read top-to-bottom
> at the start of the new session. After reading + the required
> reading list below, propose a numbered punch list and wait for
> the user's confirmation before kicking off.

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 9 turn 3
sub-turn 3a just closed** (commit `0c40cf5`, May 2 2026): the full
Crashlytics SDK seam is wired behind a single Container slot —
domain interface, real adapter (three-state lazy singleton with
sticky-failure mode), programmable fake, multi-transport logger
refactor (new `CompositeTransport` + `addTransport`/`removeTransport`
on `Logger`), `CrashlyticsLogTransport`, jest mock, native config
(SDK plugin block + ported `withCrashlyticsUploadSymbols.js`).
End-of-3a acceptance: 173 suites / 1467 tests passing; typecheck,
lint, format, test all green. The `Container.crashReporting` slot
is unobserved by every consumer until 3b — fake-backed production
wiring is safe today.

Your job this session is **Phase 9 Turn 3 sub-turn 3b — lifecycle
hook + AppContent integration + global JS error handler**. After 3b,
sub-turn 3c (dev-only force-crash entry point + manual Firebase
Console smoke against `yeapp-stage`) closes Phase 9 Turn 3.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state. Top status block
   describes 3a; phase tables show 3a ✅ / 3b Next.
2. `docs/PHASE_9_TURN_3.md` — what 3a shipped + the deferred items
   in "What's out" that ARE 3b's scope.
3. Legacy `/Users/papagallo/yeapptech/dev/yeride/AppContent.js`,
   specifically:
   - Lines ~310-325: the `ErrorUtils.setGlobalHandler` wrapper
     (forwards uncaught JS errors via `crashlytics().recordError`).
     Port verbatim, only swap legacy's
     `crashlytics().recordError(error)` for the rewrite's
     `crashReporting.recordError(error, 'GlobalErrorHandler')`.
   - Lines ~380-390: the post-auth `setUserId` + `setAttributes`
     block (`{role: docUser?.role ?? 'unknown', env: APP_VARIANT
     ?? 'unknown'}`). The rewrite uses this same pair — `role` +
     `env`, **NOT** service-area / vehicle id.
   - Lines ~545-555: the sign-out reset (`setUserId('')`).
4. `src/presentation/hooks/useGpsLifecycle.ts` — pattern parity.
   The new `useCrashReportingLifecycle` hook should mirror its
   shape: AppContent-only, `useRef`-guarded init flag, synchronous
   cleanup, ESLint boundaries-rule override entry. Read this file
   first to get the conventions locked in.
5. `src/presentation/AppContent.tsx` — where the new hook mounts.
   Look at how `useGpsLifecycle` is consumed; mirror that pattern.
   Also look at the existing auth-resolution flow (where
   `userSubscribe` from `getCurrentUser` lands a User entity) so
   `setUserId` fires at the right time.
6. `src/presentation/di/ContainerProvider.tsx` — the runtime
   attachment hop for `CrashlyticsLogTransport` lands here. The
   provider mounts a `useEffect` that calls
   `LOG.addTransport(new CrashlyticsLogTransport(c.crashReporting))`
   on mount and `LOG.removeTransport(...)` on cleanup. Keyed on
   `c` (the container reference) to handle the rare prop-swap
   case in tests.

## Pre-Turn-3 checklist (already confirmed in 3a's session)

All four are confirmed-go from the 3a kickoff — no need to re-ask:

1. ✅ Crashlytics enabled in Firebase Console for `yeapp-stage`.
2. ✅ Legacy yeride parity pattern — confirmed; the legacy
   `AppContent.js` `ErrorUtils` handler + `setUserId` /
   `setAttributes({role, env})` block is the spec.
3. ✅ dSYM upload pipeline — configured for EAS via
   `plugins/withCrashlyticsUploadSymbols.js` (Release-only Xcode
   build phase). Local builds will skip the upload (the script
   gates on `CONFIGURATION == "Release"`).
4. ✅ Production-only collection switch — **collection is ON for
   stage AND prod, off only in dev**. Wire as
   `setCollectionEnabled(__DEV__ ? false : true)`.

## Starting state — what's already built (from 3a)

- `Container.crashReporting: CrashReportingService` slot wired in
  both DI branches. Real `FirebaseCrashlyticsAdapter` when Firebase
  is configured; `FakeCrashReportingService` otherwise.
- `useCrashReporting()` sibling hook in `src/presentation/di/`.
- `LOG.addTransport(...)` / `LOG.removeTransport(...)` — mutates
  the singleton's `CompositeTransport`. Wire the
  `CrashlyticsLogTransport` here.
- `CrashlyticsLogTransport` class — fans every level into
  `crashReporting.log(formatted)` and (at error level + Error meta)
  fires `crashReporting.recordError(error, scope)`. Read the file
  comment to understand the (a)+(b) trigger rules.
- `TestContainerProvider` accepts an optional `crashReporting?:
  FakeCrashReportingService` override prop.
- Native config: SDK plugin block + dSYM upload plugin.
  `npm run prebuild` is required before the next iOS / Android
  build.

## What 3b ships (scope in)

1. **`useCrashReportingLifecycle(user, env)` hook** — mounted once
   in AppContent. New file:
   `src/presentation/hooks/useCrashReportingLifecycle.ts`. Must:
   - On first mount: `setCollectionEnabled(__DEV__ ? false : true)`.
   - When user resolves: `setUserId(user.id)` + `setAttributes({role:
     user.role, env})`. Where `env` is read from `getAppEnv()` (or
     wherever the rewrite gets `APP_VARIANT`).
   - When user goes from authenticated → unauthenticated:
     `setUserId(null)` (the adapter normalizes to `''`).
   - Synchronous cleanup. No async cleanup function.
   - `useRef`-guarded init flag so re-renders don't re-fire
     `setCollectionEnabled`.
   - Errors from each call are logged at warn level but **never**
     thrown — telemetry must never break user flow.
   - ESLint boundaries-rule override entry added in
     `eslint.config.js` (presentation-layer SDK seam, same exception
     as `useGpsLifecycle`).

2. **`<ContainerProvider/>` runtime attachment of
   `CrashlyticsLogTransport`.** Inside the provider's body:
   ```ts
   useEffect(() => {
     const transport = new CrashlyticsLogTransport(value.crashReporting);
     LOG.addTransport(transport);
     return () => LOG.removeTransport(transport);
   }, [value]);
   ```
   Re-uses `value` (the resolved Container). The cleanup function is
   synchronous (`LOG.removeTransport` is sync). Don't gate on
   `__DEV__` here — the transport itself is no-op-friendly under the
   fake-backed Container in dev / fakes-only builds (the fake
   silently records breadcrumbs to memory).

3. **Global JS error handler in AppContent.** Wrap
   `ErrorUtils.setGlobalHandler` to forward uncaught JS errors
   through `crashReporting.recordError(error, 'GlobalErrorHandler')`
   before re-chaining to the previous handler. Mount-once
   `useEffect` with synchronous cleanup that restores the previous
   handler. Mirror the legacy pattern verbatim from
   `yeride/AppContent.js` lines 312-325.

4. **Tests.** Cover:
   - `useCrashReportingLifecycle` against `FakeCrashReportingService`
     via `TestContainerProvider` — collection toggle fires once on
     mount; `setUserId` fires after user prop transitions to
     authenticated; `setAttributes` payload is `{role, env}`;
     sign-out clears identity.
   - `<ContainerProvider/>`-mounted runtime attachment fires once on
     provider mount (reaches a recording test transport via the
     fake's breadcrumb buffer); detach on unmount.
   - Global error handler test — chain order is: original handler
     runs first, wrapper fires `recordError`, returns control
     normally.

5. **`docs/PHASE_9_TURN_3.md`** — append a "Sub-turn 3b" section
   alongside the existing "Sub-turn 3a" (NOT a separate file —
   sub-turns of a turn share the doc). Update the closing test
   count + acceptance.

6. **`CLAUDE.md`** — top status block updated to reflect 3b
   shipping. Phase tables: row for 3b → ✅; 3c → Next.

## Scope out

- The dev-only "Force crash" entry point — sub-turn 3c, depends on
  3b being live to verify the upload path actually works.
- Manual smoke against Firebase Console (force a crash, verify the
  report shows up with the right user id + role/env keys) — also
  3c.
- ErrorBoundary component — Turn 6 cleanup grab-bag (not 3b).
- Sentry / Datadog / non-Firebase observability.
- Performance Monitoring (separate package).

## Conventions (non-negotiable — same as Phases 3-9)

- `Result.ok` / `Result.err` for all expected failures.
- Synchronous unsubscribe / cleanup on all subscriptions.
- No `console.*` outside the logger — use `LOG.extend('NAME')`.
- ESLint `boundaries`-rule overrides only for legitimate SDK-seam
  hooks (existing exceptions: `presentation/di/container.ts`,
  `useGpsLifecycle.ts`, `useGpsStore.ts`,
  `useNavigationSdkConnector.ts`,
  `useDriverNavigationViewModel.ts`). Add
  `useCrashReportingLifecycle.ts` to this list.
- Tests against in-memory fakes via `TestContainerProvider`.
- `npm run verify` before committing — but each step's combined
  pipeline exceeds the sandbox 45s bash timeout; run individually
  (`typecheck`, `lint`, `format:check`, `test`) and confirm each is
  green.

## Workspace hygiene at session start

The 3a session ended with `git status` reporting MM/D markers due
to the `GIT_INDEX_FILE` shadow plumbing — the working tree matches
HEAD (`0c40cf5`) but the live `.git/index` is stale. **First thing
to do in the new session: run `git reset --mixed HEAD`** (no flags
is fine, default is `--mixed`) to refresh the live index from HEAD
without touching the working tree. After that, `git status --short`
should return nothing.

## Commit pattern

Use the `GIT_INDEX_FILE` plumbing pattern documented in the
auto-memory note (virtiofs blocks plain `git commit`'s 2nd
invocation):

1. Copy `.git/index` to `/sessions/<sandbox>/mnt/outputs/<shadow>`
   (NOT `/tmp` — that path is permission-denied).
2. `GIT_INDEX_FILE=<shadow> git add -A`.
3. `GIT_INDEX_FILE=<shadow> git write-tree` → tree hash.
4. `git commit-tree <tree> -p HEAD -F <message-file>` → commit
   hash.
5. `git update-ref HEAD <commit-hash>`.

Use a fresh shadow path per commit attempt (the previous shadow's
`.lock` file gets stuck and blocks reuse).

## Acceptance for end of Sub-turn 3b

- `npm run typecheck` + `npm run lint` + `npm run format:check` +
  `npm run test` all green.
- 173/1467 baseline → ~177-180 suites / ~1490-1510 tests (estimate
  +4 to +7 suites, +25 to +40 tests).
- `useCrashReportingLifecycle` mounted once in AppContent; fires
  collection toggle on first mount; `setUserId`/`setAttributes`
  after auth resolves; sign-out clears identity.
- `<ContainerProvider/>`'s runtime attachment hop wires the
  Crashlytics transport on mount; detach on unmount.
- AppContent global JS error handler chains correctly.
- `docs/PHASE_9_TURN_3.md` appended with 3b section.
- `CLAUDE.md` updated.
- Clean commit on `main` via the sandbox plumbing pattern.

Sub-turn 3c (force-crash dev entry point + manual Firebase Console
smoke) is the next session.

## Start with

Read `CLAUDE.md` then `docs/PHASE_9_TURN_3.md` to confirm baseline.
Read the legacy `yeride/AppContent.js` `ErrorUtils` block + the
post-auth `setUserId`/`setAttributes` block to lock down the
pattern. Read `src/presentation/hooks/useGpsLifecycle.ts` for shape
parity on the new lifecycle hook. Then propose the exact
step-by-step plan as a numbered punch list (sub-tasks of 3b) and
wait for confirmation before kicking off.

**Tip:** don't try to ship 3b and 3c in one session — 3b is purely
JS/TS work (no native rebuild), 3c needs `npm run prebuild` + a
fresh native build + a real device with Firebase Console access.
Logical session boundary.
