# Phase 3 — Turn 1: Foundations for Rider UI

This turn lays down the plumbing every subsequent rider-UI turn (3.2
RouteSearch + RouteSelect, 3.3 RiderHome, 3.4a/b RideMonitor, 3.5
RideReceipt) builds on. No screens land in this turn — the goal is that
once 3.2 starts, every dependency it needs is already wired and tested.

## What's in

### Domain additions

| Path                                 | Notes                                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/entities/ChatMessage.ts` | Branded `ChatMessageId` + read-shape `ChatMessage` interface. Phase 3 only needs the value shape so the `ObserveLatestMessage` stub compiles; the live `ChatRepository` + send/markRead use cases land in Phase 3.5. |

### App layer additions

| Path                                                    | Notes                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/usecases/ride/ObserveTripEvents.ts`            | Subscription-shaped wrap around `RideRepository.subscribeEvents`. Drives the audit-log timeline in RideMonitor's status views (turn 3.4).                                                                          |
| `src/app/usecases/ride/ObserveLatestMessage.ts`         | Phase 3 stub — emits `null` synchronously and never again. The `(args) => unsubscribe` signature is the one Phase 3.5 will fill via a real ChatRepository, so the chat-button unread-dot wiring needs zero rework. |
| `src/app/usecases/ride/GetRideById.ts`                  | One-shot wrap around `RideRepository.getById`. Used by `useRideQuery` for read-only screens (RideReceipt) and deep-link handlers.                                                                                  |
| `src/app/usecases/ride/ListRidesByPassenger.ts`         | One-shot wrap around `RideRepository.listByPassenger`. Used by `useInProgressRideQuery` (RiderHome resumption) and the Phase 5 Activity tab.                                                                       |
| `src/app/usecases/trip-tracking/EvaluateExitWarning.ts` | Pure-domain predicate. Inputs: live coordinates + anchor + radius. Output: `'inside' \| 'exited'` + the actual distance. Default radius is `200m` (legacy parity, see `GEOFENCE_RADIUS_METERS` constant).          |

### Presentation layer additions

#### Hooks (`src/presentation/hooks/`)

`useFirestoreSubscription` — generic subscription hook adapting any
`(callback) => unsubscribe`-shaped use case into React's
`useSyncExternalStore`. Properties:

- consistent within a single render under React 19 concurrent
- synchronous cleanup (legacy CLAUDE.md flagged async cleanup as a
  footgun; this hook structurally prevents it)
- StrictMode-safe — subscribes once per real mount, not per render

`useUseCaseSubscription` is a thin convenience wrapper for use cases that
follow the `execute({ ...args, callback })` shape directly.

#### Stores (`src/presentation/stores/`)

| Store                | Purpose                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useTripDraftStore`  | In-flight ride request before `CreateRide` runs. Holds pickup/dropoff endpoints, route alternatives + selected index, ride-service tier, scheduled pickup time, avoid-tolls flag.              |
| `useGeofenceUiStore` | Pickup/dropoff exit-warning banner visibility. Phase 3 has no setter caller — the banner is testable but unfed; full wiring to a `BackgroundGeolocation.onGeofence` listener lands in Phase 4. |
| `useChatUiStore`     | Chat-modal `isOpen` + `lastReadAt` for the unread-dot derivation. Phase 3 stub-button writes `isOpen: true` long enough to show a "Phase 3.5" toast.                                           |

Each store has a sibling `useXxxFoo` selector hook for fast slice reads
and a `reset()` action used on sign-out / trip-end.

#### Queries (`src/presentation/queries/`)

| File                     | Exports                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keys.ts`                | Centralized `queryKeys` factory tree. Hierarchical so `invalidateQueries({ queryKey: queryKeys.ride.listsForPassenger(uid) })` invalidates every list scoped to that passenger.       |
| `ride.queries.ts`        | `useRideQuery`, `useRidesByPassengerQuery`, `useInProgressRideQuery`, `useCreateRideMutation`, `useCancelRideAsRiderMutation`. The mutations seed/invalidate the relevant cache keys. |
| `serviceArea.queries.ts` | `useServiceAreasQuery`, `useActiveServiceAreaQuery(point)`, `useRideServicesQuery(areaId)`. Catalog data is `staleTime: Infinity`.                                                    |
| `location.queries.ts`    | `useUpdateLocationMutation`. `retry: false` — the adapter's 3-retry backoff is authoritative.                                                                                         |

Active-ride statuses for `useInProgressRideQuery` include
`payment_failed` so the rider can land back on RideMonitor's
`PaymentFailedView` to retry the charge (the retry itself is Phase 6).

### DI container (`src/presentation/di/container.ts`)

Five new use cases registered: `getRideById`, `listRidesByPassenger`,
`observeTripEvents`, `observeLatestMessage`, `evaluateExitWarning`. The
`makeUseCases` composer adds them to the returned `UseCases` object so
both the production container (real Firebase) and `TestContainerProvider`
(in-memory fakes) get the same surface.

