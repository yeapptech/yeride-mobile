# CLAUDE.md — AI Assistant Guide for YeRide-Next

**Last updated:** 2026-05-04. Phase 9 closed (Turn 16 shipped the
receipt-PDF feature). Phase 10 (cutover from legacy yeride) is the
next phase. See `docs/PHASE_*.md` for the per-turn record.

**Codebase:** the clean-architecture rewrite of YeRide. New project
at `/Users/papagallo/yeapptech/dev/yeride-mobile/`. Legacy app still
lives at `/Users/papagallo/yeapptech/dev/yeride/` and is the source
of truth for domain knowledge — read its `CLAUDE.md` for trip
lifecycle, Stripe, Navigation SDK quirks, and other behaviors not
yet ported.

## Project status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Tooling + scaffolding | ✅ |
| 1 | Auth + user identity | ✅ |
| 2 | Domain + data layer (service area, routes, ride, location, FareCalculator) | ✅ |
| 3 | Rider screens — RouteSearch / RouteSelect / RiderHome / RideMonitor / RideReceipt | ✅ |
| 4 | Driver screens — DriverHome / DriverDispatch / DriverMonitor + cancel sheets | ✅ |
| 5 | Vehicle management — VehicleList / Registration / Photos / Details + NHTSA decode | ✅ |
| 6 | Payments — Stripe SDK Wallet / Connect onboarding / tip flow | ✅ |
| 7 | Background GPS — `BackgroundGeolocationClient` + `useGpsLifecycle` + geofence | ✅ |
| 8 | Driver in-app navigation — Google Navigation SDK | ✅ |
| 9 | Polish — push notifications, Crashlytics, telemetry, error boundary, receipt PDF | ✅ |
| 10 | Cutover from legacy yeride | Pending |

For the per-turn record (what shipped, why, test counts, rollback
notes), read the most recent `docs/PHASE_*.md` before starting a
turn. Latest is `docs/PHASE_9_TURN_16.md`.

## Tech stack

| Category | Choice |
| --- | --- |
| Runtime | React Native 0.83.6, React 19.2 |
| Framework | Expo SDK 55 (dev client) |
| Language | TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Backend | Firebase 24.x (Auth + Firestore + Functions + Storage) — `yeapp-stage` shared with legacy in dev/stage; fresh `yeapp-prod` at cutover |
| Cloud Functions | `us-east1` (matches legacy deployment) |
| Maps | Google Routes API + Maps SDK (same keys as legacy) |
| State | Zustand v5 (client state) + TanStack Query v5 (server cache) |
| Forms | React Hook Form + Zod |
| Navigation | React Navigation 7 (typed param lists) |
| Styling | NativeWind 4 + Tailwind 3.4 ("Honey and the Bee" tokens) |
| Tests | Jest + jest-expo + @testing-library/react-native |
| Payments | `@stripe/stripe-react-native@0.63.0` + Stripe microservice (yeride-stripe-server) |
| Background GPS | `react-native-background-geolocation@4.19.4` |
| Navigation SDK | `@googlemaps/react-native-navigation-sdk@0.14.1` |
| Push notifications | `expo-notifications` + Expo push tokens (server uses `Expo.isExpoPushToken`) |
| Crash reporting | `@react-native-firebase/crashlytics@^24.0.0` (modular API) |
| Architecture lint | eslint-plugin-boundaries (v6 `boundaries/dependencies` rule) |

## Architecture: four layers

```
src/
├── domain/         ← entities, value objects, repository INTERFACES, errors, services
│   ├── entities/   ← value objects + entities (User, Money, Coordinates, ServiceArea,
│   │                 RideService, Route, Ride, RideStatus, UserLocation, TripEvent,
│   │                 TripPayment, ChatMessage, Vehicle, PaymentMethod, Payout,
│   │                 BalanceTransaction, StripeAccountStatus, branded IDs, snapshots, …)
│   ├── repositories/ ← AuthRepository, UserRepository, ServiceAreaRepository,
│   │                 RideRepository, LocationRepository (interfaces only)
│   ├── services/   ← RoutesService, FareCalculator, StripeServerService,
│   │                 PushNotificationService, CrashReportingService, etc. (interfaces)
│   ├── errors/     ← DomainError + 6 subtypes (Validation, Authorization, NotFound, Conflict, Payment, Network)
│   └── shared/     ← Result<T,E>, brand<T,K> helpers
├── app/            ← use cases (~50 across bounded contexts:
│   │                 auth, serviceArea, route, ride, location, trip-tracking,
│   │                 vehicle, payment, push)
│   └── usecases/<bounded-context>/
├── data/           ← concrete adapters (Firebase + fetch + native SDK seams)
│   ├── dto/        ← Zod schemas matching legacy Firestore docs
│   ├── mappers/    ← bidirectional / read-only Doc ↔ domain mappers
│   ├── repositories/ ← Firestore* concrete repos
│   └── services/   ← GoogleRoutesService, CloudFunctionsService,
│                     StripeServerHttpAdapter, BackgroundGeolocationClient,
│                     NavigationSdkClient, FirebaseCrashlyticsAdapter, etc.
├── presentation/   ← screens, view-models, navigation, stores, DI
│   ├── di/         ← container.ts (composition root) + ContainerProvider
│   ├── stores/     ← Zustand stores (useSessionStore, useServiceAreaStore,
│   │                 useTripDraftStore, useGeofenceUiStore, useChatUiStore,
│   │                 useDriverStatusStore, useGpsStore)
│   ├── navigation/ ← RootNavigator, AuthNavigator, VerifyEmailNavigator,
│   │                 RiderNavigator, RiderTabsNavigator, DriverNavigator
│   ├── features/   ← rider/{screens,components,view-models}, driver/, auth/, …
│   ├── hooks/      ← useGpsLifecycle, useActiveRideForGeofence, useCrashReportingLifecycle, …
│   └── AppContent.tsx, App.tsx
└── shared/         ← logger, env, pdf, testing fakes (cross-layer utilities)
```

