# YeRide Clean Architecture Refactor Plan

**Author:** Hernando Sierra
**Date:** April 26, 2026
**Status:** Draft v1
**Source repo:** `/Users/papagallo/yeapptech/dev/yeride` (Expo SDK 53, React Native 0.79.6, JS, ~112 source files)
**Target repo:** `/Users/papagallo/yeapptech/dev/yeride-mobile/` — separate, brand-new Expo project (latest stable SDK, TypeScript strict). New bundle ID: `yeride-next` (parallel distribution until Phase 10 cutover).

---

## 1. Goals & Non-Goals

### Goals

1. Rebuild YeRide on **Uncle Bob Clean Architecture** with a strict dependency rule (presentation → domain ← data; domain depends on nothing).
2. Migrate the entire app from JavaScript to **TypeScript strict mode** with no `any` escape hatches.
3. Replace the 5-context state-management stack with **Zustand (client state) + TanStack Query (server state)**.
4. Make every external integration (Firebase, Stripe, Google Maps, GPS, Navigation SDK, NHTSA) hide behind a **repository interface** so it can be mocked, swapped, or upgraded without touching presentation or domain code.
5. Achieve meaningful test coverage where it matters most: **100% on use cases**, **>80% on repositories with mocked data sources**, **smoke E2E on the critical rider/driver journeys**.
6. Reach feature parity with the current production app and ship it as a side-by-side TestFlight/Internal-Testing build before cutting over.

### Non-Goals

1. **No new product features** during the rewrite. New features land after cutover. (One exception: features already half-built in the current code that are easier to finish in the new arch — flag these explicitly per phase.)
2. **No backend rewrite.** Firestore schema, Cloud Functions, Stripe backend proxy, and security rules stay as-is. Only the client changes.
3. **No design-system rewrite.** Keep the "Honey and the Bee" palette, semantic tokens, and NativeWind setup. Port `global.css` and `tailwind.config.js` over.
4. **No multi-platform expansion.** iOS + Android only. Web stays out of scope.

---

## 2. What's Wrong With the Current Code (and Why a Rewrite Beats Incremental Refactor)

Findings from the inventory pass:

### 2.1 Business logic lives in the data layer

`src/api/firebase/Trip.js` is ~1k lines holding both Firestore plumbing **and** core domain rules: fare formula (`calculateRangeFare`), trip status transitions, geohash discovery radius, vehicle embedding-on-dispatch, audit-event text generation. These rules cannot be unit-tested without standing up Firebase. They also cannot be reused server-side or shared between rider and driver presentations without re-importing Firestore.

### 2.2 Screens reach directly into infrastructure

`RideMonitor.js`, `DriverMonitor.js`, `RiderHome.js`, `DriverDispatch.js`, `Register.js`, etc. import `firestore`, `auth`, `BackgroundGeolocation`, `paymentProcessor`, and Google Maps APIs directly. There is no seam to mock for tests, no swap point for SDK upgrades, and no way to enforce that auth/validation runs before infrastructure calls.

### 2.3 Contexts mix UI concerns, server cache, and domain state

- `UserContext` holds identity _and_ `defaultPaymentMethod` _and_ `inProgressTrip` _and_ `initializing` flag — three distinct concerns.
- `TripContext` holds the Firestore trip mirror _and_ derived map state (`pickup.directions`, `availableRoutes`, `selectedRouteIndex`) _and_ geofence UI flags (`showPickupExitWarning`).
- `LocationContext` holds raw GPS plus odometer plus nav-SDK tracking state.

Every context re-renders the whole tree on any change. Every reducer action type (~40 in `TripContext` alone) is coupled to UI shape, not domain shape.

### 2.4 Subscriptions and lifecycles are duplicated and fragile

`subscribeTrip`, `subscribeAvailableRides`, `subscribeToUserLocation`, `subscribeTripEvent`, `subscribeToLatestMessage`, `subscribeToPassengerInProgressTrips`, `subscribeToDriverInProgressTrips` — each consumed inline in `useEffect`s with hand-rolled cleanup. The CLAUDE.md troubleshooting section already documents three classes of bugs caused by this (async cleanup, stale `subscribeToUserLocation` Promise handling, geofence event deduplication). TanStack Query `useQuery`/`useInfiniteQuery` plus a small `useFirestoreSubscription` hook eliminate the whole category.

### 2.5 No type system

The codebase is JS. Firestore documents shape-shift over time; payloads are passed by convention; no compile-time guard against missing fields, undefined-vs-null, or status-string typos. Several troubleshooting entries in CLAUDE.md (`React 19 defaultProps`, `headerBackTitleVisible` silently ignored, navigator placement, doc.data() chaining) are runtime errors a TS type system would have surfaced at build time.

### 2.6 Tests are thin

4 unit tests (`LogIn`, `VinDecoder`, `distanceTrackingService`, `paymentMessages`) and 5 Detox flows. Core money-handling code (fare calc, tip charge, cancellation fees) and core safety code (validation, authorization) have no unit tests. A Clean Architecture rewrite naturally surfaces these as use cases that are trivial to test in isolation.

### 2.7 Why rewrite, not refactor in place

The above couplings are pervasive. Untangling them in place would mean simultaneously:

- moving every screen off direct Firestore imports,
- introducing repository interfaces while the existing API files still exist,
- migrating five contexts to two state libraries,
- running TS migration alongside,

…and shipping production patches the whole time. The risk surface and review cost dominate any incremental win. A parallel rewrite, with the production app frozen on bug-fix-only mode, is faster end-to-end and gives us a clean slate on architecture, types, tests, and tooling. The current repo continues to serve users until the new app passes parity testing.

---

## 3. Target Architecture

### 3.1 The four layers

```
┌──────────────────────────────────────────────────────────────┐
│  PRESENTATION                                                │
│  React Native screens, components, navigation, Zustand UI    │
│  stores, view-model hooks. Imports from: domain, app.        │
├──────────────────────────────────────────────────────────────┤
│  APP (use cases / interactors)                               │
│  Pure functions or classes that orchestrate domain entities  │
│  and repositories to fulfill one user intent. Imports from:  │
│  domain only. Returns Result<T, DomainError>.                │
├──────────────────────────────────────────────────────────────┤
│  DOMAIN                                                      │
│  Entities, value objects, domain services, repository        │
│  interfaces, domain errors. Pure TypeScript. Zero imports    │
│  outside domain.                                             │
├──────────────────────────────────────────────────────────────┤
│  DATA (infrastructure / adapters)                            │
│  Repository implementations, Firestore data sources, Stripe  │
│  client, Google Maps client, GPS adapter, Navigation SDK     │
│  adapter, push tokens. Imports from: domain. Implements      │
│  domain repository interfaces.                               │
└──────────────────────────────────────────────────────────────┘
```

**Dependency rule:** Inner layers know nothing about outer ones. Domain has no `import` from anywhere except itself. App imports only domain. Presentation imports app (use cases) and domain types. Data imports domain (to implement its interfaces) — and is wired into presentation only via dependency injection.

### 3.2 Why this flavor

- **Uncle Bob 4-layer** (chosen) gives a single mental model and a bright dependency line. It scales well for ~30 screens and ~100 use cases without becoming bureaucratic.
- We deliberately keep one shared `domain/` and one shared `app/` rather than per-feature domain folders, because YeRide's core entities (Trip, User, Vehicle, Location, ServiceArea) are touched by both rider and driver flows. Splitting by feature would force cross-feature imports of "shared domain," which is a smell.
- Presentation **is** allowed to be feature-organized (`features/auth/`, `features/ride/`, `features/driver/`) because UI rarely shares across roles.

