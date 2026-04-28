# Phase 3 — Turn 5: RideReceipt + Phase 3 cleanup

The final Phase 3 turn. The rider can now walk a complete ride from
sign-in through receipt display. RideReceiptScreen replaces the turn
3.3 placeholder with a real read-only summary; the dormant Phase 0
GreetUser smoke artifact is retired.

The Detox `rider.test.ts` smoke that was originally scoped here is
deferred to a small Phase-3 follow-up — it needs a Firebase emulator

- admin-side seed script that's better landed alongside Phase 4's real
  driver flow (which obsoletes the seed script). Detail in §"What's
  deferred".

## What's in

### App layer

- `src/app/usecases/ride/ObserveTripPayments.ts` — subscription-shaped
  use case wrapping `RideRepository.subscribePayments`. Emits `readonly
TripPayment[]` sorted newest-first per the contract. Read-only on the
  client; Firestore rules deny client writes.
- DI registration: `useCases.observeTripPayments` added to the
  `UseCases` interface and `makeUseCases` composer.

### Presentation — view-model

`useRideReceiptViewModel` (`features/rider/view-models/`):

- `useRideQuery(rideId)` — one-shot read of the trip doc. Receipt is
  terminal-state; no live subscription needed. The cache is warmed by
  `useCancelRideAsRiderMutation` / `useCreateRideMutation` from earlier
  flows.
- `useFirestoreSubscription(observeTripPayments)` — live: the Stripe
  webhook may write a tip / refund row after the rider opened the
  receipt. The subscription auto-updates without a manual refresh.
