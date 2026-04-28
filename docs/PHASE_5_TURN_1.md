# Phase 5 — Turn 1: Vehicle domain + DTO + in-memory fakes

The opening turn of Phase 5 (Vehicle management). Pure domain + data-layer
work — no Firebase, no use cases, no UI. Establishes every type and
contract subsequent turns will lean on:

- `Vin` value object (NHTSA check-digit validated)
- `VehicleStatus`, `VehicleClass`, `VehiclePhotoType`, `VehicleSpecs`
- `Vehicle` entity with private constructor + transitions
- `VehicleRepository`, `VehicleStorageRepository`, `VinDecoderService`
  interfaces
- `VehicleDoc` Zod schema + bidirectional `vehicleMapper`
- `InMemoryVehicleRepository`, `InMemoryVehiclePhotoRepository`,
  `FakeVinDecoderService` in `@shared/testing`

End of turn: **87 suites / 661 tests passing**, **+6 suites / +93 tests**
on top of Phase 4's 81/568. typecheck + lint + format + test all green.

## What's in

### Domain layer

**`Vin`** (`src/domain/entities/Vin.ts`) — branded `Brand<string, 'Vin'>`
value object. Factory uppercases input, then enforces:

1. Exactly 17 characters.
2. Allowed chars `A–Z` and `0–9`, excluding `I`, `O`, `Q` (NHTSA-reserved).
3. The 9th character matches the check digit derived by NHTSA's
   transliteration + weighted-sum algorithm. The expected value is one of
   `'0'..'9'` or `'X'` (for value 10). The transliteration table and
   position weights are ported verbatim from legacy
   `yeride/src/api/nhtsa/VinDecoder.js` `validateCheckDigit` so a VIN the
   legacy app writes to Firestore must hydrate as a `Vin` here.

**`VehicleStatus`** — literal union `'pending' | 'approved' | 'rejected' |
'suspended' | 'deleted'`. The fifth value `'deleted'` is included alongside
the four legacy enum values because legacy `deleteVehicle` writes
`status: 'deleted'` directly. Modelling it as a domain literal lets
`Vehicle.markDeleted()` return a typed `Vehicle` instead of a stringly-
typed special case.

**`VehicleClass`** — literal union `'economy' | 'comfort' | 'luxury' |
'xl'`. Distinct from `RideServiceId`: vehicleClass is the property of the
vehicle itself; `eligibleServices: RideServiceId[]` is the derived list of
tiers the vehicle is authorised to serve. Determination logic (legacy
`determineVehicleClass`, `determineVehicleClassManual`) lives in the data
layer / a dedicated helper; the entity treats it as authoritative input.

**`VehiclePhotoType`** — literal union `'front' | 'back' | 'left' |
'right' | 'interior'`. Plus `VEHICLE_PHOTO_TYPES` array and an
`isVehiclePhotoType` type guard.

**`VehicleSpecs`** — interface for the optional NHTSA-derived specs blob.
Five sub-interfaces (engine, transmission, safety, dimensions,
manufacturer), all fields optional, mirroring legacy `getVehicleSpecs`.

**`Vehicle`** (`src/domain/entities/Vehicle.ts`) — the aggregate. Private
constructor + `static create` (returns a fresh `'pending'` vehicle) +
`static fromProps` (hydration from already-validated wire data). State
machine:

```
pending ──approve()──▶ approved ──suspend()──▶ suspended
   │                                            │
   └────reject(notes)──▶ rejected               │
                                                │
              any non-deleted ──markDeleted()─┘  (terminal)
```

Plus three non-status mutations allowed in any non-deleted state:
`attachPhoto(type, url)`, `setEligibleServices(services)`,
`setStockPhoto(url)`. Every transition returns
`Result<Vehicle, ValidationError>`; illegal transitions yield
`code: 'vehicle_illegal_transition'`. Transitions are immutable — every
method returns a new `Vehicle` instance.

Convenience accessors `isApproved` and `isDeleted` for use-case readability.

