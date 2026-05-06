# Phase 9 Turn 17 — Promote BackgroundGeolocation + Navigation SDK seam types from `@data` to `@domain`

**Status:** ✅ closed.

## Why

Two coexisting patterns for SDK adapter types in the codebase:

- **`CrashReportingService`** (Phase 9 turn 3a) and
  **`PushNotificationService`** (Phase 9 turn 2a) put the interface in
  `src/domain/services/`, the adapter in `src/data/services/`. The
  interface is the single source of truth; the adapter and the
  in-memory fake both `implements` it. `Container.<seam>` is typed as
  the interface (no `Real | Fake` union).

- **`BackgroundGeolocationClient`** (Phase 7 turn 1) and
  **`NavigationSdkClient`** (Phase 8 turn 1) co-located their domain-
  shaped types with the adapter in `src/data/services/`. Presentation
  consumed those types via `from '@data/services/<X>Client'`, gated by
  five explicit boundaries-rule override entries in `eslint.config.js`.

This turn formalizes the Crashlytics / Push pattern as the project
rule and applies it retroactively. After this turn, the boundaries-
rule override list shrinks from 5 entries to 1 (`container.ts` —
still required for the lazy `require()` of concrete adapter classes
in the composition root).

Pure refactor — no behavior change, no new tests, no test-count delta.
Existing test coverage exercises both adapters and both fakes; the
interface change is structurally invisible to the consumer's tests.

## Pre-checklist outcomes

All four pre-checklist questions landed on the Recommended option:

1. **Interface or type-alias module?** Full `interface
BackgroundGeolocationService { ... }` and `interface
NavigationService { ... }` in `src/domain/services/`. Mirrors
   `CrashReportingService` shape verbatim.

2. **`Container.bgGeolocation` / `Container.navigationSdk` types
   flip from `Real | Fake` union to just the interface.** Yes —
   that's the win.

3. **Override deletions in `eslint.config.js`:** removed
   `useGpsLifecycle.ts`, `useGpsStore.ts`, `usePermissionRefresh.ts`,
   `useNavigationSdkConnector.ts`,
   `useDriverNavigationViewModel.ts`. Kept `container.ts` (still
   imports concrete classes lazily for instantiation).

4. **CLAUDE.md doc placement:** new "SDK seams" subsection under
   "Code conventions" with a 3-line pattern statement pointing at
   `CrashReportingService.ts` as the canonical example.

## What shipped

### New domain interfaces (2 files)

- `src/domain/services/BackgroundGeolocationService.ts` — interface +
  6 type aliases (`BgLocationEvent`, `BgGeofenceEvent`,
  `BgGeofenceAction`, `BgPermissionStatus`,
  `BackgroundGeolocationClientInitArgs`, plus the interface itself).
- `src/domain/services/NavigationService.ts` — interface + 8 type
  aliases (`NavRouteStatus`, `NavInitError`, `NavArrivalEvent`,
  `NavWaypoint`, `NavSetDestinationsArgs`, `NavTermsResult`,
  `NavigationListenerSetters`, plus the interface itself).
- `src/domain/services/index.ts` — re-exports the new types alongside
  `CrashReportingService` and `PushNotificationService`.

### Adapters now `implements` the interfaces (2 files)

- `src/data/services/BackgroundGeolocationClient.ts` — local type
  definitions removed (now imported from `@domain/services`); class
  declares `implements BackgroundGeolocationService`.
- `src/data/services/NavigationSdkClient.ts` — same; class declares
  `implements NavigationService`. The internal listener-bag field is
  typed against a private `SdkNavigationListenerSetters` alias (the
  SDK-narrow shape) so internal calls like
  `this.listeners.setOnArrival(this.handleArrival)` keep their
  `SdkArrivalEvent` type info. The public `setController` signature
  takes `controller: unknown` (per the interface) and narrows
  internally with a single `as` cast at the boundary.

### Fakes now `implements` the interfaces (2 files)