### Native deps + Maps API key plugin

`package.json` adds:

- `react-native-maps@1.24.0` — pinned per the legacy CLAUDE.md
  workarounds (AIRMap NSRangeException on iOS New Arch; Android
  pause-NPE patch in the Phase 4 `withNavigationSdk` plugin).
- `react-native-google-places-autocomplete@2.6.4` — pinned at the
  React 19-compatible release per legacy fix.
- `@gorhom/bottom-sheet@^5.2.10` — RideMonitor's bottom-sheet harness.
- `react-native-toast-message@^2.3.3` — toast surface used by the chat
  stub and future error toasts.
- `@react-navigation/bottom-tabs@^7.4.6` — RiderTabsNavigator (turn 3.3).

`plugins/withGoogleMapsApiKey.js` — custom Expo config plugin that
reads `extra.googleMapsApiKeyAndroid` / `extra.googleMapsApiKeyIos` and
injects them into the AndroidManifest meta-data
(`com.google.android.geo.API_KEY`) + the iOS Info.plist `GMSApiKey`. Both
keys are nullable: when the env vars aren't set the plugin warns and
skips, and the runtime falls back to `FakeRoutesService` (no maps render
correctly without the key, but the JS bundle boots).

`app.config.ts` registers the plugin. Order: it runs after
`expo-dev-client` and before the Firebase block, which means it's
available on every prebuild regardless of Firebase config.

## Test counts (delta from Phase 2)

| Category                         | New tests                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Use cases (ride / trip-tracking) | `ObserveTripEvents` (3), `ObserveLatestMessage` (3), `EvaluateExitWarning` (10) |
| Use cases (read paths)           | `GetRideById` (2), `ListRidesByPassenger` (4)                                   |
| Stores                           | `useTripDraftStore` (10), `useGeofenceUiStore` (7), `useChatUiStore` (6)        |
| Hooks                            | `useFirestoreSubscription` (6), `useUseCaseSubscription` (1)                    |

Final tally: **53 new tests** on top of Phase 2's 422 = **475 tests / 68
suites passing**, all four verify gates green (typecheck, lint, format,
test).

## What's deferred to later turns

- **Query unit tests** — the queryFn factories are integration glue around
  use cases. Their behaviour is exercised in turns 3.2–3.5 view-model
  tests. Direct query tests aren't worth the renderHook+QueryClientProvider
  ceremony for what's mostly straight-through wrapping.
- **GPS lifecycle (`StartGpsTracking`, `StopGpsTracking`,
  `BackgroundGeolocationClient`, `useGpsLifecycle`)** — Phase 4 owns this.
  Phase 3 only needs the `EvaluateExitWarning` predicate, which is pure
  and testable without a GPS source.
- **Chat send/markRead/observeThread** — Phase 3.5.
- **Map + autocomplete UI** — turn 3.2.
- **Smoke prebuild on iOS + Android** — must run after `npm install` so
  the new native deps land. The `withGoogleMapsApiKey` plugin's no-key
  warning is expected output; set `GOOGLE_MAPS_APIKEY_ANDROID` /
  `GOOGLE_MAPS_APIKEY_IOS` in `.env.development` (or via EAS Secrets) to
  silence it.

## Acceptance for turn 1

`npm run verify` should remain green:

- **`npm test`** — Phase 2's 422 + ~52 new (suite count grows by ~9).
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors.
- **`npm run format:check`** — clean.

After install:

```bash
npm install                # picks up the four new native deps
npm run prebuild           # confirms withGoogleMapsApiKey applies clean
                           # (warns about missing env vars; that's expected)
```

The smoke prebuild is the canary for whether `react-native-maps@1.24.0`
still cooperates with RN 0.83 + Expo SDK 55 + new arch. If it doesn't,
the next decision point is whether to bump to 1.26+ and re-derive the
Android pause-NPE patch — flagged in the Phase 3 plan as the single
biggest unknown of the phase.

## Risks / known issues to watch on first prebuild

- **react-native-maps 1.24.0 on RN 0.83 / new arch** — legacy operated on
  RN 0.79.6. If the iOS pod install or Android Gradle sync errors out,
  the most likely cause is the Fabric → Paper interop layer. The legacy
  workaround (always-mounted MapView children, opacity-based visibility)
  is encoded as a coding convention in the future shared `Map.tsx`
  component (turn 3.2); the native build itself shouldn't need patches.
- **Google Places autocomplete React 19** — already pinned at the
  fixed version (2.6.4). If the autocomplete throws "Cannot read property
  'isCurrentLocationEnabled' of undefined", verify the version pin
  survived `npm install`.
- **`@gorhom/bottom-sheet` v5 + reanimated 4** — v5 explicitly supports
  reanimated 4. Some upgrade guides surface a warning about
  `useReducedMotion` import paths; if you see one at boot, follow the
  bottom-sheet v5 changelog rather than trying to patch.