**Layer dependency rule (enforced by eslint-plugin-boundaries):**

```
presentation → app → domain
data        → domain        (data implements domain interfaces)
shared      → domain        (only — shared is the ground floor)
```

`presentation` cannot import from `data`; `app` cannot import from
`presentation` or `data`; `domain` imports nothing else. The DI
container in `src/presentation/di/container.ts` is the single
composition root that wires data adapters into use cases —
boundaries-rule overrides for that file (and the handful of
presentation-layer SDK seams: `useGpsLifecycle.ts`, `useGpsStore.ts`,
`useNavigationSdkConnector.ts`, `useDriverNavigationViewModel.ts`)
are listed in `eslint.config.js`.

## Code conventions

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

`UserId`, `RideId`, `ServiceAreaId`, `RideServiceId`, `StripeCustomerId`,
`StripeAccountId`, `PaymentMethodId`, `PushToken` are branded strings
(`Brand<string, 'UserId'>`) so the type system rejects passing one
where the other is expected. Always `.create()` to construct,
returning `Result<X, ValidationError>`.

### Value objects with `Result`-returning factories

`Money`, `Coordinates`, `Email`, `PhoneNumber`, `PersonName`, `Address`,
`SavedPlace`, `Endpoint`, `PassengerSnapshot`, `DriverSnapshot`,
`PaymentMethod`, `Payout`, etc. all use private constructors +
`static create(props)` factories returning Result. They're immutable —
every "evolve" method returns a new instance.

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

`buildContainer()` in `src/presentation/di/container.ts` decides
between real adapters (`FirebaseAuthRepository`,
`FirestoreRideRepository`, etc.) and in-memory fakes
(`InMemoryAuthRepository`, …) based on
`Constants.expoConfig.extra.firebaseConfigured`. **All adapter
imports inside `buildContainer` use `require()` lazily** so:

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
`CloudFunctionsService` (`completeTrip` / `cancelTrip` / `tipDriver`
callables in `us-east1`) but the use cases don't know — same
interface as the direct-write methods. The split between direct
Firestore writes and Cloud Function calls is an implementation
detail of the data layer, not a domain concern.

### Permissive DTO parsing, canonical writes

DTOs accept legacy field aliases (`seat` alongside `seatCapacity`,
`polyline` alongside `encodedPolyline`, missing optional fields) so
the rewrite reads any legacy document. Writes use the canonical
(newer) field shapes — but trip writes use Firestore
`setDoc { merge: true }` so fields the rewrite doesn't track yet
(`lastSeenByRiderAt`, `messages` subcollection) are preserved.

### Subscription-shaped use cases

`ObserveAuthState`, `ObserveRide`, `SubscribeToUserLocation`, etc.
are subscription-shaped (return synchronous unsubscribe), not
request/response. Don't try to force them into
`execute(): Promise<…>`.

The legacy `subscribeToUserLocation` returned a Promise — explicitly
rewritten to synchronous unsubscribe to fix the React effect-cleanup
footgun. Never reintroduce async-unsubscribe.

### Role-gated use-case boundaries

`CancelRideByRider` enforces the rider-allowed set (`changed_mind`,
`driver_no_show`, …) and rejects driver-only codes (`passenger_no_show`).
`CancelRideByDriver` enforces the symmetric driver set. The `Ride`
entity's `cancel` method is symmetric on `by` because the entity
doesn't know who's calling — the role check belongs at the use case
(the audit boundary), not in the entity.

### Pricing in `Money` minor units

Every fare / price / fee field is a `Money` value object (USD minor
units). Math runs in minor units so we never accumulate
floating-point error. Wire-format conversions (legacy stores dollars
as plain numbers) happen at the mapper boundary only.
`Money.fromMajor(2.5, 'USD')` → `{minorUnits: 250, currency: 'USD'}`.

**`TripPayment.amount` is integer cents on the wire**, NOT dollars.
The Stripe webhook server writes `pi.amount` directly (Stripe's API
contract), so `tripPaymentMapper` reads via `Money.create` (minor
units), not `Money.fromMajor`.

### Logging

Never `console.*` directly. Use `LOG.extend('ModuleName')` from
`@shared/logger`. Levels map to native console methods correctly.

```ts
import { LOG } from '@shared/logger';
const logger = LOG.extend('RIDE');
logger.info('dispatched', { tripId, driverId });
logger.error('updateLocation failed', e);
```

PII protection: `sanitizeForLogging(meta)` is wired into the logger
transport — passing a User object to `meta` automatically redacts
email/phone/payment.

`LOG.error(...)` calls fan out to Crashlytics `recordError` via the
`CrashlyticsLogTransport`, which uses a parallel **rawMeta channel**
to preserve `Error` instance identity through `sanitizeForLogging`.
For a non-Error meta, construct an `Error` at the call site so it
reaches `recordError`:

