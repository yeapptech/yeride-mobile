# Phase 5 Kickoff Prompt — Vehicle management

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 5.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. The driver journey
just shipped end-to-end on real Firebase (Phase 4): a driver can sign
in, go online, accept an offer, run the full DriverMonitor status
router, and reach completed / payment_failed terminal states. Your job
this session is to start **Phase 5: Vehicle management**. Read
carefully before writing any code.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered architecture,
   conventions, file map. The "Project status" table now shows Phase 4
   complete and Phase 5 Next.
2. `REFACTOR_PLAN.md` — Phase 5 scope (§ "Phase 5 — Vehicles (1 sprint)").
3. `docs/PHASE_4_TURN_5.md` (most recent) — Phase 4 close-out, plus the
   `VEHICLE_STUB_ID` reference inside `useDriverHomeViewModel.ts:65`
   that this phase is designed to retire.
4. Legacy vehicle code at `/Users/papagallo/yeapptech/dev/yeride/`:
   - `src/api/firebase/Vehicle.js` — full CRUD + Storage uploads +
     active-vehicle propagation. Source of truth for the data layer.
   - `src/api/nhtsa/VinDecoder.js` — NHTSA `vpic.nhtsa.dot.gov`
     integration. No auth required; pure REST. Source of truth for the
     decoder service.
   - `src/driver/screens/VehicleList.js`,
     `src/driver/screens/VehicleRegistration.js`,
     `src/driver/screens/VehicleDetails.js`,
     `src/driver/screens/VehiclePhotos.js` — UI surface to mirror.
   - `src/context/VehicleContext.js` — the state-shape legacy ships.
     The rewrite will collapse this into a TanStack Query subscription
     plus a small Zustand store for the active selection.

## Starting state — what's already built

- **Domain.** `User` entity already carries `activeVehicleId: string |
null` and `vehicleIds: readonly string[]` (`src/domain/entities/User.ts:59-60`).
  No User changes needed for Phase 5 — the phase _populates_ those
  fields, doesn't add them.
- **`VehicleSnapshotDoc`** already exists in
  `src/data/dto/RideDoc.ts` for the embedded vehicle the dispatcher
  copies onto a Ride. That's distinct from the `VehicleDoc` Phase 5
  introduces (the persistent vehicles-collection shape) — keep them
  separate.
- **DI container** at `src/presentation/di/container.ts` is the single
  composition root. Phase 5 adds one new repo + one new service to
  `makeUseCases({...})` and one new lazy-`require()` branch to
  `buildContainer()`.
- **Driver UI**: `useDriverHomeViewModel` derives the active vehicle id
  off `user.activeVehicleId`, falling back to the literal
  `'vehicle-stub'` string when absent so testers without a registered
  vehicle can still go online (lines 65, 184–189). Phase 5 removes the
  stub.
- **Driver navigation**: `DriverNavigator.tsx` currently registers four
  screens (`DriverTabs`, `DriverDispatch`, `DriverMonitor`,
  `UserProfile`). Phase 5 adds four new ones.

So Phase 5 spans every layer: a new domain entity + value objects, a
new repository + Storage adapter + NHTSA service in the data layer,
eight new use cases, four new screens with view-models, and a
swap-in at the existing `VEHICLE_STUB_ID` site.

## Scope decisions (locked at kickoff)

These were resolved before the kickoff doc was written. Don't re-debate
them mid-phase — propose follow-ups in the deferred list instead.

1. **Full 5-photo upload flow.** Front/back/left/right/interior via
   `expo-image-picker` → Firebase Storage. Mirrors legacy
   `uploadVehiclePhotos`. Storage path
   `vehicles/{vin}/{photoType}_{timestamp}.jpg`, same as legacy.
2. **NHTSA decoder + manual fallback.** New `VinDecoderClient` data
   service hits the public `vpic.nhtsa.dot.gov/api/vehicles`
   endpoints (no API key); a `DecodeVin` use case wraps it. Manual
   entry remains a fallback when decode returns no match or fails.
3. **Admin approve / reject use cases included, no UI.**
   `ApproveVehicle` and `RejectVehicle` use cases + repository methods
   land for future-tool parity, but the mobile app surfaces no admin
   screen. `RegisterVehicle` continues to auto-approve (legacy parity:
   `VehicleStatus.APPROVED` on create), so the admin path is dormant
   for now.

