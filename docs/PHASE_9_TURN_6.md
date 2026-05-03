# Phase 9 — Turn 6: Observability cleanup grab-bag

Phase 9 Turn 3 closed the entire Crashlytics integration end-to-end —
SDK seam, lifecycle hook, global error handler, dev-tools section,
docs, manual smoke. The close acknowledged two follow-up items that
escaped Turn 3's scope:

1. The **`recordError`-via-`LOG`-sanitize gap** — the
   `CrashlyticsLogTransport`'s non-fatal capture path can't fire
   through the production logger pipeline because `Logger.write` runs
   `sanitizeForLogging(meta)` which converts `Error` instances to
   plain `{name, message, stack}` objects before the transport sees
   them. The transport's `instanceof Error` check in `extractError`
   then fails. Breadcrumb fan-out works fine; only `recordError` is
   silently lost. Surfaced and logged in 3b's deviation note.

2. **`<ErrorBoundary/>`** — deferred from 3a's "What's out" list.
   React error boundary that catches render-phase throws, fans the
   error out to Crashlytics, and renders a recoverable fallback UI.
   Bulk of the work is the fallback view.

Turn 6 ships both, plus a related ESLint cleanup (the
`boundaries/element-types` deprecation warning that's been emitted
on every lint run since the v6 upgrade).

## What's in

### 1. Parallel `rawMeta` channel through the logger pipeline

`src/shared/logger/Logger.ts` — `LogTransport.log` extends
additively from `(level, scope, message, meta?)` to
`(level, scope, message, meta?, rawMeta?)`. The new `rawMeta`
parameter carries the **original** un-sanitized meta payload alongside
`meta` (the `sanitizeForLogging`-stripped view). Two kinds of
transports use the two channels:

- **Text-output transports** (`ConsoleTransport`) read `meta` only —
  they emit human-readable lines and must never leak PII.
- **Telemetry transports** (`CrashlyticsLogTransport`) read `rawMeta`
  so they can detect `instanceof Error`. The telemetry transport
  still passes the FORMATTED `[scope] message` string into the
  breadcrumb buffer, so the un-sanitized `rawMeta` never reaches
  Firebase Console — only the Error reference itself is followed for
  `recordError`.

`Logger.write` is the single point that produces both: it computes
`sanitizedMeta` exactly as today AND passes the original `meta`
through as the new `rawMeta` argument. `CompositeTransport.log`
forwards both arguments to every child.

`CrashlyticsLogTransport.log` prefers `rawMeta` over `meta` when
extracting the `Error` (`extractError(rawMeta ?? meta)`). The fallback
to `meta` keeps direct `transport.log(...)` calls in tests working
with the 4-arg form — those tests stand in for direct uses outside
the logger pipeline.

The kickoff considered three fix shapes: (a) preserve `instanceof
Error` through `sanitizeForLogging`, (b) parallel un-sanitized meta
channel, (c) audit-and-fix call sites. Shape (b) shipped because:
(a) creates a real PII leak surface — `error.message` on Stripe
errors, network errors, and Cloud Function rejections embeds tokens,
URLs, and user-supplied strings that the project explicitly redacts
on every other path; (c) is brittle (new `LOG.error('scope', e)`
sites silently regress), loud at every call site, and doesn't fix
the contract.

The contract change is intentionally additive — the `rawMeta`
parameter is optional, so existing `LogTransport` implementations
that take 4 args continue to compile and run. The internal `Logger`
singleton + `CompositeTransport` always pass the 5th argument; only
the transport classes were updated.

### 2. `<ErrorBoundary/>` component

`src/presentation/components/error/ErrorBoundary.tsx`. App-root React
error boundary built as a function-component wrapper around an inner
class component. Three pieces:

- **The wrapper** (`ErrorBoundary`) is a function component that
  reads `useCrashReporting()` from the DI container, holds a
  `resetCount` in `useState`, and passes the adapter + the reset
  callback into the inner class. The function-component wrapper is
  the only way to read a React hook here — class components can't
  call hooks.