```ts
LOG.error('something_failed', new Error(`code=${code}`));
```

`LOG.warn` does NOT fan out to `recordError` — use it for
cleanup-best-effort / per-attempt / user-declined paths where you
don't want a Crashlytics non-fatal.

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

### View-model hooks per screen

Every screen has a sibling `useXxxViewModel.ts` hook in
`src/presentation/features/<area>/view-models/` that owns the
screen's orchestration: pulls use cases off the DI container, wires
TanStack Query for server state, reads/writes the relevant Zustand
store(s), maps domain `Result` values to flat UI props
(loading/error/data discriminated unions), and exposes typed
callbacks. Screens stay dumb — no `useUseCases()` calls, no Firebase
imports, no Result-unwrapping.

Test view-models in isolation with the in-memory repository fakes
via `TestContainerProvider`; screens get rendered tests that supply
the view-model output as props.

### Zustand vs. TanStack Query — split of concerns

Strict split, never mix:

- **TanStack Query** owns _server state_ (anything fetched or
  subscribed via a use case) — list of available rides, the current
  Ride doc, route catalog, payment methods. Query keys mirror use
  case args.
- **Zustand stores** own _client/UI state_ only — the trip-draft a
  rider is composing pre-CreateRide (`useTripDraftStore`), chat
  open/closed flag (`useChatUiStore`), geofence-warning banner
  visibility (`useGeofenceUiStore`), session identity bag
  (`useSessionStore`), the resolved active service area
  (`useServiceAreaStore`), GPS-stream mirror (`useGpsStore`).

Do not put server-fetched ride data in Zustand. Do not put pure UI
flags in TanStack Query.

### SDK seams: domain interface + data adapter + fake

Every native-SDK boundary follows the same shape. The interface
lives in `src/domain/services/`; the real adapter lives in
`src/data/services/` and `implements` the interface; the in-memory
fake lives in `src/shared/testing/` and `implements` the same
interface. `Container.<seam>` is typed as the interface (no
`Real | Fake` union leakage into presentation). Presentation hooks
import the interface from `@domain/services` and never reach into
the data layer for SDK types.

Canonical examples: `BackgroundGeolocationClient`,
`NavigationSdkClient`, `StripeServerService`,
`PushNotificationService`, `CrashReportingService`. The
boundaries-rule override list in `eslint.config.js` is short —
`container.ts` plus the four presentation-layer SDK-seam hooks.

When adding a new SDK seam:

1. Define the interface + any domain-shaped types in
   `src/domain/services/<X>Service.ts`. Re-export from the package
   barrel `src/domain/services/index.ts`.
2. Build the in-memory fake first in
   `src/shared/testing/Fake<X>.ts`. The fake `implements <X>Service`.
3. Build the real adapter in `src/data/services/<X>Adapter.ts`. The
   adapter `implements <X>Service` and translates SDK types to the
   domain shapes at the boundary.
4. Wire `Container.<x>: <X>Service` in
   `src/presentation/di/container.ts` with a lazy `require()` for
   the real adapter. Add a sibling hook `use<X>()` on the
   ContainerProvider if presentation needs direct access (the
   alternative is wrapping in a use case).
5. Add an optional override slot to `TestContainerProvider`.

When the SDK type can't be cleanly translated to a domain primitive
at the seam (e.g. `setController({controller: NavigationController})`
on `NavigationService`), accept `unknown` in the interface and
narrow internally with a cast in the adapter. Keep the SDK type in
a private field. The cast is one line and well-contained; the
alternative (SDK type leaking through the interface) defeats the
boundary.

### Single-call SDK escape hatch

Not every SDK that a view-model touches needs an interface in
`@domain/services`. View-models may import an SDK directly when all
three conditions hold:

- **(a) one-shot call with no listener stream.** The view-model
  invokes the SDK in response to a single user action (a tap, a
  picker-cancel, an `Alert.alert` confirmation) and the call
  resolves to a single `Promise<Result>`. No `subscribeTo*` /
  `addListener` surface to manage.
- **(b) no permission state to mirror.** A one-shot
  `request*PermissionsAsync()` per tap is fine. What's not fine is
  continuous permission status tracked in a Zustand store, surfaced
  via an `AppState 'change' → 'active'` listener, or driving a UI
  banner — that's lifecycle, and it goes through a domain
  interface.
- **(c) trivially mockable in Jest.** The SDK exports module-level
  functions that `jest.mock('<package-path>', () => ({ ... }))`
  substitutes cleanly, with no React-context provider, no native-
  module bridge, and no construction shape to mirror.

Qualifying today: `expo-print` + `expo-sharing` + `expo-file-system`
in `useGenerateReceiptPdfViewModel`; `expo-image-picker` in
`useVehiclePhotosViewModel`; `expo-web-browser` in
`useDriverEarningsViewModel` and `useStripeConnectOnboarding`. Any
of (a)/(b)/(c) flipping false moves the SDK back into the seamed
pattern. When an SDK escapes via this hatch, add a JSDoc note on
the consuming VM naming which condition lets it skip the seam.

### Status-router pattern for live trip surfaces

