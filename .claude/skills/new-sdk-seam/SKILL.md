---
name: new-sdk-seam
description: Use when wrapping a native SDK or external service (GPS, navigation, push, Stripe, crash reporting, etc.) behind the YeRide-Next domain-interface + data-adapter + in-memory-fake seam, or wiring a new service into the DI container.
---

# New SDK Seam

## Overview

Every native-SDK / external-service boundary in YeRide-Next follows one shape so the SDK type never
leaks past the data layer: **interface in `@domain/services`**, **real adapter in `@data/services`**,
**in-memory fake in `@shared/testing`** — all `implements` the same interface. `Container.<seam>` is
typed as the interface (no `Real | Fake` union in presentation). This skill is the recipe; the
canonical rules live in `CLAUDE.md` (§"SDK seams") and `docs/CONTRIBUTING.md`. Existing seams to copy
from: `BackgroundGeolocationClient`, `NavigationSdkClient`, `StripeServerService`,
`PushNotificationService`, `CrashReportingService`.

## When NOT to seam — the single-call escape hatch

A view-model may import an SDK **directly** only if ALL THREE hold (else seam it):

- **(a)** one-shot call from a single user action, resolves to one `Promise<Result>` — no listener stream.
- **(b)** no continuous permission state to mirror (a one-shot `request*PermissionsAsync()` per tap is fine).
- **(c)** trivially `jest.mock`-able module-level functions — no provider, no native bridge.

Qualifying today: `expo-print`/`expo-sharing`/`expo-file-system`, `expo-image-picker`,
`expo-web-browser`. If you escape via the hatch, add a JSDoc note on the VM naming which condition lets it skip the seam.

## Steps (do them in this order)

1. **Interface first** — `src/domain/services/<X>Service.ts`. Define the interface + any
   domain-shaped types (no SDK types). Re-export from the barrel `src/domain/services/index.ts`.
2. **Fake second** — `src/shared/testing/Fake<X>.ts`, `implements <X>Service`. Building the fake
   before the adapter keeps the contract honest.
3. **Adapter third** — `src/data/services/<X>Adapter.ts`, `implements <X>Service`. Translate SDK
   types → domain shapes at the boundary; keep the SDK type in a private field.
4. **Wire the container** — in `src/presentation/di/container.ts`, type `Container.<x>: <X>Service`
   and construct the real adapter via **lazy `require()`** (inside `isFirebaseConfigured()` / the
   real-build branch), fake otherwise. If presentation needs direct access, add a sibling `use<X>()`
   hook on `ContainerProvider`; otherwise wrap it in a use case.
5. **Test override slot** — add an optional override to `src/shared/testing/TestContainerProvider.tsx`.

## Rules that bite

- **Subscriptions return a synchronous unsubscribe**, never a `Promise`. (Explicitly-fixed footgun.)
- **Untranslatable SDK type?** Accept `unknown` in the interface and narrow with a one-line cast in
  the adapter (e.g. `setController({ controller: unknown })`). Don't let the SDK type into the interface.
- **Lazy `require()` is ONLY for `container.ts`.** Everywhere else uses static imports — this keeps a
  fakes-only / test build from loading native modules at import time.
- **boundaries override:** `container.ts` is the only entry in `eslint.config.js` `boundaries`
  overrides. Presentation hooks import the interface from `@domain/services`, never the adapter.

## Quick reference

| Layer                    | Path                                                | `implements`          |
| ------------------------ | --------------------------------------------------- | --------------------- |
| Interface + domain types | `src/domain/services/<X>Service.ts` (+ barrel)      | —                     |
| In-memory fake           | `src/shared/testing/Fake<X>.ts`                     | `<X>Service`          |
| Real adapter             | `src/data/services/<X>Adapter.ts`                   | `<X>Service`          |
| Wiring                   | `src/presentation/di/container.ts` (lazy `require`) | typed as `<X>Service` |
| Test slot                | `src/shared/testing/TestContainerProvider.tsx`      | —                     |

## Common mistakes

- Writing the adapter before the fake → contract bends to the SDK instead of the domain.
- SDK type in the interface signature → boundary defeated; fix with `unknown` + adapter cast.
- Static-importing the real adapter outside `container.ts` → test/fakes build crashes at module load.
- Returning a Promise from a `subscribe*` method → reintroduces the cleanup footgun.
