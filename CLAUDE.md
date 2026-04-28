# CLAUDE.md — AI Assistant Guide for YeRide-Next

**Last updated:** April 27, 2026
**Codebase:** the clean-architecture rewrite of YeRide. New project at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Legacy app still lives at
`/Users/papagallo/yeapptech/dev/yeride/` and is the source of truth for
domain knowledge — read its `CLAUDE.md` for trip lifecycle, Stripe,
Navigation SDK quirks, and other behaviors not yet ported.

## Project status

End of Phase 2 (data layer complete). The full domain + data layer is
rewritten under Uncle Bob clean architecture; auth + email-verification
flows work end-to-end on iOS + Android against real Firebase. Phase 3
(rider UI) starts next.

| Phase       | Scope                                                                    | Status                         |
| ----------- | ------------------------------------------------------------------------ | ------------------------------ |
| 0           | Tooling + scaffolding                                                    | ✅ Complete                    |
| 1           | Auth + user identity                                                     | ✅ End-to-end on real Firebase |
| 2 turn 1    | Service-area + ride-service catalog                                      | ✅                             |
| 2 turn 2    | Routes API + Route value object                                          | ✅                             |
| 2 turn 3a   | Ride entity + state machine + FareCalculator                             | ✅                             |
| 2 turn 3b-1 | Ride DTOs + mappers + repository contract + in-memory fake               | ✅                             |
| 2 turn 3b-2 | FirestoreRideRepository + Cloud Functions + 8 use cases                  | ✅                             |
| 2 turn 3c   | UserLocation + LocationRepository (3-retry backoff)                      | ✅                             |
| 3           | Rider UI (RiderHome, RouteSearch, RouteSelect, RideMonitor, RideReceipt) | Next                           |
| 4           | Driver UI                                                                | Pending                        |
| 5           | Vehicle management                                                       | Pending                        |
| 6           | Payments / Stripe Connect / tipping                                      | Pending                        |
| 7           | Background GPS + geofence-exit warnings                                  | Pending                        |
| 8           | Google Navigation SDK (driver in-app navigation)                         | Pending                        |
| 9           | Push notifications + Crashlytics + polish                                | Pending                        |
| 10          | Cutover from legacy yeride                                               | Pending                        |

End of Phase 2 acceptance: 59 suites / 422 tests passing; typecheck +
lint + format + test all green.

## Tech stack

| Category          | Choice                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | React Native 0.83.6, React 19.2                                                                                                           |
| Framework         | Expo SDK 55 (dev client)                                                                                                                  |
| Language          | TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                          |
| Backend           | Firebase 24.x (Auth + Firestore + Functions + Storage) — same `yeapp-stage` project as legacy in dev/stage; fresh `yeapp-prod` at cutover |
| Cloud Functions   | `us-east1` (matches legacy deployment)                                                                                                    |
| Maps              | Google Routes API + Maps SDK (same keys as legacy)                                                                                        |
| State             | Zustand v5 (client state) + TanStack Query v5 (server cache)                                                                              |
| Forms             | React Hook Form + Zod                                                                                                                     |
| Navigation        | React Navigation 7 (typed param lists)                                                                                                    |
| Styling           | NativeWind 4 + Tailwind 3.4 ("Honey and the Bee" tokens)                                                                                  |
| Tests             | Jest + jest-expo + @testing-library/react-native                                                                                          |
| Architecture lint | eslint-plugin-boundaries (legacy `boundaries/element-types` rule)                                                                         |

## Architecture: four layers