Both `RideMonitorScreen` (rider) and `DriverMonitorScreen` (driver)
use a status-router: a single switch on `Ride.status` selects which
bottom-sheet view component renders. Rider views:
`AwaitingDriverView`, `DispatchedView`, `StartedView`,
`CompletedView`, `PaymentFailedView`. Driver views:
`EnRouteToPickupView`, `AtPickupView`, `StartedView`,
`PaymentRequestedView`, `CompletedView`, `PaymentFailedView`. The
driver side splits server status `'dispatched'` into the
en-route ↔ at-pickup distinction via a derived `arrivedAtPickup`
value (`useGpsIsInsidePickupGeofence() || manualOverride`) — UI
only, no server write. Each view is independently testable, gets
the `Ride` + callbacks as props, and never reads from the store
directly. Adding a new ride status = add a `RideStatus` literal +
add one component + extend the router. Don't grow a single
god-component.

## Data co-existence with legacy yeride

**Critical decision (REFACTOR_PLAN.md §7 Decision 6):** dev + stage
share the same `yeapp-stage` Firebase project as the legacy app, and
trips/users/locations live in the SAME Firestore collections. The
rewrite reads what legacy writes and vice versa. This means:

- DTO schemas must accept every legacy field shape we've ever seen.
- Doc writes must include canonical fields the legacy app reads
  (e.g. bake `seat: 4` AND `seatCapacity: 4` on ride-service
  snapshots).
- Trip writes use `setDoc { merge: true }` so we don't clobber
  fields the rewrite doesn't track yet.
- Cloud Functions are deployed once and called by both apps — keep
  function signatures byte-identical.
- **Driver Stripe Connect state lives in two shapes on disk** —
  legacy yeride writes the FULL `stripe.accounts.create` response
  spread into
  `users/{uid}.stripe = { id, charges_enabled, payouts_enabled, … }`,
  while the rewrite emits both that nested shape AND canonical flat
  fields
  (`stripeAccountId / stripeChargesEnabled / stripePayoutsEnabled`).
  `userMapper` reads either, prefers flat, and writes both. Don't
  drop the dual-write until legacy yeride is retired (Phase 10).
- **Passenger snapshot Stripe shape:**
  `PassengerSnapshot.defaultPaymentMethod` is canonical
  `{id, type: 'card' | 'cash'}`; the DTO preprocess accepts that
  shape, the legacy full Stripe `PaymentMethod` object, and a bare
  string for backward compat. `PassengerSnapshot.stripeCustomerId`
  must be present for `completeTrip` / `tipDriver` /
  `cancelTrip` callables to charge.
- **Receipt-doc statuses:** `RideDocSchema.status` accepts
  `'payment_intent'` and `'closed'` (written by the deployed
  payment pipeline) in addition to the canonical statuses;
  `rideMapper` normalizes both to domain states the receipt UI
  understands.

Production (post-cutover): fresh `yeapp-prod` Firebase project,
only the new app writes to it.

## Critical files

| File | Purpose |
| --- | --- |
| `REFACTOR_PLAN.md` | Phased migration roadmap, decisions, target architecture |
| `docs/PHASE_*.md` | Per-turn record. Read newest first when picking up work |
| `app.config.ts` | Env-aware Expo config; threads Firebase + Maps API keys via `extra` |
| `eslint.config.js` | Boundaries rule + per-file overrides (DI container + 4 SDK-seam hooks) |
| `scripts/patch-podfile.js` | Three Podfile fixes for `@react-native-firebase` 24.x under `useFrameworks: 'static'` |
| `plugins/withBackgroundFetchMaven.js` | Custom Expo plugin — Android Maven repo for `tsbackgroundfetch` AAR |
| `plugins/withNavigationSdk.js` | Custom Expo plugin — Google Navigation SDK Android+iOS native config |
| `plugins/withCrashlyticsUploadSymbols.js` | Release-only Xcode build phase that uploads dSYMs |
| `jest.setup.ts` | Global SDK mocks (Stripe, BackgroundGeolocation, NavigationSdk, Crashlytics) + test helpers |
| `src/presentation/App.tsx` | Provider stack — StripeProvider → NavigationProvider → QueryClientProvider → ContainerProvider → ErrorBoundary → AppContent |
| `src/presentation/AppContent.tsx` | Auth listener, role routing, `useGpsLifecycle`, `useCrashReportingLifecycle`, `usePushTokenRegistration`, `useNotificationResponseHandler`, `usePermissionRefresh` |
| `src/presentation/di/container.ts` | Composition root — single place where all repo + service wiring lives |
| `src/presentation/navigation/RootNavigator.tsx` | Top-level switch between Auth / VerifyEmail / Rider / Driver based on session + role |
| `src/presentation/features/rider/screens/RideMonitorScreen.tsx` | Live-trip surface (rider); map + bottom-sheet status-router |
| `src/presentation/features/driver/screens/DriverMonitorScreen.tsx` | Live-trip surface (driver); same status-router pattern; mounts `useNavigationSdkConnector` |
| `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts` | Driver status-router state machine + Start / RequestPayment / Cancel mutations + terminal-redirect rule + `arrivedAtPickup` derivation |
| `src/presentation/components/trip/CancelReasonSheet.tsx` | Rider cancel picker (`isRiderCode`) |
| `src/presentation/components/trip/DriverCancelReasonSheet.tsx` | Driver cancel picker (`isDriverCode`) |
| `src/presentation/components/error/ErrorBoundary.tsx` | Top-level boundary; mounts inside ContainerProvider; resets via `key=resetCount` |
| `src/domain/entities/Ride.ts` | Trip aggregate + state machine. Most-touched domain entity |
| `src/data/repositories/FirestoreRideRepository.ts` | Largest data adapter — direct writes + Cloud Function delegation + geo-filter |
| `src/data/services/CloudFunctionsService.ts` | `httpsCallable` wrapper for `completeTrip` / `cancelTrip` / `tipDriver` (us-east1) |
| `src/data/services/StripeServerHttpAdapter.ts` | 11-method Stripe microservice adapter; Bearer-authed; retry-with-backoff |
| `src/data/services/BackgroundGeolocationClient.ts` | 11-method GPS SDK seam; listener-deduped |
| `src/data/services/NavigationSdkClient.ts` | 8-method Google Navigation SDK seam; arrival-event dedup; controller-injection pattern |
| `src/data/services/FirebaseCrashlyticsAdapter.ts` | Crashlytics adapter (modular API); three-state lazy singleton; sticky-failure mode |
| `src/data/services/ExpoNotificationsAdapter.ts` | Push-notification adapter — Expo push tokens |
| `src/presentation/stores/useGpsStore.ts` | Zustand mirror of GPS streams; `useGpsLifecycle` is the only writer |
| `src/presentation/hooks/useGpsLifecycle.ts` | AppContent-only GPS lifecycle owner |
| `src/presentation/hooks/useCrashReportingLifecycle.ts` | AppContent-only Crashlytics user-id / attribute / collection-flag mirror |
| `src/presentation/hooks/usePushTokenRegistration.ts` | AppContent-only push-token registration with soft-ask UX |
| `src/shared/logger/Logger.ts` | Multi-transport logger; `CompositeTransport`; `CrashlyticsLogTransport` rawMeta channel |
| `src/shared/pdf/buildReceiptHtml.ts` | Pure HTML-template builder for the receipt-PDF feature |
| `src/shared/testing/TestContainerProvider.tsx` | Test-only container with override slots for every adapter / fake |

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

