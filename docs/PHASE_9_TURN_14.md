# Phase 9 Turn 14 — RNFirebase Crashlytics modular API migration

**Closed:** May 4, 2026
**Commits:** (this turn) on top of `a03dbde` (Turn 13 close)

## Summary

Migrated `FirebaseCrashlyticsAdapter` from the deprecated namespaced
default-import shape (`import crashlytics from
'@react-native-firebase/crashlytics'` + `crashlytics().setUserId(uid)`)
to the modular API exposed by RNFirebase 24
(`import { getCrashlytics, setUserId, ... }` + `setUserId(instance,
uid)`). Closes the runtime deprecation warnings the user observed at
boot and on every Crashlytics call.

## Background — what the kickoff thought, what was actually true

The kickoff scope described Turn 14 as "RNFirebase modular API
migration — the rewrite uses the namespaced form throughout" and listed
ten data-layer adapters (Auth / User / ServiceArea / Ride / Location /
Vehicle / Storage / CloudFunctions plus Jest mocks) for migration.

A first orientation pass (`grep -rnE
"(\bfirestore\(\)|\bauth\(\)|\bstorage\(\)|\bfunctions\([^)]*\)\.)"
src/`) returned **zero** namespaced call sites, all default-imported
namespaces (`import firestore from ...`) absent, and every
`@react-native-firebase` import in `src/data/repositories/` already
uses modular named imports — `getFirestore`, `doc`, `getDoc`,
`onSnapshot`, `query`, `where`, `arrayUnion`, `writeBatch`, `getAuth`,
`getStorage`, `getFunctions(getApp(), 'us-east1')`. The kickoff scope
was already shipped upstream of Turn 13 without being recorded.

The outcome was initially mis-reported as a no-op close. Then the user
shared real-device boot logs with a stack of deprecation warnings
(`setCrashlyticsCollectionEnabled`, `log`, `setUserId`,
`setAttributes`, plus an unattributed `getApp()` warning that fires
once before each Crashlytics block) — proof that the migration was
NOT complete.

The actual remaining namespaced surface was the Crashlytics adapter:

```ts
// src/data/services/FirebaseCrashlyticsAdapter.ts (pre-Turn-14)
import crashlytics from '@react-native-firebase/crashlytics';
//   ↓
_instance = crashlytics(); // namespaced accessor
instance.setUserId(uid); // namespaced method call
instance.recordError(error, name);
instance.log(message);
instance.crash();
```

Each of those calls fired a v22+ deprecation warning. The
unattributed `getApp()` warning is a side effect of the namespaced
`crashlytics()` accessor itself internally resolving the default
Firebase app — so eliminating the Crashlytics namespaced surface also
eliminates that warning.