```
src/
├── domain/         ← entities, value objects, repository INTERFACES, errors, services
│   ├── entities/   ← ~16 value objects + entities (User, Money, Coordinates, ServiceArea, RideService, Route, Ride, UserLocation, TripEvent, TripPayment, …)
│   ├── repositories/ ← AuthRepository, UserRepository, ServiceAreaRepository, RideRepository, LocationRepository (interfaces only)
│   ├── services/   ← RoutesService (interface), FareCalculator (pure-math implementation)
│   ├── errors/     ← DomainError + 6 subtypes (Validation, Authorization, NotFound, Conflict, Payment, Network)
│   └── shared/     ← Result<T,E>, brand<T,K> helpers
├── app/            ← use cases (28 of them across auth/serviceArea/route/ride/location/shared)
│   └── usecases/<bounded-context>/
├── data/           ← concrete adapters (Firebase + fetch)
│   ├── dto/        ← Zod schemas matching legacy Firestore docs
│   ├── mappers/    ← bidirectional / read-only Doc ↔ domain mappers
│   ├── repositories/ ← Firestore* concrete repos
│   └── services/   ← GoogleRoutesService, CloudFunctionsService
├── presentation/   ← screens, view-models, navigation, stores, DI
│   ├── di/         ← container.ts (the composition root)
│   ├── stores/     ← Zustand stores (useSessionStore, useServiceAreaStore, …)
│   ├── navigation/ ← AuthNavigator / VerifyEmailNavigator / MainNavigator / RootNavigator
│   ├── features/<feature>/screens|view-models/
│   └── AppContent.tsx, App.tsx
└── shared/         ← logger, env, testing fakes (cross-layer utilities)
```

**Layer dependency rule (enforced by eslint-plugin-boundaries):**

```
presentation → app → domain
data        → domain        (data implements domain interfaces)
shared      → domain        (only — shared is the ground floor)
```

`presentation` cannot import from `data`; `app` cannot import from
`presentation` or `data`; `domain` imports nothing else. The DI container
in `src/presentation/di/container.ts` is the single composition root that
wires data adapters into use cases — boundaries-rule overrides for that
file are listed in `eslint.config.js`.

## Code conventions (locked in across Phases 0–2)

### Result over throw

Every operation that can fail in an expected way returns
`Result<T, DomainError>` and never throws. Use `Result.ok` / `Result.err`
factories. Programming errors (network catastrophes, broken SDK state)
still throw; domain failures don't.

```ts
async signIn(args: { email: Email; password: string }):
  Promise<Result<UserId, NotFoundError | AuthorizationError>> {
  if (!found) return Result.err(new NotFoundError({ code: 'auth_user_not_found', ... }));
  return Result.ok(uid);
}
```

### Branded IDs

`UserId`, `RideId`, `ServiceAreaId`, `RideServiceId` are branded strings
(`Brand<string, 'UserId'>`) so the type system rejects passing one where
the other is expected. Always `.create()` to construct, returning
`Result<X, ValidationError>`.

### Value objects with `Result`-returning factories

`Money`, `Coordinates`, `Email`, `PhoneNumber`, `PersonName`, `Address`,
`SavedPlace`, `Endpoint`, `PassengerSnapshot`, `DriverSnapshot`, etc. all
use private constructors + `static create(props)` factories returning
Result. They're immutable — every "evolve" method returns a new
instance.

### Immutable entities with transition methods

`Ride` is the canonical example. Every state transition is a method
returning `Result<Ride, ValidationError>` that produces a new entity:

```ts
ride.dispatch({ driver, pickupDirections, at }); // awaiting_driver → dispatched
ride.start({ odometerMeters, at }); // dispatched → started
ride.requestPayment({ odometerMeters, at }); // started → payment_requested
ride.markCompleted(); // payment_requested → completed
ride.cancel({ reason, by, at, odometerMeters }); // any active → cancelled
```

Illegal transitions (e.g. completing a not-yet-started ride) return
`Result.err(ValidationError({code: 'ride_illegal_transition', ...}))`
rather than throwing.

### Repository pattern with lazy-required adapters

`buildContainer()` in `src/presentation/di/container.ts` decides between
real adapters (`FirebaseAuthRepository`, `FirestoreRideRepository`, etc.)
and in-memory fakes (`InMemoryAuthRepository`, …) based on
`Constants.expoConfig.extra.firebaseConfigured`. **All adapter imports
inside `buildContainer` use `require()` lazily** so:

- A fakes-only build never bundles `@react-native-firebase/*` (which
  would crash at module-load time without config files).
- The test environment never tries to load native modules.

```ts
if (isFirebaseConfigured()) {
  const data = require('@data/repositories/FirestoreRideRepository') as { … };
  return makeUseCases({ rides: new data.FirestoreRideRepository(), … });
}
const testing = require('@shared/testing') as { … };
return makeUseCases({ rides: new testing.InMemoryRideRepository(), … });
```

### Cloud Function callables hidden behind repositories