Live in `.env.development` / `.env.stage` / `.env.production`:

- `EXPO_PUBLIC_APP_ENV` — required, one of dev/stage/production
- `EXPO_PUBLIC_USE_FIREBASE` — toggles real-vs-fakes (also respects
  config-file presence)
- `GOOGLE_MAPS_APIKEY_ANDROID` / `GOOGLE_MAPS_APIKEY_IOS` — read at
  build time, threaded through `app.config.ts` `extra`. NOT
  prefixed with `EXPO_PUBLIC_*` so they don't ship in the bundle
  string blob.
- `STRIPE_SERVER_URL` + `STRIPE_SERVER_API_KEY` — both required as
  a unit; falls back to `FakeStripeServerService` if either missing.
- `BG_GEOLOCATION_LICENSE_KEY` — consumed at BUILD time only by the
  background-geolocation Expo plugin; SDK degrades to time-limited
  debug mode without.

## Common tasks

### Adding a use case

1. New file in `src/app/usecases/<context>/<UseCaseName>.ts`.
2. Constructor takes whatever repos / services it needs.
3. `execute(args): Promise<Result<T, DomainError>>` (or sync for
   subscription-shaped).
4. Wire into `src/presentation/di/container.ts`'s `UseCases`
   interface + `makeUseCases()` body.
5. Tests in `__tests__/<UseCaseName>.test.ts` using
   `InMemory<X>Repository` fakes from `@shared/testing`.

### Adding a domain entity

1. New file in `src/domain/entities/<Name>.ts`.
2. Private constructor + `static create(props): Result<X, ValidationError>`
   factory.
3. Tests in `__tests__/<Name>.test.ts` covering happy path + every
   validation rejection (one assertion per `code` string).
4. Re-export via `src/domain/entities/index.ts` only if multiple
   files need it (most stay direct-imported).

### Adding a Firestore repository

1. Define the interface in `src/domain/repositories/<X>Repository.ts`.
2. Build the in-memory fake first in
   `src/shared/testing/InMemory<X>Repository.ts` — exercise the
   contract.
3. Build the real adapter in
   `src/data/repositories/Firestore<X>Repository.ts` (and a
   `<X>Doc.ts` schema + bidirectional mapper if persistence is
   needed).
4. Wire into the DI container with a lazy `require()`.
5. Add an optional override to `TestContainerProvider`.

## Troubleshooting

### iOS build: modular-headers + RNFirebase under static frameworks

`@react-native-firebase` 24.x's Obj-C wrappers do
`#import <React/...>` which Clang rejects under
`useFrameworks: 'static'`. Three coupled fixes applied by
`scripts/patch-podfile.js`:

1. `Podfile.properties.json`: `ios.buildReactNativeFromSource: "true"`
   so React-Core builds from source (the prebuilt binary has no
   module map).
2. `Podfile`: `$RNFirebaseAsStaticFramework = true` at top level.
3. `Podfile`: `use_modular_headers!` inside the target.

If a NEW pod errors with non-modular include, add a targeted
`pod 'X', :modular_headers => true` to the patch script.

### Android: `compileSdkVersion 35` AAR-metadata error