The kickoff didn't mention Crashlytics because Phase 9 Turn 3a's JSDoc
(visible in the adapter source) explicitly justified the namespaced
choice at the time ("Direct top-level import is fine here: the global
jest mock in `jest.setup.ts` replaces the native module so unit tests
don't fail at module load. The legacy yeride wrapper used a lazy
`require()` ..."). That justification is still accurate but doesn't
account for the v22+ deprecation tax — which is what motivated this
turn.

## Pre-checklist outcome

The kickoff's pre-checklist landed on (c) "Close Turn 14 as no-op +
correct CLAUDE.md" based on the initial mis-reading. The user's real-
device warnings re-scoped the turn to the Crashlytics migration; no
re-asked checklist questions because the migration shape was
mechanical (named imports + `(instance, ...)` calling convention) and
the blast radius was confirmed small (two source files + the global
mock).

## What shipped

### 1. `src/data/services/FirebaseCrashlyticsAdapter.ts`

Replaced the default import with seven named modular imports plus the
`Crashlytics` type:

```ts
import {
  crash as crashlyticsCrash,
  getCrashlytics,
  log as crashlyticsLog,
  recordError as crashlyticsRecordError,
  setAttributes as crashlyticsSetAttributes,
  setCrashlyticsCollectionEnabled,
  setUserId as crashlyticsSetUserId,
  type Crashlytics,
} from '@react-native-firebase/crashlytics';
```

Aliased five of the seven (`crash`, `log`, `recordError`,
`setAttributes`, `setUserId`) to avoid name collisions with the
adapter's own method names — `setCrashlyticsCollectionEnabled` is
already unique and `getCrashlytics` is the accessor. The
`CrashReportingService` interface method names match a few of the SDK
function names by design (so the abstraction reads naturally), and
TypeScript correctly resolves the aliases without ambiguity.

The lazy three-state singleton cache is preserved verbatim — same
`_instance: Crashlytics | null | undefined` shape, same try/catch
around the accessor, same sticky-failure semantics. Only the internal
accessor call changed (`crashlytics()` → `getCrashlytics()`) and the
`CrashlyticsModule` type alias was dropped in favor of the directly
imported `Crashlytics` type.

Each method body's call shape changed:

| Method                 | Pre-Turn-14                                               | Post-Turn-14                                               |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `setCollectionEnabled` | `await instance.setCrashlyticsCollectionEnabled(enabled)` | `await setCrashlyticsCollectionEnabled(instance, enabled)` |
| `setUserId`            | `await instance.setUserId(uid)`                           | `await crashlyticsSetUserId(instance, uid)`                |
| `setAttributes`        | `await instance.setAttributes(attrs)`                     | `await crashlyticsSetAttributes(instance, attrs)`          |
| `recordError`          | `instance.recordError(error, name)`                       | `crashlyticsRecordError(instance, error, name)`            |
| `log`                  | `instance.log(message)`                                   | `crashlyticsLog(instance, message)`                        |
| `crash`                | `instance.crash()`                                        | `crashlyticsCrash(instance)`                               |

The Result-shaped failure handling, the `netError` wrapper, the empty-
string-clears-identity convention on `setUserId(null)`, the dev-only
synchronous throw on `crash()` when the SDK is unavailable — all
preserved unchanged. Error code mapping is byte-identical:

- `crashlytics_native_unavailable` (the only string change is the
  inner reason: `'crashlytics() returned null'` → `'getCrashlytics()
returned null'` on three of the four occurrences; the fourth is
  literal in the throw message)
- `crashlytics_set_collection_enabled_failed`
- `crashlytics_set_user_id_failed`
- `crashlytics_set_attributes_failed`
- `crashlytics_record_error_failed`
- `crashlytics_log_failed`

JSDoc rewritten to describe the modular API and reference Turn 14;
the legacy yeride parity note stays.

### 2. `jest.setup.ts` global mock

Pre-Turn-14 the mock factory exposed only the namespaced default:

```ts
jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  default: jest.fn(() => mockCrashlyticsInstance),
}));
```

Post-Turn-14 the mock exposes both surfaces. The legacy `default` is
preserved for any consumer that hasn't migrated (today: none — the
adapter was the only caller). The modular named functions each
delegate to the singleton's per-method `jest.fn()` so the existing
test assertion shape (`expect(sdk.setUserId).toHaveBeenCalledWith(...)`)
keeps working in the adapter's test file:

```ts
jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  default: jest.fn(() => mockCrashlyticsInstance),
  getCrashlytics: jest.fn(() => mockCrashlyticsInstance),
  setCrashlyticsCollectionEnabled: jest.fn((c, enabled) =>
    c.setCrashlyticsCollectionEnabled(enabled),
  ),
  setUserId: jest.fn((c, uid) => c.setUserId(uid)),
  setAttribute: jest.fn((c, name, value) => c.setAttribute(name, value)),
  setAttributes: jest.fn((c, attrs) => c.setAttributes(attrs)),
  recordError: jest.fn((c, error, name) => c.recordError(error, name)),
  log: jest.fn((c, message) => c.log(message)),
  crash: jest.fn((c) => c.crash()),
  // + checkForUnsentReports / deleteUnsentReports /
  //   didCrashOnPreviousExecution / sendUnsentReports
  //   (unused today; included for completeness)
}));
```

The header JSDoc was rewritten to describe the modular API surface,
the per-method delegation invariant, and the per-test override
patterns. The pre-Turn-14 namespaced-only example was replaced with
both modular accessor patterns:

```ts
// Per-test usage (modular):
import { getCrashlytics } from '@react-native-firebase/crashlytics';
const c = getCrashlytics();
(c.recordError as jest.Mock).mockClear();
expect(c.recordError).toHaveBeenCalledWith(expect.any(Error), 'Foo');

// Native-unavailable simulation:
import { getCrashlytics } from '@react-native-firebase/crashlytics';
(getCrashlytics as jest.Mock).mockImplementationOnce(() => {
  throw new Error('native module not found');
});
```

### 3. `src/data/services/__tests__/FirebaseCrashlyticsAdapter.test.ts`

The test file's accessor reference flipped from the namespaced default
to `getCrashlytics`:

```ts
// Pre-Turn-14
import crashlytics from '@react-native-firebase/crashlytics';
const crashlyticsMock = crashlytics as unknown as jest.Mock;
const sdk = crashlytics() as unknown as { ... };

// Post-Turn-14
import { getCrashlytics } from '@react-native-firebase/crashlytics';
const getCrashlyticsMock = getCrashlytics as unknown as jest.Mock;
const sdk = getCrashlytics() as unknown as { ... };
```

The two `crashlyticsMock.mockClear()` calls in `beforeEach` blocks
became `getCrashlyticsMock.mockClear()`. The
`crashlyticsMock.mockImplementationOnce(() => { throw ... })` in the
"native unavailable" describe block became
`getCrashlyticsMock.mockImplementationOnce(...)` — the critical
behavioral change here is that pre-Turn-14 the test was simulating
the namespaced default throwing, but the adapter was already calling
`crashlytics()` (which is `default` — same thing pre-migration). Post-
Turn-14, the adapter calls `getCrashlytics()`, so the throwing-
accessor simulation has to target `getCrashlytics`, not the
namespaced default. The test would have been a false-positive without
this update.