`requestPayment` and `cancel` on `RideRepository` route through
`CloudFunctionsService` (`completeTrip` / `cancelTrip` callables in
`us-east1`) but the use cases don't know — same interface as the
direct-write methods. The split between direct Firestore writes and
Cloud Function calls is an implementation detail of the data layer, not
a domain concern.

### Permissive DTO parsing, canonical writes

DTOs accept legacy field aliases (`seat` alongside `seatCapacity`,
`polyline` alongside `encodedPolyline`, missing optional fields) so the
rewrite reads any legacy document. Writes use the canonical (newer)
field shapes — but trip writes use Firestore `setDoc { merge: true }` so
fields the rewrite doesn't track yet (`lastSeenByRiderAt`,
`messages` subcollection) are preserved.

### Subscription-shaped use cases

`ObserveAuthState`, `ObserveRide`, `SubscribeToUserLocation`, etc. are
subscription-shaped (return synchronous unsubscribe), not
request/response. Don't try to force them into `execute(): Promise<…>`.

The legacy `subscribeToUserLocation` returned a Promise — explicitly
rewritten to synchronous unsubscribe to fix the React effect-cleanup
footgun. Never reintroduce async-unsubscribe.

### Role-gated use-case boundaries

`CancelRideByRider` enforces the rider-allowed set (`changed_mind`,
`driver_no_show`, …) and rejects driver-only codes (`passenger_no_show`).
`CancelRideByDriver` enforces the symmetric driver set. The `Ride`
entity's `cancel` method is symmetric on `by` because the entity doesn't
know who's calling — the role check belongs at the use case (the audit
boundary), not in the entity.

### Pricing in `Money` minor units

Every fare / price / fee field is a `Money` value object (USD minor
units). Math runs in minor units so we never accumulate floating-point
error. Wire-format conversions (legacy stores dollars as plain numbers)
happen at the mapper boundary only. `Money.fromMajor(2.5, 'USD')` →
`{minorUnits: 250, currency: 'USD'}`.

### Logging

Never `console.*` directly. Use `LOG.extend('ModuleName')` from
`@shared/logger`. Levels map to native console methods correctly
(important: `LOG.info` shows as `INFO`, not `WARN` — fixed in Phase 1
follow-up).

```ts
import { LOG } from '@shared/logger';
const logger = LOG.extend('RIDE');
logger.info('dispatched', { tripId, driverId });
logger.error('updateLocation failed', e);
```

PII protection: `sanitizeForLogging(meta)` is wired into the logger
transport — passing a User object to `meta` automatically redacts
email/phone/payment.

### Async / Result composition

Use `if (!r.ok) return r;` early-return pattern; don't use `.then`
chains. Use cases run server-side validation + auth before any side
effect, and sequence results explicitly:

```ts
const userR = await this.users.getById(id);
if (!userR.ok) return userR;
const updatedR = userR.value.updatePhone(newPhone);
if (!updatedR.ok) return updatedR;
return this.users.update(updatedR.value);
```

## Data co-existence with legacy yeride

**Critical decision (REFACTOR_PLAN.md §7 Decision 6):** dev + stage
share the same `yeapp-stage` Firebase project as the legacy app, and
trips/users/locations live in the SAME Firestore collections. The
rewrite reads what legacy writes and vice versa. This means:

- DTO schemas must accept every legacy field shape we've ever seen.
- Doc writes must include canonical fields the legacy app reads (e.g.
  bake `seat: 4` AND `seatCapacity: 4` on ride-service snapshots).
- Trip writes use `setDoc { merge: true }` so we don't clobber fields
  the rewrite doesn't track yet.
- Cloud Functions are deployed once and called by both apps — keep
  function signatures byte-identical.

Production (post-cutover): fresh `yeapp-prod` Firebase project, only the
new app writes to it.

## Critical files

