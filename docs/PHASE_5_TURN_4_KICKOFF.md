# Phase 5 — Turn 4 Kickoff Prompt — VehiclePhotos + VehicleDetails + retire `'vehicle-stub'`

Paste below the cut into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 5 (Vehicle management). Turn 1 shipped the Vehicle domain + DTO +
in-memory fakes; Turn 2 shipped real adapters (Firestore + Storage + NHTSA),
the 9 vehicle-management use cases, and the DI / TestContainerProvider
wiring; Turn 3 shipped the driver-facing list + registration screens
(VehicleList + VehicleRegistration), the `VehicleClassifier` domain
service, the vehicle queries layer, and a role-gated "My vehicles" entry
inside the shared `UserProfileScreen` — all under green verify gates
(102 suites / 772 tests). Your job this session is **Turn 4**: photo
upload, the read-only vehicle detail view, retiring the
`'vehicle-stub'` literal in `useDriverHomeViewModel`, and surfacing the
active vehicle's stock photo on `DriverHome`. After this turn lands,
Phase 5 closes and Phase 6 (Payments / Stripe Connect / tipping) is
next. Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file
   map. Phase 5 turn 3 is now ✅; Turn 4 is Next.
2. `docs/PHASE_5_TURN_3.md` — what Turn 3 shipped, what's deferred to
   Turn 4, locked decisions.
3. `docs/PHASE_5_KICKOFF.md` — overall Phase 5 plan (scope, locked
   decisions, suggested turn breakdown, end-of-phase acceptance bar).
4. Legacy `yeride/src/driver/screens/VehiclePhotos.js` — UI / UX
   reference for the five-tile grid + image-picker flow.
5. Legacy `yeride/src/driver/screens/VehicleDetails.js` — UI / UX
   reference for the read-only specs view + set-active / delete /
   edit-photos actions.
6. Legacy `yeride/src/api/firebase/Vehicle.js` — `uploadVehiclePhotos`
   helper for the storage path convention (already mirrored in
   `FirebaseStorageVehiclePhotoRepository`; you're checking the UX
   shape only).
7. `src/app/usecases/vehicle/UploadVehiclePhotos.ts` — the auth-gated
   use case the photos VM will consume. Note the auth + ownership
   pre-check (Phase 5 Turn 2 locked decision Q1) — it rejects with
   `vehicle_photos_not_owned_by_driver` BEFORE any Storage write.
8. `src/app/usecases/vehicle/{GetVehicle,SetActiveVehicle,DeleteVehicle}.ts`
   — the use cases the details VM will consume.
9. `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts:65`
   — the `VEHICLE_STUB_ID = 'vehicle-stub'` literal you're retiring.
   The fallback is at lines 187-191. The view-model's existing test
   relies on the stub for the online-toggle path when
   `activeVehicleId` is null — that test needs to flip to expect the
   empty-state prompt instead.
10. `src/presentation/features/auth/view-models/useUserProfileViewModel.ts`
    - the `UploadAvatar` use case (Phase 1 turn 2) — reference for an
      existing image-picker → repository upload flow in the rewrite.
11. `src/shared/testing/TestContainerProvider.tsx` — how to seed
    `vehicles` / `vehiclePhotos` overrides for view-model tests.
12. `app.config.ts` — confirm `expo-image-picker` config and the iOS
    `NSPhotoLibraryUsageDescription` / `NSCameraUsageDescription`
    permission strings are present. The rider-avatar flow already
    needs them; if they're missing the first iOS launch crashes (see
    legacy `CLAUDE.md` permission-strings troubleshooting entry).

## Starting state — what's already built (Turns 1-3)

- **Domain**: `Vehicle` entity + state machine, `VehicleClassifier`
  manual-entry classifier with `computeEligibleServices` parity map.
- **Data**: `FirestoreVehicleRepository` (write-batch + per-VIN fan-out
  subscribe), `FirebaseStorageVehiclePhotoRepository`
  (`putFile` + `getDownloadURL`, path `vehicles/{vin}/{type}_{ts}.jpg`),
  `NhtsaVinDecoderService` (keyless vPIC + SafetyRatings).
- **Use cases**: All 9 from Turn 2 — `UploadVehiclePhotos` runs the
  ownership pre-check, then sequential per-photo Storage upload + each
  upload's `attachPhoto` + repo `update`. First failure aborts; prior
  successful uploads stay attached.
