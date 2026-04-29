# Phase 5 — Turn 4: VehiclePhotos + VehicleDetails + retire vehicle-stub

The driver-facing photo upload + read-only detail surfaces, plus the
retirement of the `'vehicle-stub'` literal in `useDriverHomeViewModel`.
Closes Phase 5.

End of turn: **107 suites / 799 tests passing**, **+5 suites / +27 tests**
on top of Phase 5 Turn 3's 102/772. typecheck + lint + format + test all
green.

## What's in

### Native config + dependency

`expo-image-picker@~55.0.19` added to `package.json`. The plugin block
is registered in `app.config.ts` with `photosPermission` +
`cameraPermission` strings — required to avoid the iOS RCTFatal on first
picker call (legacy `CLAUDE.md` documents this failure mode under
"image-picker permission strings").

A fresh `npm run prebuild` is required before the next iOS / Android
rebuild. Verify gates run JS-only and don't touch native config.

### Query layer additions

`src/presentation/queries/vehicle.queries.ts` gains three hooks:

- `useVehicleQuery(vin: Vin | null)` — one-shot read of a single vehicle
  via `GetVehicle`. 30s stale time so post-upload `byVin` invalidation
  refetches quickly. Disabled when `vin` is null.
- `useDriverActiveVehicleQuery()` — composes `useCurrentUserQuery` +
  `GetVehicle`: reads `user.activeVehicleId`, parses it back into a
  `Vin`, then fetches the vehicle. Returns `null` when no active vehicle
  is registered or the legacy doc has a malformed VIN (defensive: log
  and return null rather than crash). Powers the DriverHome stock-photo
  header.
- `useUploadVehiclePhotosMutation()` — wraps `UploadVehiclePhotos`. On
  success invalidates `vehicle.byVin(vin)` so the photos / details
  screens repaint with the new URLs.

Two new keys in `keys.ts`: `vehicle.byVin(vin)` and
`vehicle.activeForDriver(driverId)`.

### View-models

**`useVehiclePhotosViewModel`** — owns the per-tile photo upload state.

The state machine is split between TanStack Query (the live `Vehicle`
read, source of truth for `attached`) and a local `useState`-driven
`PerTileFlags` record (`inFlight` + `errors`, source of truth for
`uploading` / `error`). Per-render derivation:

```
{ kind: 'idle' }                     - default
{ kind: 'uploading' }                - inFlight[type] === true
{ kind: 'error', error }             - errors[type] set
{ kind: 'attached', url }            - vehicle.photos[type] !== null
                                       AND not in flight AND no error
```

Per-tile mutation isolation is achieved without 5 hardcoded mutation
hooks — a single `useUploadVehiclePhotosMutation` is fired via
`mutateAsync` per tile, and the `PerTileFlags` map carries the per-tile
lifecycle. A second tile can upload while the first is still in flight;
the success of one doesn't clear the `inFlight` of another.

Picker integration: library-only via `expo-image-picker` (`mediaTypes:
'images'`, `quality: 0.7`, `allowsEditing: false`). Permission is
requested first via `requestMediaLibraryPermissionsAsync`; denial → tile
error. Cancellation is silent. Camera-first path deferred to Phase 9.

VIN parsing from the route param `string` happens once at the top of
the VM via `Vin.create`. A bad VIN string lands the VM in
`{ kind: 'error', error }` rather than crashing the screen — it's a
programming error path (only screens we control push this route) but
defensive handling is cheaper than a debug session.

8 unit tests covering: tile seeding from existing photos, happy-path
upload, picker cancellation, upload failure → per-tile error
(unaffected siblings), permission denial → per-tile error, ownership
rejection from the use case, `onDone` pops back, malformed VIN landing.

**`useVehicleDetailsViewModel`** — read-only specs view + meta actions.

Composes `useVehicleQuery` + `useCurrentUserQuery` +
`useSetActiveVehicleMutation` + `useDeleteVehicleMutation`. State
machine:

```
{ kind: 'loading' }                                     - vehicle fetch in flight
{ kind: 'error',   error }                              - vehicle fetch failed
{ kind: 'ready',
  vehicle, isActive, canSetActive }                     - happy path
```

`isActive` is `user.activeVehicleId === vehicle.vin`. `canSetActive` is
`vehicle.status === 'approved' && !isActive`. The screen hides the "Set
as active" button when `canSetActive === false`, which catches both
already-active and not-approved cases without a separate disabled
affordance.

