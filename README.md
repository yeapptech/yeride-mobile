# YeRide Next

The Clean Architecture rewrite of YeRide. See `REFACTOR_PLAN.md` for the full
plan, decisions, and phase breakdown.

This repo is currently at **Phase 0** — the architectural skeleton is in
place but no product features have landed yet. The single user-facing screen
(`HelloYeRideScreen`) is a smoke test that proves the dependency graph
compiles and runs end-to-end.

## Stack

- Expo SDK 55 (RN 0.83.6, React 19.2.5) — versions follow Expo's compatibility matrix
- TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Zustand for client state, TanStack Query for server cache
- React Navigation 7, NativeWind 4
- Jest + @testing-library/react-native

## Getting started

```bash
nvm use                  # picks up .nvmrc (Node 20)
npm install
npm run prebuild         # generates ios/ and android/ from app.config.ts
npm run ios              # or `npm run android`
```

## Daily commands

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run format           # prettier --write .
npm test                 # jest (unit + use case + screen)
npm run verify           # all four, in order
```

`npm run verify` is what CI runs on every PR (see `.github/workflows/ci.yml`).

## Architecture

Four layers, strict dependency rule (enforced by `eslint-plugin-boundaries`
in `eslint.config.js`):

```
domain        → may import from   domain, shared
app           → may import from   domain, app, shared
data          → may import from   domain, data, shared
presentation  → may import from   domain, app, presentation, shared
shared        → may import from   shared only
```

The intent: domain is pure. App orchestrates domain via use cases. Data
implements domain repository interfaces. Presentation calls app use cases
through a DI container — never reaches into data directly.

See `REFACTOR_PLAN.md` §3 for the full layout.

## Status

| Phase | Description                                     | Status      |
| ----- | ----------------------------------------------- | ----------- |
| 0     | Scaffold, tooling, primitives, DI, Hello screen | ✅ complete |
| 1     | Auth + user identity                            | ✅ complete |
| 2     | Service areas + ride services + route planning  | pending     |
| 3     | Rider trip lifecycle                            | pending     |
| 4     | Driver flows                                    | pending     |
| 5     | Vehicles                                        | pending     |
| 6     | Payments + tipping + earnings + wallet          | pending     |
| 7     | In-app navigation (Google Navigation SDK)       | pending     |
| 8     | Delivery flow                                   | pending     |
| 9     | Polish, observability, hardening                | pending     |
| 10    | Cutover                                         | pending     |

## Source repo

The legacy production app lives at `/Users/papagallo/yeapptech/dev/yeride`.
That repo continues to receive bug fixes during the rewrite and will be
archived at cutover (Phase 10).