- **The class** (`ErrorBoundaryClass`) implements
  `getDerivedStateFromError(error)` (sync, returns the state update
  that swaps in the fallback UI) and `componentDidCatch(error,
errorInfo)` (async-fire-and-forget side-effect — calls
  `crashReporting.recordError(error, 'ErrorBoundary')` and emits a
  breadcrumb carrying the React component stack). Both Crashlytics
  calls are wrapped in a try/catch so a synchronous SDK throw
  doesn't break the fallback render. The class also `LOG.error`s
  the catch event for live developer visibility.

- **The fallback UI** (`FallbackUI`) is a centered card with
  "Something went wrong" + a "Try again" CTA. Production builds
  show only the copy + button. Dev builds (`__DEV__ === true`)
  additionally render a debug panel with the error name and
  message — production hides this because (a) it's noise to end
  users and (b) some error messages embed internal context (URLs,
  IDs, stack frames) that shouldn't reach the user-facing surface.

**Reset semantics** — the "Try again" CTA bumps `resetCount` in the
wrapper, which is passed as `key` on the inner class. React responds
by unmounting + remounting the entire boundary, clearing
`caughtError` and re-rendering children fresh. This is the
React-recommended pattern for resetting error boundaries — preferred
over conditionally clearing state inside the class because
remounting also resets any sibling state that might have gotten into
a bad shape.

**Mounting rule** — mounted exactly once at app root, inside
`<ContainerProvider/>` (so `useCrashReporting()` resolves) and
wrapping `<AppContent/>`. The trade-off documented inline: the
`<ContainerProvider/>` itself constructs the container synchronously
via `useMemo`, so a throw during container build would land ABOVE
this boundary. That's acceptable — the alternative (boundary above
the provider) would require a separate path to record the error,
and `buildContainer()` has no failure modes today.

**What this catches** (per React's documented contract):

- Errors thrown during render of any descendant component.
- Errors thrown from `componentDidMount` / `componentDidUpdate` /
  the synchronous parts of `useEffect` setup.
- Errors thrown from class lifecycle methods.

**What this does NOT catch** — covered by `useGlobalErrorHandler`
(Phase 9 turn 3 sub-turn 3b):

- Throws inside event handlers.
- Throws inside async callbacks / `setTimeout` / promise chains.
- Throws inside the boundary's own render (would propagate up to the
  next boundary; there is none here, so it would unmount the app).

`src/presentation/App.tsx` — the boundary slots between
`<ContainerProvider>` and `<AppContent>` in the layered provider
stack. The JSDoc tree-diagram comment was extended to reflect the
new layer.

8 tests cover happy path (no error → renders children), catch
(fallback UI renders, `recordError` fires with the actual Error
reference, breadcrumb carries the React component stack), reset
behavior (bumping the key remounts the subtree; if children stop
throwing they render successfully; if they keep throwing the
fallback re-renders + at least one additional `recordError` fires),
and production hide-debug-details behavior (`__DEV__ === false`
branch).

### 3. ESLint `boundaries/element-types` → `boundaries/dependencies` migration

`eslint.config.js` — `eslint-plugin-boundaries` v6 deprecated the
`boundaries/element-types` rule name in favor of
`boundaries/dependencies` with a new object-selector schema. The
rule still works under the old name but emits a deprecation warning
on every lint run. Tracked since Phase 9 Turn 1.

The migration is mechanical: same five `from → allow` rules,
expressed in the new `from: { type: 'X' }` / `allow: { to: { type:
[...] } }` shape. Same enforcement semantics. The override block
that disables the rule for tests + the DI container + the SDK-seam
hooks gets the rule-name flip applied symmetrically.

Lint output before: 0 errors, 0 warnings (the deprecation message
prints separately, not as an ESLint warning). Lint output after:
0 errors, 0 warnings, no plugin chatter. Cumulative line-count
change to `eslint.config.js`: +18 lines (the new schema is more
verbose but more explicit about direction).

## What's out (deferred to follow-up turns)

- **RNFirebase modular-API migration.** The deprecation warnings
  (`Method called was X. Please use X() instead.`) that surfaced
  during the 3c smoke. Mechanical refactor across every RNFirebase
  consumer (auth, firestore, functions, storage, crashlytics — five
  packages, dozens of call sites). More natural as a Phase 10
  cutover-prep task. Skipped this turn per the kickoff Q3 decision
  to keep Turn 6 focused on observability cleanup.