`onDelete` wraps `useDeleteVehicleMutation` in `Alert.alert` confirmation
(legacy + Turn 3 list parity). On successful delete the VM pops back to
the list. `onEditPhotos` pushes `VehiclePhotos` with the VIN.

6 unit tests covering: ready state for active and non-active vehicles,
set-active happy path, set-active no-op when not approved, delete
Alert flow with success → goBack, edit-photos navigation.

### Components

- `VehiclePhotoTile` — single tile, generic over `VehiclePhotoType`.
  Renders one of four visual states keyed on `state.kind`:
  - `idle` — dashed border, camera glyph, "Tap to upload" hint.
  - `uploading` — same as idle with a centered ActivityIndicator
    overlay; press disabled.
  - `attached` — uploaded image as background, with a checkmark
    alongside the type label.
  - `error` — red-tinted border, "Tap to retry" plus a "Dismiss" button
    wired to `onClearError`.

  4 component-render tests (idle / attached / uploading / error).

- `VehiclePhotoGrid` — 2-2-1 layout (paired tiles for front/back +
  left/right, then a wide tile for interior). Pure layout component
  driven by the VM state map. Iteration order from `VEHICLE_PHOTO_TYPES`
  so any future tile additions land deterministically.

### Screens

**`VehiclePhotosScreen`** — header with year/make/model from
`useVehicleQuery`, photo-guidelines info banner, the 5-tile grid, and a
Done button. The Done button is disabled while any tile is uploading
(`vm.anyUploading`); leaving mid-tile-upload is otherwise safe (the
mutation is durable, the byVin invalidation persists URLs, the next
mount re-derives `attached`). 3 smoke tests with `expo-image-picker`
mocked.

**`VehicleDetailsScreen`** — hero image (stock photo with `contain` if
present, else `photos.front` with `cover`), ACTIVE badge in the
top-right corner when active, title + status badge + verification notes
(rejection reason), action row (Set-as-active / Edit-photos), photo
gallery row (read-only horizontal scroll over the 5 tile URLs, hidden
when no photos exist), spec section (VIN / class / body / seats / doors
/ fuel / transmission), eligible-services chips, and a destructive
"Delete vehicle" action at the bottom. 5 smoke tests including the
ACTIVE-badge testID.

### List → Details migration

The Turn 3 `VehicleListScreen` activated a vehicle on card tap. Turn 4
splits that responsibility:

- `useVehicleListViewModel.onActivate(vin)` is gone. Replaced by
  `onSelectVehicle(vin)` which pushes `VehicleDetails` with the VIN.
  `setActive` moves to `useVehicleDetailsViewModel.onSetActive`.
- `DriverVehicleCard` prop renamed `onActivate` → `onSelect`. The
  active highlight is now informational only — no longer a tap target
  for activation. The Delete button stays.
- `useVehicleListViewModel.test.tsx` updates: drop the activate-on-tap
  test, add a navigate-to-details test asserting `mockNavigate` and
  `setup.vehiclesRepo.spies.setActive === 0`.

### vehicle-stub retirement

`useDriverHomeViewModel.ts` no longer carries the `VEHICLE_STUB_ID`
literal. The new shape:

- `noActiveVehicle: boolean` derived from `user.activeVehicleId === null`
  (driver role only). True → DriverHome shows an empty-state prompt
  with a "Register a vehicle" CTA instead of the online toggle.
- `onRegisterVehicle: () => void` pushes `Vehicles`.
- `activeVehicle: Vehicle | null` from `useDriverActiveVehicleQuery`.
  Powers the DriverHome stock-photo + active-vehicle thumbnail in the
  bottom card (visible while offline; the ride-card stack takes over
  while online).
- `onToggleOnline` is now an authoritative no-op when
  `noActiveVehicle === true` — defense in depth on top of the screen
  hiding the toggle.

`useDriverHomeViewModel.test.tsx` updates: the existing
`activeVehicleId` assertion flips from the literal `'vehicle-real-1'`
to a valid 17-char VIN; two new tests cover `noActiveVehicle === true`
(toggle is no-op, register CTA pushes `Vehicles`) and
`vm.activeVehicle?.stockPhoto` propagation through
`useDriverActiveVehicleQuery`. Net: +2 cases, 1 modified.

