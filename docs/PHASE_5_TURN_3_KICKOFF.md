# Phase 5 — Turn 3 Kickoff Prompt — VehicleList + VehicleRegistration screens

Paste below the cut into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo.

---

You're picking up YeRide-Next at `/Users/papagallo/yeapptech/dev/yeride-mobile/`
mid-Phase 5 (Vehicle management). Turn 1 shipped the domain + DTO + in-memory
fakes; Turn 2 shipped the real adapters (Firestore + Storage + NHTSA), the 9
vehicle-management use cases, and the DI / TestContainerProvider wiring — all
under green verify gates (97 suites / 708 tests). Your job this session is
Turn 3: the driver-facing UI for listing, activating, deleting, and
registering vehicles. Read carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` — current state, layered architecture, conventions, file map.
   Phase 5 Turn 2 is now ✅; Turn 3 is Next.
2. `docs/PHASE_5_TURN_2.md` — what Turn 2 shipped, what's deferred to Turn 3,
   locked decisions.
3. `docs/PHASE_5_KICKOFF.md` — overall Phase 5 plan (scope, locked decisions,
   risks, suggested turn breakdown).
4. Legacy `yeride/src/api/nhtsa/VinDecoder.js` — source of truth for the
   manual-entry classifier (`determineVehicleClassManual`,
   `checkManualEligibility`, `createManualVehicleData`).
5. Legacy `yeride/src/driver/screens/VehicleList.js` and
   `yeride/src/driver/screens/VehicleRegistration.js` — UI / UX reference.
   Don't copy verbatim; understand the shape, decode flow, and manual-entry
   fallback.
6. `src/presentation/features/rider/view-models/useRouteSearchViewModel.ts`
   (or any other Phase 3/4 view-model) — reference for the rewrite's
   view-model pattern: `useUseCases()` → TanStack Query / mutation →
   flat-prop discriminated-union output.
7. `src/presentation/features/rider/screens/RouteSearchScreen.tsx` — reference
   for the rewrite's screen pattern: dumb component, props from VM, no
   `useUseCases` calls.
8. `src/presentation/navigation/DriverNavigator.tsx` — where Turn 3's two new
   screens get registered.
9. `src/app/usecases/vehicle/RegisterVehicle.ts`, `ListDriverVehicles.ts`,
   `SetActiveVehicle.ts`, `DeleteVehicle.ts`, `DecodeVin.ts` — the use cases
   the view-models will consume.
10. `src/shared/testing/TestContainerProvider.tsx` — how to seed `vehicles` /
    `vinDecoder` overrides for view-model tests.

## Starting state — what's already built (Turn 2)

- Adapters — `FirestoreVehicleRepository`,
  `FirebaseStorageVehiclePhotoRepository`, `NhtsaVinDecoderService` (keyless,
  returns `Result.ok(null)` on no-match / missing fields).
- Use cases — 9 of them under `src/app/usecases/vehicle/`: `RegisterVehicle`
  (auto-approve + first-vehicle auto-active), `ListDriverVehicles`
  (sync-unsubscribe subscription), `GetVehicle`, `SetActiveVehicle`
  (auth-gated), `UploadVehiclePhotos` (auth + ownership pre-check),
  `DeleteVehicle` (auth-gated), `ApproveVehicle` / `RejectVehicle` (admin
  path), `DecodeVin` (thin wrap).
- DI — `makeUseCases` accepts `vehicles`, `vehiclePhotos`, `vinDecoder`.
  `TestContainerProvider` accepts the matching three optional overrides.
- Tests — 97 suites / 708 tests passing.

The `useDriverHomeViewModel.ts:65,184–189` `'vehicle-stub'` literal is still
in place — Turn 4 retires it.

## Scope decisions (locked at Turn 3 kickoff — confirm or override)

1. **Manual-entry classifier lives in
   `domain/services/VehicleClassifier.ts`.** Pure-math service with two
   methods — `classifyManual(args)` returning `VehicleClass` and
   `checkManualEligibility(args)` returning `boolean`. Same shape as
   `FareCalculator`. Ports legacy `determineVehicleClassManual` +
   `checkManualEligibility` verbatim. No I/O, no NHTSA fetch. Used by the
   registration view-model when the user fills the manual form.
2. **Manual entry skips the NHTSA SafetyRatings stock-photo fetch.** Legacy
   `createManualVehicleData` calls `getVehicleImage` and the rewrite's
   `NhtsaVinDecoderService.decode` already does for the VIN-decoded path —
   but for manual entry it adds an extra HTTP round-trip + requires
   extending the `VinDecoderService` interface. Drivers upload their own
   photos in Turn 4 anyway. Lock: manual-entry vehicles get
   `stockPhoto: null`; the photo gallery on the vehicle card uses uploaded
   photos when present.
3. **VIN decode triggers automatically on a valid 17-char check-digit-passing
   input** (no explicit "Decode" button). Mirrors the rewrite's existing
   form patterns; keeps the UX one-step. Loading + no-match states surface
   inline, with an "Enter manually" CTA when the decode returns
   `Result.ok(null)` or a `NetworkError`.
4. **Navigation entry point: a "Vehicles" item under
   `DriverProfilePlaceholder` → pushes `VehicleListScreen` → "Add vehicle"
   CTA pushes `VehicleRegistrationScreen` → on success pops back to the
   list.** If the Profile placeholder doesn't have a navigation surface
   yet, also wire a temporary "Vehicles" button onto `DriverHomeScreen`
   (only visible when no active vehicle is set, so it doesn't clutter the
   active-driver UI). Both removed in Turn 4 once Profile lands properly.
5. **Stub retirement deferred to Turn 4.** `useDriverHomeViewModel`'s
   `'vehicle-stub'` stays in place this turn — retiring it requires the
   active-vehicle observation wired through `useSessionStore` or an
   equivalent, which is best done after Photos lands. Turn 3 just makes
   registration possible; Turn 4 makes the driver actually use a real
   `activeVehicleId`.
6. **TanStack Query keys mirror use-case args.** `['vehicles', driverId,
'list']` for the subscription, `['vinDecode', vinString]` for the
   decode (5-minute stale time), invalidation triggers on mutation
   success.

## Scope (in / out)

### In

**Domain service:**

- `src/domain/services/VehicleClassifier.ts` — `classifyManual` +
  `checkManualEligibility`. Pure functions. Returns `Result` only where
  ValidationError is possible.
- Re-exported from `src/domain/services/index.ts`.

**View-models (`src/presentation/features/driver/view-models/`):**

- `useVehicleListViewModel.ts` — pulls `useUseCases().listDriverVehicles`
  (subscription) + `setActiveVehicle` + `deleteVehicle` mutations. State
  machine: `loading | empty | ready | error`. Active vehicle derived from
  `useSessionStore` (driver doc's `activeVehicleId`). Exposes typed
  callbacks `onActivate(vin)`, `onDelete(vin)`, `onAddVehicle()`.
- `useVehicleRegistrationViewModel.ts` — owns the form state machine:
  `idle | decoding | decoded | manual | submitting | submitted | error`.
  Wraps `decodeVin` (TanStack query, debounced trigger on valid VIN),
  `registerVehicle` (mutation). When decode returns `null`/`NetworkError`,
  transitions to `manual` mode where the user fills in
  make/model/year/bodyClass/seats/doors/vehicleSize/fuelType, and
  submission runs the values through `VehicleClassifier.classifyManual` +
  `checkManualEligibility` before calling `RegisterVehicle`.

**Screens (`src/presentation/features/driver/screens/`):**

- `VehicleListScreen.tsx` — list of `DriverVehicleCard`s, swipe-to-delete
  via `react-native-gesture-handler`, FAB "Add vehicle" button, empty
  state with CTA, error state with retry. Uses NativeWind tokens
  (`bg-card dark:bg-card-dark`, `text-primary`, etc.).
- `VehicleRegistrationScreen.tsx` — multi-state form. The form state is
  owned by the view-model; the screen renders `<VinEntryStep>`,
  `<DecodedPreviewStep>`, `<ManualEntryStep>`, `<SubmittingStep>` based
  on a discriminated union.

**Components (`src/presentation/features/driver/components/`):**

- `DriverVehicleCard.tsx` — vehicle row with stock photo, year/make/model,
  status badge, active-indicator dot. Tap to activate. Swipe to delete.
- `VinEntryStep.tsx` — VIN text input with format validation, 17-char
  counter, decode-status indicator (idle/loading/error/success), "Enter
  manually" CTA below.
- `DecodedPreviewStep.tsx` — read-only preview of decoded fields,
  "Confirm & register" / "Edit manually" / "Cancel" buttons.
- `ManualEntryStep.tsx` — react-hook-form fields (`make`, `model`, `year`,
  `bodyClass`, `vehicleSize`, `seats`, `doors`, `fuelType`), Zod schema,
  submit button.

**Navigation:**

- Add `Vehicles: undefined` and `VehicleRegistration: undefined` to the
  driver param list in `DriverNavigator.tsx`.
- Add a "Vehicles" button to the Driver Profile placeholder (or the
  temporary entry on `DriverHomeScreen` if Profile doesn't exist yet —
  confirm with the navigator state).

**Tests:**

- `useVehicleListViewModel.test.tsx` — empty + loaded + activate-flow +
  delete-flow + error-state. ~6 cases.
- `useVehicleRegistrationViewModel.test.tsx` — happy-decode-then-register,
  no-match-then-manual, network-error-then-manual,
  manual-validation-failures, ineligible-manual-vehicle-blocked-from-submit.
  ~7 cases.
- `VehicleListScreen.test.tsx` — renders, tap-to-activate, swipe-to-delete,
  empty state. ~4 cases (rendered with `TestContainerProvider`).
- `VehicleRegistrationScreen.test.tsx` — VIN input → decoded preview,
  manual fallback, submit flow. ~4 cases.
- `VehicleClassifier.test.ts` — every branch from legacy logic: luxury
  brand, XL by SUV/seats, crossover→comfort, sedan compact vs. mid-size,
  coupe→economy, age + door + seat eligibility checks. ~12 cases.

### Out (deferred to later turns)

- `VehiclePhotosScreen` + `useVehiclePhotosViewModel` — Turn 4.
- `VehicleDetailsScreen` (read-only view of a single vehicle's
  specs/photos) — Turn 4.
- Retiring the `'vehicle-stub'` literal in `useDriverHomeViewModel` —
  Turn 4.
- Surfacing the active vehicle's stock photo on `DriverHome` — Turn 4
  (after the photos UX lands).

## Suggested file punch list (for Turn 3 alignment)

Files to create:

1. `src/domain/services/VehicleClassifier.ts`
2. `src/domain/services/__tests__/VehicleClassifier.test.ts`
3. `src/presentation/features/driver/view-models/useVehicleListViewModel.ts`
4. `src/presentation/features/driver/view-models/useVehicleRegistrationViewModel.ts`
5. `src/presentation/features/driver/view-models/__tests__/useVehicleListViewModel.test.tsx`
6. `src/presentation/features/driver/view-models/__tests__/useVehicleRegistrationViewModel.test.tsx`
7. `src/presentation/features/driver/screens/VehicleListScreen.tsx`
8. `src/presentation/features/driver/screens/VehicleRegistrationScreen.tsx`
9. `src/presentation/features/driver/screens/__tests__/VehicleListScreen.test.tsx`
10. `src/presentation/features/driver/screens/__tests__/VehicleRegistrationScreen.test.tsx`
11. `src/presentation/features/driver/components/DriverVehicleCard.tsx`
12. `src/presentation/features/driver/components/VinEntryStep.tsx`
13. `src/presentation/features/driver/components/DecodedPreviewStep.tsx`
14. `src/presentation/features/driver/components/ManualEntryStep.tsx`

Files to touch:

1. `src/domain/services/index.ts` — re-export `VehicleClassifier`.
2. `src/presentation/navigation/DriverNavigator.tsx` — register `Vehicles`
   - `VehicleRegistration` routes; add the param-list entries.
3. `src/presentation/features/driver/screens/DriverProfilePlaceholder.tsx`
   (or wherever the Profile entry lives) — add a "Vehicles" navigation
   row.
4. `src/presentation/features/driver/screens/DriverHomeScreen.tsx` —
   temporary "Vehicles" CTA if Profile doesn't have one yet (delete in
   Turn 4).

## Conventions (non-negotiable — same as Phase 4 turn-by-turn)

- Server state goes in TanStack Query; client/UI state goes in Zustand.
  Don't mix.
- View-model owns orchestration; screen body is dumb (props in, JSX out).
- Every form field uses react-hook-form + Zod, value objects via
  `Vin.create` / `RideServiceId.create` etc. — never `as Vin`.
- `Result.ok` / `Result.err` for every expected failure. No throws for
  domain failures.
- Logger only — `LOG.extend('VEHICLE_VM')` etc. Never `console.*`.
- NativeWind class names from the existing semantic-token palette
  (`bg-card`, `text-primary`, `bg-success/10`, etc.). Don't introduce raw
  hex except where Tailwind doesn't reach (React Navigation tints,
  MapView strokes).
- All status-router-style state machines should be a tagged union with a
  single `kind` discriminant. Tests assert on `kind` first, then per-kind
  shape.
- Screens never call `useUseCases()` directly — only the view-model does.
- View-model tests render via `TestContainerProvider`, seeding the
  in-memory fakes via the override props (`vehicles`, `vinDecoder`,
  `users`, `auth`).
- Run `npm run verify` (typecheck + lint + format + test) before declaring
  the turn done.

## Acceptance for end of Turn 3

- `VehicleClassifier` lands with full unit coverage; classifier output for
  the same inputs matches what Phase 5 Turn 2's `NhtsaVinDecoderService`
  would produce for the VIN-decoded path (parity check).
- The two view-models compile against the DI container, exercise the
  use-case results correctly, and have rendered tests against
  `TestContainerProvider`.
- Driver can: open `VehicleListScreen` → see their (empty or seeded) list
  → tap "Add vehicle" → enter a valid VIN → see decoded preview → confirm
  → land back on the list with the new vehicle highlighted as active
  (because it's the first one).
- Driver can: enter an unknown VIN → see "Couldn't auto-fill" → manually
  enter make/model/year/etc. → submit → land back on the list with the
  manually-entered vehicle.
- Driver can: tap a non-active vehicle → it activates (services.ride
  propagates).
- Driver can: swipe-to-delete → vehicle removed from list, active pointer
  cleared if it was active.
- `npm run verify` green. Estimate +5 suites / +30 tests over Turn 2's
  97/708.
- `docs/PHASE_5_TURN_3.md` written.
- The `'vehicle-stub'` literal in `useDriverHomeViewModel` is unchanged
  (deliberately deferred).

## Risks + mitigations

- **DriverProfilePlaceholder may not exist yet.** Turn 3 doesn't gate on
  Profile being a real screen. If only a placeholder exists, add the
  temporary `VehicleListScreen` entry to `DriverHomeScreen` instead and
  note the Profile integration as Turn 4 work.
- **react-hook-form + Zod nullable handling.** The manual form has lots
  of optional fields. Use `z.nullable()` not `z.optional()` where the
  wire format wants `null` (most legacy fields). Existing forms in the
  rewrite (auth, route search) are the reference.
- **Swipe-to-delete on Android with `react-native-gesture-handler`.** If
  gesture-handler proves flaky in the test renderer, fall back to a
  long-press → confirmation dialog. Tests should target whichever
  gesture is wired.
- **Decode debouncing.** Auto-decode shouldn't fire on every keystroke.
  Use a 400ms debounce and only after `Vin.create(input).ok === true`.
  Tests should verify the decode use-case is called once per stable
  input.
- **Co-existence with legacy yeride.** Legacy and rewrite share the
  dev/stage `yeapp-stage` Firebase project, including the `vehicles`
  collection. Any vehicle the rewrite registers should be readable by
  legacy and vice versa. The DTO + write-shape work in Turn 1 already
  handled this; Turn 3 just needs to not introduce new fields.

## Start with

Read `CLAUDE.md`, then `docs/PHASE_5_TURN_2.md`, then the Phase 5 section
of `REFACTOR_PLAN.md`, then the legacy `VinDecoder.js`, `VehicleList.js`,
and `VehicleRegistration.js`, then a couple of existing view-models
(`useRouteSearchViewModel.ts` and `useDriverDispatchViewModel.ts`) and a
screen (`RouteSearchScreen.tsx`). Then propose Turn 3 scope as a numbered
punch list (files to create, files to touch, tests to add) and wait for
confirmation before writing code.

Tip: this kickoff has the same shape as Phase 5 Turn 1's and Turn 2's.
Mirror that structure for future turn-kickoffs in this phase.