- **DriverNavigation polish.** Phase 8 close left several polish
  items (e.g. the driver VM's `lastWrittenCoordsRef`-deduped
  foreground location push overlapping with the Phase 7 Turn 2
  lifecycle hook's per-delivery write — currently a harmless
  double-write). Was the alternate path for this turn; took
  observability cleanup instead.

- **Per-screen ErrorBoundary variants.** Turn 6 mounts the boundary
  app-root only (kickoff Q2 (a)). Per-screen variants are YAGNI
  until there's a real need.

## Risks surfaced (still observability scope)

### Test-environment React reconciler noise

React 19 (and 18) logs caught errors via `console.error` independent
of the user's `componentDidCatch`. The ErrorBoundary tests silence
this with a `console.error` spy in `beforeEach` — without the spy
every "throws on render" test floods the test output with React's
red-box-equivalent stack trace. Standard `@testing-library`
practice; documented inline in the test file.

### React's double-invocation of `componentDidCatch` in dev

The "if children still throw after Try again" test asserts
`recordErrorCalls > initialCount` rather than `=== 2`. React in
dev-mode may double-invoke `componentDidCatch` to surface buggy
error-handling logic in user code; the exact total varies between
React minor versions. The brittle "exactly 2" assertion was
relaxed to `>` so the test stays green across minor React updates.

### `extractError` fallback path is now exercised by two distinct surfaces

After Turn 6, `CrashlyticsLogTransport.extractError(rawMeta ?? meta)`
has two real call shapes:

- **Production** (via `Logger.write`): both arguments are passed.
  `rawMeta` carries the original `Error` reference; `meta` carries
  the sanitized stand-in. The `??` selects `rawMeta`.
- **Direct test calls**: only `meta` is passed. The `??` falls
  through to `meta`. Existing 9 `CrashlyticsLogTransport.test.ts`
  tests in the previous describe blocks all use this shape.

A future change that confuses the two channels (e.g. someone
swaps the `rawMeta`/`meta` argument order in `Logger.write`) would
silently regress without a test catching it — because direct test
calls would still extract correctly via the fallback. The 3 new
"rawMeta channel" tests in `CrashlyticsLogTransport.test.ts`
explicitly assert `rawMeta` wins over `meta` when both are present
to catch this case.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + `npm test` all green. Per the prior turns'
sandbox conventions, the full test suite is run in chunks because
the single-pass time exceeds the sandbox's 45s bash timeout.

**180 test suites / 1515 tests** passing.

Delta vs. Phase 9 Turn 3 close baseline (179 suites / 1499 tests):
**+1 suite / +16 tests**. At the lower end of the kickoff's
"+2 to +4 suites / +15 to +25 tests" estimate band. Most of the
new tests (8 of 16) landed in the new ErrorBoundary suite; the
other 8 landed in existing logger suites (5 in `Logger.test.ts`,
3 in `CrashlyticsLogTransport.test.ts`).

Test-suite breakdown verified across 7 chunks:

