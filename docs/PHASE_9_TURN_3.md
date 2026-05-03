# Phase 9 — Turn 3: Crashlytics integration (sub-turn 3a in)

Phase 9 turn 2 closed the biggest functional gap (push notifications);
turn 3 closes the last observability gap before the legacy yeride
cutover. The rewrite now has the full Crashlytics SDK seam, the
domain interface, the real adapter, the programmable fake, the
multi-transport logger refactor, and the Crashlytics log transport —
all behind a single composition-root wiring in `Container`.

This doc covers **sub-turn 3a only** — domain + data plumbing + DI
wiring + logger architecture. The lifecycle hook
(`useCrashReportingLifecycle`), AppContent integration, and the
dev-only Force-crash entry point land in sub-turns 3b and 3c. As of
3a, the `Container.crashReporting` slot is unobserved by every
consumer — a fake-backed production wiring is safe.

The legacy `yeride/CLAUDE.md` Crashlytics integration is the parity
target. Three findings from the legacy investigation shape Turn 3:

- **Custom keys are `role` + `env`** (set via the SDK's bulk
  `setAttributes(record)` form), NOT `service_area_id` /
  `vehicle_id` as the kickoff guessed.
- **Multi-transport logger** — legacy's `logger.config.js` runs
  `consoleTransport` + `crashlyticsTransport` concurrently via
  `react-native-logs`. The rewrite's `Logger.ts` is single-transport
  today but explicitly anticipates a Crashlytics transport (see the
  Phase 9 doc block). Sub-turn 3a refactors to support multi-transport
  composition via a new `CompositeTransport` class.
- **dSYM upload plugin** — legacy has a custom Expo plugin
  (`plugins/withCrashlyticsUploadSymbols.js`) that adds a
  Release-only `[firebase_crashlytics] Upload dSYMs` Xcode build
  phase. Ported verbatim with the import path adjusted from
  `expo/config-plugins` (legacy) to `@expo/config-plugins` (rewrite).

`@react-native-firebase/crashlytics@^24.0.0` joins the dep set,
matching the existing RNFirebase 24.x stack
(`app/auth/firestore/functions/storage`). `npm run prebuild` is
required before the next iOS / Android build so the SDK Expo plugin's
native config lands (iOS `firebase_crashlytics_collection_enabled`
Info.plist entry — gated to default-on, runtime-overridden by
`setCollectionEnabled`; Android FCM `firebase_crashlytics_collection_enabled`
manifest meta-data; iOS dSYM upload phase).

## What's in

### Sub-turn 3a — domain + data + DI + logger refactor (no behavior change)

#### 1. `CrashReportingService` domain interface

`src/domain/services/CrashReportingService.ts` — six methods all
returning `Promise<Result<void, NetworkError>>` except `crash()`
which is synchronous and never returns:

- `setCollectionEnabled(enabled: boolean)` — wired by the lifecycle
  hook (sub-turn 3b) to `__DEV__ ? false : true` (off in dev, on in
  stage + production per project decision).
- `setUserId(userId: UserId | null)` — pass `null` to clear identity
  on sign-out. Adapter normalizes to the SDK's empty-string clear
  semantic (legacy parity).
- `setAttributes(attributes: Record<string, string>)` — bulk form,
  matches legacy's call shape. Lifecycle hook will pass
  `{role, env}` after auth resolves.
- `recordError(error: Error, name?: string)` — name is a Crashlytics
  "domain" tag for grouping non-fatal captures (e.g.
  `'GlobalErrorHandler'`, `'YeRide:RIDE'`). Defaults to the error's
  class name.
- `log(message: string)` — adds a breadcrumb to the next crash
  report. The SDK retains the last ~64 messages.
- `crash(): void` — synchronous, no Result. Used only by the
  dev-only Force-crash entry point (sub-turn 3c).

Re-exported from `src/domain/services/index.ts`.

#### 2. `FakeCrashReportingService`

`src/shared/testing/FakeCrashReportingService.ts` — programmable
in-memory stand-in. Mirrors the real adapter's surface 1:1. Pattern
matches `FakePushNotificationService` /
`FakeBackgroundGeolocationClient` / `FakeStripeServerService`.

Surface:

- `seed*` helpers (`seedCollectionEnabled`, `seedUserId`,
  `seedAttributes`) — prime initial state for tests.
- `failNext({method, error})` — make the next call to a method
  return `Result.err(error)` one-shot.
