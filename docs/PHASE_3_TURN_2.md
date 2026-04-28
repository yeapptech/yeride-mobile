# Phase 3 — Turn 2: RouteSearch + RouteSelect screens

The first turn that lands actual screens. A signed-in rider can now go
RiderHome (placeholder) → RouteSearch → RouteSelect against seeded data.
The `CreateRide` invocation still defers to turn 3.3 — turn 3.2 stops at
"selection captured in `useTripDraftStore`".

## What's in

### App layer

| Path                                     | Notes                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/usecases/route/EstimateFare.ts` | Thin pre-trip fare wrapper around `FareCalculator.estimate`. Returns a single `Money` per (Route × RideService). Single-fare semantics match legacy `calculateRangeFare`; Phase 6 can add range. |

### Presentation — components

#### Map (`src/presentation/components/map/`)

`Map.tsx` — shared `react-native-maps` wrapper following the
**always-mounted-children rule** (per legacy CLAUDE.md AIRMap entry):

- Fixed-size pool of 3 marker slots (pickup, dropoff, driver) and 5
  polyline slots (3 alternative routes + pickup-route + selected-route).
- Visibility driven by props — empty `coordinates={[]}` hides
  polylines; `opacity={0}` + dummy coordinate hides markers. Never
  conditional `{cond && <Polyline/>}`.
- Selected route renders LAST so it draws on top of any alternative
  sharing segments.
- Provider: `'google'` on Android (matches `withGoogleMapsApiKey` plumbing);
  default Apple Maps on iOS.

`decodePolyline.ts` — inlined Google polyline decoder (zero runtime deps).
Tolerates malformed input by returning the points decoded so far rather
than throwing.

#### Route components (`src/presentation/components/route/`)

| Component          | Purpose                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `EndpointSummary`  | Two-line pickup/dropoff card. `kind: 'pickup' \| 'dropoff'` toggles dot color (gold/red).                                            |
| `FareEstimate`     | Single-fare display. "—" when null. USD-only formatting in the hot path.                                                             |
| `TollBadge`        | Inline pill rendering the toll price; renders nothing when `tollPrice` is null.                                                      |
| `RouteSelector`    | Horizontal-scroll route alternative cards with selected highlight + toll badges + Google route labels (`Fastest`, `Fuel efficient`). |
| `RideServicesList` | Vertical ride-service tier list with name/seats/description + per-row `FareEstimate`.                                                |

### Presentation — feature screens (`src/presentation/features/rider/`)

#### `RouteSearchScreen` + `useRouteSearchViewModel`

Single-screen pickup + dropoff entry with two stacked
`react-native-google-places-autocomplete` widgets. View-model reads
the active service area from `useServiceAreaStore` and emits a
`circle:radius@lat,lng` `locationbias` to scope autocomplete results;
falls back to unbounded when no active area is set.

Architecture seam: the autocomplete widget calls Google Places directly
(bypassing our use cases). The view-model is the boundary — it accepts
raw place data via `setPickupFromPrediction` / `setDropoffFromPrediction`,
normalizes through `Endpoint.create`, and writes only valid value
objects to `useTripDraftStore`. Phase 6 can swap to a custom autocomplete
behind a `GooglePlacesService` interface here without touching the screen.

#### `RouteSelectScreen` + `useRouteSelectViewModel`

Top-half map + bottom-half scrollable card:

- `EndpointSummary` for pickup + dropoff
- Avoid-tolls Switch (toggling re-fetches routes)
- `RouteSelector` for alternatives
- `RideServicesList` for ride-service tiers with fare per row
- Confirm button (turn 3.2 just navigates back; turn 3.3 wires
  `CreateRide` → RideMonitor)

View-model responsibilities: redirect-if-no-endpoints guard,
debounced `ComputeRoutes` on pickup/dropoff/avoidTolls (300ms), per-tier
fare derivation via `EstimateFare`, friendly error formatting per
DomainError kind. Stale-response cancellation via a request-id ref so
rapid avoidTolls toggles don't race.

### Navigation

`MainStackParamList` extended with `RouteSearch` and `RouteSelect`.
`MainNavigator` mounts both screens. `HomePlaceholderScreen` gets a
"Plan a ride" button that pushes RouteSearch.

### Type shim — react-native-maps

`react-native-maps` 1.24.0 publishes its `.tsx` source as `main` (no
compiled `.d.ts`), so importing it pulled the package's strict-mode-
incompatible source into our typecheck (~30 errors across files we
don't touch). Workaround: `src/shared/types/react-native-maps.d.ts`
declares only the surface `Map.tsx` consumes; `tsconfig.paths` redirects
TypeScript's module resolution to the shim. Metro and Jest don't read
tsconfig.paths, so runtime resolution still picks the real package.

If we ever need additional react-native-maps primitives (`Circle`,
`Polygon`, `Heatmap`, `Callout`), extend the shim rather than chasing
transitive types through the package source.

### DI container

`EstimateFare` registered. The view-models don't add new use cases beyond
this — they compose existing ones (`computeRoutes`, `listRideServices`,
`estimateFare`).

## Test counts (delta from turn 3.1)

| Category           | New tests                                                     |
| ------------------ | ------------------------------------------------------------- |
| Use cases          | `EstimateFare` (4)                                            |
| Presentation utils | `decodePolyline` (4)                                          |
| View-models        | `useRouteSearchViewModel` (10), `useRouteSelectViewModel` (8) |

**26 new tests** on top of turn 3.1's 475 = **501 tests / 72 suites
passing**, all four verify gates green.

## What's deferred to later turns

- **`Map.tsx` rendering tests** — exercising the always-mounted-children
  invariants requires a real react-native-maps mock or Detox. View-model
  tests don't touch the component, and turn 3.3+ Detox will. Intentional
  hole for now.
- **Branded marker / polyline styling** — turn 3.3 will swap default
  pins for custom views inside `<Marker>` (still always-mounted).
- **Schedule-pickup datetime picker** — `useTripDraftStore.scheduledPickupAt`
  exists; UI binding lands in Phase 5 alongside scheduled-ride creation.
- **`CreateRide` from RouteSelect** — Confirm button is a stub that
  navigates back to Home. Turn 3.3 wires the real mutation +
  RideMonitor navigation.
- **RouteSearch keyboard-aware scroll polish** — two stacked
  autocompletes inside a parent ScrollView is fine for the harness;
  turn 3.3 may swap to a focused-on-tap pattern (Uber/Lyft style) if the
  stacked layout doesn't feel right after a real-Maps-key smoke test.

## Acceptance for turn 2

`npm run verify`:

- **`npm test`** — 501 tests / 72 suites passing (up from 475 / 68).
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors. Boundaries v6 deprecation warning
  is the same one that's been there since Phase 1.
- **`npm run format:check`** — clean.

## Risks / known issues to watch on first real-Maps-key boot

- **react-native-maps 1.24.0 on RN 0.83 + new arch** — the type shim
  bypasses one class of friction (typecheck), but doesn't validate
  runtime. The smoke prebuild + first-launch on iOS/Android are still
  the canary for whether the AIRMap workaround in `Map.tsx` holds. If
  the iOS app SIGABRTs on entering RouteSelect, the always-mounted-
  children invariant has slipped — check that no caller passes
  conditional MapView children.

- **Two stacked GooglePlacesAutocomplete widgets** — the legacy app
  pinned at 2.6.4 because of a React 19 `defaultProps` crash. If
  RouteSearch throws "Cannot read property 'isCurrentLocationEnabled'
  of undefined" at boot, that pin has slipped via a transitive update.

- **`disableScroll` interaction with the parent ScrollView** — the
  inline-suggestions list now sits inside a ScrollView. If the
  suggestions list doesn't scroll on long results, drop `disableScroll`
  on one widget at a time and let it self-scroll instead.