- `src/shared/testing/FakeBackgroundGeolocationClient.ts` — flips
  imports from `@data/services/...` to `@domain/services`; class
  declares `implements BackgroundGeolocationService`. Surface
  unchanged.
- `src/shared/testing/FakeNavigationSdkClient.ts` — same; declares
  `implements NavigationService`.

### Container interface flip (1 file)

- `src/presentation/di/container.ts`:
  - `Container.bgGeolocation: BackgroundGeolocationService` (was
    `BackgroundGeolocationClientType | FakeBackgroundGeolocationClientType`).
  - `Container.navigationSdk: NavigationService` (was
    `NavigationSdkClientType | FakeNavigationSdkClientType`).
  - Static `import type` of the data-layer concrete classes removed
    (`BackgroundGeolocationClientType` / `NavigationSdkClientType`).
    The lazy `require('@data/services/...')` calls in the
    `build*Client()` builder functions remain — they're string-literal
    module paths, not `from` imports, and the cast types reference
    the new domain interfaces.
  - Removed unused imports of `FakeBackgroundGeolocationClient` /
    `FakeNavigationSdkClient` from `@shared/testing` (the union types
    they backed are gone).

### Presentation imports flipped (5 files)

Every consumer that previously type-imported from `@data/services/...`
now imports from `@domain/services`:

- `src/presentation/hooks/useGpsLifecycle.ts` — `BackgroundGeolocationService`
  alias replaces the `Real | Fake` union.
- `src/presentation/hooks/usePermissionRefresh.ts` — same.
- `src/presentation/stores/useGpsStore.ts` — `BgGeofenceEvent` /
  `BgLocationEvent` / `BgPermissionStatus` from `@domain/services`.
- `src/presentation/features/driver/hooks/useNavigationSdkConnector.ts`
  — `NavigationService` alias replaces the `Real | Fake` union.
- `src/presentation/features/driver/view-models/useDriverNavigationViewModel.ts`
  — same.

### Test imports flipped (4 files)

- `src/presentation/hooks/__tests__/useGpsLifecycle.test.tsx`
- `src/presentation/stores/__tests__/useGpsStore.test.ts`
- `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`
- `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`

### ESLint boundaries-rule override list shrunk (1 file)

- `eslint.config.js` second file-pattern block now lists exactly:
  test files (`**/__tests__/...` + `**/*.test.{ts,tsx}`),
  `src/shared/testing/**`, and
  `src/presentation/di/container.ts`. The five SDK-seam-consumer
  entries are gone.

### CLAUDE.md (1 file)

- New "SDK seams: domain interface + data adapter + fake" subsection
  under "Code conventions". Three-line pattern statement plus a
  five-step recipe for adding a new SDK seam, pointing at
  `CrashReportingService.ts` as the canonical example.

## Acceptance

- `npm run verify` green; test count unchanged (pure refactor).
- `eslint.config.js` second file-pattern block lists exactly: tests,
  `shared/testing/**`, and `container.ts` — three entries.
- `git grep "from '@data/services/BackgroundGeolocationClient'"
src/presentation/` returns nothing.
- `git grep "from '@data/services/NavigationSdkClient'"
src/presentation/` returns nothing.

## Out of scope

- The PDF / image-picker / web-browser seams (Phase 9 turn 16's
  PDF feature uses `expo-print` + `expo-sharing` + `expo-file-system`
  through React-Native module APIs, not via a class-adapter; same for
  `expo-image-picker` in the vehicle photo flow). Those are
  function-style seams, not class adapters; the interface-promotion
  pattern doesn't apply 1:1.
- `App.tsx`'s `<StripeProvider/>` / `<NavigationProvider/>` mounts
  (React-context-provider seams, not class-adapter seams).
- `useStripe()` in `useAddPaymentMethodViewModel` (consumed via
  Stripe SDK's React hook directly — the
  `@stripe/stripe-react-native` provider is the seam, not a class).
- `useDriverStatusStore`'s server-state mirror (Phase 4 turn 5
  internal pattern, not an SDK seam).