- `reset()` — wipe seed + spy + recorded state.
- `spies` getter — read-only call counts for every method.
- `get*` / `did*` — read-only introspection
  (`getCollectionEnabled()`, `getUserId()`, `getAttributes()`,
  `getRecordedErrors()`, `getBreadcrumbs()`, `didCrash()`).

`crash()` flips a `crashed: true` flag rather than raising a fatal
exception — tests assert the flag was set without taking the Jest
worker down. The real adapter throws in this method; the divergence
is intentional and isolated to test ergonomics.

Tested with 18 cases covering defaults, every seed helper, every
adapter-surface method, `failNext` one-shot semantics (incl. the
"only one failure per method" overwrite rule), and reset behavior.

Re-exported from `src/shared/testing/index.ts` alongside the type
exports (`FakeCrashReportingMethod`, `FakeCrashReportingSpies`,
`RecordedCrashError`).

#### 3. `FirebaseCrashlyticsAdapter`

`src/data/services/FirebaseCrashlyticsAdapter.ts` — single seam
between the rewrite and `@react-native-firebase/crashlytics`. Three
substantive design decisions:

- **Three-state lazy singleton cache** — the `_instance` slot is
  `undefined | null | Module`. `undefined` means not yet resolved
  (next call attempts a fresh `crashlytics()` lookup). `null` means
  resolution failed and is sticky for the lifetime of the process —
  every subsequent call short-circuits to
  `Result.err({code: 'crashlytics_native_unavailable'})` without
  re-attempting. Mirrors legacy yeride's
  `crashlyticsInstance = false` sentinel pattern.