`DriverHomeScreen.tsx` updates: empty-state prompt rendered when
`vm.noActiveVehicle === true` (replacing the online toggle), active
vehicle thumbnail rendered when present and offline, online toggle
gated on `!vm.noActiveVehicle`.

### Navigation

`DriverStackParamList` (`src/presentation/navigation/types.ts`) gains
two routes:

- `VehicleDetails: { vin: string }`
- `VehiclePhotos: { vin: string }`

`DriverNavigator.tsx` registers both with title-only headers (`'Vehicle'`
and `'Vehicle photos'` respectively).

## Scope decisions made / confirmed during the turn

### Q1 — Per-tile mutation isolation via local state, not 5 hooks

The kickoff brief noted "Per-tile mutations are isolated so a second
tile can upload while the first is in flight" without prescribing
implementation. Two paths were available: (a) maintain 5 hardcoded
`useUploadVehiclePhotosMutation` instances (one per `VehiclePhotoType`),
or (b) maintain a single mutation hook and a per-tile state map. We
went with (b) — a `useReducer`-shaped `PerTileFlags` keyed on
`VehiclePhotoType` plus `mutateAsync` calls per tile.

Rationale: option (a) brittles the VM against future tile-set changes
(adding a 6th `VehiclePhotoType` would require editing the VM's hook
roster). Option (b) iterates over `VEHICLE_PHOTO_TYPES` and works for
any tile-set size. Test surface: option (b) is also easier to assert
on — the `flags.errors[type]` and `flags.inFlight[type]` records are
plain data, not React-internal hook state.

### Q2 — Vehicle photos as derived state, not stored

The naive design would mirror photo URLs into a local state map
alongside `inFlight` / `errors`. We don't — `vehicle.photos[type]`
from the live `useVehicleQuery` is the source of truth for `attached`,
and the local state only holds the two transient UI flags
(`inFlight`, `errors`). This means a successful upload's `byVin`
invalidation is the canonical mechanism by which the tile transitions
to `attached`; we don't have to reconcile two state stores.