| Chunk pattern                                                                              | Suites | Tests |
| ------------------------------------------------------------------------------------------ | -----: | ----: |
| `src/(shared\|presentation/(di\|hooks\|components))`                                       |     30 |   269 |
| `src/presentation/features/rider`                                                          |     14 |   100 |
| `src/presentation/features/driver`                                                         |     24 |   168 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent)` |      7 |    55 |
| `src/(domain\|app)`                                                                        |     88 |   661 |
| `src/data`                                                                                 |     16 |   256 |
| `src/presentation/__tests__/AppContent`                                                    |      1 |     6 |
| **Total**                                                                                  |    180 |  1515 |

End-of-Turn-6 acceptance criteria, all met:

1. ✅ Parallel `rawMeta` channel landed in `Logger.ts` /
   `CrashlyticsLogTransport.ts`. Contract change additive — existing
   `LogTransport` implementations that take 4 args still work.
2. ✅ Regression test in `Logger.test.ts` proves
   `LOG.error('scope', errorInstance)` reaches
   `CrashlyticsLogTransport.recordError` with reference identity
   preserved. Pre-fix this test would fail.
3. ✅ `<ErrorBoundary/>` shipped at
   `src/presentation/components/error/ErrorBoundary.tsx`. Function
   wrapper + class core + `__DEV__`-gated debug panel in fallback.
   Mounted in `App.tsx` between `<ContainerProvider>` and
   `<AppContent>`.
4. ✅ 8 ErrorBoundary tests cover happy path, catch + recordError
   fan-out + component-stack breadcrumb, reset semantics (recover +
   re-throw), production hide-debug-details branch.
5. ✅ ESLint boundaries-rule migrated from
   `boundaries/element-types` to `boundaries/dependencies`. v6
   deprecation warning silenced. Override blocks updated. Lint
   output: 0 errors, 0 warnings, no plugin chatter.
6. ✅ All four verify gates green (each step individually under the
   sandbox's 45s bash timeout; the combined pipeline exceeds the
   timeout and is verified piecemeal as in prior turns).
7. ✅ `docs/PHASE_9_TURN_6.md` written (this file).
8. ✅ `CLAUDE.md` updated to reflect Phase 9 Turn 6 close.
9. ✅ Clean commit on `main` via the sandbox `GIT_INDEX_FILE` shadow
   plumbing pattern.

No native config changes. No new dependencies. No prebuild required.

## Files added / touched

**Added:**

- `src/presentation/components/error/ErrorBoundary.tsx` — function
  wrapper + inner class component + `__DEV__`-gated debug panel in
  fallback.
- `src/presentation/components/error/__tests__/ErrorBoundary.test.tsx`
  — 8 tests across 4 describe blocks.
- `docs/PHASE_9_TURN_6.md` — this file.

**Touched:**

- `src/shared/logger/Logger.ts` — `LogTransport.log` signature
  extended additively with optional 5th `rawMeta` arg;
  `ConsoleTransport.log` accepts but ignores `rawMeta`;
  `CompositeTransport.log` forwards both; `Logger.write` passes
  original `meta` as `rawMeta`.
- `src/shared/logger/CrashlyticsLogTransport.ts` — `log()` signature
  update; `extractError(rawMeta ?? meta)` for the production
  pipeline + direct-call backward compat.
- `src/shared/logger/__tests__/Logger.test.ts` —
  `RecordingTransport` extended to capture `rawMeta`; new describe
  block "Logger — rawMeta channel preserves Error instance through
  sanitize" with 5 tests covering the channel itself + the headline
  end-to-end regression (`LOG.error → CrashlyticsLogTransport
recordError fires with the actual Error`).
- `src/shared/logger/__tests__/CrashlyticsLogTransport.test.ts` —
  new describe block "rawMeta channel (Phase 9 turn 6)" with 3
  tests covering `rawMeta` wins over `meta`, fallback to `meta`
  when `rawMeta` absent, and the production pipeline shape.
- `src/presentation/App.tsx` — `<ErrorBoundary/>` mounted between
  `<ContainerProvider>` and `<AppContent>`; new import; tree-
  diagram JSDoc comment extended to reflect the new layer.
- `eslint.config.js` — `boundaries/element-types` rule migrated to
  `boundaries/dependencies` with the new object-selector schema in
  both the main rules block and the test-files override block.
  Inline comment updated.
- `CLAUDE.md` — top status block + phase-tables row for Turn 6.

---

## Phase 9 close — combined summary

Across six turns Phase 9 closes the entire observability + push-
notifications + iOS Apple Maps gaps that were the difference between
the rewrite and a production-equivalent surface. Turn 1 fixed the
iOS Map registration regression (PROVIDER_GOOGLE flip); Turn 2
shipped the full push-notifications pipeline (registration +
permission soft-ask + tap routing); Turn 3 shipped the entire
Crashlytics integration end-to-end across three sub-turns; Turn 6
closes the two follow-ups (the LOG-sanitize gap + ErrorBoundary)
plus an opportunistic ESLint cleanup. Net delta across the phase
(160/1268 close-of-Phase-8 → 180/1515 close-of-Turn-6):
**+20 suites / +247 tests**.

The next turn (Turn 4 or whenever the user picks the next direction)
covers DriverNavigation polish + cleanup grab-bag. The RNFirebase
modular-API migration is still tracked for either Turn 7 or as a
Phase 10 cutover-prep task.