AndroidX libs pulled in transitively (browser/core/core-ktx 1.17+)
require `compileSdk >= 36`. Fixed in `app.config.ts`
`expo-build-properties` block:
`compileSdkVersion: 36, targetSdkVersion: 35`. Bumping `compileSdk`
only opens new APIs at compile time; runtime behavior stays at sdk
35.

### Firebase Auth on Android: `auth/internal-error` on signInWithEmailAndPassword

Driver/dev keystore SHA-1 not registered with the Firebase Android
app for `tech.yeapp.yeridenext.dev`. Get SHA-1 via:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

Add it in Firebase Console → Project Settings → your Android app →
Add fingerprint, re-download `google-services.json`, replace in
`firebase/config/<env>/`, re-run `npm run prebuild && npm run android`.

### Logger says WARN for an info message

Don't use `console.*` directly anywhere except
`src/shared/logger/Logger.ts`. Use `LOG.extend('Module').info(...)`.
The transport correctly routes each level — if you see WARN tags on
info messages, something is calling `console.warn` directly somewhere
it shouldn't be.

### Firestore `.get()` hangs but `onSnapshot` works

Firebase BoM 34.10.0 has gRPC stream stability issues. Legacy yeride
pins to BoM 34.0.0 in its `withNavigationSdk.js`. We don't pin yet;
if this surfaces, look at the legacy plugin for the fix. Watch for
it during heavy `getDoc` use.

### iOS RCTFatal on boot: "missing usage descriptions"

`expo-location` hard-fails (`RCTFatal`) the first time
`requestForegroundPermissionsAsync()` is called if the iOS
Info.plist is missing `NSLocationWhenInUseUsageDescription` /
`NSLocationAlwaysAndWhenInUseUsageDescription`. Crashes the entire
app on boot.

The strings ARE configured in `app.config.ts` under the
`expo-location` plugin block — but only a fresh `npm run prebuild`
writes them into `ios/<app>/Info.plist`. If you edited the plugin
block (or the iOS native folder was generated before the plugin was
added) the plist falls out of sync.

Fix: `npm run prebuild` to regenerate the iOS native tree (also
re-runs `pod install` and the `patch-podfile.js` Podfile fixes). A
native rebuild (`npm run ios`) is required either way — a JS reload
won't pick up the plist change.

### iOS: `<RNMapsMapView>` placeholder pink screen

Under Expo SDK 55 + RN 0.83.6 New Arch, the react-native-maps Apple
Maps view manager (`AIRMap`) doesn't get picked up by the
Fabric → Paper interop. Fix: use `provider={PROVIDER_GOOGLE}` on
both platforms (already wired in the shared `<Map/>` component).
The patches in `plugins/withNavigationSdk.js` (Podfile Google
subspec emit, podspec patch, `package.json` `componentProvider`
patch) are required for the Google view manager to register
correctly. `npm run prebuild` + a fresh `pod install` + a clean
Xcode build are required after touching either the plugin or
`react-native-maps`.

### Android: `Could not find com.transistorsoft:tsbackgroundfetch:1.0.4`

Modern npm hoists `react-native-background-fetch` to top-level
`node_modules/`, putting its local `libs/` flatdir out of reach of
`:app:debugRuntimeClasspath`. The custom
`plugins/withBackgroundFetchMaven.js` injects the correct repo
into `android/build.gradle`'s `allprojects.repositories`. Run
`npm run prebuild` after touching this plugin.

### `TurboModuleRegistry.getEnforcing(...): 'NavViewModule' not found`

New Architecture got disabled. `@googlemaps/react-native-navigation-sdk`
0.14.1 ships only a codegen TurboModule spec with no legacy bridge
fallback. Verify `newArchEnabled=true` in
`android/gradle.properties` and that `ios/Podfile.properties.json`
does NOT set `"newArchEnabled": "false"`, then
`cd ios && pod install` and rebuild.

## AI best practices

### Do

- Use `Result.ok` / `Result.err` for all expected failures.
- Read `REFACTOR_PLAN.md` and the most recent `docs/PHASE_*.md`
  before starting a turn — they document scope decisions and
  deferred work.
- Match legacy field shapes exactly (read the legacy
  `src/api/firebase/<X>.js` source before writing a DTO/mapper for
  that collection).
- Build the in-memory fake repository BEFORE the real Firestore
  one; the contract is firmer that way.
- Use synchronous unsubscribe for all subscriptions.
- For new screens: write a `useXxxViewModel` hook alongside it,
  keep the screen body dumb (props in, JSX out), and test the
  view-model in isolation against in-memory repository fakes via
  `TestContainerProvider`.
- Server state goes in TanStack Query; client/UI state goes in
  Zustand. Don't mix.
- Construct an `Error` at `LOG.error` call sites when the failure
  isn't already an `Error` instance — that's the only way the
  Crashlytics rawMeta channel resolves it through to `recordError`.
- When in doubt about a legacy quirk, check the legacy
  `/Users/papagallo/yeapptech/dev/yeride/CLAUDE.md` — it captures
  most of the trial-and-error history.
- Always update `eslint.config.js` boundaries overrides if
  introducing a cross-layer import (only do this for legitimate
  composition-root files or presentation-layer SDK seams).

### Don't

- Don't `console.*` outside the logger.
- Don't `throw` for domain failures — return `Result.err`.
- Don't put business logic in repositories. Logic belongs in
  entities or domain services.
- Don't import data-layer types into domain. Domain knows nothing.
- Don't put presentation code (Zustand stores, navigation, screens)
  in app/use cases.
