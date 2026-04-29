# Phase 5 — Turn 2: Real adapters + 9 use cases + DI wiring

The follow-up to Turn 1's pure domain + DTO work. Turn 2 lands the
production-side plumbing (Firestore + Storage + NHTSA), all nine
vehicle-management use cases, and the DI / testing wiring needed for
view-models in Turn 3 to consume them.

End of turn: **97 suites / 708 tests passing**, **+10 suites / +47
tests** on top of Phase 5 Turn 1's 87/661. typecheck + lint + format +
test all green.

## What's in

### Real adapters

**`FirestoreVehicleRepository`** (`src/data/repositories/`) — modular
`@react-native-firebase/firestore`. Implements the full
`VehicleRepository` interface:

- `getByVin` / `existsByVin` — direct doc reads. `existsByVin` matches
  legacy `isVINRegistered` (true only when status ∈ {pending,
  approved}).
- `listByDriver` — reads `users/{driverId}.vehicleIds[]`, fetches each
  vehicle by VIN with `Promise.all`, skips per-doc validation failures
  (matches legacy `getDriverVehicles`).
- `subscribeByDriver` — mirrors legacy `subscribeToDriverVehicles`:
  watches the user doc, dedupes `[...new Set(vehicleIds)]`, fans out
  per-VIN `onSnapshot` listeners, emits a single `createdAt`-desc
  sorted array on every change. Synchronous unsubscribe closes the
  user-doc watch + every per-VIN watch.
- `create` / `softDelete` — cross-aggregate writes use `writeBatch` so
  the user doc never observes a `vehicleIds[]` array out of sync with
  the vehicles collection. `softDelete` writes the deleted vehicle +
  `arrayRemove` from `vehicleIds[]` + conditionally clears
  `activeVehicleId` in one batch.
- `setActive` — reads ownership + the target vehicle, then writes
  `activeVehicleId` and propagates `eligibleServices` →
  `users/{uid}.services.ride` in a single `setDoc { merge: true }`.
  Refuses non-approved vehicles (rewrite tightening over legacy — the
  `Vehicle.status` state machine makes this explicit).
- `update` — `setDoc { merge: true }` with explicit
  `permission-denied` → `AuthorizationError` mapping.

All writes use `setDoc { merge: true }` so any forward-compat fields
legacy may write are preserved.

**`FirebaseStorageVehiclePhotoRepository`** — wraps
`@react-native-firebase/storage` modular `putFile` + `getDownloadURL`.
Path: `vehicles/{VIN}/{type}_{Date.now()}.jpg` (matches legacy exactly).
Empty `localUri` → `ValidationError`; transport failures →
`NetworkError`. Doesn't touch Firestore — caller writes the URL via
`Vehicle.attachPhoto` + `VehicleRepository.update`.

**`NhtsaVinDecoderService`** (`src/data/services/`) — `fetch` against
NHTSA's keyless vPIC + SafetyRatings APIs. Ports legacy
`determineVehicleClass`, `checkEligibility`, `getEligibleServices`
verbatim so a VIN that legacy classifies as "comfort" decodes the same
way here.

Result mapping per locked decisions:

| NHTSA response                         | Adapter result    |
| -------------------------------------- | ----------------- |
| `Results[0].ErrorCode !== '0'`         | `Result.ok(null)` |
| Missing `Make` / `Model` / `ModelYear` | `Result.ok(null)` |
| Empty / missing `Results`              | `Result.ok(null)` |
| HTTP non-2xx                           | `NetworkError`    |
| Non-JSON response                      | `NetworkError`    |
| `fetch` threw                          | `NetworkError`    |

Stock-photo fetch (SafetyRatings) is best-effort: a failure logs at
`LOG.warn` but does NOT degrade the decode result — the VIN is decoded,
we just return `stockPhoto: null`.

The `extractSpecs` helper builds the optional `VehicleSpecs` blob
field-by-field with conditional assignment so `exactOptionalPropertyTypes`
doesn't reject a `T | undefined` shape.