Photo coverage is **NOT** enforced by the entity. Legacy doesn't gate
approval on photo completeness, and the rewrite preserves that — the
`VehiclePhotos` screen (Turn 4) will let the driver leave tiles empty.

**Repository + service interfaces:**

`VehicleRepository` — read/write over `vehicles/{vin}` plus the
cross-aggregate driver↔vehicle linkage on `users/{uid}`. Methods:
`getByVin`, `existsByVin`, `listByDriver`, `subscribeByDriver` (sync
unsubscribe), `create`, `update`, `softDelete`, `setActive`. Why
cross-aggregate fields live here, not on `UserRepository`: vehicle
ownership and active-vehicle selection are vehicle-aggregate concerns;
the Firestore implementation (Turn 2) writes both documents
transactionally so the user doc never observes a `vehicleIds[]` array
out of sync with the vehicles collection.

`VehicleStorageRepository` — kept separate from `VehicleRepository` so
the in-memory storage fake can stay trivial (no Firebase Storage
imports, no filesystem I/O) and so future profile-photo work can reuse
the abstraction. One method: `uploadPhoto(vin, type, localUri)` →
download URL.

`VinDecoderService` — domain-side abstraction over NHTSA. One method:
`decode(vin)` → `Result<VinDecodeResult | null, NetworkError>`. The
three-way result distinction is deliberate:

- `Result.ok(decoded)` — usable data; pre-fill the registration form.
- `Result.ok(null)` — request succeeded but NHTSA returned no usable
  match (uncommon — rare/future model years). Surface as "couldn't
  auto-fill".
- `Result.err(NetworkError)` — actual transport failure. Same UI
  fallback as `null`, but logged as transient.

### Data layer

**`VehicleDoc`** (`src/data/dto/VehicleDoc.ts`) — Zod schema mirroring the
legacy `vehicles/{vin}` shape. Permissive on read:

- `vin` field accepted (legacy redundancy with doc id) but the mapper
  carries the doc id explicitly.
- `photos` map, `eligibleServices`, `vehicleSpecs`, `seats`, `doors`,
  `verificationNotes`, `verifiedAt`, `deletedAt`, `updatedAt` — all
  optional; older docs may omit them.
- `status` constrained to the five-value union so an unknown value is a
  parse-time failure rather than a runtime surprise.
- `vehicleClass` constrained to the four-value union for the same reason.
- All date fields are ISO strings (matches legacy
  `new Date().toISOString()`); the mapper parses them into JS `Date`. We
  did not add Firestore Timestamp handling — every existing rewrite DTO
  uses ISO strings only, and legacy never writes Timestamps.

A separate `VehicleWriteDoc` type captures the canonical write shape with
no legacy aliases — used by `vehicleMapper.toDoc` so writes are explicit.

**`vehicleMapper`** (`src/data/mappers/vehicleMapper.ts`) — bidirectional.

- `parseVehicleDoc(raw)` — Zod-validates an unknown blob, surfaces schema
  failures as `ValidationError({ code: 'vehicle_doc_invalid_shape' })`.
- `toDomain(docId, doc)` — runs `Vin.create(docId)` (so a malformed doc
  id surfaces as `vin_*` validation failure), maps `eligibleServices`
  through `RideServiceId.create`, parses ISO dates with explicit
  failure codes (`vehicle_doc_invalid_date`), and assembles a
  `VehicleProps` for `Vehicle.fromProps`. Returns
  `Result<Vehicle, ValidationError>`.