| File                                               | Purpose                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `REFACTOR_PLAN.md`                                 | Phased migration roadmap, decisions, target architecture                                                    |
| `docs/PHASE_1_TURN_2.md`                           | What shipped through Phase 1                                                                                |
| `app.config.ts`                                    | Env-aware Expo config; threads Firebase + Maps API keys via `extra`                                         |
| `scripts/patch-podfile.js`                         | THREE Podfile fixes for `@react-native-firebase` 24.x under `useFrameworks: 'static'` (see Troubleshooting) |
| `eslint.config.js`                                 | Boundaries rule + per-file overrides (DI container, logger, testing fakes)                                  |
| `src/presentation/di/container.ts`                 | The composition root — single place where all repo + service wiring lives                                   |
| `src/domain/entities/Ride.ts`                      | The trip aggregate + state machine. Most-touched entity                                                     |
| `src/data/repositories/FirestoreRideRepository.ts` | Largest data adapter — direct writes + Cloud Function delegation + geo-filter                               |
| `src/data/services/CloudFunctionsService.ts`       | `httpsCallable` wrapper for `completeTrip` / `cancelTrip` (us-east1)                                        |
| `src/shared/testing/InMemoryRideRepository.ts`     | Full-fidelity fake with seed/spy seams + Haversine geo-filter                                               |

## Build & deployment

### Local dev

```bash
npm run start         # Metro dev server (--dev-client)
npm run prebuild      # expo prebuild --clean + node scripts/patch-podfile.js
npm run ios           # iOS simulator
npm run android       # Android emulator
```

`prebuild` is gated on the Firebase config files in
`firebase/config/<env>/`. With files: real Firebase wired. Without
files: in-memory fakes, with a `LOG.warn` at boot.

### Verify gates

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format:check   # prettier --check .
npm test               # jest
npm run verify         # all four in sequence
```

All four must be green before commit. CI runs the same.

### Env vars

Live in `.env.development` / `.env.stage` / `.env.production`. Currently
configured:

- `EXPO_PUBLIC_APP_ENV` — required, one of dev/stage/production
- `EXPO_PUBLIC_USE_FIREBASE` — toggles real-vs-fakes (also respects
  config-file presence)
- `GOOGLE_MAPS_APIKEY_ANDROID` / `GOOGLE_MAPS_APIKEY_IOS` — read at
  build time, threaded through `app.config.ts` `extra`. NOT prefixed
  with `EXPO_PUBLIC_*` so they don't ship in the bundle string blob.

## Common tasks

### Adding a use case

1. New file in `src/app/usecases/<context>/<UseCaseName>.ts`.
2. Constructor takes whatever repos / services it needs.
3. `execute(args): Promise<Result<T, DomainError>>` (or sync for
   subscription-shaped).
4. Wire into `src/presentation/di/container.ts`'s `UseCases` interface
   - `makeUseCases()` body.
5. Tests in `__tests__/<UseCaseName>.test.ts` using
   `InMemory<X>Repository` fakes from `@shared/testing`.

### Adding a domain entity

1. New file in `src/domain/entities/<Name>.ts`.
2. Private constructor + `static create(props): Result<X, ValidationError>`
   factory.
3. Tests in `__tests__/<Name>.test.ts` covering happy path + every
   validation rejection (one assertion per `code` string).
4. Re-export via `src/domain/entities/index.ts` only if multiple files
   need it (most stay direct-imported).

### Adding a Firestore repository

1. Define the interface in `src/domain/repositories/<X>Repository.ts`.
2. Build the in-memory fake first in
   `src/shared/testing/InMemory<X>Repository.ts` — exercise the contract.
3. Build the real adapter in
   `src/data/repositories/Firestore<X>Repository.ts` (and a `<X>Doc.ts`
   schema + bidirectional mapper if persistence is needed).
4. Wire into the DI container with a lazy `require()`.
5. Add an optional override to `TestContainerProvider`.

## Troubleshooting

### iOS build: modular-headers + RNFirebase under static frameworks

`@react-native-firebase` 24.x's Obj-C wrappers do `#import <React/...>`
which Clang rejects under `useFrameworks: 'static'`. Three coupled fixes
applied by `scripts/patch-podfile.js`:

1. `Podfile.properties.json`: `ios.buildReactNativeFromSource: "true"`
   so React-Core builds from source (the prebuilt binary has no module
   map).
2. `Podfile`: `$RNFirebaseAsStaticFramework = true` at top level.
3. `Podfile`: `use_modular_headers!` inside the target.

If a NEW pod errors with non-modular include, add a targeted
`pod 'X', :modular_headers => true` to the patch script.

### Android: `compileSdkVersion 35` AAR-metadata error

AndroidX libs pulled in transitively (browser/core/core-ktx 1.17+)
require `compileSdk >= 36`. Fixed in `app.config.ts` `expo-build-properties`
block: `compileSdkVersion: 36, targetSdkVersion: 35`. Bumping `compileSdk`
only opens new APIs at compile time; runtime behavior stays at sdk 35.