### 3.3 Folder layout

```
yeride-mobile/YeRide Clean Architecture/
├── app.config.ts                  # Expo config, env-aware
├── eas.json                       # Build profiles (dev, stage, prod)
├── tsconfig.json                  # strict: true, exactOptionalPropertyTypes, noUncheckedIndexedAccess
├── package.json
├── jest.config.ts
├── babel.config.js
├── metro.config.js
├── tailwind.config.js
├── global.css
├── nativewind-env.d.ts
├── .env.development / .env.stage / .env.production
├── plugins/                       # Expo config plugins (port from current)
│   ├── withNavigationSdk.ts
│   ├── withFirebaseSdkVersion.ts
│   ├── withStripeIosSdkOverride.ts
│   ├── withCrashlyticsUploadSymbols.ts
│   ├── withMaterialTheme.ts
│   └── withPackagingOptions.ts
├── firebase/                      # Firestore rules + indexes (live with app)
│   ├── firestore.rules
│   └── firestore.indexes.json
├── e2e/                           # Detox flows (port from current)
└── src/
    ├── domain/                    # ──────────────  LAYER 1
    │   ├── entities/
    │   │   ├── User.ts            # User, Rider, Driver discriminated union
    │   │   ├── Trip.ts            # Trip aggregate root with status FSM
    │   │   ├── TripStatus.ts      # union literal type + transition table
    │   │   ├── TripEvent.ts       # value object, immutable
    │   │   ├── Vehicle.ts         # entity (VIN as id)
    │   │   ├── VehicleStatus.ts
    │   │   ├── ServiceArea.ts
    │   │   ├── RideService.ts     # value object
    │   │   ├── Money.ts           # value object (amount + currency, all cents)
    │   │   ├── Coordinates.ts     # value object with validation
    │   │   ├── Address.ts         # value object
    │   │   ├── Route.ts           # value object (polyline, distance, duration, tolls)
    │   │   ├── Fare.ts            # value object (range or final)
    │   │   ├── PaymentMethod.ts
    │   │   └── Payment.ts
    │   ├── services/              # pure domain services (no I/O)
    │   │   ├── FareCalculator.ts  # baseFare + km*cost + min*cost (extracted from Trip.js)
    │   │   ├── TripStateMachine.ts# canTransition(from, to), nextStatus(...)
    │   │   ├── DistanceCalculator.ts # haversine, units
    │   │   └── GeofenceEvaluator.ts  # is-inside, distance-to-edge
    │   ├── repositories/          # interfaces only — implementations live in data/
    │   │   ├── AuthRepository.ts
    │   │   ├── UserRepository.ts
    │   │   ├── TripRepository.ts
    │   │   ├── VehicleRepository.ts
    │   │   ├── LocationRepository.ts
    │   │   ├── ServiceAreaRepository.ts
    │   │   ├── PaymentRepository.ts
    │   │   ├── MapsRepository.ts
    │   │   └── PushTokenRepository.ts
    │   ├── errors/
    │   │   ├── DomainError.ts     # base class
    │   │   ├── ValidationError.ts
    │   │   ├── AuthorizationError.ts
    │   │   ├── NotFoundError.ts
    │   │   ├── ConflictError.ts
    │   │   └── PaymentError.ts
    │   └── shared/
    │       ├── Result.ts          # Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
    │       ├── Brand.ts           # branded primitives (TripId, UserId, VIN, etc.)
    │       └── DomainEvent.ts     # for future event-sourced flows
    │
    ├── app/                       # ──────────────  LAYER 2
    │   └── usecases/
    │       ├── auth/
    │       │   ├── RegisterUser.ts
    │       │   ├── LogInUser.ts
    │       │   ├── LogOutUser.ts
    │       │   ├── SendEmailVerification.ts
    │       │   ├── CheckEmailVerified.ts
    │       │   ├── ResetPassword.ts
    │       │   ├── ChangeEmail.ts
    │       │   └── UpdateProfile.ts
    │       ├── rider/
    │       │   ├── PlanTripRoute.ts          # computeRoutes + pickup/dropoff selection
    │       │   ├── EstimateFareRange.ts      # FareCalculator domain service
    │       │   ├── RequestTrip.ts            # creates Trip aggregate
    │       │   ├── CancelTripAsRider.ts      # delegates to TripRepository.cancel
    │       │   ├── PayForTrip.ts             # Stripe charge + Trip.payTrip
    │       │   ├── AddTip.ts
    │       │   ├── ManagePaymentMethods.ts
    │       │   └── ManageSavedPlaces.ts
    │       ├── driver/
    │       │   ├── BrowseAvailableRides.ts
    │       │   ├── ScheduleRide.ts
    │       │   ├── DispatchRide.ts           # vehicle embed + status transition
    │       │   ├── StartTrip.ts
    │       │   ├── CompleteTrip.ts
    │       │   ├── CancelTripAsDriver.ts
    │       │   ├── RegisterVehicle.ts        # VIN decode + create + photos
    │       │   ├── ApproveVehicle.ts
    │       │   ├── SetActiveVehicle.ts
    │       │   └── ViewEarnings.ts
    │       ├── shared/
    │       │   ├── ObserveTrip.ts            # returns Observable<Trip>
    │       │   ├── ObserveTripEvents.ts
    │       │   ├── ObserveLatestMessage.ts
    │       │   ├── SendChatMessage.ts
    │       │   ├── UpdateUserLocation.ts
    │       │   └── ResolveAddressFromCoordinates.ts
    │       └── trip-tracking/
    │           ├── StartGpsTracking.ts
    │           ├── StopGpsTracking.ts
    │           ├── HandleGeofenceEvent.ts    # pickup/dropoff arrival + exit warnings
    │           └── EvaluateExitWarning.ts
    │
    ├── data/                      # ──────────────  LAYER 4
    │   ├── repositories/          # concrete implementations
    │   │   ├── FirebaseAuthRepository.ts
    │   │   ├── FirestoreUserRepository.ts
    │   │   ├── FirestoreTripRepository.ts    # uses CloudFunctions for cancel/complete
    │   │   ├── FirestoreVehicleRepository.ts
    │   │   ├── FirestoreLocationRepository.ts
    │   │   ├── FirestoreServiceAreaRepository.ts
    │   │   ├── StripePaymentRepository.ts
    │   │   ├── GoogleMapsRepository.ts
    │   │   └── ExpoPushTokenRepository.ts
    │   ├── datasources/           # raw SDK wrappers, one job each
    │   │   ├── firebase/
    │   │   │   ├── FirestoreClient.ts
    │   │   │   ├── FirebaseAuthClient.ts
    │   │   │   ├── FirebaseStorageClient.ts
    │   │   │   └── CloudFunctionsClient.ts
    │   │   ├── stripe/
    │   │   │   └── StripeBackendClient.ts
    │   │   ├── maps/
    │   │   │   ├── GoogleRoutesClient.ts
    │   │   │   ├── GoogleGeocodingClient.ts
    │   │   │   └── GoogleDistanceMatrixClient.ts
    │   │   ├── gps/
    │   │   │   └── BackgroundGeolocationClient.ts
    │   │   ├── navigation-sdk/
    │   │   │   └── GoogleNavigationSdkClient.ts
    │   │   ├── nhtsa/
    │   │   │   └── VinDecoderClient.ts
    │   │   └── http/
    │   │       └── fetchWithTimeout.ts
    │   ├── mappers/               # DTO ↔ domain entity converters
    │   │   ├── tripMapper.ts
    │   │   ├── userMapper.ts
    │   │   ├── vehicleMapper.ts
    │   │   ├── routeMapper.ts
    │   │   └── paymentMapper.ts
    │   └── dto/                   # Firestore document shapes (zod schemas)
    │       ├── TripDoc.ts
    │       ├── UserDoc.ts
    │       ├── VehicleDoc.ts
    │       ├── LocationDoc.ts
    │       └── ServiceAreaDoc.ts
    │
    ├── presentation/              # ──────────────  LAYER 3
    │   ├── App.tsx                # root, mounts QueryClientProvider, Stripe, Theme, ErrorBoundary
    │   ├── AppContent.tsx         # auth listener, initial route, GPS lifecycle
    │   ├── di/
    │   │   ├── container.ts       # central DI: instantiate clients → repos → use cases
    │   │   ├── useUseCases.ts     # React hook to access use cases (typed)
    │   │   └── tokens.ts          # symbol tokens
    │   ├── navigation/
    │   │   ├── RootNavigator.tsx
    │   │   ├── AuthNavigator.tsx
    │   │   ├── RiderNavigator.tsx
    │   │   ├── DriverNavigator.tsx
    │   │   ├── RiderTabsNavigator.tsx
    │   │   ├── DriverTabsNavigator.tsx
    │   │   ├── linking.ts
    │   │   └── types.ts           # RootStackParamList, etc. — typed navigation
    │   ├── theme/
    │   │   ├── tokens.ts
    │   │   ├── ThemeProvider.tsx
    │   │   └── useTheme.ts
    │   ├── stores/                # Zustand UI stores (NOT server cache)
    │   │   ├── useSessionStore.ts # current user id + auth status (mirror of TanStack)
    │   │   ├── useTripDraftStore.ts # in-flight ride request before createTrip
    │   │   ├── useGeofenceUiStore.ts # exit-warning banner toggles
    │   │   └── useChatUiStore.ts  # is chat open, suppress banner
    │   ├── queries/               # TanStack Query keys + factories
    │   │   ├── keys.ts
    │   │   ├── trip.queries.ts
    │   │   ├── user.queries.ts
    │   │   ├── vehicle.queries.ts
    │   │   └── serviceArea.queries.ts
    │   ├── hooks/
    │   │   ├── useFirestoreSubscription.ts # generic subscribe → useSyncExternalStore
    │   │   ├── useGpsLifecycle.ts
    │   │   ├── useGeofenceListener.ts
    │   │   ├── usePushNotifications.ts
    │   │   └── useAppStateListener.ts
    │   ├── components/            # design-system / shared widgets
    │   │   ├── form/
    │   │   ├── map/
    │   │   ├── trip/
    │   │   ├── chat/
    │   │   └── feedback/          # toasts, alerts, error boundary
    │   └── features/
    │       ├── auth/
    │       │   ├── screens/{LogIn,Register,EmailVerification,ForgotPassword,UserProfile}.tsx
    │       │   └── view-models/   # custom hooks that call use cases + manage form state
    │       ├── rider/
    │       │   ├── screens/{Home,RouteSearch,RoutePlan,RideSelect,RideMonitor,PaymentMethod,Wallet,...}.tsx
    │       │   ├── components/{AwaitingDriverView,DispatchedView,StartedView,CompletedView,...}.tsx
    │       │   └── view-models/
    │       └── driver/
    │           ├── screens/{Home,Dispatch,Monitor,Navigation,Earnings,VehicleList,VehicleRegistration,...}.tsx
    │           ├── components/
    │           └── view-models/
    │
    ├── shared/                    # cross-layer utilities (allowed everywhere)
    │   ├── logger/                # wrapper with sanitize-on-write
    │   ├── env/                   # validated env loader (zod)
    │   ├── errors/                # error formatting for users (maps DomainError → Toast)
    │   └── testing/               # test helpers, in-memory repos, fixture factories
    │
    └── __tests__/                 # cross-cutting integration tests
```