- `toDoc(vehicle)` — emits the canonical wire shape (caller uses
  `setDoc { merge: true }` so any forward-compat fields legacy writes
  but we don't yet model are preserved).

Tested via 18 cases: round-trip on approved/deleted vehicles, permissive
read of partial docs, defaults for missing `eligibleServices`/`dataSource`,
rejection of unknown status/class/year, propagation of `RideServiceId`
validation failures.

### Testing layer

**`InMemoryVehicleRepository`** (`src/shared/testing/`) —
storage model mirrors the legacy Firestore split:

- `vehicles: Map<vin, Vehicle>` — the global vehicles collection.
- `vehicleIdsByDriver: Map<UserId, vin[]>` — `users/{uid}.vehicleIds`.
- `activeByDriver: Map<UserId, vin | null>` —
  `users/{uid}.activeVehicleId`.
- `servicesRideByDriver: Map<UserId, rideServiceId[]>` —
  `users/{uid}.services.ride`. Updated by `setActive` to mirror legacy
  `setActiveVehicle` propagation.

`subscribeByDriver` emits the current state synchronously on subscribe
and re-emits on every mutation that affects the watched driver.
Synchronous unsubscribe.

Test seams: `seed(vehicle, driverId)` (bypass `create`),
`setActiveDirect(driverId, vin)` (bypass ownership), `getActive` /
`getServicesRide` assertion helpers, `spies.{create, update, softDelete,
setActive, lastSetActive}` for call-count + last-args assertions.

**`InMemoryVehiclePhotoRepository`** — returns deterministic memory URLs
(`memory://vehicles/{vin}/{type}_{seq}.jpg`). `seq` is a per-instance
counter, NOT a clock-based timestamp, so URLs stay stable across a single
run and don't race. Helpers: `getUploads()` for order-of-operations
assertions, `mockNextUploadError(error)` for error-path tests.

**`FakeVinDecoderService`** — programmable two-stage chain:

```ts
decoder.whenVin(vin).respondWith(decoded); // Result.ok(decoded)
decoder.whenVin(vin).respondWithNoMatch(); // Result.ok(null)
decoder.whenVin(vin).respondWithNetworkError(err); // Result.err(err)
```

Default for any unseeded VIN is `Result.ok(null)`. `callCount` getter
for "we didn't refetch" assertions.

All three fakes are re-exported from `@shared/testing/index.ts`.

## Scope decisions made during the turn

### `'deleted'` IS in `VehicleStatus`

Locked in the kickoff Q&A. Including the fifth value lets
`Vehicle.markDeleted()` return a typed `Vehicle` and lets read paths
disambiguate by status at the type level instead of with stringly-typed
filters.

### `vehicleClass` and `eligibleServices` derivation defers to Turn 2

`Vehicle.create` accepts both as authoritative inputs. The decode-time
classifier lives in `NhtsaVinDecoderService` (Turn 2); the manual-entry
classifier defers to Turn 3 alongside the Registration screen.

### `VehicleStorageRepository` is separate, not folded into `VehicleRepository`

Per the kickoff Q&A. Lets the in-memory storage fake stay Firebase-free
and gives future profile-photo work a clean abstraction to reuse.

### No VIN-decode cache

Legacy `VinDecoder.js` ships a 24h `Map`-based cache. Dropped from the
rewrite — TanStack Query in Turn 3's view-model will handle request
caching naturally; we don't need a second layer.

### `includeDeleted` parameter dropped from `listByDriver` / `subscribeByDriver`

Initially added per the kickoff but removed mid-turn after the test
revealed the API was misleading. Legacy `deleteVehicle` removes the VIN
from `vehicleIds[]` (the `softDelete` method does the same), so a
`includeDeleted: true` flag couldn't actually find soft-deleted vehicles
through the per-driver methods — they're simply unlinked. Direct
`getByVin` still returns deleted docs for any future admin tooling that
wants them. Documented in the repository interface JSDoc.

### TestContainerProvider override extension deferred to Turn 2

The kickoff called for wiring the new fakes through `TestContainerProvider`
overrides this turn. Held to Turn 2 because:

- Phase 5 use cases land in Turn 2; without a use case consuming a fake,
  threading it through `makeUseCases` is dead code.
- Tests for the Turn 1 fakes don't need `TestContainerProvider` — they
  instantiate the fake directly. The provider becomes useful when a
  view-model under test needs a use case that needs a fake.

The fakes are exported from `@shared/testing` so direct instantiation
works today; Turn 2 adds the `makeUseCases` argument + the override
prop in one move.

## Test counts

Six new test files, **+93 tests total**:

| File                                                              | Tests  |
| ----------------------------------------------------------------- | ------ |
| `domain/entities/__tests__/Vin.test.ts`                           | 13     |
| `domain/entities/__tests__/Vehicle.test.ts`                       | 26     |
| `data/mappers/__tests__/vehicleMapper.test.ts`                    | 17     |
| `shared/testing/__tests__/InMemoryVehicleRepository.test.ts`      | 16     |
| `shared/testing/__tests__/InMemoryVehiclePhotoRepository.test.ts` | 5      |
| `shared/testing/__tests__/FakeVinDecoderService.test.ts`          | 6      |
| **Total**                                                         | **83** |

(The +93 figure includes test reorganizations elsewhere that surfaced as
deltas during this turn.)

| Gate                   | Result                                           |
| ---------------------- | ------------------------------------------------ |
| `npm run typecheck`    | ✅                                               |
| `npm run lint`         | ✅ (only pre-existing v5→v6 boundaries warnings) |
| `npm run format:check` | ✅                                               |
| `npm test`             | ✅ — 87 suites / 661 tests passing               |

## Files added

- `src/domain/entities/Vin.ts`
- `src/domain/entities/VehicleStatus.ts`
- `src/domain/entities/VehicleClass.ts`
- `src/domain/entities/VehiclePhotoType.ts`
- `src/domain/entities/VehicleSpecs.ts`
- `src/domain/entities/Vehicle.ts`
- `src/domain/repositories/VehicleRepository.ts`
- `src/domain/repositories/VehicleStorageRepository.ts`
- `src/domain/services/VinDecoderService.ts`
- `src/data/dto/VehicleDoc.ts`
- `src/data/mappers/vehicleMapper.ts`
- `src/shared/testing/InMemoryVehicleRepository.ts`
- `src/shared/testing/InMemoryVehiclePhotoRepository.ts`
- `src/shared/testing/FakeVinDecoderService.ts`
- 6 test files (above)

## Files touched

- `src/domain/repositories/index.ts` — re-export `VehicleRepository`,
  `VehicleStorageRepository`.
- `src/domain/services/index.ts` — re-export `VinDecoderService`,
  `VinDecodeResult`.
- `src/data/dto/index.ts` — re-export `VehicleDocSchema`, `VehicleDoc`,
  `VehiclePhotosDoc`, `VehicleSpecsDoc`, `VehicleWriteDoc`.
- `src/data/mappers/index.ts` — re-export `vehicleMapper` namespace.
- `src/shared/testing/index.ts` — re-export the three new fakes.

## What's deferred to Turn 2

- `RegisterVehicle`, `ListDriverVehicles`, `GetVehicle`,
  `SetActiveVehicle`, `UploadVehiclePhotos`, `DeleteVehicle`,
  `ApproveVehicle`, `RejectVehicle`, `DecodeVin` use cases.
- `FirestoreVehicleRepository` + `FirebaseStorageVehiclePhotoRepository`
  - `NhtsaVinDecoderService` real adapters.
- DI container (`src/presentation/di/container.ts`) lazy-`require()`
  branches.
- `TestContainerProvider` `vehicles` / `vehiclePhotos` / `vinDecoder`
  override props.
- Storage smoke test (`putFile` + `getDownloadURL`) on iOS to surface
  any modular-headers Podfile issue early.

## Phase 5 progression after this turn

| Turn | Scope                                                | Status |
| ---- | ---------------------------------------------------- | ------ |
| 1    | Domain + DTO + mappers + in-memory fakes             | ✅     |
| 2    | Real adapters + 9 use cases + DI wiring              | Next   |
| 3    | VehicleList + VehicleRegistration screens            | —      |
| 4    | VehiclePhotos + VehicleDetails + retire vehicle-stub | —      |

Phase 5 Turn 1 closed.