- Don't forget the DI container is the only place
  lazy-`require()` is acceptable. Everywhere else uses static
  imports.
- Don't skip the verify gates before committing.
- Don't return promises from subscription methods (legacy footgun
  explicitly fixed).
- Don't put fetched ride/route/payment data in a Zustand store —
  that's what TanStack Query is for. Don't put a UI flag
  (banner-visible, sheet-open) in TanStack Query — that's what
  Zustand is for.
- Don't grow `RideMonitorScreen` or `DriverMonitorScreen` into a
  god-component. New ride status = add a `RideStatus` literal +
  a new `<Status>View` component + one case in the relevant
  side's status-router.
- Don't use `LOG.error` for cleanup-best-effort / per-attempt /
  user-declined paths — those stay at `LOG.warn` so they don't
  flood Crashlytics with non-actionable noise.

### Driver-side specifics

Patterns specific to the driver-side surfaces. Read these before
touching `useDriverHomeViewModel`, `useDriverDispatchViewModel`,
`useDriverMonitorViewModel`, or any driver status view.

- **Driver mode mirror.** `useDriverStatusStore` carries a
  `mode: 'offline' | 'online_idle' | 'dispatched' | 'on_trip'` flag.
  `useDriverMonitorViewModel` mirrors `Ride.status` into this flag
  so DriverHome / the tabs / a future Earnings surface don't have
  to re-derive from the in-progress ride query at every read.
  `cancelled` always maps to `'online_idle'` (driver re-joins the
  queue); `started` / `payment_requested` / `payment_failed` /
  `completed` all map to `'on_trip'`.
- **Client-side `arrivedAtPickup` derivation.** Server status
  `'dispatched'` is split into UI states `'en_route_to_pickup'` and
  `'at_pickup'` via a derived value:
  `useGpsIsInsidePickupGeofence() || manualOverride`. The geofence
  half is event-driven by `useGpsLifecycle`'s pickup-geofence
  registration. The manual override (`onArriveAtPickup` /
  `onBackToEnRoute`) remains as resilience for GPS drift /
  cellular dead zones; once tapped, sticks across a subsequent
  EXIT so a transient drift mid-pickup doesn't bounce the UI back
  to en-route. The override resets when the ride leaves
  `'dispatched'`. There's no server-side `at_pickup` state — UI
  only. Don't reintroduce a stored `useState<boolean>` for
  `arrivedAtPickup` — the OR-derivation is the canonical pattern.
- **Real odometer at start / request-payment.** The VM reads
  `useGpsCurrentOdometer()` (a cheap `useGpsStore` selector hook)
  and passes the value to both `useStartRideMutation` and
  `useRequestPaymentMutation`. Pre-first-delivery default is `0`;
  `Ride.start({odometerMeters: 0})` accepts that. The monotonicity
  check on `Ride.requestPayment` requires
  `odometerMeters >= pickupTiming.odometerMeters`. Don't call
  `bgGeolocation.getOdometer()` at click time — the staleness of
  the store value (≤200m / ~30s old per the SDK's
  `distanceFilter`) is preferred over an `await` on the
  user-facing tap.
- **Terminal-redirect rule.** `useDriverMonitorViewModel` resets
  the stack to `DriverTabs` on `'cancelled'` and `'completed'`.
  `'payment_failed'` intentionally does NOT redirect — the driver
  stays on the failure card and taps "Close trip" themselves. The
  `redirectedRef` ref guards against re-firing across re-renders.
  If you add a new terminal status, decide deliberately whether it
  auto-redirects.
- **Two cancel-sheet variants.** `CancelReasonSheet` is rider-side
  (gated on `isRiderCode`); `DriverCancelReasonSheet` is
  driver-side (gated on `isDriverCode`). They diverge on the
  available code list (`driver_no_show` rider-only;
  `passenger_no_show` driver-only) and on copy.