The trade-off: there's a brief window between mutation success and
byVin refetch where the tile renders as `idle` (because `inFlight` is
cleared and `vehicle.photos[type]` hasn't refetched yet). The
TanStack `gcTime: 0` in `TestContainerProvider` makes the test
deterministic; production has a larger gcTime so the refetch is fast.

### Q3 — Card tap → details, not activate

The kickoff locked decision 5 specified this. Implementing it pulled
several pieces along: the `DriverVehicleCard` prop rename
(`onActivate` → `onSelect`), the `useVehicleListViewModel` callback
rename (`onActivate` → `onSelectVehicle`), and a test rewrite
(`activate` → `navigate-to-details`). The `setActive` mutation moved
into `useVehicleDetailsViewModel.onSetActive` cleanly with no other
callers needing to follow.

### Q4 — Empty-state prompt instead of disabled toggle

The kickoff allowed either UX. Empty-state prompt was chosen because
it's a clearer call to action — a disabled toggle reads as "something
broke" while an explicit "Register a vehicle" CTA reads as
"here's the next step." This matches the legacy app's first-launch
flow.

The `DriverHomeScreen` gates the empty-state branch on
`vm.noActiveVehicle === true`, which is itself driver-role-gated. A
rider role somehow rendering DriverHome (shouldn't happen given the
RootNavigator gate) would see the active-vehicle / online-toggle
branch — empty state stays driver-only.

### Q5 — `app.config.ts` permission strings are required

Confirmed during the turn: the kickoff's claim that
"`expo-image-picker` is already configured for the rider avatar flow"
was inaccurate. The rewrite has no avatar upload yet (
`UserProfileScreen.tsx:75-86` shows an "Avatar upload coming in Phase 9"
placeholder), and `expo-image-picker` was not in `package.json`
before this turn. Turn 4 adds both the dependency and the plugin
block — a fresh `npm run prebuild` is required before the next iOS /
Android build, otherwise the first picker call will RCTFatal.

## Test counts

| Gate                   | Result                              |
| ---------------------- | ----------------------------------- |
| `npm run typecheck`    | ✅                                  |
| `npm run lint`         | ✅ (only pre-existing v5→v6 warns)  |
| `npm run format:check` | ✅                                  |
| `npm test`             | ✅ — 107 suites / 799 tests passing |

Net delta from Turn 3: **+5 suites / +27 tests**.

## Files added

Presentation — view-models:

- `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts`
- `src/presentation/features/driver/view-models/useVehicleDetailsViewModel.ts`
- `src/presentation/features/driver/view-models/__tests__/useVehiclePhotosViewModel.test.tsx`
- `src/presentation/features/driver/view-models/__tests__/useVehicleDetailsViewModel.test.tsx`

Presentation — screens:

- `src/presentation/features/driver/screens/VehiclePhotosScreen.tsx`
- `src/presentation/features/driver/screens/VehicleDetailsScreen.tsx`
- `src/presentation/features/driver/screens/__tests__/VehiclePhotosScreen.test.tsx`
- `src/presentation/features/driver/screens/__tests__/VehicleDetailsScreen.test.tsx`

Presentation — components:

- `src/presentation/features/driver/components/VehiclePhotoTile.tsx`
- `src/presentation/features/driver/components/VehiclePhotoGrid.tsx`
- `src/presentation/features/driver/components/__tests__/VehiclePhotoTile.test.tsx`

Docs:

- `docs/PHASE_5_TURN_4.md` (this file)

## Files touched

- `package.json` — added `expo-image-picker@~55.0.19`.
- `app.config.ts` — added `expo-image-picker` plugin block with
  `photosPermission` + `cameraPermission` strings.
- `src/presentation/queries/vehicle.queries.ts` — added
  `useVehicleQuery`, `useDriverActiveVehicleQuery`,
  `useUploadVehiclePhotosMutation`. New `UploadVehiclePhotosInput`
  type re-exported from `index.ts`.
- `src/presentation/queries/keys.ts` — added `vehicle.byVin(vin)` and
  `vehicle.activeForDriver(driverId)`.
- `src/presentation/queries/index.ts` — re-export the three new hooks
  - `UploadVehiclePhotosInput` type.
- `src/presentation/navigation/types.ts` — added `VehicleDetails: { vin: string }`
  and `VehiclePhotos: { vin: string }` to `DriverStackParamList`.
- `src/presentation/navigation/DriverNavigator.tsx` — registered the
  two new screens.
- `src/presentation/features/driver/view-models/useVehicleListViewModel.ts`
  — `onActivate` removed; `onSelectVehicle` added (navigate-to-details).
  `useSetActiveVehicleMutation` import dropped (moved to details VM).
- `src/presentation/features/driver/view-models/__tests__/useVehicleListViewModel.test.tsx`
  — flipped activate-on-tap tests to navigate-to-details.
- `src/presentation/features/driver/components/DriverVehicleCard.tsx` —
  `onActivate` → `onSelect`. Active highlight now informational.
- `src/presentation/features/driver/screens/VehicleListScreen.tsx` —
  pass `vm.onSelectVehicle` to the card.
- `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`
  — removed `VEHICLE_STUB_ID`. Added `noActiveVehicle` +
  `onRegisterVehicle` + `activeVehicle`. `onToggleOnline` is a no-op
  when `noActiveVehicle === true`.
- `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
  — switched to a valid VIN; added two new tests
  (`noActiveVehicle === true` branch and `activeVehicle` propagation).
- `src/presentation/features/driver/screens/DriverHomeScreen.tsx` —
  empty-state prompt + active-vehicle thumbnail.

## What's deferred to Phase 9 polish

- Per-tile "clear" / individual photo deletion (legacy doesn't support
  it; the rewrite mirrors that until polish).
- Multi-photo selection per tile (legacy is one URL per type; preserved).
- Camera-first picker UX (library-first this turn).
- VehicleDetails edit-info flow (delete-and-re-register if mistyped).
- Storage orphan sweep (re-uploads leave the prior Storage object in
  place; not a correctness issue but a hygiene one).
- iOS Storage smoke from a fresh prebuild — defer to user-side
  verification after `npm run prebuild` lands; the existing
  `use_modular_headers!` patch in `scripts/patch-podfile.js` should
  cover the @react-native-firebase/storage pod.

## Phase 5 progression after this turn

| Turn | Scope                                                | Status |
| ---- | ---------------------------------------------------- | ------ |
| 1    | Domain + DTO + mappers + in-memory fakes             | ✅     |
| 2    | Real adapters + 9 use cases + DI wiring              | ✅     |
| 3    | VehicleList + VehicleRegistration screens            | ✅     |
| 4    | VehiclePhotos + VehicleDetails + retire vehicle-stub | ✅     |

**Phase 5 closed.** Phase 6 (Payments / Stripe Connect / tipping) is
next.