- **Presentation**:
  - View-models: `useVehicleListViewModel`,
    `useVehicleRegistrationViewModel`.
  - Screens: `VehicleListScreen`, `VehicleRegistrationScreen`.
  - Components: `DriverVehicleCard`, `VinEntryStep`,
    `DecodedPreviewStep`, `ManualEntryStep`.
  - Queries: `useVinDecodeQuery`, `useRegisterVehicleMutation`,
    `useSetActiveVehicleMutation`, `useDeleteVehicleMutation` (all
    invalidate `user.current`).
  - Navigation: `Vehicles` + `VehicleRegistration` routes registered
    on `DriverNavigator`. Profile-tab entry via role-gated row inside
    the shared `UserProfileScreen`.
- **Tests**: 102 suites / 772 tests passing.

The `useDriverHomeViewModel.ts:65` `'vehicle-stub'` literal is the
last piece blocking real driver-side activation. Once removed, a
driver can't go online without a registered + active vehicle.

## Scope decisions (locked at Turn 4 kickoff — confirm or override)

1. **Five-tile grid: front, back, left, right, interior.** Same set
   as legacy. `VehiclePhotoType` already enumerates these. Tiles
   render the existing photo URL when `vehicle.photos.{type}` is
   non-null, else a placeholder; tapping a tile launches
   `expo-image-picker` (library picker, with camera as a secondary
   option via the picker's `mediaTypes`). Selected URI flows through
   the VM into `UploadVehiclePhotos`.
2. **Empty tiles are allowed.** Legacy doesn't gate approval on
   photo completeness, and the rewrite's `Vehicle` entity doesn't
   either (`Vehicle.ts` JSDoc explicitly notes this). The "Done"
   button on `VehiclePhotosScreen` is always enabled.
3. **Single-tile re-uploads (overwrite semantics).** Tapping an
   already-filled tile launches the picker again; on success, the
   new URL replaces the prior one via `attachPhoto`. The previous
   Storage object stays in place (legacy doesn't delete; we mirror
   that — Phase 9 polish can sweep orphans).
4. **`UploadVehiclePhotos` is per-tile, not batch.** Each tile
   tap fires a single-entry map (e.g.
   `{ front: 'file://...local-uri' }`) so the VM can render
   per-tile spinners and per-tile errors without a batch failure
   model. The use case still supports multi-entry maps; we just
   don't use that on this UI surface.
5. **Tap card → push `VehicleDetails`; set-active moves into the
   detail screen.** The current Turn 3 list card has tap-to-activate.
   Turn 4 changes that to tap-to-navigate-to-detail. The detail
   screen has the "Set as active" button. This frees the card up
   to be a richer info row and follows legacy. The Delete button
   stays on the card itself (one-step destructive action, same
   Alert-confirm flow Turn 3 wired).
6. **Retire `'vehicle-stub'` via empty-state prompt on
   DriverHome.** When `user.activeVehicleId === null`, `DriverHome`
   shows a banner "Register a vehicle to start accepting rides" with
   a CTA pushing `Vehicles`. The online toggle is hidden in this
   state. The `goOnline(seedId)` call signature stays the same;
   `useDriverHomeViewModel` just doesn't reach that branch when
   there's no active vehicle.
7. **Surface the active vehicle's stock photo on DriverHome.** Use
   `useDriverActiveVehicleQuery` (new, see file punch-list) →
   `GetVehicle.execute(vin)` → render `vehicle.stockPhoto ??
vehicle.photos.front` in the header card. Skip when no active
   vehicle (the empty-state prompt covers that case).

## Scope (in / out)

### In

**View-models** (`src/presentation/features/driver/view-models/`):

- `useVehiclePhotosViewModel.ts` — owns the per-tile upload state.
  Five tiles, each with a tagged-union state:
  `{ kind: 'idle' } | { kind: 'picking' } | { kind: 'uploading' } | { kind: 'attached', url } | { kind: 'error', error }`.
  Per-tile actions: `onPickPhoto(type)`, `onClearError(type)`. The VM
  is constructed for a specific VIN (`useRoute().params.vin`), reads
  the live vehicle via `GetVehicle` + `useFirestoreSubscription` (or
  one-shot `useVehicleQuery` — confirm at scope), and dispatches
  `UploadVehiclePhotos` mutations one tile at a time. "Done"
  navigates back.
- `useVehicleDetailsViewModel.ts` — read-only specs view + meta
  actions. Composes:
  - `useVehicleQuery(vin)` — one-shot read (`GetVehicle`).
  - `useCurrentUserQuery` — for the active-VIN comparison.
  - `useSetActiveVehicleMutation` + `useDeleteVehicleMutation` (already
    shipped).
  - `useVehiclePhotosNavigation()` — small helper to push
    `VehiclePhotos` with the VIN.
  - State: `loading | ready | error`. Actions: `onSetActive`,
    `onDelete`, `onEditPhotos`, `onBack`.

**Screens** (`src/presentation/features/driver/screens/`):

- `VehiclePhotosScreen.tsx` — header + 5-tile grid + Done button.
  Per-tile spinner overlay during upload; per-tile error toast or
  inline error chip. Library picker (camera secondary) via
  `expo-image-picker`.
- `VehicleDetailsScreen.tsx` — header (year / make / model / status
  badge), photo gallery row (read-only horizontal scroll across the
  five tile URLs), spec section (class / seats / doors / fuel /
  eligible-services chips), action buttons (Set active / Edit photos /
  Delete).

**Components** (`src/presentation/features/driver/components/`):

- `VehiclePhotoTile.tsx` — single tile with image fallback +
  per-tile state visualization (idle / picking / uploading / attached
  / error). Generic over `VehiclePhotoType`.
- `VehiclePhotoGrid.tsx` — 5-tile grid layout (2-2-1 or 2x3 with
  one missing — mirror legacy). Renders five `VehiclePhotoTile`s
  driven by the VM state map.

**Stub retirement + DriverHome surfacing:**

- Edit `useDriverHomeViewModel.ts` to remove `VEHICLE_STUB_ID` and
  the fallback in `onToggleOnline`. Add a `noActiveVehicle: boolean`
  field to the VM output and a `onRegisterVehicle()` callback that
  navigates to `Vehicles`.
- Edit `DriverHomeScreen.tsx` to render an empty-state prompt when
  `noActiveVehicle === true` (replaces the online toggle), and to
  surface the active vehicle's stock photo when present.
- Edit `useDriverHomeViewModel.test.tsx` to flip the stub-fallback
  case to assert the new empty-state behavior, and add a test for
  the active-vehicle stock-photo surfacing.

**Queries:**

- Add `useVehicleQuery(vin)` to `vehicle.queries.ts` —
  `GetVehicle.execute(vin)` mapped through TanStack `useQuery`. Stale
  time short (< 1 minute) since the doc updates often during the
  photos flow.
- Add `useDriverActiveVehicleQuery()` — pulls
  `useCurrentUserQuery().data?.activeVehicleId`, then
  `GetVehicle.execute(vin)`. Returns `null` when no active vehicle.
  Used by `DriverHome` for the stock-photo surfacing.

**Navigation:**

- Add `VehiclePhotos: { vin: string }` and `VehicleDetails: { vin: string }`
  to `DriverStackParamList` in `src/presentation/navigation/types.ts`.
- Register both screens in `DriverNavigator.tsx`.
- Wire `useVehicleListViewModel` to push `VehicleDetails` instead
  of activating directly when a card is tapped (per locked decision 5).
- The Delete button on `DriverVehicleCard` stays.

**Tests:**

- `useVehiclePhotosViewModel.test.tsx` — 6 cases: initial state from
  seeded vehicle, pick-photo happy path attaches the URL, picker
  cancellation no-ops, mid-tile upload failure surfaces error
  per-tile, second tile uploads while first is still in flight,
  ownership rejection from the use case surfaces error.
- `useVehicleDetailsViewModel.test.tsx` — 5 cases: ready state for
  seeded vehicle, set-active happy path, set-active rejected when
  vehicle not approved, delete happy path navigates back, delete
  rejected when vehicle not owned.
- `VehiclePhotosScreen.test.tsx` — 3 smoke cases: renders 5 tiles,
  tapping a tile fires the picker (mocked), Done button navigates
  back.
- `VehicleDetailsScreen.test.tsx` — 3 smoke cases: renders specs,
  renders ACTIVE badge when `vehicle.vin === user.activeVehicleId`,
  Edit-photos button pushes `VehiclePhotos` with the VIN.
- `useDriverHomeViewModel.test.tsx` — flip the stub fallback case;
  add empty-state-prompt assertion + active-stock-photo assertion.
  ~2 new cases, 1 modified.
- `VehiclePhotoTile.test.tsx` — 3 smoke cases: idle / uploading /
  attached visual states.

### Out (deferred)

- **Photo deletion / clear-tile.** Legacy doesn't support it
  individually; the rewrite mirrors that until Phase 9 polish. The
  existing `Vehicle.attachPhoto` rejects empty URLs, so a "clear"
  would need a separate use case.
- **Multi-photo selection per tile.** Legacy is one URL per type;
  preserve that.
- **VehicleDetails edit-info flow.** Editing make / model / year
  post-registration isn't on the roadmap. If a driver mistypes
  during manual entry, they delete and re-register.
- **Camera-first picker (vs. library-first).** Library picker is
  the primary path; camera is reachable via the picker's media-source
  toggle. A dedicated camera button can land in Phase 9 polish.
- **iOS Storage smoke from a fresh prebuild.** Carried over from
  Turn 2 — confirm `putFile` + `getDownloadURL` against staging
  works on first iOS rebuild. Likely just-works given the existing
  modular-headers patch in `scripts/patch-podfile.js`, but verify.
- **Admin approve / reject UI.** Use cases ship; surface stays
  out of scope for the mobile app.

## Suggested file punch list (for Turn 4 alignment)

Files to create:

1. `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts`
2. `src/presentation/features/driver/view-models/useVehicleDetailsViewModel.ts`
3. `src/presentation/features/driver/view-models/__tests__/useVehiclePhotosViewModel.test.tsx`
4. `src/presentation/features/driver/view-models/__tests__/useVehicleDetailsViewModel.test.tsx`
5. `src/presentation/features/driver/screens/VehiclePhotosScreen.tsx`
6. `src/presentation/features/driver/screens/VehicleDetailsScreen.tsx`
7. `src/presentation/features/driver/screens/__tests__/VehiclePhotosScreen.test.tsx`
8. `src/presentation/features/driver/screens/__tests__/VehicleDetailsScreen.test.tsx`
9. `src/presentation/features/driver/components/VehiclePhotoTile.tsx`
10. `src/presentation/features/driver/components/VehiclePhotoGrid.tsx`
11. `src/presentation/features/driver/components/__tests__/VehiclePhotoTile.test.tsx`

Files to touch:

1. `src/presentation/queries/vehicle.queries.ts` — add `useVehicleQuery`,
   `useDriverActiveVehicleQuery`, `useUploadVehiclePhotosMutation`.
   Re-export from `presentation/queries/index.ts`.
2. `src/presentation/queries/keys.ts` — add `vehicle.byVin(vin)` +
   `vehicle.activeForDriver(driverId)` keys.
3. `src/presentation/navigation/types.ts` — add `VehiclePhotos: { vin: string }`
   and `VehicleDetails: { vin: string }` to `DriverStackParamList`.
4. `src/presentation/navigation/DriverNavigator.tsx` — register the
   two new screens.
5. `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`
   — remove `VEHICLE_STUB_ID`, add `noActiveVehicle` + `onRegisterVehicle`,
   surface the active vehicle's stock photo via `useDriverActiveVehicleQuery`.
6. `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
   — flip the stub case; add empty-state + stock-photo assertions.
7. `src/presentation/features/driver/screens/DriverHomeScreen.tsx` —
   render the empty-state prompt and the active-vehicle photo when
   present.
8. `src/presentation/features/driver/view-models/useVehicleListViewModel.ts`
   — change card tap from `onActivate` to a navigate-to-detail
   handler. Keep the per-card Delete button.
9. `src/presentation/features/driver/components/DriverVehicleCard.tsx`
   — pass through the new tap behavior; tighten the active-highlight
   to be informational rather than the "tap to set active" affordance.
10. `app.config.ts` — verify `expo-image-picker` plugin block + the
    iOS permission strings (`NSPhotoLibraryUsageDescription`,
    `NSCameraUsageDescription`). If they need updating, run
    `npm run prebuild` afterward.

## Conventions (non-negotiable — same as Turns 1-3)

- Server state goes in TanStack Query; client/UI state goes in Zustand.
  Don't mix.
- View-model owns orchestration; screen body is dumb (props in, JSX out).
- Every form field uses react-hook-form + Zod where present; value
  objects via factory `Result.create`s, never `as`.
- `Result.ok` / `Result.err` for every expected failure. No throws
  for domain failures.
- Logger only — `LOG.extend('VehiclePhotosVM')` etc. Never `console.*`.
- NativeWind class names from the existing semantic-token palette
  (`bg-card`, `text-primary`, `bg-success/10`, etc.).
- All status-router-style state machines should be a tagged union with
  a single `kind` discriminant. Tests assert on `kind` first, then
  per-kind shape.
- Screens never call `useUseCases()` directly — only the view-model
  does.
- View-model tests render via `TestContainerProvider`, seeding the
  in-memory fakes via the override props (`vehicles`, `vehiclePhotos`,
  `users`, `auth`).
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring the turn done.

## Acceptance for end of Turn 4

- A signed-in driver can: register a vehicle (Turn 3 path) → land on
  the list with the new vehicle marked active → tap the card → land
  on `VehicleDetails` → tap "Edit photos" → land on `VehiclePhotos`
  → tap a tile → pick a library photo → see the tile fill in with
  the uploaded URL → tap "Done" → back to `VehicleDetails` showing
  the photo in the gallery row.
- A signed-in driver with NO active vehicle lands on `DriverHome`
  and sees the empty-state prompt + register CTA INSTEAD of the
  online toggle. Tapping the CTA pushes `Vehicles`. The
  `'vehicle-stub'` literal is gone from the codebase.
- `DriverHome` for a signed-in driver WITH an active vehicle
  surfaces the active vehicle's stock photo (or photos.front
  fallback) in the header.
- `useDriverActiveVehicleQuery` resolves correctly when
  `activeVehicleId` is set; returns `null` cleanly when not.
- `npm run verify` green. Estimate +6 suites / +25 tests over
  Turn 3's 102/772 — bringing total to ~108 suites / ~797 tests.
- `docs/PHASE_5_TURN_4.md` written.
- Phase 5 closes; `CLAUDE.md` status table flipped (Phase 5 → ✅,
  Phase 6 → Next, refresh test count + critical-files block).

## Risks + mitigations

- **iOS image-picker boot crash if permission strings are missing.**
  Legacy `CLAUDE.md` documents the failure mode (`RCTFatal` on first
  call). Mitigation: confirm `app.config.ts` has both
  `NSPhotoLibraryUsageDescription` and
  `NSCameraUsageDescription` set before the first iOS rebuild.
  Already configured for the rider-avatar flow per the Phase 1
  fold-in, but verify before Turn 4 ends.
- **Firebase Storage iOS modular-headers.** The
  `use_modular_headers!` patch in `scripts/patch-podfile.js` covers
  every pod. First Storage exercise might surface a missing pod
  pin; if so, extend the patch following the same pattern as the
  existing Auth + Firestore fixes.
- **`UploadVehiclePhotos` ownership pre-check.** The use case reads
  `users.getById(uid).vehicleIds[]` BEFORE any Storage write. If
  the user-doc fetch is slow or fails, the spinner will hold longer
  than the storage upload itself. Surface a "Loading…" indicator
  before the picker fires, and on use-case `AuthorizationError`
  show "You don't own this vehicle" rather than a generic upload
  error.
- **Live subscription vs. one-shot read for the photos VM.** The
  photos screen needs to see the new URL after upload — but we own
  that URL in-memory via the mutation's success payload. A
  one-shot `useVehicleQuery` is cheaper than a live subscription
  here. Mitigation: use `useVehicleQuery` (one-shot) and rely on
  `queryClient.invalidateQueries` after each `attachPhoto` to
  re-fetch. Skip the subscription unless tests show stale-cache
  issues.
- **Stock-photo URL shape on the legacy and rewrite paths.** Both
  the NHTSA decode and the manual entry produce
  `vehicle.stockPhoto: string | null`. `DriverHome` should fall
  through `stockPhoto ?? photos.front ?? null`. When all three are
  null, render a generic placeholder (existing `bg-muted` styling).
- **The card tap UX shift.** Turn 3's `DriverVehicleCard` activates
  on tap; Turn 4 changes that to navigate-to-detail. Drivers used
  to the activate-on-tap behavior won't notice (Turn 3 only just
  shipped) but tests targeting `onActivate` need to flip. The
  set-active path migrates onto `VehicleDetails`. Update
  `useVehicleListViewModel.test.tsx` accordingly.

## Start with

Read `CLAUDE.md`, then `docs/PHASE_5_TURN_3.md`, then the Phase 5
section of `docs/PHASE_5_KICKOFF.md`, then the legacy
`VehiclePhotos.js` and `VehicleDetails.js`, then
`src/app/usecases/vehicle/UploadVehiclePhotos.ts` (the auth +
ownership pre-check matters), then `useDriverHomeViewModel.ts:65`
and its existing test (the stub site you're retiring), then a couple
of existing screen-with-image patterns in the rewrite (the rider
avatar flow's `UploadAvatar` use case + its callsite). Then propose
Turn 4 scope as a numbered punch list (files to create, files to
touch, tests to add) and wait for confirmation before writing code.

Tip: this kickoff has the same shape as Phase 5 Turns 1, 2, and 3.
Mirror that structure for Phase 6's kickoff.