- **Direct top-level import** of
  `@react-native-firebase/crashlytics`. The global jest mock in
  `jest.setup.ts` (Task #10) replaces the native module so unit
  tests don't fail at module load. Legacy's lazy `require` was
  needed because legacy's Jest setup had no global mock — the
  rewrite's setup does.
- **`recordError` and `log` are sync void in the SDK** (the SDK
  buffers locally and uploads async). The adapter wraps them in
  `Promise<Result<void, NetworkError>>` to match the project's
  uniform interface — and to give us an exception-mapping point in
  case the SDK ever throws synchronously (rare, but legacy's
  wrapper has the same try/catch defense).

Error code mapping for adapter failures:

- `crashlytics_native_unavailable` — `crashlytics()` itself threw
  on resolution (sticky after first hit).
- `crashlytics_set_collection_enabled_failed`
- `crashlytics_set_user_id_failed`
- `crashlytics_set_attributes_failed`
- `crashlytics_record_error_failed`
- `crashlytics_log_failed`

Each carries the original throw / reject reason in the `NetworkError`'s
`cause` field for breadcrumb context.

`__resetCrashlyticsInstanceForTests()` exposed as a test-only escape
hatch (resets the cached singleton between tests).

Tested with 17 cases covering happy path (every method's correct
SDK call shape), failure mapping (every async reject and every sync
throw mapped to the right error code), and native-unavailable
sticky-cache semantics (subsequent calls also fail; `crash()` falls
back to a synchronous throw with the right error message).

#### 4. DI container wiring

`src/presentation/di/container.ts`:

- New `crashReporting: CrashReportingService` slot on `Container`.
- New `buildCrashReportingService()` builder gated on
  `isFirebaseConfigured()` — real adapter when configured, fake
  otherwise. Lazy-required from each branch so a fakes-only build
  never pulls `@react-native-firebase/crashlytics` into the bundle.
- Wired in both branches of `buildContainer()` (Firebase-configured
  AND fakes-only).

`src/presentation/di/ContainerProvider.tsx`:

- New `useCrashReporting()` sibling hook alongside
  `useUseCases()` / `useBackgroundGeolocation()` /
  `useNavigationSdk()` / `usePushNotificationService()`. Same
  throw-outside-provider contract.
- Documented mounting rule: consumed exclusively by
  `useCrashReportingLifecycle` (sub-turn 3b) and the
  `<ContainerProvider/>`-mount Crashlytics-transport wiring (also
  sub-turn 3b — the runtime attachment hop). Screens and view-models
  do NOT consume directly.

Re-exported from `src/presentation/di/index.ts`.

`src/shared/testing/TestContainerProvider.tsx`:

- New `crashReporting?: FakeCrashReportingService` optional
  override prop. Defaults to a fresh fake instance if omitted.

#### 5. `Logger` multi-transport refactor

`src/shared/logger/Logger.ts` — extends the existing single-transport
architecture to support a list of transports. Two new exports:

- **`ConsoleTransport`** — extracted from the old inline anonymous
  class, now exported so callers can reference it (e.g. the
  Crashlytics transport's no-op-on-non-composite test asserts the
  default isn't the bare `ConsoleTransport`).
- **`CompositeTransport`** — fans `log()` to a list of children
  sequentially. Per-transport failure isolation: a child that throws
  is silently swallowed so siblings still run. Mutable list:
  `add(t)`, `remove(t)`, `list()`. `add` is duplicate-tolerant
  (idempotent); `remove` is no-op-tolerant.

`Logger` itself gains:

- **`addTransport(transport)`** — attaches an additional transport
  to the underlying pipeline. Only valid if the logger was
  constructed with a `CompositeTransport`. No-op otherwise (so a
  custom-built `Logger` with a single transport doesn't surprise
  its callers).
- **`removeTransport(transport)`** — symmetric detach. Same
  composite-only semantics.

The singleton `LOG` is now constructed with a
`CompositeTransport([new ConsoleTransport()])`. The
`ConsoleTransport` is wired immediately at module load (so dev /
test logs always reach Metro / Xcode). The `CrashlyticsLogTransport`
is attached LATER, at runtime, from `<ContainerProvider/>` once the
DI container resolves (sub-turn 3b).

Tested with 11 cases covering composite fan-out + isolation
(throwing child doesn't block siblings; `list()` snapshot doesn't
let caller mutation leak; `add` ignores duplicates; `remove` is
no-op-tolerant; iteration uses a snapshot so mid-emit list
mutation doesn't break it), `addTransport` / `removeTransport` on
the singleton (subsequent `LOG.*` reaches the new transport;
`extend()` preserves the pipeline so children share the composite;
`removeTransport` detaches), and sanitization (meta with email is
redacted before reaching any transport).

#### 6. `CrashlyticsLogTransport`

`src/shared/logger/CrashlyticsLogTransport.ts` — implements
`LogTransport`. Two responsibilities:

- **Breadcrumb buffer** — every level (debug / info / warn / error)
  flows into `crashReporting.log('[scope] message')`. The SDK
  retains the last ~64 messages and includes them in any subsequent
  crash report. This means when a crash actually happens, the
  report carries the most recent app context (which screen, which
  mutation, which network call).
- **Non-fatal error capture** — at `'error'` level, if `meta` is an
  `Error` instance (or has an `error` field that is), the transport
  additionally fires `crashReporting.recordError(error, scope)`.
  Each recorded error appears in the Firebase Console as a separate
  issue, NOT as a crash — they're crash-grouped non-fatal captures
  that help triage degraded experiences without a crash.

**Triggering rule (kickoff decision (b))**:
Always call `log()` (every level). Call `recordError()` ONLY if
level === `'error'` AND we can extract a real `Error` from meta.
Constructed Errors lose the original stack, so we don't manufacture
one from the scope+message. The global JS error handler (sub-turn
3b) covers the case where an uncaught throw happens outside any
logger call.

**Async-fire-and-forget**: the Crashlytics service methods are
`Promise<Result<void, NetworkError>>`. The transport's `log(...)`
must be synchronous (`LogTransport` contract) — and logger calls
are deeply embedded in code paths that can't easily await. So we
fire the promise and intentionally do NOT await it. The compiler
warning is suppressed via the explicit `void` operator. Telemetry
must never break user flow; failures are silently swallowed.

`extractError(meta)` helper handles three common call-site shapes:
(1) `logger.error('scope', e)` where `e` is the Error directly,
(2) `logger.error('scope', { error: e, ...context })` where the
Error is nested, (3) `logger.error('scope', { code, message, ... })`
where there's no actual Error (returns `null` and the transport
skips `recordError` — breadcrumb still runs).

Tested with 9 cases covering breadcrumb fan-out (every level
formats with `[scope]` prefix), recordError trigger rules (Error
direct / nested / not present, error-level only, undefined meta),
and failure isolation (rejection from `recordError` or `log`
doesn't throw out of the synchronous `log()` method).

#### 7. Native config

`app.config.ts` — Crashlytics plugin block. The Firebase plugin
spread (gated on `iosFirebaseConfig && androidFirebaseConfig`) now
lists both `'@react-native-firebase/crashlytics'` and
`'./plugins/withCrashlyticsUploadSymbols.js'` alongside the
existing `'@react-native-firebase/app'` and
`'./plugins/withFirebasePodfileFix.js'`. Order matches legacy's
`app.config.js`.

`plugins/withCrashlyticsUploadSymbols.js` — ported from legacy. Adds
a Release-only `[firebase_crashlytics] Upload dSYMs` Xcode build
phase that runs `${PODS_ROOT}/FirebaseCrashlytics/run`. Idempotent:
skips if a phase whose name contains `firebase_crashlytics` already
exists. Only delta from legacy: import path
(`@expo/config-plugins` vs. legacy's `expo/config-plugins`) — the
rewrite's other plugins all use the scoped form.

#### 8. Jest setup

`jest.setup.ts` — global mock for `@react-native-firebase/crashlytics`.
The mock returns the SAME singleton instance on every call (the SDK
memoizes natively, our mock memoizes in JS) so per-test mock setup
via `(crashlytics().log as jest.Mock).mockImplementation(...)` flows
through to subsequent calls.

The SDK's `crash()` is a `jest.fn()` here — it does NOT crash the
test runner — so dev "Force crash" tests can assert it fired
without taking the Jest worker down (when those tests land in
sub-turn 3c).

Mock surface mirrors the real SDK module shape:
`isCrashlyticsCollectionEnabled` (boolean), `log` (sync void),
`recordError` (sync void), `setUserId` (Promise<null>),
`setAttribute` (Promise<null>), `setAttributes` (Promise<null>),
`setCrashlyticsCollectionEnabled` (Promise<null>), `crash` (sync
void), plus the four less-used methods (`checkForUnsentReports`,
`deleteUnsentReports`, `didCrashOnPreviousExecution`,
`sendUnsentReports`) that the adapter doesn't call but that the SDK
typings declare.

## What's out (deferred to sub-turns 3b / 3c)

- `useCrashReportingLifecycle` hook — boots the SDK on AppContent
  mount: `setCollectionEnabled(__DEV__ ? false : true)` immediately,
  `setUserId(uid)` after auth resolves, `setAttributes({role, env})`
  to tag reports for triage. ESLint boundaries-rule override added
  for the new file (presentation-layer SDK seam).
- AppContent global JS error handler — `ErrorUtils.setGlobalHandler`
  wrapper that forwards uncaught JS errors via
  `crashReporting.recordError(error)` before re-chaining to the
  previous handler. Mirrors legacy's pattern verbatim.
- `<ContainerProvider/>` runtime attachment hop —
  `useEffect(() => { LOG.addTransport(new CrashlyticsLogTransport(c.crashReporting)); ... }, [c])`
  to wire the transport once the DI container resolves.
- Force-crash entry point — dev-only hidden button somewhere
  reachable from the app (likely on a future `UserProfile` screen
  in Phase 10 cleanup; for now we'll add it to a reachable
  developer-tools location in sub-turn 3c). Calls `crashReporting.crash()`
  to verify the dSYM upload + Firebase Console pipeline end-to-end.
- Manual smoke test — toggle `setCollectionEnabled(true)` in dev,
  trigger a force crash, confirm the report appears in Firebase
  Console with the right user id + service-area custom key. Verify
  on both iOS (real device) and Android (emulator OK for crash; iOS
  sim may be blocked by debugger interception per the SDK doc note).
- ErrorBoundary component — separate UI concern (the integration
  with Crashlytics is one line; the bulk of the work is the
  fallback view). Deferred to Turn 6 cleanup grab-bag.

## Risks surfaced (still Phase 9 scope)

### Boundaries-rule warnings (still Phase 9 turn 1 scope)

`eslint-plugin-boundaries` continues to emit informational warnings
about the deprecated `boundaries/element-types` rule name. Lint
still passes. Tracked for a future cleanup turn.

### `npm run prebuild` required before next native build

The `'@react-native-firebase/crashlytics'` plugin block + the
custom `withCrashlyticsUploadSymbols` plugin only land via
`expo prebuild`. Without it, the Crashlytics SDK is still installed
(per `package.json`) but the iOS dSYM upload phase isn't wired and
the Android FCM `firebase_crashlytics_collection_enabled` manifest
meta-data is missing. The runtime toggle from
`useCrashReportingLifecycle` (sub-turn 3b) will still work in dev /
fakes mode; production crash uploads need the prebuild.

Sequence:

1. `npm run prebuild` — applies the new plugin block.
2. `(cd ios && pod install)` — picks up the
   `FirebaseCrashlytics` Pod (auto-linked, no manual entry).
3. `npm run ios` / `npm run android` — should boot with the new
   entitlement + manifest meta in place.

### Test count climb

The cumulative Phase 9 test footprint is +193 tests over the close
of Phase 8 (160/1268 → 173/1467 across turns 1, 2, and 3a). The
test suite still completes in ~37s on the sandbox, so no CI signal
hit yet. If sub-turn 3b doubles the lifecycle-hook test count we
should keep an eye on it.

## Acceptance

`npm run typecheck` + `npm run lint` + `npm run format:check` +
`npm run test` all green. **173 test suites / 1467 tests** (+4
suites / +76 tests over Phase 9 turn 2's 169/1391 baseline — at the
high end of the kickoff's "+4 to +6 suites" estimate band but every
test maps to a documented behavior).

End-of-sub-turn-3a acceptance criteria, all met:

1. ✅ `@react-native-firebase/crashlytics@^24.0.0` installed,
   matching the existing RNFirebase 24.x stack.
2. ✅ `plugins/withCrashlyticsUploadSymbols.js` ported from legacy.
3. ✅ Crashlytics plugin block in `app.config.ts`, gated on
   Firebase config presence alongside the other Firebase plugins.
4. ✅ `CrashReportingService` domain interface defined; six methods
   covering collection toggle / user id / attributes / record-error
   / log breadcrumb / sync force-crash.
5. ✅ `FakeCrashReportingService` mirrors the interface 1:1 with
   seed/spy/failNext/reset seams; 18 tests.
6. ✅ `FirebaseCrashlyticsAdapter` implements against the real SDK
   with three-state cache + sticky failure mode + 5 mapped error
   codes; 17 tests.
7. ✅ DI container `crashReporting` slot wired in both branches.
   `useCrashReporting()` sibling hook exposed.
   `TestContainerProvider` accepts optional `crashReporting`
   override.
8. ✅ `Logger` extended to support multi-transport composition via
   `CompositeTransport` + `addTransport` / `removeTransport`. Old
   single-transport behavior preserved (custom-built loggers with a
   non-composite transport silently no-op `addTransport`).
9. ✅ `CrashlyticsLogTransport` fans every level into the
   breadcrumb buffer + records non-fatal errors at `'error'` level
   when meta carries a real `Error`; 9 tests.
10. ✅ Global jest mock for `@react-native-firebase/crashlytics`.
11. ✅ `docs/PHASE_9_TURN_3.md` written (this file).
12. ✅ `CLAUDE.md` updated to reflect Phase 9 turn 3 sub-turn 3a
    close.
13. ✅ `npm run verify` green at the end of the sub-turn (each step
    individually under the sandbox's 45s bash timeout; the combined
    pipeline exceeds the timeout and is verified piecemeal).

Manual smoke (force a crash in dev, verify Firebase Console report)
is pending sub-turn 3c — deliberate; sub-turn 3a is wiring-only and
has no end-to-end behavior to smoke yet.

## Files added / touched this sub-turn

**Added:**

- `src/domain/services/CrashReportingService.ts`
- `src/data/services/FirebaseCrashlyticsAdapter.ts` + tests (17)
- `src/shared/testing/FakeCrashReportingService.ts` + tests (18)
- `src/shared/logger/CrashlyticsLogTransport.ts` + tests (9)
- `src/shared/logger/__tests__/Logger.test.ts` (11 — new file
  exercises the existing + extended logger surface)
- `plugins/withCrashlyticsUploadSymbols.js`
- `docs/PHASE_9_TURN_3.md` — this file

**Touched:**

- `app.config.ts` — Crashlytics plugin block.
- `jest.setup.ts` — global Crashlytics SDK mock.
- `package.json` / `package-lock.json` — Crashlytics dependency.
- `src/domain/services/index.ts` — barrel re-export for
  `CrashReportingService`.
- `src/presentation/di/container.ts` — `crashReporting` slot,
  `buildCrashReportingService`, both-branch wiring.
- `src/presentation/di/ContainerProvider.tsx` — `useCrashReporting`
  sibling hook.
- `src/presentation/di/index.ts` — barrel re-export.
- `src/shared/logger/Logger.ts` — multi-transport refactor.
- `src/shared/logger/index.ts` — barrel re-exports for
  `CompositeTransport`, `ConsoleTransport`, `CrashlyticsLogTransport`.
- `src/shared/testing/TestContainerProvider.tsx` — optional
  `crashReporting` override prop.
- `src/shared/testing/index.ts` — barrel re-export for
  `FakeCrashReportingService` + types.

**Incidental prettier reflow** (not turn-3a behavior — pre-existing
formatting drift surfaced by `prettier --check .`; reflowed in the
same commit since `npm run verify` gates on it):

- `src/data/dto/RideDoc.ts`
- `src/data/mappers/rideMapper.ts`
- `src/data/mappers/__tests__/rideMapper.test.ts`
- `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