## Scope (in / out)

**In:**

- **Domain layer**:
  - `Vin` value object — branded 17-char string with NHTSA-compliant
    character set + check-digit validation (port from
    `validateCheckDigit` in `src/api/nhtsa/VinDecoder.js`). Factory
    returns `Result<Vin, ValidationError>`.
  - `VehicleStatus` literal type (`'pending' | 'approved' | 'rejected' | 'suspended'`)
    matching legacy.
  - `Vehicle` entity (private constructor + `static create` returning
    `Result<Vehicle, ValidationError>`). Fields per legacy + photo
    URLs map (front / back / left / right / interior). Includes
    `eligibleServices: readonly RideServiceId[]`. Transition methods:
    `approve`, `reject`, `suspend`, `attachPhoto(type, url)`,
    `setEligibleServices(...)`, all returning `Result<Vehicle, ValidationError>`.
  - `VehicleRepository` interface + `VehicleStorageRepository`
    interface (photo upload / delete) in `src/domain/repositories/`.
  - `VinDecoderService` interface in `src/domain/services/`.

- **Data layer**:
  - `VehicleDoc.ts` Zod schema in `src/data/dto/`. Permissive on read
    (accepts every legacy field shape we've written), canonical on
    write.
  - `vehicleMapper.ts` bidirectional Doc ↔ entity mapper.
  - `FirestoreVehicleRepository.ts` — direct CRUD against
    `vehicles/{vin}` + the `users/{uid}.vehicleIds` array
    (`arrayUnion` / `arrayRemove`) + the `users/{uid}.activeVehicleId`
    - `services.ride` propagation that legacy does in
      `setActiveVehicle`.
  - `FirebaseStorageVehiclePhotoRepository.ts` (or fold into
    `FirestoreVehicleRepository` — Turn 2 decides) — wraps
    `@react-native-firebase/storage` with `putFile` + `getDownloadURL`.
    First time the rewrite touches Firebase Storage; the iOS
    Podfile-modular-headers fix may need re-checking.
  - `NhtsaVinDecoderService.ts` — fetch-based service against
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json`
    plus the legacy `getEligibleServices` mapping.
  - In-memory fakes for both repos and the decoder service in
    `src/shared/testing/`.

- **App layer (use cases in `src/app/usecases/vehicle/`)**:
  - `RegisterVehicle` — composite: validate Vin + (optional) decode +
    write vehicle + add VIN to `user.vehicleIds[]` + auto-approve +
    auto-set-active when driver has no active vehicle. Server-side
    duplicate check via `VehicleRepository.exists(vin)`.
  - `ListDriverVehicles` (subscription-shaped — synchronous unsubscribe
    per the project rule).
  - `GetVehicle` — read by VIN.
  - `SetActiveVehicle` — propagates to
    `user.services.ride = vehicle.eligibleServices`.
  - `UploadVehiclePhotos` — accepts a partial map
    `{ front?, back?, left?, right?, interior? }` of local URIs;
    uploads each in parallel; updates `vehicle.photos.{type}` after
    each completes (fire all, await all, persist URLs).
  - `DeleteVehicle` — soft delete (status → `'deleted'`) + remove
    from `user.vehicleIds[]` + clear `activeVehicleId` if it was the
    active vehicle.
  - `ApproveVehicle` — admin path; not consumed by Phase 5 UI.
  - `RejectVehicle` — admin path; not consumed by Phase 5 UI.
  - `DecodeVin` — wraps `VinDecoderService` and returns a domain
    `VinDecodeResult` (make/model/year/class/eligibleServices/stockPhoto).

- **Presentation layer**:
  - `VehicleListScreen` + `useVehicleListViewModel` — Profile-tab
    entry point. Lists driver vehicles (live subscription via
    `ListDriverVehicles` → TanStack Query), shows the active vehicle
    badge, action to register a new vehicle.
  - `VehicleRegistrationScreen` + `useVehicleRegistrationViewModel` —
    React Hook Form + Zod (port the legacy schema); VIN input runs
    `DecodeVin`; pre-fills make/model/year/class on success; shows
    manual-entry path on failure. Submit calls `RegisterVehicle`,
    then routes to `VehiclePhotos`.
  - `VehiclePhotosScreen` + `useVehiclePhotosViewModel` — five-tile
    grid (front/back/left/right/interior); each tile launches
    `expo-image-picker`; selected URIs handed to
    `UploadVehiclePhotos`. Empty tiles allowed (legacy doesn't gate
    approval on photos). "Done" returns to `VehicleList`.
  - `VehicleDetailsScreen` + `useVehicleDetailsViewModel` — read-only
    view of a single vehicle with edit photos, set active, and
    delete actions. Driven entirely by `GetVehicle` + `SetActiveVehicle` +
    `DeleteVehicle` + navigate-to-`VehiclePhotos`.

- **Wiring**:
  - DI container gains a `vehicles` repository arg, a `vehiclePhotos`
    storage arg (or one composite repo — choose at Turn 2), and a
    `vinDecoder` service arg. Production branch `require()`s the
    Firestore + Storage + NHTSA modules; in-memory branch wires the
    fakes.
  - `DriverNavigator` registers `VehicleList`, `VehicleRegistration`,
    `VehiclePhotos`, `VehicleDetails`. Reachable from the driver
    Profile tab.
  - `useDriverHomeViewModel` removes the `'vehicle-stub'` literal —
    online toggle now requires `user.activeVehicleId`. If absent,
    surface a "register a vehicle to go online" prompt with a deep-link
    into `VehicleList`.

**Out (deferred — do not build in Phase 5):**

- Admin UI for approve / reject (use cases ship; no surface).
- VIN scanning via camera (`expo-barcode-scanner`). Manual entry
  only this phase. Camera scan can land in Phase 9 polish.
- Vehicle status change notifications (e.g. push to driver on
  approval). Notifications are Phase 9.
- Insurance document upload. Legacy collects insurance fields as text
  but doesn't upload a PDF; Phase 5 mirrors that. Document upload is
  out of scope.
- Multi-photo selection per tile (legacy is one URL per type).
- Deletion of individual photos (legacy overwrites only).

## Suggested turn breakdown (4 turns)

- **Turn 1 — Domain + DTO + mappers + in-memory fakes.** Pure
  domain/data work, no Firebase. `Vin`, `VehicleStatus`, `Vehicle`
  entity with full transition tests. `VehicleDoc` Zod schema +
  `vehicleMapper` + round-trip tests against fixture docs from the
  legacy `vehicles/` collection. `VehicleRepository` +
  `VehicleStorageRepository` + `VinDecoderService` interfaces.
  `InMemoryVehicleRepository`, `InMemoryVehiclePhotoRepository`,
  `FakeVinDecoderService` in `@shared/testing` with full contract
  coverage. Wire fakes into `TestContainerProvider` overrides. Tests
  pass against fakes only; no Firebase imports yet.

- **Turn 2 — Real adapters + 8 use cases + DI wiring.** Build
  `FirestoreVehicleRepository`, `FirebaseStorageVehiclePhotoRepository`,
  `NhtsaVinDecoderService` against the legacy contracts. Implement
  `RegisterVehicle`, `ListDriverVehicles`, `GetVehicle`,
  `SetActiveVehicle`, `UploadVehiclePhotos`, `DeleteVehicle`,
  `ApproveVehicle`, `RejectVehicle`, `DecodeVin` use cases with full
  unit coverage against the in-memory fakes. Update
  `src/presentation/di/container.ts` with lazy-required branches.
  Dual-mode boot smoke (real Firebase + fakes) before declaring done.

- **Turn 3 — VehicleList + VehicleRegistration screens.** Profile-tab
  entry → vehicle list → register flow. Real `DecodeVin` wired (turn
  it on against staging — the NHTSA endpoint is public). Manual-entry
  fallback tested. Form validation mirrors legacy Zod schema.
  Successful registration navigates to `VehiclePhotos`.
  View-model unit tests + screen smoke tests with
  `TestContainerProvider`.

- **Turn 4 — VehiclePhotos + VehicleDetails + stub retirement +
  cleanup.** Five-tile photo grid with `expo-image-picker` +
  `UploadVehiclePhotos`. `VehicleDetails` read-only view with set-active
  and delete. Replace `VEHICLE_STUB_ID` in
  `useDriverHomeViewModel`: empty-state prompt routes to `VehicleList`.
  Update `CLAUDE.md` (Phase 5 → ✅, Phase 6 → Next, refresh test
  count + critical-files table + import paths). Write
  `docs/PHASE_5_TURN_*.md` records for each turn. Final `npm run verify`
  green.

## Conventions (non-negotiable — same as Phases 3–4)

- `Result.ok` / `Result.err` for every expected failure. Never throw
  for domain errors. Programming errors still throw.
- Build the in-memory fake first (Turn 1) before the real Firestore /
  Storage / NHTSA adapters (Turn 2). The contract is firmer that way.
- Server state → TanStack Query (`useDriverVehiclesQuery`,
  `useVehicleQuery`). Client/UI state → Zustand if any UI flag needs
  holding (most likely: a draft-vehicle store across Registration →
  Photos). Don't mix.
- Each screen gets a sibling `useXxxViewModel.ts`. Screens are dumb
  (props in, JSX out).
- Logger only: `LOG.extend('VEHICLE')`, never `console.*`.
- Synchronous unsubscribe for `ListDriverVehicles` — legacy
  `subscribeToDriverVehicles` is sync-unsubscribe already; preserve it.
- Permissive on read, canonical on write. The DTO must accept every
  legacy field shape; writes use the canonical shape with `setDoc {
merge: true }` so future-rewrite-unaware fields survive.
- Run `npm run verify` (typecheck + lint + format + test) before
  declaring a turn done.

## Acceptance for end of Phase 5

- A signed-in driver can navigate from the Profile tab to a
  `VehicleList`, register a new vehicle (VIN decode → form → optional
  photos), see it appear in the list with the active badge, change
  the active selection, and delete a vehicle. The auto-approve path
  fires; the admin approve / reject use cases are unit-tested but
  unreachable from the UI.
- The driver can no longer go online without an active vehicle — the
  `'vehicle-stub'` literal is gone from the codebase.
  `useDriverHomeViewModel` emits an empty-state prompt routing into
  `VehicleList` instead.
- Vehicle photos upload to `vehicles/{vin}/{type}_{ts}.jpg` in
  Firebase Storage and the URLs persist on the vehicle doc.
- Active-vehicle changes propagate to `user.services.ride` per the
  legacy `setActiveVehicle` contract.
- Test suite stays green; new view-models have unit tests against
  in-memory fakes; new components have at least smoke renders. Net
  test gain: ≥40 tests (estimate; Phase 4 added 50, Phase 5 is a
  somewhat smaller surface).
- `CLAUDE.md` updated; `docs/PHASE_5_TURN_*.md` records written.

## Risks + mitigations

- **Firebase Storage on iOS under static frameworks.** The rewrite
  has not exercised `@react-native-firebase/storage` yet; Auth +
  Firestore are working but Storage may need its own modular-headers
  pin in the existing Podfile patch. Mitigation: include a Storage
  smoke (single test photo upload + URL fetch) in Turn 2's dual-mode
  boot; if it fails, extend `scripts/patch-podfile.js` before moving to
  Turn 3.
- **NHTSA endpoint flakiness.** The decoder is a public US-government
  API. Treat any non-200 response as a fall-through to manual entry,
  not a fatal error. The `DecodeVin` use case must return
  `Result.ok(null)` for "no match found" and `Result.err(NetworkError)`
  only for actual network failures.
- **VIN check-digit algorithm.** Legacy ships a working
  `validateCheckDigit` — port it verbatim into the `Vin` value
  object's factory rather than reimplementing. The transliteration
  table is the easy thing to get wrong.
- **`expo-image-picker` permission strings on iOS.** Already
  configured in `app.config.ts` for the rider avatar flow; verify
  before Turn 4 that camera + library permission strings are still
  present and run a fresh `npm run prebuild` if they were edited.
- **Co-existence with legacy yeride.** Both apps still write to the
  same `vehicles/` collection in dev/stage. The DTO must round-trip
  every legacy field; writes must include canonical fields legacy
  reads (e.g. `vin`, `status`, `eligibleServices`). The
  `setDoc { merge: true }` rule applies on Vehicle as it does on Ride.

## Start with

Read `CLAUDE.md`, then the Phase 5 section of `REFACTOR_PLAN.md`, then
`docs/PHASE_4_TURN_5.md`, then the legacy `src/api/firebase/Vehicle.js`
and `src/api/nhtsa/VinDecoder.js`. Then propose **Turn 1 scope** as a
numbered punch list (files to create, files to touch, tests to add)
and wait for confirmation before writing code.
