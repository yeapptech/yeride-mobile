# Phase 0 — Verification Checklist

This document tells you what to run on your local machine to confirm Phase 0
is complete. The bash sandbox available to me here cannot run `npm install`
to completion (45-second timeout vs 2–3 min required for an Expo+RN install)
and cannot stand up the iOS / Android toolchain at all, so the steps below
need to happen on your laptop.

## What Phase 0 delivered

| Item                                                                                                                           | Path                                                                | Status |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------ |
| package.json with Expo SDK 55, RN 0.83.6, React 19.2.5, TS 5.9 (Expo's compat matrix)                                          | `package.json`                                                      | ✅     |
| TypeScript strict config (noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.)                                          | `tsconfig.json`                                                     | ✅     |
| Expo config (yeride-next bundle ID, env-aware)                                                                                 | `app.config.ts`                                                     | ✅     |
| EAS profiles (development, stage, production)                                                                                  | `eas.json`                                                          | ✅     |
| Babel + Metro + NativeWind wiring                                                                                              | `babel.config.js`, `metro.config.js`                                | ✅     |
| Tailwind config + global.css ported (Honey & Bee tokens)                                                                       | `tailwind.config.js`, `global.css`                                  | ✅     |
| ESLint flat config with TypeScript strict-type-checked + boundaries (architecture lint)                                        | `eslint.config.js`                                                  | ✅     |
| Prettier + .editorconfig + lint-staged + husky pre-commit                                                                      | `.prettierrc`, `.editorconfig`, `package.json`, `.husky/pre-commit` | ✅     |
| Jest config with jest-expo preset + path aliases + 95% coverage gate on domain                                                 | `jest.config.ts`, `jest.setup.ts`                                   | ✅     |
| CI pipeline (typecheck + lint + format + test on every PR)                                                                     | `.github/workflows/ci.yml`                                          | ✅     |
| Folder skeleton: domain / app / data / presentation / shared (per REFACTOR_PLAN §3.3)                                          | `src/`                                                              | ✅     |
| `Result<T, E>`, `Brand<T, K>` primitives + tests                                                                               | `src/domain/shared/`                                                | ✅     |
| `DomainError` base + 5 subclasses (Validation, Authorization, NotFound, Conflict, Payment) + tests                             | `src/domain/errors/`                                                | ✅     |
| Value objects: Money, Coordinates, Email, PhoneNumber, Address — all immutable, all with full Result-returning factory + tests | `src/domain/entities/`                                              | ✅     |
| Logger with sanitize-on-write (PII redaction, depth limit, string truncation) + tests                                          | `src/shared/logger/`                                                | ✅     |
| validateEnv with zod (fails fast on missing/malformed env) + test                                                              | `src/shared/env/`                                                   | ✅     |
| DI container + `<ContainerProvider/>` + `useUseCases()` hook + `<TestContainerProvider/>` for tests                            | `src/presentation/di/`, `src/shared/testing/`                       | ✅     |
| Fully-typed React Navigation (`RootStackParamList`, `RootStackScreenProps<T>`, global module augmentation)                     | `src/presentation/navigation/types.ts`                              | ✅     |
| `GreetUser` use case (Phase 0 smoke test) + tests                                                                              | `src/app/usecases/shared/GreetUser.ts`                              | ✅     |
| `HelloYeRideScreen` wired through `useUseCases() → GreetUser → Result → UI` + screen test                                      | `src/presentation/features/auth/screens/`                           | ✅     |
| Root `<App/>` with QueryClientProvider, ContainerProvider, NavigationContainer, SafeAreaProvider                               | `src/presentation/App.tsx`                                          | ✅     |
| App entry point                                                                                                                | `index.ts`                                                          | ✅     |
| README documenting stack, commands, architecture, status                                                                       | `README.md`                                                         | ✅     |
| .env.example for env-var contract                                                                                              | `.env.example`                                                      | ✅     |

## How to verify locally

```bash
cd /Users/papagallo/yeapptech/dev/yeride-mobile
nvm use                    # installs/uses Node 20 from .nvmrc
npm install                # ~2-3 min, downloads SDK 55, RN 0.85, etc.

# The four CI gates — must all pass before merging anything:
npm run typecheck          # tsc --noEmit (strict mode, no implicit any)
npm run lint               # eslint with architecture rules
npm run format:check       # prettier
npm test                   # jest — runs every *.test.ts(x) under src/

# All four at once:
npm run verify
```

Acceptance criteria from REFACTOR_PLAN.md §6 Phase 0:

> A developer can clone, `yarn install`, `yarn ios`, see the placeholder screen,
> and `yarn test` passes on the value-object suite.

You should expect:

- **`npm test`** — 9 test files pass: Result, Brand, DomainError, Money,
  Coordinates, Email, PhoneNumber, Address, sanitize, validateEnv, GreetUser,
  HelloYeRideScreen. ~75 individual assertions.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors. The architecture rule will refuse any
  cross-layer import that violates the dependency graph.

To run the app on a simulator:

```bash
npm run prebuild           # generates ios/ and android/ from app.config.ts
npm run ios                # opens iOS simulator with Hello YeRide screen
# or:
npm run android
```

You should see a screen with "YeRide Next", "Phase 0 smoke test", a text
input prefilled with "YeRide", and a "Greet" button. Tapping it shows
"Hello, YeRide!" in green. Clearing the input and tapping Greet shows
"Name is required" in red — that's the ValidationError flowing back through
Result.

## Items deferred to later phases

- **Husky `prepare` script** — needs `git init` + `npm install` to run, so
  it'll auto-wire on first install. The pre-commit hook is in
  `.husky/pre-commit`.
- **EAS project linking** — `eas init` needs your Expo account. Run when
  you're ready to do the first EAS build.
- **Firebase config files** — `google-services.json` (Android) and
  `GoogleService-Info.plist` (iOS) for the new `yeride-next.dev`,
  `yeride-next.stage`, `yeride-next` Firebase apps. Land in Phase 1 (Auth).
- **Expo config plugins** (`withFirebaseSdkVersion`, `withNavigationSdk`,
  `withCrashlyticsUploadSymbols`, etc.) — port from the legacy repo as
  TypeScript when their respective phases land. Phase 4 / 6 / 7 / 9.
- **Crashlytics transport for Logger** — Phase 9 (polish).
- **Architecture lint smoke test** — once `npm install` finishes locally,
  verify the rule fires by temporarily importing
  `@data/datasources/firebase/FirestoreClient` from `domain/entities/Money.ts`
  (don't commit). `npm run lint` should error with a clear message.

## What to do if something fails

| Failure                                                                      | Likely cause                                                                                  | Fix                                                                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm install` errors with `ERESOLVE`                                         | New peer-dep conflict introduced by a transitive update                                       | Pin the offending package in `package.json`, document in REFACTOR_PLAN risks          |
| `tsc` errors in test files about non-null assertions                         | The `noUncheckedIndexedAccess` flag is firing on `array[0]` — wrap with `if (r.ok)` narrowing | Already done in tests; if a new test violates it, narrow rather than disable the rule |
| Jest can't resolve `@domain/...` paths                                       | `moduleNameMapper` in `jest.config.ts` is out of sync with `tsconfig.json` paths              | Add the missing alias to both files                                                   |
| `react-native-reanimated` complains about Worklets at runtime                | `babel.config.js` doesn't list `react-native-worklets/plugin` last                            | Already last in our config; verify your edits                                         |
| Native build (iOS) fails with "module not found" on Stripe / Maps / Firebase | Those native modules will be added in Phase 1+ — don't try to build them yet on Phase 0       | Phase 0 only builds the JS-only Hello screen                                          |