### 3.4 Naming and conventions

| Layer                | File suffix                  | Default export?                                                       | Notes                                                                          |
| -------------------- | ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Domain entity        | `User.ts`, `Trip.ts`         | named class/type                                                      | Immutable. Methods return new instances.                                       |
| Domain service       | `FareCalculator.ts`          | named class with static methods _or_ exported pure functions          | Whichever reads cleaner; no instance state.                                    |
| Repository interface | `TripRepository.ts`          | `interface TripRepository`                                            | Methods return `Promise<Result<T, DomainError>>` or `Observable<T>`.           |
| Use case             | `RequestTrip.ts`             | named class `RequestTrip` with `execute(input): Promise<Result<...>>` | Constructor takes its repos via DI. One verb per use case.                     |
| Repository impl      | `FirestoreTripRepository.ts` | named class                                                           | Implements the domain interface; nothing more.                                 |
| Mapper               | `tripMapper.ts`              | named functions `toDomain(doc)` and `toDoc(entity)`                   | Pure, total.                                                                   |
| Screen               | `RideMonitorScreen.tsx`      | default export React component                                        | Suffix `Screen` for screens, plain name for components.                        |
| View-model           | `useRideMonitorViewModel.ts` | named hook                                                            | Wraps use cases + Zustand + TanStack Query. The screen renders, the VM thinks. |

Branded IDs everywhere (`type TripId = Brand<string, 'TripId'>`) so a `UserId` cannot be passed where a `TripId` is expected.

### 3.5 The Result type and error model