### Use cases

Nine use cases under `src/app/usecases/vehicle/`. Auth-gated paths
(`SetActiveVehicle`, `DeleteVehicle`, `UploadVehiclePhotos`,
`RegisterVehicle`) ALL pull `await this.auth.currentUserId()` and
return `AuthorizationError({code: 'auth_no_current_user'})` on null —
the view-model can never sneak a different driver-id past the audit
boundary.

| Use case              | Shape         | Notes                                                                                                                   |
| --------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RegisterVehicle`     | composite     | auto-approve + first-vehicle auto-active; rejects non-driver users; flat-args interface (Q3 confirmed)                  |
| `ListDriverVehicles`  | subscription  | wraps `vehicles.subscribeByDriver`; sync unsubscribe; takes `driverId` as arg (parity with `ListRidesByDriver`)         |
| `GetVehicle`          | one-shot read | trivial wrap of `vehicles.getByVin`                                                                                     |
| `SetActiveVehicle`    | auth-gated    | always passes the signed-in UID to the repo; vin: Vin \| null                                                           |
| `UploadVehiclePhotos` | composite     | auth + ownership pre-check (Q1) + sequential per-photo Storage upload + `attachPhoto` + `update`. First failure aborts. |
| `DeleteVehicle`       | auth-gated    | thin wrap of `vehicles.softDelete`                                                                                      |
| `ApproveVehicle`      | admin path    | not consumed by Phase 5 UI; ships for parity                                                                            |
| `RejectVehicle`       | admin path    | not consumed by Phase 5 UI; ships for parity                                                                            |
| `DecodeVin`           | thin wrap     | direct delegate to `vinDecoder.decode`                                                                                  |

`UploadVehiclePhotos` ownership check: reads
`users.getById(uid).vehicleIds[]` and refuses if the VIN isn't there
— defense in depth on top of Firestore Security Rules. Tests assert
that no Storage uploads happen when the pre-check fails.

### DI container + TestContainerProvider

`src/presentation/di/container.ts`:

- `UseCases` interface gains 9 new fields.
- `makeUseCases({ ... vehicles, vehiclePhotos, vinDecoder })` —
  three new args; everything wired the same way as the existing
  ride/auth/location use cases.
- Real-Firebase branch lazy-`require()`s the two new Firestore +
  Storage adapters.
- `buildVinDecoderService()` is unconditional in production — NHTSA
  needs no API key (Q2 confirmed). Lazy-required so a fakes-only
  build that never instantiates the container won't pull
  `NhtsaVinDecoderService` into the bundle.
- Fakes-only branch instantiates `InMemoryVehicleRepository` +
  `InMemoryVehiclePhotoRepository`; `vinDecoder` still points at the
  real keyless NHTSA service (Q2: real NHTSA in fakes-only too).

`src/shared/testing/TestContainerProvider.tsx` — three new optional
override props (`vehicles?`, `vehiclePhotos?`, `vinDecoder?`),
defaulting to fresh `InMemoryVehicleRepository` /
`InMemoryVehiclePhotoRepository` / `FakeVinDecoderService` instances.
Threaded into `makeUseCases`.

### Tests

Ten new test files / 47 new cases:

| File                                                     | Tests  | What it covers                                                                                                                         |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RegisterVehicle.test.ts`                                | 7      | happy + auto-active, second-vehicle no-auto-active, conflict, no-auth, wrong-role, missing-user, invalid input                         |
| `ListDriverVehicles.test.ts`                             | 4      | initial emit, add/remove emits, sync unsubscribe, per-driver isolation                                                                 |
| `GetVehicle.test.ts`                                     | 2      | happy + not-found                                                                                                                      |
| `SetActiveVehicle.test.ts`                               | 5      | happy + propagation, no-auth, not-owned, not-approved, clear-with-null                                                                 |
| `UploadVehiclePhotos.test.ts`                            | 7      | single, multi-canonical-order, mid-sequence failure preserves prior, no-auth, wrong-role, not-owned, empty-map                         |
| `DeleteVehicle.test.ts`                                  | 4      | happy, no-auth, not-owned, clears active                                                                                               |
| `ApproveVehicle.test.ts`                                 | 4      | pending→approved, suspended→approved, not-found, illegal-from-deleted                                                                  |
| `RejectVehicle.test.ts`                                  | 3      | happy, empty notes, illegal-from-approved                                                                                              |
| `DecodeVin.test.ts`                                      | 3      | happy, ok(null) passthrough, NetworkError passthrough                                                                                  |
| `data/services/__tests__/NhtsaVinDecoderService.test.ts` | 8      | happy + stock photo, stock-photo-fails-but-decode-succeeds, ErrorCode!=0, missing fields, HTTP 500, fetch throws, non-JSON, no Results |
| **Total**                                                | **47** |                                                                                                                                        |

