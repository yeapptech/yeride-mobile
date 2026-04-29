# Phase 5 — Turn 3: VehicleList + VehicleRegistration screens

The driver-facing UI for listing, activating, deleting, and registering
vehicles. Sits on top of the 9 use cases + DI wiring shipped in Turn 2.

End of turn: **102 suites / 772 tests passing**, **+5 suites / +64 tests**
on top of Phase 5 Turn 2's 97/708. typecheck + lint + format + test all
green.

## What's in

### Domain service

**`VehicleClassifier`** (`src/domain/services/`) — pure-function service
with three methods, no I/O:

- `classifyManual(args)` — returns `VehicleClass` for manually-entered
  vehicle data. Ports legacy
  `yeride/src/api/nhtsa/VinDecoder.js#determineVehicleClassManual`
  verbatim. Decision order: luxury brand > XL (SUV/minivan/van/7+ seats) >
  crossover > sedan (compact ↔ mid-size by `vehicleSize`) > wagon >
  coupe/hatchback > default economy.
- `checkManualEligibility(args)` — returns boolean. Same rules as the
  NHTSA path (≤15 model years, no ineligible body types, ≥4 doors except
  coupes, ≥4 seats). Takes `now: Date` for testability — same convention
  as `FareCalculator`.
- `computeEligibleServices(vehicleClass, isEligible)` — returns
  `readonly RideServiceId[]`. Mirrors `NhtsaVinDecoderService.getEligibleServices`
  exactly so manual-entry vehicles get the same services list as VIN
  decode would have produced.

40 unit tests covering every branch, including the
case-insensitive luxury-brand match, the 7+ seats override on sedans, the
coupe carve-out for the 4-door rule, and the `now` parameter for the
age check.

### Query layer

`src/presentation/queries/vehicle.queries.ts` — new file alongside the
existing `ride.queries.ts` / `user.queries.ts`. Exports:

- `useVinDecodeQuery(vin)` — TanStack `useQuery` with 5-minute stale
  time, disabled when vin is null. Decode result for a given VIN is
  effectively immutable, so the cache absorbs typos (typing then
  re-typing the same VIN doesn't refetch).
- `useRegisterVehicleMutation` — wraps `RegisterVehicle.execute`,
  invalidates `user.current` on success because the auto-active flip
  may have changed `activeVehicleId`.
- `useSetActiveVehicleMutation` — wraps `SetActiveVehicle.execute`,
  same `user.current` invalidation.
- `useDeleteVehicleMutation` — wraps `DeleteVehicle.execute`, same
  invalidation (the repo clears `activeVehicleId` when the deleted
  VIN was active).

`queryKeys.vehicle.decode(vin)` added to `keys.ts`. The driver's vehicle
list itself doesn't go through TanStack — it's delivered live via
`useFirestoreSubscription` over `ListDriverVehicles.subscribe`.

### View-models

**`useVehicleListViewModel`** — subscription via
`useFirestoreSubscription` + the two activate/delete mutations. Tagged-
union state machine `loading | empty | ready | error`. Active-vehicle
highlight derived from `useCurrentUserQuery().data?.activeVehicleId`,
not the Zustand `useDriverStatusStore` (which only mirrors the active
vehicle while the driver is online — it's a UI state, not the persisted
truth). Mutations invalidate `user.current` so the active-pointer paint
updates.

`onDelete` wraps the soft-delete mutation in `Alert.alert`
confirmation — legacy parity. Naturally testable via
`jest.spyOn(Alert, 'alert')`.

**`useVehicleRegistrationViewModel`** — owns the form state machine:

```
idle → decoding → { decoded | manual } → submitting → submitted   (success: navigation.goBack)
                                                    → error       (Conflict / Auth / Validation)
```

VIN input is debounced 400ms. When the debounced value parses as a
`Vin` (length + check digit), `useVinDecodeQuery` fires. On
`Result.ok(decoded)` → `'decoded'`. On `Result.ok(null)` (no-match) or
`Result.err(NetworkError)` → `'manual'` with the (originally-parsed)
VIN carried forward in `fromDecodedVin` so submit knows which VIN to
attach.

From `'manual'`, submit runs the form values through
`VehicleClassifier.classifyManual` + `.checkManualEligibility` +
`.computeEligibleServices` before calling `RegisterVehicle`. Manual
entry skips the NHTSA stock-photo fetch (locked Turn 3 decision 2);
drivers upload their own photos in Turn 4.

Conflict (`vehicle_already_exists`) lands in `{ kind: 'error', error }`
with a friendly inline banner — the user can change the VIN and try
again rather than seeing a generic toast.

9 view-model unit tests covering every branch including the debounce
behavior (typing the full VIN one character at a time only fires
decode once).

### Screens

**`VehicleListScreen`** — header with Add CTA, FlatList of
`DriverVehicleCard`s, full-screen empty state with primary CTA, full-
screen error state. Dumb component: pulls only from the VM.

**`VehicleRegistrationScreen`** — single page that switches on
`vm.state.kind` to render `VinEntryStep` + (`DecodedPreviewStep` |
`ManualEntryStep` | error banner | submitting indicator). Cancel button
at the bottom always pops back.

5 + 4 screen-level smoke tests via `TestContainerProvider`.

### Components (driver-side)

- `DriverVehicleCard` — vehicle row card. Stock photo (NHTSA) or first
  uploaded photo as fallback. Active highlight via 2px primary border +
  ACTIVE badge. Tap card to activate (gated on `status === 'approved'
&& !isActive`). Per-card Delete pressable wired through the VM's
  Alert-confirmed flow.
- `VinEntryStep` — VIN text input with 17-char counter, inline
  decode-status indicator (`decoding` spinner / `decoded` checkmark /
  `manual` warning), and an "Enter manually" CTA below the input.
- `DecodedPreviewStep` — read-only preview of the decoded vehicle
  data. Stock-photo block when present. Eligibility-warning banner
  when `decoded.isEligible === false` (informational, doesn't block
  submit — admin review is the final gate). Confirm + Edit-manually
  buttons.
- `ManualEntryStep` — react-hook-form form with chip-pickers for
  body class / vehicle size (sedan-only) / seats / doors / fuel,
  plus freeform inputs for make / model / year / trim. Zod schema
  validates all fields including the `bodyClass === 'sedan' →
vehicleSize required` cross-field rule. Form value type stays as
  the loose `ManualVehicleFormValues` (all strings) for clean
  defaults + reset; the schema's `refine`s enforce the enum
  membership at runtime.

### Navigation + Profile entry

- `DriverStackParamList` gains `Vehicles: undefined` and
  `VehicleRegistration: undefined` (`src/presentation/navigation/types.ts`).
- `DriverNavigator` registers both screens with title-only headers.
- `UserProfileScreen` gains a role-gated `{user.role === 'driver' && …}`
  block with a "My vehicles" navigation row pushing `Vehicles`.
  Riders never see the row. Typed against `DriverStackNavigation`
  because the `Vehicles` route is driver-only.

## Scope decisions made / confirmed during the turn

### Q1 — Active-vehicle source-of-truth is `useCurrentUserQuery`

The kickoff brief mentioned "Active vehicle derived from
`useSessionStore`" — but `useSessionStore` only carries the userId.
`useDriverStatusStore.activeVehicleId` is a UI mirror set by
`goOnline(seedId)` and only populated while online. The persisted truth
lives on the Firestore user doc, which we read via
`useCurrentUserQuery().data?.activeVehicleId` — same pattern
`useDriverHomeViewModel.ts:188` already uses. Both
`useSetActiveVehicleMutation` and `useDeleteVehicleMutation` invalidate
`queryKeys.user.current()` on success, so the next read sees the
updated pointer.

### Q2 — Trash + `Alert.alert` instead of swipe-to-delete

The kickoff allowed swipe-to-delete with `react-native-gesture-handler`
or a fallback. We chose Alert-confirmed trash for three reasons:
legacy parity (`yeride/src/driver/screens/VehicleList.js:63-76` does
the same), trivial test surface (`jest.spyOn(Alert, 'alert')` lets a
test reach in and tap the Delete button programmatically), and zero
gesture-handler choreography to debug.

### Q3 — Profile entry via role-gated row inside `UserProfileScreen`

The driver tabs reuse the rider-side `UserProfileScreen`. Adding a
top-level "Vehicles" CTA on `DriverHomeScreen` was the kickoff
fallback, but it would need cleanup later. The role-gated row inside
`UserProfileScreen` is cleaner: riders never see it, and Turn 4 won't
need to remove anything.

### Q4 — No pre-submit duplicate-VIN check

The kickoff offered the option of an eager `existsByVin` check before
decoding. We chose the lazy path: the user can type any VIN, decode it,
and only at submit time does `RegisterVehicle` surface a
`ConflictError`. Saves a Firestore read per typed VIN; the inline
"This VIN is already registered" banner is good UX. The legacy app
pre-checks (legacy `isVINRegistered` is called during decode), but
the rewrite's `Vehicle.status` state machine makes the conflict path
explicit at submit time, which is enough.

### Q5 — `computeEligibleServices` lives on `VehicleClassifier`

The kickoff listed only `classifyManual` + `checkManualEligibility`.
We added `computeEligibleServices` because the manual path has to
build the same `RideServiceId[]` list the NHTSA path produces, and
inlining that in the VM would duplicate logic that's already pure
math. Putting it on `VehicleClassifier` gives both paths one source
of truth + parity testing.

### Form schema uses string types, not literal unions

Initial implementation used `z.enum(BODY_CLASS_OPTIONS)` etc. to get
literal-union types in the schema's inferred output. That collided
with `useForm<ManualVehicleFormValues>` (which uses plain `string`
fields) because the resolver's value type didn't match the form's
value type. Reworked to `z.string().refine((v) => OPTIONS.includes(v))`
for every chip-picker field — runtime validation is identical, and
both form and schema agree on `string`.

### `VehicleSpecs` built piecewise

Same `exactOptionalPropertyTypes` constraint that
`NhtsaVinDecoderService.extractSpecs` works around — assigning
`engine: undefined` is rejected. Build the specs object piece by
piece with conditional assignment.

## Test counts

| Gate                   | Result                                |
| ---------------------- | ------------------------------------- |
| `npm run typecheck`    | ✅                                    |
| `npm run lint`         | ✅ (only pre-existing v5→v6 warnings) |
| `npm run format:check` | ✅                                    |
| `npm test`             | ✅ — 102 suites / 772 tests passing   |

Net delta from Turn 2: **+5 suites / +64 tests**.

## Files added

Domain:

- `src/domain/services/VehicleClassifier.ts`
- `src/domain/services/__tests__/VehicleClassifier.test.ts`

Presentation — view-models:

- `src/presentation/features/driver/view-models/useVehicleListViewModel.ts`
- `src/presentation/features/driver/view-models/useVehicleRegistrationViewModel.ts`
- `src/presentation/features/driver/view-models/__tests__/useVehicleListViewModel.test.tsx`
- `src/presentation/features/driver/view-models/__tests__/useVehicleRegistrationViewModel.test.tsx`

Presentation — screens:

- `src/presentation/features/driver/screens/VehicleListScreen.tsx`
- `src/presentation/features/driver/screens/VehicleRegistrationScreen.tsx`
- `src/presentation/features/driver/screens/__tests__/VehicleListScreen.test.tsx`
- `src/presentation/features/driver/screens/__tests__/VehicleRegistrationScreen.test.tsx`

Presentation — components:

- `src/presentation/features/driver/components/DriverVehicleCard.tsx`
- `src/presentation/features/driver/components/VinEntryStep.tsx`
- `src/presentation/features/driver/components/DecodedPreviewStep.tsx`
- `src/presentation/features/driver/components/ManualEntryStep.tsx`

Presentation — queries:

- `src/presentation/queries/vehicle.queries.ts`

## Files touched

- `src/domain/services/index.ts` — re-export `VehicleClassifier` and
  its arg types.
- `src/presentation/queries/keys.ts` — `vehicle.decode(vin)` key.
- `src/presentation/queries/index.ts` — re-export the four vehicle
  hooks.
- `src/presentation/navigation/types.ts` — `Vehicles` and
  `VehicleRegistration` added to `DriverStackParamList`.
- `src/presentation/navigation/DriverNavigator.tsx` — register the
  two new screens.
- `src/presentation/features/auth/screens/UserProfileScreen.tsx` —
  role-gated "My vehicles" row + `useNavigation<DriverStackNavigation>()`.

## What's deferred to Turn 4

- `VehiclePhotosScreen` + `useVehiclePhotosViewModel` —
  five-tile (front/back/left/right/interior) `expo-image-picker`
  flow over `UploadVehiclePhotos`.
- `VehicleDetailsScreen` — read-only single-vehicle view with
  edit-photos / set-active / delete actions.
- Retiring the `VEHICLE_STUB_ID = 'vehicle-stub'` literal in
  `useDriverHomeViewModel.ts:65`. Driver online-toggle currently
  still falls through to the stub when `user.activeVehicleId` is
  null. Turn 4 surfaces an empty-state prompt routing into
  `Vehicles` instead.
- Surfacing the active vehicle's stock photo on `DriverHome` (after
  the photos UX lands).

## Phase 5 progression after this turn

| Turn | Scope                                                | Status |
| ---- | ---------------------------------------------------- | ------ |
| 1    | Domain + DTO + mappers + in-memory fakes             | ✅     |
| 2    | Real adapters + 9 use cases + DI wiring              | ✅     |
| 3    | VehicleList + VehicleRegistration screens            | ✅     |
| 4    | VehiclePhotos + VehicleDetails + retire vehicle-stub | Next   |

Phase 5 Turn 3 closed.