- **DriverMonitor map polyline rules.** The map keeps a fixed pool
  of always-mounted children (the `<Map/>` component's invariant).
  Drive visibility via props:
  - Green driver→pickup polyline: visible during server status
    `'dispatched'`. Hidden in every other state.
  - Gold pickup→dropoff polyline: visible during `'started'` /
    `'payment_requested'` / `'payment_failed'` / `'completed'`.
    Both pickup and dropoff markers stay mounted across
    late-status transitions so the map doesn't visibly redraw.
- **Navigation SDK init lives in DriverMonitor, not
  DriverNavigation.** The legacy `getCurrentActivity()` returns
  null inside `<NavigationView/>`, so init must run in the parent
  screen before navigating. `useDriverMonitorViewModel.onLaunchNavigation`
  runs the `init → terms-dialog → navigate` chain.

### Vehicle-side specifics

Patterns to know before touching `useVehicleListViewModel`,
`useVehicleRegistrationViewModel`, `useVehiclePhotosViewModel`,
`useVehicleDetailsViewModel`, or the DriverHome empty-state branch.

- **Active-vehicle source-of-truth is `useCurrentUserQuery`.** The
  driver's active VIN lives on `user.activeVehicleId`, not on a
  Zustand store. `useDriverStatusStore.activeVehicleId` is a UI
  mirror set by `goOnline(seedId)` and only valid while online —
  do not reach for it to derive list highlights or detail-screen
  `isActive`. After `setActive` / `delete` mutations succeed, the
  queries layer invalidates `user.current` so the next render sees
  the updated pointer.
- **List card tap pushes details, not activate.**
  `DriverVehicleCard` takes `onSelect`. Set-active is reachable
  from `VehicleDetailsScreen` via
  `useVehicleDetailsViewModel.onSetActive`, which gates on
  `vehicle.status === 'approved' && !isActive`.
- **VehiclePhotos per-tile state is split across two stores.**
  Server state (URLs already attached) lives in
  `vehicle.photos[type]` from `useVehicleQuery`; local UI state
  (which tiles are uploading or errored) lives in a
  `useState`-driven `PerTileFlags` map keyed on
  `VehiclePhotoType`. Don't mirror photo URLs into local state —
  the byVin invalidation after a successful upload is the
  canonical mechanism for the idle/uploading → attached
  transition.
- **Per-tile mutation isolation, single hook.**
  `useVehiclePhotosViewModel` fires a single
  `useUploadVehiclePhotosMutation` via `mutateAsync` per tile.
  Five concurrent uploads use the same hook instance; the
  per-tile `inFlight` / `errors` flags carry the lifecycle. Don't
  refactor to one hook per `VehiclePhotoType`.
- **`expo-image-picker` permission gate.**
  `requestMediaLibraryPermissionsAsync` runs before
  `launchImageLibraryAsync` on every tap. Permission denial → tile
  error rather than a silent no-op so the user sees what
  happened. `app.config.ts` carries the iOS permission strings.
- **No active vehicle → no online toggle.**
  `useDriverHomeViewModel` exposes `noActiveVehicle: boolean`
  derived from `user.activeVehicleId === null` (driver-role only).
  `DriverHomeScreen` renders an empty-state prompt with a
  "Register a vehicle" CTA in that branch; the online toggle is
  hidden entirely.

## Quick reference

### Use cases by bounded context

```
auth / serviceArea / route / ride / location / trip-tracking /
vehicle / payment / push / crash-reporting

src/app/usecases/<context>/*.ts
```

### Repositories

```
Auth        → src/data/repositories/FirebaseAuthRepository.ts
User        → src/data/repositories/FirestoreUserRepository.ts
ServiceArea → src/data/repositories/FirestoreServiceAreaRepository.ts
Ride        → src/data/repositories/FirestoreRideRepository.ts
Location    → src/data/repositories/FirestoreLocationRepository.ts
Vehicle     → src/data/repositories/FirestoreVehicleRepository.ts
VehiclePhotos → src/data/repositories/FirebaseStorageVehiclePhotoRepository.ts
```

### SDK seams (interface in `@domain/services`, adapter in `@data/services`, fake in `@shared/testing`)

```
RoutesService           → GoogleRoutesService
StripeServerService     → StripeServerHttpAdapter
PaymentCallableService  → CloudFunctionsService (also satisfies CloudFunctions interface for trip callables)
NhtsaVinDecoderService  → NhtsaVinDecoderService (no fake needed; deterministic stub via FakeVinDecoderService)
BackgroundGeolocation   → BackgroundGeolocationClient
NavigationSdk           → NavigationSdkClient
PushNotificationService → ExpoNotificationsAdapter
CrashReportingService   → FirebaseCrashlyticsAdapter
```

### Stores

```
Session     → useSessionStore
ServiceArea → useServiceAreaStore
TripDraft   → useTripDraftStore
GeofenceUI  → useGeofenceUiStore
ChatUI      → useChatUiStore
DriverStatus → useDriverStatusStore
GPS (read-only mirror) → useGpsStore  (writer: useGpsLifecycle only)
```

### Lifecycle hooks (mounted once at AppContent)

```
useGpsLifecycle             → SDK init / start / stop + location/geofence subs
useActiveRideForGeofence    → resolves geofence target from active ride
useCrashReportingLifecycle  → user id / attributes / collection flag
useGlobalErrorHandler       → ErrorUtils.setGlobalHandler → recordError
usePushTokenRegistration    → soft-ask + token write
useNotificationResponseHandler → tap routing via navigationRef
usePermissionRefresh        → AppState 'active' → re-poll OS permission
```

### Navigation

```
RootNavigator       → src/presentation/navigation/RootNavigator.tsx
AuthNavigator       → src/presentation/navigation/AuthNavigator.tsx
VerifyEmailNavigator → src/presentation/navigation/VerifyEmailNavigator.tsx
RiderNavigator      → src/presentation/navigation/RiderNavigator.tsx
RiderTabsNavigator  → src/presentation/navigation/RiderTabsNavigator.tsx
DriverNavigator     → src/presentation/navigation/DriverNavigator.tsx
```

### Rider screens

```
RiderHome, RouteSearch, RouteSelect, RideMonitor, RideReceipt,
ActivityPlaceholder, Wallet, AddPaymentMethod
```

### Driver screens

```
DriverHome, DriverDispatch, DriverMonitor, DriverNavigation,
DriverActivityPlaceholder, DriverEarnings,
VehicleList, VehicleRegistration, VehicleDetails, VehiclePhotos,
UserProfile
```

### DI

```
DI container        → src/presentation/di/container.ts
ContainerProvider   → src/presentation/di/ContainerProvider.tsx
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
`docs/PHASE_*.md` (latest: `PHASE_9_TURN_16.md`), then ask.