### Firebase Auth on Android: `auth/internal-error` on signInWithEmailAndPassword

Driver/dev keystore SHA-1 not registered with the Firebase Android app
for `tech.yeapp.yeridenext.dev`. Get SHA-1 via:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

Add it in Firebase Console → Project Settings → your Android app → Add
fingerprint, re-download `google-services.json`, replace in
`firebase/config/<env>/`, re-run `npm run prebuild && npm run android`.

### Logger says WARN for an info message

Don't use `console.*` directly anywhere except `src/shared/logger/Logger.ts`.
Use `LOG.extend('Module').info(...)`. The transport correctly routes
each level — if you see WARN tags on info messages, something is calling
`console.warn` directly somewhere it shouldn't be.

### Firestore `.get()` hangs but `onSnapshot` works

Firebase BoM 34.10.0 has gRPC stream stability issues. Legacy yeride
pins to BoM 34.0.0 in its `withNavigationSdk.js`. We don't pin yet; if
this surfaces, look at the legacy plugin for the fix. Watch for it
during heavy `getDoc` use in the rider UI work.

## AI best practices

### Do

- Use `Result.ok` / `Result.err` for all expected failures.
- Read `REFACTOR_PLAN.md` and the most recent `docs/PHASE_*.md` before
  starting a turn — they document scope decisions and deferred work.
- Match legacy field shapes exactly (read the legacy
  `src/api/firebase/<X>.js` source before writing a DTO/mapper for that
  collection).
- Build the in-memory fake repository BEFORE the real Firestore one;
  the contract is firmer that way.
- Use synchronous unsubscribe for all subscriptions.
- When in doubt about a legacy quirk, check the legacy
  `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` — it captures most
  of the trial-and-error history.
- Always update `eslint.config.js` boundaries overrides if introducing a
  cross-layer import (only do this for legitimate composition-root
  files).

### Don't

- Don't `console.*` outside the logger.
- Don't `throw` for domain failures — return `Result.err`.
- Don't put business logic in repositories. Logic belongs in entities or
  domain services.
- Don't import data-layer types into domain. Domain knows nothing.
- Don't put presentation code (Zustand stores, navigation, screens) in
  app/use cases.
- Don't forget the DI container is the only place lazy-`require()` is
  acceptable. Everywhere else uses static imports.
- Don't skip the verify gates before committing.
- Don't return promises from subscription methods (legacy footgun
  explicitly fixed).

## Quick reference

### File locations

```
Auth use cases       → src/app/usecases/auth/*.ts
Service-area use cases → src/app/usecases/serviceArea/*.ts
Routes use case      → src/app/usecases/route/ComputeRoutes.ts
Ride lifecycle use cases → src/app/usecases/ride/*.ts (8 of them)
Location use cases   → src/app/usecases/location/*.ts

Auth repository      → src/data/repositories/FirebaseAuthRepository.ts
User repository      → src/data/repositories/FirestoreUserRepository.ts
ServiceArea repo     → src/data/repositories/FirestoreServiceAreaRepository.ts
Ride repository      → src/data/repositories/FirestoreRideRepository.ts (largest)
Location repository  → src/data/repositories/FirestoreLocationRepository.ts (3-retry backoff)

Routes service       → src/data/services/GoogleRoutesService.ts
Cloud Functions      → src/data/services/CloudFunctionsService.ts (us-east1)

Session store        → src/presentation/stores/useSessionStore.ts
Service-area store   → src/presentation/stores/useServiceAreaStore.ts

DI container         → src/presentation/di/container.ts
TestContainerProvider → src/shared/testing/TestContainerProvider.tsx
```

### Import paths (TS path aliases)

```ts
import { ... } from '@domain/entities/...';
import { ... } from '@domain/repositories';
import { ... } from '@domain/services';
import { ... } from '@app/usecases/...';
import { ... } from '@data/repositories/...';
import { ... } from '@data/mappers/...';
import { ... } from '@presentation/...';
import { ... } from '@shared/logger';
import { ... } from '@shared/env';
import { ... } from '@shared/testing';
```

---

**End of CLAUDE.md.** When in doubt, read the most recent
`docs/PHASE_*.md` for what shipped, then ask.
