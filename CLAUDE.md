# CLAUDE.md — AI Assistant Guide for YeRide-Next

**Last updated:** 2026-05-30. Phase 10 complete — Turns 1-9 closed
(audit-v2 verification + Firebase iOS SDK pin + Material theme +
BGTaskScheduler retirement + rider live ETA + Activity tab + scheduled
rides + chat + BG-geolocation test regression fix), Turn 10.5 closed
2026-05-26 (rewrite-ahead synchronous-error payment-failure surfacing),
Turn 10 closed 2026-05-30 (audit v3 + inline prettier cleanup + §0
gate flip). Cutover is unblocked, see
`docs/PHASE_10_CUTOVER_PLAN.md` §1 for the active workstream.
Phase 9 closed (Turn 18 documented the SDK-seam vs. direct-consumption
policy; Turn 17 shrank the ESLint `boundaries` override list from
five entries to one; Turn 16 shipped the receipt-PDF feature). One
out-of-band chore landed on top of Phase 9: react-native-background-geolocation
upgrade 4.19.4 → 5.1.1 (resolves the v4 `rapidActivityLaunch` kill
loop on the Android emulator). On 2026-06-01 the v5 SDK's own
`rapidActivityLaunch` activity-launch loop was reproduced and fixed:
the `ready()` config now uses `locationAuthorizationRequest:
'WhenInUse'` + `disableLocationAuthorizationAlert: true` with no
`backgroundPermissionRationale` (the prior `'Always'` + rationale
shape made v5 auto-launch `TSLocationManagerActivity` and SIGKILL the
app), and `usePermissionRefresh` gained an in-flight + skip-when-
granted guard. The former `__DEV__` / `skipNativeInDev` short-circuit
was REMOVED entirely — native GPS now runs in dev too (the
`setPriority(-1)` concern did not materialise on the emulator).
Trade-off: `'WhenInUse'` drops background-always tracking until a
Transistor license is provisioned for `tech.yeapp.yeridenext.*`. See
memory `rn_bg_geolocation_v5_android_loop.md`. A second out-of-band fix landed on
top of Phase 10 Turn 9: the driver-home / rider-home stale-location
fix — `useCurrentLocation` now caps `getLastKnownPositionAsync` at
`maxAge: 120s` / `requiredAccuracy: 200m` and falls through to a
live read (then an uncapped last-known) so a previous session's
dropoff coordinate doesn't centre the map; `<Map>` follows
post-mount `initialRegion` changes via a ref-driven
`animateToRegion`. See
`docs/PHASE_10_OOB_DRIVER_HOME_STALE_LOCATION.md`. The home screens
still consume the `useCurrentLocation` foreground read for their
initial camera centre, so the cold-start fallback chain still matters
even though BG-geolocation now streams in dev. A third out-of-band fix
landed on top of Phase 10 (PR #12): the driver-dispatch
first-come-first-served rework — `DriverDispatchScreen` no longer hangs
on "Loading ride…" because the accept/decline gate dropped its
pre-accept Google Routes call; the claim is now an atomic
`RideRepository.transitionWithClaim` (`runTransaction`, status-guarded,
`ConflictError('ride_already_taken')` on a lost race); the winning
driver computes + attaches the pickup route afterwards via
`useAttachPickupDirections` (capped retry); `onAccept` ignores repeat
taps; and DriverHome sorts available rides nearest-first by live GPS
Haversine distance. See `docs/PHASE_10_OOB_DRIVER_DISPATCH_FCFS.md`. A
fourth out-of-band effort landed a whole-app **UI redesign** to an
Uber-familiar look on a new **"Cab Yellow (#F7B731) + UPS Pullman Brown
(#644117)"** design language: the `global.css` token values were rewritten
and `card`/`muted`/`border`/`honey` promoted to CSS variables so dark mode
themes app-wide (brown-based, **no per-screen `dark:` variants**); a shared
`components/ui/Button` primitive that every CTA now uses; an Uber-familiar
RiderHome (bottom sheet + "Where to?" + saved places) plus restyled
rider/driver/auth + secondary screens (date-grouped Activity, honey
empty-states, branded cards/badges); and cab-yellow map markers. The locked
spec is `docs/superpowers/specs/2026-06-24-ui-redesign-design-language.md`;
the **`yeride-design-language` skill** (`.claude/skills/`) codifies it —
invoke it before any UI work. See `docs/PHASE_*.md` for the per-turn record
(latest: `PHASE_10_TURN_10.md`).

**Codebase:** the clean-architecture rewrite of YeRide. New project
at `/Users/papagallo/yeapptech/dev/yeride-mobile/`. Legacy app still
lives at `/Users/papagallo/yeapptech/dev/yeride/` and is the source
of truth for domain knowledge — read its `CLAUDE.md` for trip
lifecycle, Stripe, Navigation SDK quirks, and other behaviors not
yet ported.

## Project status

| Phase | Scope                                                                                     | Status |
| ----- | ----------------------------------------------------------------------------------------- | ------ |
| 0     | Tooling + scaffolding                                                                     | ✅     |
| 1     | Auth + user identity                                                                      | ✅     |
| 2     | Domain + data layer (service area, routes, ride, location, FareCalculator)                | ✅     |
| 3     | Rider screens — RouteSearch / RouteSelect / RiderHome / RideMonitor / RideReceipt         | ✅     |
| 4     | Driver screens — DriverHome / DriverDispatch / DriverMonitor + cancel sheets              | ✅     |
| 5     | Vehicle management — VehicleList / Registration / Photos / Details + NHTSA decode         | ✅     |
| 6     | Payments — Stripe SDK Wallet / Connect onboarding / tip flow                              | ✅     |
| 7     | Background GPS — `BackgroundGeolocationClient` + `useGpsLifecycle` + geofence             | ✅     |
| 8     | Driver in-app navigation — Google Navigation SDK                                          | ✅     |
| 9     | Polish — push notifications, Crashlytics, telemetry, error boundary, receipt PDF          | ✅     |
| 10    | Cutover from legacy yeride — Turns 1-9 + 10.5 + 10 all closed; §0 gate cleared 2026-05-30 | ✅     |

For the per-turn record (what shipped, why, test counts, rollback
notes), read the most recent `docs/PHASE_*.md` before starting a
turn. Latest is `docs/PHASE_10_TURN_10.md`.

## Tech stack

| Category           | Choice                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | React Native 0.83.6, React 19.2                                                                                                       |
| Framework          | Expo SDK 55 (dev client)                                                                                                              |
| Language           | TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                      |
| Backend            | Firebase 24.x (Auth + Firestore + Functions + Storage) — `yeapp-stage` shared with legacy in dev/stage; fresh `yeapp-prod` at cutover |
| Cloud Functions    | `us-east1` (matches legacy deployment)                                                                                                |
| Maps               | Google Routes API + Maps SDK (same keys as legacy)                                                                                    |
| State              | Zustand v5 (client state) + TanStack Query v5 (server cache)                                                                          |
| Forms              | React Hook Form + Zod                                                                                                                 |
| Navigation         | React Navigation 7 (typed param lists)                                                                                                |
| Styling            | NativeWind 4 + Tailwind 3.4 — "Cab Yellow + UPS Pullman Brown" design language (CSS-var tokens in `global.css`, automatic dark mode)  |
| Tests              | Jest + jest-expo + @testing-library/react-native                                                                                      |
| Payments           | `@stripe/stripe-react-native@0.63.0` + Stripe microservice (yeride-stripe-server)                                                     |
| Background GPS     | `react-native-background-geolocation@5.1.1`                                                                                           |
| Navigation SDK     | `@googlemaps/react-native-navigation-sdk@0.14.1`                                                                                      |
| Push notifications | `expo-notifications` + Expo push tokens (server uses `Expo.isExpoPushToken`)                                                          |
| Crash reporting    | `@react-native-firebase/crashlytics@^24.0.0` (modular API)                                                                            |
| Architecture lint  | eslint-plugin-boundaries (v6 `boundaries/dependencies` rule)                                                                          |

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
composition root that wires data adapters into use cases, and it's
the only `boundaries/dependencies` override in `eslint.config.js` —
Phase 9 Turn 17 promoted every SDK seam type into `@domain/services`,
shrinking the override list from five entries to one.

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
ride.claimForDispatch({ driver, at }); // awaiting_driver → dispatched (directions-free atomic claim)
ride.beginScheduledClaim({ at }); // scheduled_driver_accepted → dispatched (scheduled analog)
ride.attachPickupDirections(directions); // fills the pickup route post-claim (winner only)
ride.start({ odometerMeters, at }); // dispatched → started
ride.requestPayment({ odometerMeters, at }); // started → payment_requested
ride.markCompleted(); // payment_requested → completed
ride.cancel({ reason, by, at, odometerMeters }); // any active → cancelled
```

The dispatch transition is split: `claimForDispatch` /
`beginScheduledClaim` are directions-free so the atomic
`RideRepository.transitionWithClaim` (Firestore `runTransaction`,
status-guarded, returns `ConflictError('ride_already_taken')` on a lost
race) can be the single first-come-first-served claim path; the winning
driver computes + `attachPickupDirections` afterwards (see
`docs/PHASE_10_OOB_DRIVER_DISPATCH_FCFS.md`). The old `dispatch` /
`beginScheduledRide` methods were removed.

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
  open/closed flag + per-ride local read stamp
  (`useChatUiStore.{isOpen, openRideId, lastReadAtByRide}`),
  geofence-warning banner visibility (`useGeofenceUiStore`),
  session identity bag (`useSessionStore`), the resolved active
  service area (`useServiceAreaStore`), GPS-stream mirror
  (`useGpsStore`).

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
boundaries-rule override list in `eslint.config.js` is just
`container.ts` — Turn 17 promoted every SDK seam type into
`@domain/services`, so presentation hooks import the interface, not
the adapter.

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

| File                                                                         | Purpose                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REFACTOR_PLAN.md`                                                           | Phased migration roadmap, decisions, target architecture                                                                                                                                                                                                                                                                                                           |
| `docs/PHASE_*.md`                                                            | Per-turn record. Read newest first when picking up work                                                                                                                                                                                                                                                                                                            |
| `app.config.ts`                                                              | Env-aware Expo config; threads Firebase + Maps API keys via `extra`                                                                                                                                                                                                                                                                                                |
| `eslint.config.js`                                                           | Boundaries rule + per-file overrides (DI container + 4 SDK-seam hooks)                                                                                                                                                                                                                                                                                             |
| `scripts/patch-podfile.js`                                                   | Three Podfile fixes for `@react-native-firebase` 24.x under `useFrameworks: 'static'`                                                                                                                                                                                                                                                                              |
| `plugins/withNavigationSdk.js`                                               | Custom Expo plugin — Google Navigation SDK Android+iOS native config                                                                                                                                                                                                                                                                                               |
| `plugins/withGradleHeap.js`                                                  | Custom Expo plugin — bumps `org.gradle.jvmargs` to `-Xmx4096m` (default 2GB OOMs `mergeDebugResources` on the SDK 55 module surface)                                                                                                                                                                                                                               |
| `plugins/withCrashlyticsUploadSymbols.js`                                    | Release-only Xcode build phase that uploads dSYMs                                                                                                                                                                                                                                                                                                                  |
| `jest.setup.ts`                                                              | Global SDK mocks (Stripe, BackgroundGeolocation, NavigationSdk, Crashlytics) + test helpers                                                                                                                                                                                                                                                                        |
| `src/presentation/App.tsx`                                                   | Provider stack — StripeProvider → NavigationProvider → QueryClientProvider → ContainerProvider → ErrorBoundary → AppContent                                                                                                                                                                                                                                        |
| `src/presentation/AppContent.tsx`                                            | Auth listener, role routing, `useGpsLifecycle`, `useCrashReportingLifecycle`, `usePushTokenRegistration`, `useNotificationResponseHandler`, `usePermissionRefresh`                                                                                                                                                                                                 |
| `src/presentation/di/container.ts`                                           | Composition root — single place where all repo + service wiring lives                                                                                                                                                                                                                                                                                              |
| `src/presentation/navigation/RootNavigator.tsx`                              | Top-level switch between Auth / VerifyEmail / Rider / Driver based on session + role                                                                                                                                                                                                                                                                               |
| `src/presentation/features/rider/screens/RideMonitorScreen.tsx`              | Live-trip surface (rider); map + bottom-sheet status-router                                                                                                                                                                                                                                                                                                        |
| `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`           | Live-trip surface (driver); same status-router pattern; mounts `useNavigationSdkConnector`                                                                                                                                                                                                                                                                         |
| `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`  | Driver status-router state machine + Start / RequestPayment / Cancel mutations + terminal-redirect rule + `arrivedAtPickup` derivation; mounts `useAttachPickupDirections`                                                                                                                                                                                         |
| `src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts` | Accept/decline VM. Loading gate is user + ride only (NO Google Routes); a lost claim (`ConflictError`) → "Already taken"; `onAccept` no-ops while a claim is pending/won (double-tap guard). See `docs/PHASE_10_OOB_DRIVER_DISPATCH_FCFS.md`                                                                                                                       |
| `src/presentation/features/driver/hooks/useAttachPickupDirections.ts`        | Post-claim driver→pickup route compute + attach, on the monitor — only the winning driver spends a Routes quota unit. Per-rideId latch, retry-on-GPS-tick capped at `MAX_ATTACH_ATTEMPTS` (best-effort; directions are nullable)                                                                                                                                   |
| `src/presentation/components/trip/CancelReasonSheet.tsx`                     | Rider cancel picker (`isRiderCode`)                                                                                                                                                                                                                                                                                                                                |
| `src/presentation/components/trip/DriverCancelReasonSheet.tsx`               | Driver cancel picker (`isDriverCode`)                                                                                                                                                                                                                                                                                                                              |
| `src/presentation/components/error/ErrorBoundary.tsx`                        | Top-level boundary; mounts inside ContainerProvider; resets via `key=resetCount`                                                                                                                                                                                                                                                                                   |
| `src/domain/entities/Ride.ts`                                                | Trip aggregate + state machine. Most-touched domain entity. Dispatch is split: directions-free `claimForDispatch` / `beginScheduledClaim` + separate `attachPickupDirections` (old `dispatch` / `beginScheduledRide` removed)                                                                                                                                      |
| `src/data/repositories/FirestoreRideRepository.ts`                           | Largest data adapter — direct writes + Cloud Function delegation + geo-filter + `transitionWithClaim` (`runTransaction` atomic first-come-first-served claim; `ConflictError('ride_already_taken')` on a lost race)                                                                                                                                                |
| `src/data/services/CloudFunctionsService.ts`                                 | `httpsCallable` wrapper for `completeTrip` / `cancelTrip` / `tipDriver` (us-east1)                                                                                                                                                                                                                                                                                 |
| `src/data/services/StripeServerHttpAdapter.ts`                               | 11-method Stripe microservice adapter; Bearer-authed; retry-with-backoff                                                                                                                                                                                                                                                                                           |
| `src/data/services/BackgroundGeolocationClient.ts`                           | 11-method GPS SDK seam; listener-deduped; v5 compound config. `ready()` uses `locationAuthorizationRequest: 'WhenInUse'` + `disableLocationAuthorizationAlert: true`, no `backgroundPermissionRationale` — the 2026-06-01 fix for the v5 `rapidActivityLaunch` SIGKILL loop. The old `__DEV__`/`skipNativeInDev` short-circuit was removed; native runs in dev too |
| `src/data/services/NavigationSdkClient.ts`                                   | 8-method Google Navigation SDK seam; arrival-event dedup; controller-injection pattern                                                                                                                                                                                                                                                                             |
| `src/data/services/FirebaseCrashlyticsAdapter.ts`                            | Crashlytics adapter (modular API); three-state lazy singleton; sticky-failure mode                                                                                                                                                                                                                                                                                 |
| `src/data/services/ExpoNotificationsAdapter.ts`                              | Push-notification adapter — Expo push tokens                                                                                                                                                                                                                                                                                                                       |
| `src/presentation/stores/useGpsStore.ts`                                     | Zustand mirror of GPS streams; `useGpsLifecycle` is the only writer                                                                                                                                                                                                                                                                                                |
| `src/presentation/hooks/useGpsLifecycle.ts`                                  | AppContent-only GPS lifecycle owner                                                                                                                                                                                                                                                                                                                                |
| `src/presentation/hooks/useCurrentLocation.ts`                               | Foreground location read for `*HomeScreen` + `RouteSelect`. Three-tier cold-start fallback (fresh capped last-known → live `getCurrentPositionAsync` → uncapped last-known); guards against the "stale last-dropoff" symptom on the home-screen camera, which still relies on this foreground read for its initial centre                                          |
| `src/presentation/components/map/Map.tsx`                                    | Shared MapView wrapper. Always-mounted children pool, `PROVIDER_GOOGLE` on both platforms, and a ref-driven `animateToRegion` effect so `initialRegion` updates after mount actually move the camera (the native prop is one-shot)                                                                                                                                 |
| `src/presentation/hooks/useCrashReportingLifecycle.ts`                       | AppContent-only Crashlytics user-id / attribute / collection-flag mirror                                                                                                                                                                                                                                                                                           |
| `src/presentation/hooks/usePushTokenRegistration.ts`                         | AppContent-only push-token registration with soft-ask UX                                                                                                                                                                                                                                                                                                           |
| `src/presentation/hooks/useForegroundNotificationHandler.ts`                 | AppContent-only foreground push policy — suppresses `chat_message` banners when `useChatUiStore.openRideId` matches the payload `tripId`                                                                                                                                                                                                                           |
| `src/presentation/components/chat/ChatModal.tsx`                             | In-trip chat surface wrapping `react-native-gifted-chat`; effect split (openRideId mirror vs. subscription) + per-snapshot `markMessagesRead` dedupe + send-failure Toast — see `docs/PHASE_10_TURN_8_REVIEW_FIXES.md`                                                                                                                                             |
| `src/presentation/stores/useChatUiStore.ts`                                  | Chat UI state. `lastReadAtByRide` is keyed per `RideId` (Critical-#2 fix); `openRideId` is the suppression signal read by `useForegroundNotificationHandler`                                                                                                                                                                                                       |
| `src/shared/logger/Logger.ts`                                                | Multi-transport logger; `CompositeTransport`; `CrashlyticsLogTransport` rawMeta channel                                                                                                                                                                                                                                                                            |
| `src/shared/pdf/buildReceiptHtml.ts`                                         | Pure HTML-template builder for the receipt-PDF feature                                                                                                                                                                                                                                                                                                             |
| `src/shared/testing/TestContainerProvider.tsx`                               | Test-only container with override slots for every adapter / fake                                                                                                                                                                                                                                                                                                   |

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

All four must be green before commit. CI runs the same. Opening a
GitHub issue also triggers an agent that triages it, reproduces real
bugs via headless Jest, and opens a fix PR — see
[docs/AUTO_FIX_ISSUES.md](docs/AUTO_FIX_ISSUES.md).

End-to-end UI flows live in `e2e/maestro/{auth,rider,driver}` (Maestro;
driver=Android / rider=iOS, stage test accounts). They are not part of
`npm run verify` — run them against a booted simulator/emulator + dev
client. See `e2e/README.md`.

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
- `BG_GEOLOCATION_LICENSE_KEY_ANDROID` /
  `BG_GEOLOCATION_LICENSE_KEY_IOS` — consumed at BUILD time only;
  SDK degrades to time-limited debug mode without. Must be the v5
  **JWT format** (starts with `eyJ...`, ~670 chars). The v4 32-char
  hex license format is rejected by the SDK with `LICENSE VALIDATION
FAILURE` since the 4.19.4 → 5.1.1 upgrade. Android and iOS use
  DIFFERENT per-platform JWTs issued by Transistor's licensing
  portal. Wiring in `app.config.ts`: Android flows through the
  plugin block (`{ license: ... }`), iOS flows through
  `ios.infoPlist.TSLocationManagerLicense` because the Expo
  plugin's iOS handler is a no-op.

## Common tasks

Recipes for adding a use case, domain entity, Firestore repository,
or SDK seam live in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Troubleshooting

Known build- and runtime-time problems with root causes and fixes
are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). Add new
diagnoses there as they're discovered.

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
- Don't "improve" adjacent code, comments, or formatting in files
  you're already editing — every changed line should trace to the
  request.
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

### Feature-area patterns

Driver-side and vehicle-side surfaces have their own patterns —
mode-mirror, derived `arrivedAtPickup`, terminal-redirect rule,
per-tile photo upload state, active-vehicle source-of-truth, etc.
Read [docs/PATTERNS.md](docs/PATTERNS.md) before touching
`useDriverHomeViewModel`, `useDriverDispatchViewModel`,
`useDriverMonitorViewModel`, `useVehicleListViewModel`,
`useVehicleRegistrationViewModel`, `useVehiclePhotosViewModel`,
`useVehicleDetailsViewModel`, or the DriverHome empty-state branch.

## Import paths

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

Per-area inventories (use cases, repositories, SDK seams, stores,
lifecycle hooks, navigators, screens) are derivable from
`ls src/<layer>/...`; the most-touched files are listed in the
Critical files table above.

---

**End of CLAUDE.md.** When in doubt, read the most recent
`docs/PHASE_*.md` (latest: `PHASE_10_TURN_10.md`), then ask.