Plus shared fixtures at
`src/app/usecases/vehicle/__tests__/fixtures.ts` — `setupSignedInDriver`
/ `setupSignedInRider` helpers, real-world VIN constants, and a
`makeVehicle` factory that wraps `Vehicle.create` with sensible
defaults.

## Scope decisions made during the turn

### Q1 — `UploadVehiclePhotos` owns the explicit ownership check

Reads `users.getById(uid).vehicleIds[]` and rejects with
`AuthorizationError({code: 'vehicle_photos_not_owned_by_driver'})`
before any Storage write. Defense in depth — Firestore Security Rules
remain the authoritative gate, but we want the auth surface error to
appear BEFORE the driver wastes upload bandwidth.

### Q2 — Real NHTSA in the fakes-only DI branch

NHTSA's vPIC + SafetyRatings endpoints are keyless and read-only, so
they work in any context that has internet. The fakes-only build (no
Firebase config) still uses `NhtsaVinDecoderService`. Tests swap in
`FakeVinDecoderService` via `TestContainerProvider`, never via the
container builder.

### Q3 — `RegisterVehicle` takes flat args

`RegisterVehicleArgs` accepts the raw vehicle properties (vin, make,
model, year, vehicleClass, eligibleServices, dataSource, plus optional
trim/bodyClass/seats/doors/photos/stockPhoto/specs). The use case is the
single seam where `Vehicle.create` runs, so server-side validation
lives in one place and the view-model can hand off either decoded or
manually-entered shapes via the same interface.

### Cross-aggregate writes use `writeBatch`, not `runTransaction`

None of the write paths actually need to read-then-write inside a
transaction window — the read happens before the batch, and Firestore's
`arrayUnion` / `arrayRemove` sentinels are themselves atomic per-doc.
Batches give us cross-doc atomicity without the read-write ordering
constraints of `runTransaction`. Used in `create` (vehicle + user) and
`softDelete` (vehicle + user, with conditional `activeVehicleId`
clear).

### `setActive` refuses non-approved vehicles

Tightening over legacy: the legacy `setActiveVehicle` accepts any
vehicle the driver owns regardless of status. The rewrite refuses
non-`'approved'` vehicles via a `vehicle_not_approved` ValidationError
— matches `InMemoryVehicleRepository`'s behavior (Turn 1) and aligns
with the explicit `Vehicle.status` state machine. In practice this is
unreachable from the UI because `RegisterVehicle` auto-approves
immediately, but it keeps the invariant tight.

### NHTSA stock-photo failure does NOT degrade the decode

If the SafetyRatings two-step (variants → details) fails at any
point, we return the decoded data with `stockPhoto: null` and log a
warning. A network blip on the secondary fetch shouldn't sabotage the
primary decode. Tested: `still returns ok(decoded) when the
stock-photo fetch fails`.

### Subscription teardown is the combined unsub

`subscribeByDriver` returns a single `() => void` that closes BOTH
the user-doc watch AND every per-VIN fan-out watch, plus clears the
internal map. Mirrors legacy semantics; matches the
`InMemoryVehicleRepository` contract that view-model tests already
exercise.