```ts
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Use cases never throw for expected failures (validation, not-found, unauthorized, payment-declined). They return `Result.err(new ValidationError(...))`. Presentation layer maps `DomainError` subclasses to user-facing messages via `shared/errors/format.ts`. Genuine bugs (infrastructure crashes, programming errors) still throw and are caught by the React error boundary + Crashlytics.

### 3.6 Reactive data: subscriptions vs queries

| Read pattern                        | Tool                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| One-shot fetch                      | TanStack `useQuery`, with the use case returning `Promise<Result<T>>` and the query function unwrapping.               |
| Real-time subscription (single doc) | A small `useFirestoreSubscription(useCase)` hook that wires `onSnapshot`-backed use cases into `useSyncExternalStore`. |
| Real-time subscription (collection) | Same hook + `useInfiniteQuery` for paginated history.                                                                  |
| Mutations                           | TanStack `useMutation` calling a use case. The mutation's `onSuccess` invalidates the relevant query keys.             |
| Local UI state                      | Zustand store.                                                                                                         |

The key idea: **TanStack Query is the server cache**, not Zustand. Zustand holds only what _can't_ be derived from server data — draft form state, modal open/closed, banner toggles, chat-open flag.

### 3.7 Dependency injection

A single `container.ts` constructs the dependency graph at app start (called from `App.tsx`):

```ts
// container.ts (sketch)
const firestore = getFirestore();
const auth = getAuth();
const tripRepo = new FirestoreTripRepository(firestore, cloudFunctionsClient);
const requestTrip = new RequestTrip(tripRepo, userRepo, fareCalculator, clock);
// ...
export const container = { useCases: { requestTrip /* ... */ } };
```

Presentation accesses use cases via `useUseCases()` (a typed hook backed by React context), never reaches into `data/` directly. Tests inject in-memory repository fakes through the same hook by mounting a `<TestContainerProvider/>`.

---

## 4. Migration Map: Current Code → Target Architecture

This is the row-by-row mapping I'll consult while building each phase.

| Current location                                                                                                                                                                                                                                              | Target location                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api/firebase/Trip.js::createTrip`                                                                                                                                                                                                                        | `data/repositories/FirestoreTripRepository.create` + `app/usecases/rider/RequestTrip`                                                                                                                                                                                                                                                                                                  | Validation moves to use case; doc-shape conversion to mapper.                                                                                                |
| `src/api/firebase/Trip.js::scheduleDriver / dispatchDriver / startTrip / completeTrip / passengerCancelTrip / driverCancelTrip`                                                                                                                               | `data/repositories/FirestoreTripRepository` (thin) + `app/usecases/driver/{ScheduleRide,DispatchRide,StartTrip,CompleteTrip,CancelTripAsDriver}` and `app/usecases/rider/CancelTripAsRider`                                                                                                                                                                                            | Status-transition rules become `domain/services/TripStateMachine.ts`.                                                                                        |
| `src/api/firebase/Trip.js::calculateRangeFare`                                                                                                                                                                                                                | `domain/services/FareCalculator.ts`                                                                                                                                                                                                                                                                                                                                                    | Pure. Easy unit tests. Uses `Money` value object.                                                                                                            |
| `src/api/firebase/Trip.js::subscribeAvailableRides / subscribeTrip / subscribeTripEvent / subscribeToUserLocation / subscribeRiderScheduledRides / subscribeToPassenger*Trips / subscribeToDriver*Trips / subscribeToTripPayments / subscribeToLatestMessage` | `data/repositories/Firestore*Repository::observe*` returning `Observable<Result<T, DomainError>>` + `app/usecases/shared/Observe*` use cases + `presentation/hooks/useFirestoreSubscription`                                                                                                                                                                                           | One generic hook replaces ~10 hand-rolled subscription useEffects.                                                                                           |
| `src/api/firebase/Trip.js::updateUserLocation` (with retry)                                                                                                                                                                                                   | `data/repositories/FirestoreLocationRepository.update` + `app/usecases/shared/UpdateUserLocation`                                                                                                                                                                                                                                                                                      | Retry logic stays in repo; coordinate validation moves to `Coordinates` value object's constructor.                                                          |
| `src/api/firebase/Trip.js::findNearbyUsers` (geohash)                                                                                                                                                                                                         | `data/repositories/FirestoreLocationRepository.findNearby`                                                                                                                                                                                                                                                                                                                             | Stays in repo (it's pure infrastructure: geohash math + Firestore query).                                                                                    |
| `src/api/firebase/Trip.js::recordDeliveryInterest / addServiceArea / getServiceAreas / getRideServices`                                                                                                                                                       | `data/repositories/FirestoreServiceAreaRepository` + `app/usecases/rider/{ListServiceAreas,GetRideServices,RecordDeliveryInterest}`                                                                                                                                                                                                                                                    |                                                                                                                                                              |
| `src/api/firebase/Trip.js::addTripEvent`                                                                                                                                                                                                                      | `app/usecases/shared/AddTripEvent` (called by other use cases on transitions)                                                                                                                                                                                                                                                                                                          | Human-readable event text moves to a `domain/services/TripEventNarrator` so it's testable.                                                                   |
| `src/api/firebase/AuthUser.js` (all functions)                                                                                                                                                                                                                | Split: Firebase Auth wrapping → `data/datasources/firebase/FirebaseAuthClient`; Firestore user doc → `data/repositories/FirestoreUserRepository`; Storage avatar → `FirebaseStorageClient`. Use cases: `RegisterUser`, `LogInUser`, `LogOutUser`, `SendEmailVerification`, `CheckEmailVerified`, `ChangeEmail`, `ResetPassword`, `UpdateProfile`, `UploadAvatar`, `ManageSavedPlaces`. |                                                                                                                                                              |
| `src/api/firebase/Vehicle.js` (all)                                                                                                                                                                                                                           | `data/repositories/FirestoreVehicleRepository` + use cases under `app/usecases/driver/{RegisterVehicle, ApproveVehicle, RejectVehicle, SetActiveVehicle, UploadVehiclePhotos, DeleteVehicle, ListDriverVehicles}`                                                                                                                                                                      | VIN-as-id stays in repo; `VehicleStatus` becomes a domain enum.                                                                                              |
| `src/api/firebase/CloudFunctions.js`                                                                                                                                                                                                                          | `data/datasources/firebase/CloudFunctionsClient` (one client) — repositories that need server-side ops (cancel trip, complete trip, calculate fare authoritative) inject this client.                                                                                                                                                                                                  |                                                                                                                                                              |
| `src/api/gps/gpsLocation.js`                                                                                                                                                                                                                                  | `data/datasources/gps/BackgroundGeolocationClient` (single instance, hides SDK) + `data/repositories/LocationRepository::startTracking/stopTracking` (or a `TripTrackingRepository` if we want a clean seam) + `app/usecases/trip-tracking/{StartGpsTracking, StopGpsTracking, HandleGeofenceEvent}` + `presentation/hooks/useGpsLifecycle` (called from `AppContent` only).           | Per CLAUDE.md, **only AppContent** owns GPS lifecycle. The view-models cannot start/stop GPS directly — they request it through a session-level coordinator. |
| `src/api/maps/GoogleMapsAPI.js`                                                                                                                                                                                                                               | Split per concern: `data/datasources/maps/{GoogleRoutesClient, GoogleGeocodingClient, GoogleDistanceMatrixClient}` + `data/repositories/GoogleMapsRepository` (fronts the three) + use cases `{PlanTripRoute, ResolveAddressFromCoordinates, GetEta}` + `domain/services/DistanceCalculator` (haversine).                                                                              | Polyline decoding stays in the maps repo.                                                                                                                    |
| `src/api/stripe/paymentProcessor.js`                                                                                                                                                                                                                          | `data/datasources/stripe/StripeBackendClient` + `data/repositories/StripePaymentRepository` + use cases `{CreateStripeCustomer, ListPaymentMethods, AddPaymentMethod, RemovePaymentMethod, ChargeForTrip, ProcessTip, CreateConnectAccount, GetAccountBalance, GetAccountPayouts, GetCustomerCharges}`.                                                                                | `Money` value object replaces raw cents passed around. Tip rule (100% to driver, $1 minimum) lives in `domain/services/TipPolicy.ts`.                        |
| `src/api/nhtsa/VinDecoder.js`                                                                                                                                                                                                                                 | `data/datasources/nhtsa/VinDecoderClient` + `app/usecases/driver/DecodeVin`                                                                                                                                                                                                                                                                                                            | Existing test ports cleanly.                                                                                                                                 |
| `src/api/services/distanceTrackingService.js`                                                                                                                                                                                                                 | `domain/services/DistanceTracker` (logic) + `data/repositories/LocationRepository.recordOdometer` (persistence)                                                                                                                                                                                                                                                                        | Existing test ports.                                                                                                                                         |
| `src/api/notifications/notificationService.js`                                                                                                                                                                                                                | `data/datasources/expo-notifications/ExpoNotificationsClient` + `data/repositories/ExpoPushTokenRepository` + use cases `{RegisterPushToken, HandleIncomingNotification}` + `presentation/hooks/usePushNotifications`                                                                                                                                                                  |                                                                                                                                                              |
| `src/utils/validation.js`                                                                                                                                                                                                                                     | Constructor validation on value objects (`Coordinates.create`, `Email.create`, `Money.create`) returning `Result`. Field-level validators that don't fit a value object stay in `domain/services/Validators.ts`.                                                                                                                                                                       |                                                                                                                                                              |
| `src/utils/authorization.js`                                                                                                                                                                                                                                  | `domain/services/AuthorizationPolicy.ts` (pure: takes user + resource → `Result<true, AuthorizationError>`). Repos call into the policy before reads/writes that need it.                                                                                                                                                                                                              | Mirrors Firestore rules; both must be updated together. A lint rule + a test suite that diff-checks both is added in Phase 0.                                |
| `src/utils/errorHandler.js`                                                                                                                                                                                                                                   | `shared/errors/mapFirebaseError.ts` (data-layer concern). Domain errors are separate.                                                                                                                                                                                                                                                                                                  |                                                                                                                                                              |
| `src/utils/etaCalculations.js`                                                                                                                                                                                                                                | `domain/services/EtaCalculator.ts`                                                                                                                                                                                                                                                                                                                                                     |                                                                                                                                                              |
| `src/utils/DatetimeUtil.js`                                                                                                                                                                                                                                   | `shared/datetime/`                                                                                                                                                                                                                                                                                                                                                                     | Wrap `date-fns`, no domain rules in here.                                                                                                                    |
| `src/utils/logSanitizer.js`                                                                                                                                                                                                                                   | `shared/logger/sanitize.ts`                                                                                                                                                                                                                                                                                                                                                            | Logger respects this on every write — wrapped at the logger layer, not at every call site.                                                                   |
| `src/utils/cardImage.js`, `phone.js`, `paymentMessages.js`, `chatEvents.js`                                                                                                                                                                                   | `presentation/components/...` (UI helpers) or `shared/...` as appropriate.                                                                                                                                                                                                                                                                                                             |                                                                                                                                                              |
| `src/constants/CancelReasons.js`, `ErrorCodes.js`                                                                                                                                                                                                             | `domain/entities/CancelReason.ts` + `domain/errors/ErrorCode.ts`.                                                                                                                                                                                                                                                                                                                      |                                                                                                                                                              |
| `src/context/UserContext.js`                                                                                                                                                                                                                                  | Split: identity → `useSessionStore` (Zustand) + TanStack `useUserQuery`; saved places → `useSavedPlacesQuery`; default payment method → `usePaymentMethodsQuery`; `inProgressTrip` → `useInProgressTripQuery`. The "context" disappears.                                                                                                                                               |                                                                                                                                                              |
| `src/context/TripContext.js`                                                                                                                                                                                                                                  | Split: server-mirrored trip → `useTripQuery(tripId)`; route planning draft (pickup/dropoff/availableRoutes/selectedRouteIndex/scheduledPickupAt) → `useTripDraftStore`; geofence UI flags → `useGeofenceUiStore`.                                                                                                                                                                      |                                                                                                                                                              |
| `src/context/LocationContext.js`                                                                                                                                                                                                                              | Live location → `useLocationQuery` (subscription-backed); odometer → derived from data; nav-SDK tracking flag → `useNavSdkUiStore`.                                                                                                                                                                                                                                                    |                                                                                                                                                              |
| `src/context/ServiceAreaContext.js`                                                                                                                                                                                                                           | Pure server data → `useServiceAreasQuery`, `useRideServicesQuery`. No need for a store.                                                                                                                                                                                                                                                                                                |                                                                                                                                                              |
| `src/context/VehicleContext.js`                                                                                                                                                                                                                               | TanStack queries: `useDriverVehiclesQuery`, `useActiveVehicleQuery`.                                                                                                                                                                                                                                                                                                                   |                                                                                                                                                              |
| `AppContent.js`                                                                                                                                                                                                                                               | Stays in spirit, becomes `presentation/AppContent.tsx`: subscribes to auth state, computes initial route, owns GPS lifecycle, geofence-event listener, push-notification listener. All work goes through use cases.                                                                                                                                                                    |                                                                                                                                                              |
| `AppProvider.js`                                                                                                                                                                                                                                              | Becomes `presentation/App.tsx` with `QueryClientProvider`, `StripeProvider`, `ThemeProvider`, `ContainerProvider`, `NavigationContainer`, `ErrorBoundary`.                                                                                                                                                                                                                             |                                                                                                                                                              |
| `App.js`                                                                                                                                                                                                                                                      | `index.tsx` → registers root component.                                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                              |
| `firestore.rules`, `firestore.indexes.json`                                                                                                                                                                                                                   | Move to `firebase/` directory in new repo (still deployed via `firebase deploy --only firestore:rules`).                                                                                                                                                                                                                                                                               |                                                                                                                                                              |
| `plugins/with*.js`                                                                                                                                                                                                                                            | Port file-by-file as `.ts`. The Firebase BoM pin, Navigation SDK patches, edge-to-edge, etc. all carry over.                                                                                                                                                                                                                                                                           |                                                                                                                                                              |
| `e2e/`                                                                                                                                                                                                                                                        | Port flows after each feature lands. Smoke + auth + rider + driver + screenshots.                                                                                                                                                                                                                                                                                                      |                                                                                                                                                              |

---

## 5. Tooling, Libraries, and Conventions

### 5.1 Runtime stack

| Concern              | Choice                                                                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework            | **Expo SDK 55** (55.0.17, latest stable as of April 2026), pinned to **RN 0.83.6** + **React 19.1.0** — Expo's official recommended pair. Expo's iOS Swift code in `expo/ios/AppDelegates/ExpoReactNativeFactory.swift` is compiled against RN 0.83's `RCTReactNativeFactory` API; picking RN 0.85 broke the iOS build with `missing argument for parameter 'bundleConfiguration'`. Re-evaluate when SDK 56 ships. | "Latest stable" follows Expo's compatibility matrix, not RN's `latest` tag. Some native pins (`react-native-maps`, `@googlemaps/react-native-navigation-sdk`, `react-native-background-geolocation`) may still need re-validation in Phases 4 and 7. |
| Language             | **TypeScript 5.x, strict mode**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.                                                                                                                                                                                                                                                                                              | Catches whole categories of bugs documented in CLAUDE.md.                                                                                                                                                                                            |
| State (client)       | **Zustand v5** with the `subscribeWithSelector` middleware.                                                                                                                                                                                                                                                                                                                                                        | ~1 KB, no provider tree, hooks selector model is fast and easy to test.                                                                                                                                                                              |
| State (server cache) | **TanStack Query v5** (`@tanstack/react-query`).                                                                                                                                                                                                                                                                                                                                                                   | Industry standard, perfect fit with use cases that return Promises.                                                                                                                                                                                  |
| Subscriptions glue   | Custom `useFirestoreSubscription` on `useSyncExternalStore`.                                                                                                                                                                                                                                                                                                                                                       | Keeps Firestore `onSnapshot` clean and React-18-safe.                                                                                                                                                                                                |
| Forms                | **react-hook-form v7** + **zod v3** + `@hookform/resolvers`.                                                                                                                                                                                                                                                                                                                                                       | Already in current code; carry forward.                                                                                                                                                                                                              |
| Navigation           | **React Navigation 7** (native-stack, bottom-tabs).                                                                                                                                                                                                                                                                                                                                                                | Already in current code; typed `RootStackParamList` per CLAUDE.md guidance.                                                                                                                                                                          |
| Styling              | **NativeWind 4** + Tailwind utility classes + semantic tokens from `docs/DESIGN_SYSTEM.md`.                                                                                                                                                                                                                                                                                                                        | Carry forward; do **not** reintroduce raw hex.                                                                                                                                                                                                       |
| Animations           | `react-native-reanimated`, `react-native-gesture-handler`, `@gorhom/bottom-sheet`.                                                                                                                                                                                                                                                                                                                                 | Same as current.                                                                                                                                                                                                                                     |
| Maps                 | `react-native-maps` 1.24.0 (pinned per CLAUDE.md), `@googlemaps/react-native-navigation-sdk` 0.14.1.                                                                                                                                                                                                                                                                                                               | Pin reasons documented in current CLAUDE.md — keep.                                                                                                                                                                                                  |
| GPS                  | `react-native-background-geolocation` 4.19.x.                                                                                                                                                                                                                                                                                                                                                                      | Same.                                                                                                                                                                                                                                                |
| Payments             | `@stripe/stripe-react-native` (latest compatible with SDK 53).                                                                                                                                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                                      |
| Firebase             | `@react-native-firebase` modular API, BoM pinned to 34.0.0 (per current troubleshooting).                                                                                                                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                      |
| Logging              | `react-native-logs` wrapped in our own `Logger` that auto-sanitizes on write.                                                                                                                                                                                                                                                                                                                                      | Replaces ad-hoc `LOG.extend('MODULE')` pattern; same surface.                                                                                                                                                                                        |
| HTTP                 | Native `fetch` + `fetchWithTimeout` helper. No axios.                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                      |

### 5.2 Test stack

| Layer                                      | Tooling                                                                                                                   | Coverage target                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Domain (entities, services, value objects) | Jest, no test renderer needed. Pure TS.                                                                                   | **100%**                                        |
| App (use cases)                            | Jest + in-memory repository fakes from `shared/testing`.                                                                  | **100%**                                        |
| Data (repositories)                        | Jest with Firestore emulator (via `firebase-tools`) + Stripe test keys. Run as a separate `npm run test:integration` job. | **>80%** of public methods                      |
| Presentation (view-models, hooks)          | Jest + React Testing Library + `@tanstack/react-query` test utilities + container provider with fake use cases.           | **>70%**                                        |
| Presentation (screens, snapshot)           | Sparingly — only for stable UI primitives.                                                                                | n/a                                             |
| E2E                                        | **Detox** (port from current project). Smoke, auth, rider, driver, screenshot flows.                                      | All four flows green in CI before each release. |

### 5.3 Quality gates (CI)

Pre-merge, on every PR:

1. `tsc --noEmit` (zero errors).
2. `eslint .` with the rule set below.
3. `prettier --check .`.
4. `npm test` (unit + use case + repository-mock).
5. **Architecture lint** (custom): no import from `domain/` to anywhere outside `domain/`; no import from `app/` to `data/` or `presentation/`; presentation never imports from `data/` directly.

Pre-release (manual or nightly):

6. `npm run test:integration` against Firebase + Stripe emulators.
7. `npm run e2e:android` and `npm run e2e:ios` Detox suites.
8. EAS build for `dev` profile, smoke install.

ESLint rule set: `@react-native`, `@typescript-eslint/strict-type-checked`, `eslint-plugin-import` (boundaries enforcement), `eslint-plugin-tanstack-query`, `eslint-plugin-react-hooks`. Custom rule via `eslint-plugin-boundaries` to enforce the layer dependency graph.

### 5.4 Environment & secrets

Carry the existing `.env.development` / `.env.stage` / `.env.production` model. Validate at startup with `shared/env/validateEnv.ts` (zod schema; fail fast with a readable error). EAS Secrets workflow stays the same (`npm run secret-{development|stage|production}`).

### 5.5 Build configuration

Port the existing Expo config plugins one-by-one to TypeScript. The Firebase BoM 34.0.0 pin, Stripe iOS SDK pin, Navigation SDK patches, edge-to-edge flag, packaging options, Crashlytics symbol upload — all critical and well-documented. EAS profiles mirror current (`dev`, `stage`, `prod`, `dev-android`, etc.).

---

## 6. Phased Migration Roadmap

Phases are ordered so that each one ends with **a runnable, demoable app**. Each phase has a concrete acceptance criterion.

### Phase 0 — Setup, scaffolding, and architectural guardrails (1 sprint)

Deliverables:

- Fresh Expo SDK 55 project (TS template), scaffolded directly into `/Users/papagallo/yeapptech/dev/yeride-mobile/` (separate repo). Bundle ID set to `yeride-next` in `app.config.ts`.
- `tsconfig.json` strict; `eslint`, `prettier`, `husky` + `lint-staged` configured.
- Folder skeleton from §3.3 with `index.ts` barrels.
- Fully typed React Navigation from day one: `presentation/navigation/types.ts` with `RootStackParamList`, `AuthStackParamList`, `RiderStackParamList`, `DriverStackParamList`, plus `RootStackScreenProps<T>` and per-stack screen-prop helpers. Every `navigation.navigate(...)` call type-checked.
- Architecture lint rule wired and tested.
- `Result`, `Brand`, `DomainError` and subclasses, `Money`, `Coordinates`, `Email`, `PhoneNumber`, `Address` value objects with full test coverage.
- DI container, `useUseCases` hook, test container provider.
- `Logger` with sanitize-on-write.
- `validateEnv` with zod.
- `tailwind.config.js`, `global.css`, `nativewind-env.d.ts` ported from current.
- CI pipeline (GitHub Actions or whatever the team uses) running typecheck/lint/test on every PR.
- A "Hello, YeRide" screen wired through a use case to prove the dependency graph works end-to-end.

Acceptance: a developer can clone, `yarn install`, `yarn ios`, see the placeholder screen, and `yarn test` passes on the value-object suite.

Risks: getting plugins to apply correctly on a clean project. Mitigation: copy and verify each plugin one-by-one, run `expo prebuild --clean` after each.

### Phase 1 — Auth and user identity (1 sprint)

In scope:

- Domain: `User`, `Rider`, `Driver`, `Email`, `EmailVerificationStatus`, `Role`.
- Repositories: `AuthRepository`, `UserRepository`.
- Data sources: `FirebaseAuthClient`, `FirestoreUserRepository`, `FirebaseStorageClient`, `ExpoPushTokenRepository`.
- Use cases: `RegisterUser`, `LogInUser`, `LogOutUser`, `SendEmailVerification`, `CheckEmailVerified`, `ResetPassword`, `ChangeEmail`, `UpdateProfile`, `UploadAvatar`, `AddSavedPlace`, `UpdateSavedPlace`, `RemoveSavedPlace`. (`RegisterPushToken` deferred to Phase 9 — no notification consumers exist yet, so the permission prompt would have nothing to drive.)
- Screens: `LogIn`, `Register`, `EmailVerification`, `ForgotPassword`, `UserProfile`.
- Stores: `useSessionStore`.
- Queries: `useCurrentUserQuery`.
- Navigation: `AuthNavigator`, conditional root routing (auth-vs-main) via `useSessionStore`.
- AppContent skeleton (auth listener, initial-route computation, 5-second safety timeout per CLAUDE.md).

Acceptance: a user can register → verify email → log in → edit profile → log out, end-to-end on dev backend, with all flows under test (use case unit tests + view-model tests + Detox `auth.test.ts`).

Risks: matching the exact email-verification UX from current app; making sure push-token registration is fire-and-forget per CLAUDE.md.

### Phase 2 — Service areas, ride services, and route planning (1 sprint)

In scope:

- Domain: `ServiceArea`, `RideService`, `Route`, `Fare`, `FareCalculator`.
- Repositories: `ServiceAreaRepository`, `MapsRepository`.
- Data sources: `FirestoreServiceAreaRepository`, `GoogleRoutesClient`, `GoogleGeocodingClient`, `GoogleDistanceMatrixClient`.
- Use cases: `ListServiceAreas`, `GetRideServices`, `PlanTripRoute` (autocomplete → `computeRoutes` → alternatives + tolls), `EstimateFareRange`, `ResolveAddressFromCoordinates`.
- Stores: `useTripDraftStore`.
- Screens: `RouteSearch`, `RoutePlan`, `RideSelect` (browse-only, no creation yet).
- Components: `Map`, `RouteSelector`, `RideServicesList`, `TripRouteView`, `ScheduleDatetimePicker`.

Acceptance: a rider can search for a destination, see routes (with alternatives + tolls), pick a service tier, and see a fare range — without yet creating a trip.

Risks: Google Routes API field-mask drift; handling the autocomplete `defaultProps` quirk per CLAUDE.md (already fixed, just carry forward).

### Phase 3 — Rider trip lifecycle (2 sprints)

In scope:

- Domain: `Trip`, `TripStatus`, `TripStateMachine`, `TripEvent`, `Coordinates`, `Address`, `CancelReason`, `GeofenceEvaluator`.
- Repositories: `TripRepository`, `LocationRepository`.
- Data sources: `FirestoreTripRepository` (with `CloudFunctionsClient` for cancel/complete), `FirestoreLocationRepository`.
- Use cases: `RequestTrip`, `ObserveTrip`, `ObserveTripEvents`, `CancelTripAsRider`, `UpdateUserLocation`, `HandleGeofenceEvent`, `EvaluateExitWarning`, `SendChatMessage`, `ObserveLatestMessage`.
- Hooks: `useFirestoreSubscription`, `useGeofenceListener`.
- Stores: `useGeofenceUiStore`, `useChatUiStore`.
- Screens: `RiderHome`, `RideMonitor`.
- Status views: `AwaitingDriverView`, `DispatchedView`, `StartedView`, `CompletedView`, `PaymentFailedView`.

Acceptance: a rider can request a ride against a seeded driver in dev, see live status updates, see geofence exit warnings, chat with the driver, and cancel.

Risks: this is the highest-complexity phase. The current `RideMonitor.js` carries a lot of inline UI/state logic. Mitigation: write the view-model (`useRideMonitorViewModel`) with full unit-test coverage _before_ writing the screen.

### Phase 4 — Driver flows: dispatch, monitor, and trip execution (2 sprints)

In scope:

- Use cases: `BrowseAvailableRides`, `ScheduleRide`, `DispatchRide`, `StartTrip`, `CompleteTrip`, `CancelTripAsDriver`.
- Screens: `DriverHome`, `DriverDispatch`, `DriverMonitor`.
- Status views: `DriverDispatchedView`, `DriverStartedView`, `DriverCompletedView`.
- GPS lifecycle: `StartGpsTracking`, `StopGpsTracking`, `BackgroundGeolocationClient` adapter, `useGpsLifecycle` (called only from `AppContent`).
- Geofence dedup ref pattern lifted into a `useGeofenceDeduper` hook (per CLAUDE.md guidance).

Acceptance: a driver can come online, browse available rides, accept one, dispatch with vehicle, navigate to pickup, start, complete, and cancel — against a seeded rider in dev.

Risks: GPS lifecycle on Android (the `Unable to pause activity` issue documented in CLAUDE.md). Mitigation: port `withNavigationSdk.ts` patches verbatim; add an integration test that opens an image picker mid-trip.

### Phase 5 — Vehicles (1 sprint)

In scope:

- Domain: `Vehicle`, `VehicleStatus`, `Vin`.
- Repository: `VehicleRepository`.
- Data sources: `FirestoreVehicleRepository`, `VinDecoderClient` (NHTSA), `FirebaseStorageClient` for photos.
- Use cases: `RegisterVehicle`, `ApproveVehicle`, `RejectVehicle`, `SetActiveVehicle`, `UploadVehiclePhotos`, `DeleteVehicle`, `ListDriverVehicles`, `DecodeVin`.
- Screens: `VehicleList`, `VehicleRegistration`, `VehicleDetails`, `VehiclePhotos`.

Acceptance: a driver can register a new vehicle (VIN decode → fields → photos), see it pending or auto-approved, set it active, and have it propagate to `driver.services.ride`.

### Phase 6 — Payments, tipping, earnings, wallet (2 sprints)

In scope:

- Domain: `Money`, `PaymentMethod`, `Payment`, `TipPolicy`.
- Repository: `PaymentRepository`.
- Data sources: `StripeBackendClient`.
- Use cases: `CreateStripeCustomer`, `ListPaymentMethods`, `AddPaymentMethod`, `RemovePaymentMethod`, `ChargeForTrip`, `ProcessTip`, `CreateConnectAccount`, `CreateAccountLink`, `GetAccountBalance`, `GetAccountPayouts`, `GetCustomerCharges`, `GetAccountBalanceTransactions`.
- Screens: `PaymentMethod`, `Wallet`, `Earnings`, `TripPreviewModal` (with tip selector + receipt).

Acceptance: rider can pay, tip; driver can onboard Stripe Connect, view balance, view payouts. Tip-100%-to-driver and $1 minimum rule covered by `TipPolicy.test.ts`.

Risks: Stripe iOS SDK + Swift 6.3 compile issue documented in CLAUDE.md (`swift_task_dealloc`). Mitigation: port `withFirebaseSdkVersion.ts` plugin verbatim and revisit when `@react-native-firebase` ships >= 12.12.0.

### Phase 7 — In-app navigation (Google Navigation SDK) (1 sprint)

In scope:

- Data source: `GoogleNavigationSdkClient` (init session, terms, start/stop nav).
- Use cases: `InitNavigationSession`, `StartTurnByTurnNavigation`, `StopTurnByTurnNavigation`.
- Screen: `DriverNavigation`.

Acceptance: driver can hand off from `DriverMonitor` to in-app turn-by-turn nav and back, with terms-and-conditions handled.

Risks: New Architecture / TurboModule registration (per CLAUDE.md), terms-not-accepted state. Mitigation: same as current — initialize the session in `DriverMonitor` view-model before navigating.

### Phase 8 — Delivery flow (1 sprint)

The delivery flow (`DeliverService`, `DeliverSelect`, `DeliverMonitor`) parallels the ride flow. With the rider trip lifecycle in place from Phase 3, this is mostly UI + a `Trip.kind = 'delivery'` branch in domain.

Acceptance: end-to-end delivery flow against dev backend.

### Phase 9 — Polish, observability, hardening, parity test (1 sprint)

- Crashlytics wiring (port `withCrashlyticsUploadSymbols.ts` plugin, configure dSYM upload for iOS, mapping-file upload for Android). No Sentry.
- Push-notification deep links.
- Error boundary + nice fallback screens.
- Accessibility pass on all screens.
- Lighthouse/perf pass: identify rerender storms via React Profiler; convert any remaining global state reads to selectors.
- Production parity test: walk a script that mirrors the App Store screenshot flow on both apps side by side; diff behavior.
- E2E suite green on both iOS and Android.
- TestFlight + Play Internal Testing build of the **`yeride-next` bundle** distributed to the same beta cohort as the current app, so testers can install both side by side and report parity gaps.

### Phase 10 — Cutover (½ sprint)

- Run both apps (`yeride` production + `yeride-next` beta) in parallel on the same beta cohort for one release cycle, with new app pointed at production Firebase + Stripe.
- Decide between the two cutover paths:
  - **(a) Keep `yeride-next` as the new production bundle.** Submit `yeride-next` for App Store / Play review under its own listing, then unpublish the old `yeride` listing once the new one is live. Cleaner release-engineering story; users have to re-download.
  - **(b) Re-sign the new binary under the original `yeride` bundle ID.** Existing users get the rewrite as a normal update. Single listing preserved; review risk is higher because the binary changes substantially in one shot.
- Recommendation: pick (a) unless retention of the existing user base across the update is strategically critical. Decide at the start of the phase based on App Store / Play Console review risk and product input.
- Archive the old repo (`/Users/papagallo/yeapptech/dev/yeride`) at a `last-known-good` tag once the cutover settles.

### Effort estimate

Roughly **12–14 sprints** for a single experienced RN/TS engineer working full time, or **6–8 sprints** for a pair. The longest-pole phases are 3, 4, and 6 (rider lifecycle, driver lifecycle, payments). Phases 0, 5, 7, 8, and 9 each fit in a sprint and are largely sequential because most depend on Trip + User being in place.

---

## 7. Risks, Mitigations, and Open Questions

### Risks

1. **Native pin drift.** Firebase BoM 34.0.0, react-native-maps 1.24.0, Navigation SDK 0.14.1, Stripe iOS SDK pin, Kotlin/gRPC patches — all hard-won and documented in CLAUDE.md. _Mitigation:_ port plugins verbatim before any other native code. Run a smoke build after Phase 0.
2. **Firestore schema mismatch.** The new code reads/writes the same documents as the current app. A mismatch in mapper fields can corrupt production data. _Mitigation:_ `data/dto/*.ts` zod schemas; write `tripMapper.test.ts` etc. with fixtures derived from a real Firestore doc dump of dev data.
3. **Authorization drift.** Client `AuthorizationPolicy` and `firestore.rules` must stay in sync. _Mitigation:_ a test in `__tests__/authorization-vs-rules.test.ts` that parses both and asserts the rule set is a subset of (or matches) the policy.
4. **Subscription cleanup bugs.** The current code has documented incidents (async cleanup, geofence dedup). _Mitigation:_ one canonical `useFirestoreSubscription` hook; lint rule against direct `onSnapshot` in presentation; test the hook explicitly.
5. **Performance regression vs current app.** TanStack Query on Firestore subscriptions could be slower than direct subscription if not careful. _Mitigation:_ benchmark the home screen + RideMonitor with React Profiler before/after; target equal or fewer commits per second on the same scenario.
6. **Detox flakiness during port.** _Mitigation:_ run E2E in the existing repo as a regression baseline while the new repo's E2E suite is being built; only cut over once flake rate is acceptable.

### Decisions (locked)

1. **Bundle ID and provisioning** — the new app ships under a **separate `yeride-next` bundle ID** for parallel TestFlight / Play Internal Testing distribution. The current `yeride` bundle stays in production untouched until Phase 10 cutover, at which point we either (a) keep `yeride-next` as the new production bundle and retire the old one, or (b) re-sign the new binary under the original bundle ID once parity is proven. Decide between (a) and (b) at the start of Phase 10 based on App Store / Play Console review risk.
2. **Repo strategy** — the new app lives in a **separate repo at `/Users/papagallo/yeapptech/dev/yeride-mobile/`**. This plan and all new source live there. The old `/Users/papagallo/yeapptech/dev/yeride` repo stays as the production source of truth for bug fixes during the rewrite, and is archived at cutover.
3. **TanStack Query persistence** — **deferred to Phase 3**. We'll evaluate in-flight after the rider lifecycle lands: which queries genuinely benefit from `react-native-mmkv`-backed persistence (likely `recentTrips`, `serviceAreas`, `paymentMethods`) versus which must always re-subscribe (`activeTrip`, `userLocation`). Document the call in `docs/decisions/` once made.
4. **Crash reporting** — **stay on Crashlytics**. The current `withCrashlyticsUploadSymbols.ts` plugin and Firebase Crashlytics integration carry over verbatim. No Sentry. If leadership later wants release-health dashboards, revisit as a separate proposal.
5. **Navigation typing** — **fully typed from day one**. `RootStackParamList`, `AuthStackParamList`, `RiderStackParamList`, `DriverStackParamList`, plus `RootStackScreenProps<T>` helpers, are part of the Phase 0 scaffold. No progressive typing; no `as any` escape hatches. Every `navigation.navigate(...)` call gets type-checked against the param list.
6. **Firebase project split** — `yeride-next` reuses the **legacy `yeride` Firebase projects for `development` and `stage`** so beta testers see real-shaped data flowing through both apps. `production` is a **fresh `yeride-next-prod` Firebase project**, isolated from the legacy production backend until cutover (Phase 10). Cutover then either migrates production data into `yeride-next-prod` or pivots `yeride-next` back at the legacy production project, depending on the cutover path picked. Documented in Phase 10.

---

## 8. Definition of Done (project-level)

The rewrite is "done" when:

1. Every screen and flow in §2 of the inventory is reachable in the new app.
2. Detox E2E (`smoke`, `auth`, `rider`, `driver`, `screenshots`) passes on both iOS and Android.
3. `tsc --noEmit`, ESLint (with architecture rules), and `npm test` are green on `main`.
4. Use-case test coverage is 100% for `app/usecases/*`.
5. Domain test coverage is 100% for `domain/services/*` and value objects.
6. The new app has been on internal TestFlight + Play Internal Testing for at least one full release cycle without P0 regressions vs the current app.
7. Firestore rules and indexes have been re-deployed (no schema-level changes expected, but verify).
8. Old repo `/Users/papagallo/yeapptech/dev/yeride` is archived (read-only branch, last-known-good tag).

---

## 9. Quick Reference: Mapping at a Glance

```
JS                                       TS Clean Arch
────────────────────────────────────     ──────────────────────────────────────────
src/api/firebase/Trip.js            →    domain/services/{FareCalculator, TripStateMachine}
                                         data/repositories/FirestoreTripRepository
                                         app/usecases/{rider,driver,shared}/...
src/api/firebase/AuthUser.js        →    data/repositories/{FirebaseAuthRepository, FirestoreUserRepository}
                                         app/usecases/auth/...
src/api/firebase/Vehicle.js         →    data/repositories/FirestoreVehicleRepository
                                         app/usecases/driver/{RegisterVehicle, ...}
src/api/firebase/CloudFunctions.js  →    data/datasources/firebase/CloudFunctionsClient
src/api/gps/gpsLocation.js          →    data/datasources/gps/BackgroundGeolocationClient
                                         app/usecases/trip-tracking/...
                                         presentation/hooks/useGpsLifecycle
src/api/maps/GoogleMapsAPI.js       →    data/datasources/maps/{GoogleRoutesClient, ...}
                                         data/repositories/GoogleMapsRepository
                                         app/usecases/{shared,rider}/{ResolveAddress, PlanTripRoute, ...}
src/api/stripe/paymentProcessor.js  →    data/datasources/stripe/StripeBackendClient
                                         data/repositories/StripePaymentRepository
                                         app/usecases/{rider,driver}/...
src/utils/validation.js             →    domain/entities/value-objects/* + domain/services/Validators
src/utils/authorization.js          →    domain/services/AuthorizationPolicy
src/utils/errorHandler.js           →    shared/errors/mapFirebaseError
src/context/UserContext.js          →    presentation/stores/useSessionStore
                                         presentation/queries/user.queries
src/context/TripContext.js          →    presentation/queries/trip.queries
                                         presentation/stores/useTripDraftStore
                                         presentation/stores/useGeofenceUiStore
src/context/LocationContext.js      →    presentation/queries/location.queries
                                         presentation/stores/useNavSdkUiStore
src/context/ServiceAreaContext.js   →    presentation/queries/serviceArea.queries
src/context/VehicleContext.js       →    presentation/queries/vehicle.queries
AppContent.js                       →    presentation/AppContent.tsx
AppProvider.js                      →    presentation/App.tsx
plugins/with*.js                    →    plugins/with*.ts (verbatim port)
firestore.rules                     →    firebase/firestore.rules
e2e/                                →    e2e/ (port flow-by-flow per phase)
```

---

**End of plan.**