Two new regression tests in a new describe block
`'FirebaseCrashlyticsAdapter — modular API wiring'`:

1. **`uses getCrashlytics() (modular) to resolve the singleton`** —
   asserts `getCrashlyticsMock` was called once after a
   `setCollectionEnabled` invocation. Catches accidental regression
   to the namespaced default-import accessor (which would NOT call
   the modular `getCrashlytics` mock).

2. **`passes the resolved instance as the first argument to modular
functions`** — drives `setUserId(uid())`, asserts
   `sdk.setUserId.toHaveBeenCalledWith(TEST_UID)` (the modular-mock
   delegation strips the instance arg and forwards just the domain
   args to the singleton's per-method jest.fn(); so this assertion
   shape remains stable across the migration). Combined with assertion
   #1, this proves the modular wiring is correct end-to-end.

The pre-existing 17 tests across three describe blocks all pass
unchanged.

## Architecture invariants preserved

- `CrashReportingService` interface unchanged (six methods + `crash`)
- `FakeCrashReportingService` (in `@shared/testing`) unchanged
- DI container (`src/presentation/di/container.ts`) unchanged — still
  resolves `FirebaseCrashlyticsAdapter` in production builds, fake in
  test/dev builds
- `useCrashReportingLifecycle` hook unchanged
- `CrashlyticsLogTransport` unchanged
- `useGlobalErrorHandler` hook unchanged
- `<DevToolsSection/>` (force-crash entry point) unchanged
- Three-state singleton cache + sticky-failure semantics preserved
- `__resetCrashlyticsInstanceForTests` test escape hatch preserved

## Acceptance

- `npm run typecheck` ✅
- `node node_modules/eslint/bin/eslint.js .` ✅ (no output)
- `npm run format:check` ✅
- Test suite (chunked across 8 patterns to fit the sandbox bash
  timeout): **187 suites / 1621 tests passing** (+0 suites / +2
  tests over Turn 13's 187/1619 — the two new modular-wiring
  regression guards in
  `FirebaseCrashlyticsAdapter.test.ts`).
- `FirebaseCrashlyticsAdapter.test.ts` standalone: 19 tests passing
  (was 17; +2 for the new describe block).

## Smoke checklist (user-driven)

After this commit lands, re-run `npm run start --reset-cache` and
trigger a sign-in / sign-out cycle. The deprecation warnings
should be gone:

- `setCrashlyticsCollectionEnabled` (fired on app boot via
  `useCrashReportingLifecycle`'s one-shot collection toggle) — gone
- `setUserId` (fired on auth state transition) — gone
- `setAttributes` (fired on auth state transition; carries `role` +
  `env` keys) — gone
- `log` (fired by `CrashlyticsLogTransport` on every `LOG.*` call
  with a transport attached) — gone
- The unattributed `getApp()` warning that fires once before each
  Crashlytics block — gone (was a side effect of the namespaced
  accessor's internal app resolution)

If any of these remain after a clean reload, the cause is upstream
of the adapter — most likely a stale Metro cache. Hard-reload via
the dev menu (Cmd+R) or `npm run start --reset-cache`.

The "Force crash" button in the dev tools section still works
identically (Debug-build limitation from the Turn 3c smoke is
unchanged: RN's @try/@catch around `RCT_EXPORT_METHOD` in Debug
swallows the @throw from `crash()` and routes to the redbox; Release
builds will let the @throw propagate to the OS crash handler).

## Native rebuild

**Not required.** Pure JS-side refactor; same `@react-native-firebase/
crashlytics@24.x` package; no plugin changes; no native config
changes; no DI container changes.

## Rollback

`git revert <this commit>` is one commit deep and restores the
pre-Turn-14 namespaced shape (deprecation warnings return). RNFirebase
24 still ships the namespaced surface in v24.0.0; v25 is the version
that drops it.

## Follow-ups (Phase 9 turn 15+ pending list)

- **Receipt PDF** (deferred from Turn 13's close) — generate a
  printable PDF of the rider's RideReceipt
- **NavigationSdk teardown telemetry** — 3 LOG.warn → LOG.error
  flips at NavigationSdkClient L387 / L415 / L428 (cleanup-best-
  effort sites that Turn 11's audit classified as stays-warn but
  Turn 12's close re-flagged for telemetry once field signals
  arrive)

The kickoff's broader "Firestore modular API migration" turned out
to be already complete before Turn 14 started — no follow-up action
needed for the Auth / User / ServiceArea / Ride / Location / Vehicle
/ Storage / CloudFunctions adapters or their per-suite test mocks.