### `extractSpecs` builds VehicleSpecs piecewise

Initial implementation used a `stripUndefined<T>` helper that
returned `T` after filtering. Under
`exactOptionalPropertyTypes: true`, TypeScript can't narrow
`T | undefined`-typed input fields back to the strict optional shape,
so the helper was rejected by typecheck. Reworked to assign each
optional field individually with a conditional check — verbose but
correct.

## Test counts

| Gate                   | Result                                           |
| ---------------------- | ------------------------------------------------ |
| `npm run typecheck`    | ✅                                               |
| `npm run lint`         | ✅ (only pre-existing v5→v6 boundaries warnings) |
| `npm run format:check` | ✅                                               |
| `npm test`             | ✅ — 97 suites / 708 tests passing               |

## Files added

Adapters:

- `src/data/repositories/FirestoreVehicleRepository.ts`
- `src/data/repositories/FirebaseStorageVehiclePhotoRepository.ts`
- `src/data/services/NhtsaVinDecoderService.ts`

Use cases:

- `src/app/usecases/vehicle/RegisterVehicle.ts`
- `src/app/usecases/vehicle/ListDriverVehicles.ts`
- `src/app/usecases/vehicle/GetVehicle.ts`
- `src/app/usecases/vehicle/SetActiveVehicle.ts`
- `src/app/usecases/vehicle/UploadVehiclePhotos.ts`
- `src/app/usecases/vehicle/DeleteVehicle.ts`
- `src/app/usecases/vehicle/ApproveVehicle.ts`
- `src/app/usecases/vehicle/RejectVehicle.ts`
- `src/app/usecases/vehicle/DecodeVin.ts`

Tests:

- `src/app/usecases/vehicle/__tests__/fixtures.ts`
- `src/app/usecases/vehicle/__tests__/RegisterVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/ListDriverVehicles.test.ts`
- `src/app/usecases/vehicle/__tests__/GetVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/SetActiveVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/UploadVehiclePhotos.test.ts`
- `src/app/usecases/vehicle/__tests__/DeleteVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/ApproveVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/RejectVehicle.test.ts`
- `src/app/usecases/vehicle/__tests__/DecodeVin.test.ts`
- `src/data/services/__tests__/NhtsaVinDecoderService.test.ts`

## Files touched

- `src/data/repositories/index.ts` — re-export
  `FirestoreVehicleRepository`, `FirebaseStorageVehiclePhotoRepository`.
- `src/data/services/index.ts` — re-export `NhtsaVinDecoderService`.
- `src/presentation/di/container.ts` — `UseCases` interface +
  `makeUseCases` body + `buildContainer` lazy-require branch +
  `buildVinDecoderService()` helper.
- `src/shared/testing/TestContainerProvider.tsx` — three new optional
  override props.

## What's deferred to Turn 3

- `VehicleListScreen` + `VehicleRegistrationScreen` view-models +
  screens.
- Manual-entry classifier (`classifyVehicleManually` from legacy
  `determineVehicleClassManual` / `checkManualEligibility` /
  `createManualVehicleData`) — deferred to Turn 3 alongside the
  manual-entry form.
- iOS Storage smoke (`putFile` + `getDownloadURL` against staging) —
  deferred to whenever the Phase 5 UI gets its first prebuild + native
  rebuild. The `use_modular_headers!` patch in
  `scripts/patch-podfile.js` already covers every pod (it's not
  scoped per-podspec), so Storage's modular dependencies should
  resolve without additional patching, but verification needs an
  actual build.

## Phase 5 progression after this turn

| Turn | Scope                                                | Status |
| ---- | ---------------------------------------------------- | ------ |
| 1    | Domain + DTO + mappers + in-memory fakes             | ✅     |
| 2    | Real adapters + 9 use cases + DI wiring              | ✅     |
| 3    | VehicleList + VehicleRegistration screens            | Next   |
| 4    | VehiclePhotos + VehicleDetails + retire vehicle-stub | —      |

Phase 5 Turn 2 closed.