- Computed surface:
  - `farePayment` / `tipPayment` / `refundPayment` — single-row access
    for the receipt's labelled rows (filtered to `succeeded` only).
  - `fareTotal: Money | null` — authoritative total computed as
    `fare + tip − refund` in `Money` minor units. Returns `null` while
    no fare row has landed yet (the UI shows "Total updates as soon as
    your charge clears."). Clamps to zero when a refund exceeds the
    charge rather than going negative.
- `emailReceipt()` — Phase 9 placeholder; the screen mounts the disabled
  button.

### Presentation — screen

`RideReceiptScreen` rewritten:

- Top: small map (`height: 220`) showing pickup + dropoff + the dropoff
  polyline. Reuses the shared `Map` component's always-mounted-children
  pool — no new patterns.
- Header: "Trip with {Driver}" plus the receipt-id (the `RideId`).
- Pickup / Dropoff endpoint summary card.
- Fare breakdown table: trip fare row + tip row + refund row +
  total row. Rows render only when their corresponding payment exists.
- Payment summary: "Charged to your default card" placeholder. Card
  brand + last-4 land in Phase 6 alongside the Stripe wallet's
  `cardBrand` / `cardLast4` extension to `TripPayment`.
- Disabled "Email receipt" button (Phase 9 polish).
- Done CTA → `navigation.popToTop()`, returning to RiderTabs.
- Loading + error guards at the top so the screen never renders with a
  partial ride.

### Cleanup

- `src/app/usecases/shared/GreetUser.ts` — Phase 0 smoke artifact
  retired. The DI container's `useCases.greetUser` field and its
  registration are gone. The file remains as `export {};` because the
  sandbox running this turn couldn't `rm`; the test file similarly
  contains a single placeholder spec to keep Jest happy until the
  files are deleted with:
  ```
  git rm -f src/app/usecases/shared/GreetUser.ts \
            'src/app/usecases/shared/__tests__/GreetUser.test.ts'
  ```

## Test counts (delta from turn 3.4b)

| Category    | New tests                     |
| ----------- | ----------------------------- |
| Use cases   | `ObserveTripPayments` (3)     |
| View-models | `useRideReceiptViewModel` (6) |

9 new tests on top of turn 3.4b's 512. The GreetUser collapse swapped
4 tests for 1 placeholder, net −3. Total: **518 tests / 75 suites
passing** (+6 vs. turn 3.4b's 512). Suite count went 73 → 75: two new
test files (`ObserveTripPayments.test.ts`, `useRideReceiptViewModel.test.tsx`).

## What's deferred to a Phase 3 follow-up

- **Detox `rider.test.ts` smoke** — was originally scoped here. The
  test needs (a) a Firebase emulator booted in CI, (b) an admin-side
  seed script that walks a ride through `awaiting_driver → dispatched
→ started → payment_requested → completed` server-side, and (c) a
  Detox config that survives RN 0.83 + new arch on both iOS and
  Android. Phase 4's real driver flow obsoletes (b) — the rider Detox
  smoke can drive both halves of the trip from a single device. The
  follow-up is small once Phase 4 lands: write the rider script, hook
  it up to CI.
- **`useRouteSelectViewModel.confirm()` submit-path tests** — promised
  in turn 3.3's deferred list and turn 3.4b's deferred list. Same
  reason: needs `useCurrentUserQuery` resolving inside a renderHook
  wrapper; the smaller follow-up is a small TestContainerProvider
  helper that primes the auth + user-doc state in one call.
- **`GreetUser` file deletion** — sandbox couldn't `rm`; the user
  cleans up in the turn-3.5 commit.
- **Schedule-pickup datetime picker** — `useTripDraftStore.scheduledPickupAt`
  carries the field; the UI lands in Phase 5 alongside the scheduled-
  ride creation flow.

## Acceptance for turn 5

`npm run verify`:

- **`npm test`** — 518 tests / 75 suites passing.
- **`npm run typecheck`** — zero errors.
- **`npm run lint`** — zero errors.
- **`npm run format:check`** — clean.

End-to-end (against the in-memory fakes): RiderHome → RouteSearch →
RouteSelect → Confirm → RideMonitor walks awaiting → dispatched →
started → payment_requested → completed → automatically replaces with
RideReceipt → fare breakdown shows fare-only when only the fare row
lands, fare + tip when the tip row lands, fare + tip − refund when a
refund posts. "Done" pops back to RiderTabs.

## Phase 3 — full delta vs. start

Phase 3 is now ✅. The rewrite has:

- 6 turns (3.1 foundations, 3.2 RouteSearch + RouteSelect, 3.3
  RiderHome + role-routing, 3.4a RideMonitor scaffold, 3.4b late-status
  views, 3.5 RideReceipt + cleanup).
- ~1500 lines of new presentation code, ~2200 of tests, ~400 of
  documentation.
- 5 new use cases (`ObserveTripEvents`, `ObserveLatestMessage`,
  `EvaluateExitWarning`, `GetRideById`, `ListRidesByPassenger`,
  `ObserveTripPayments`, `EstimateFare`).
- 1 use case refactor (`CreateRide` now takes a spec and mints the
  RideId).
- New repository contract method (`RideRepository.newId`).
- 9 new screens / view-models (RouteSearch, RouteSelect, RiderHome,
  RideMonitor, RideReceipt + their VMs, plus 4 placeholder/tab screens).
- 5 status views (Awaiting/Dispatched/Started/Completed/PaymentFailed),
  3 trip components (BottomSheetHeader, CancelReasonSheet, etc.), 5
  route components.
- 3 Zustand stores (TripDraft, GeofenceUi, ChatUi) + 2 new query
  factories + the `useFirestoreSubscription` + `useCurrentLocation` hooks.
- 5 native deps (react-native-maps, RNGPA, bottom-sheet, toast-message,
  bottom-tabs).
- 2 config plugins / shims (`withGoogleMapsApiKey`,
  `react-native-maps.d.ts` type shim).
- Test count: **422 → 518 tests** (+96 across Phase 3); **59 → 75
  suites**. All four verify gates green throughout.

Phase 4 (driver mode + GPS lifecycle) is next; it picks up
`useGpsLifecycle`, `BackgroundGeolocationClient`, the driver tabs
(Home / Activity / Earnings / Profile), DriverDispatch / DriverMonitor
/ DriverNavigation, and the geofence-listener wiring that the rider
side stubbed out. The rider-side groundwork from Phase 3 means the
geofence + chat + GPS hooks have known integration points.
