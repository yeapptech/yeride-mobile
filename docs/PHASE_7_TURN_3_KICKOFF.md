# Phase 7 Turn 3 Kickoff Prompt — RideMonitor + DriverMonitor swap-ins + Phase 7 close

Paste the section below into a fresh Claude session against the
`/Users/papagallo/yeapptech/dev/yeride-mobile/` repo to begin Phase 7
Turn 3.

---

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. Phase 7 Turn 2 just
closed: `useGpsLifecycle` is mounted exactly once at AppContent,
the SDK lifecycle (init / permission / start / stop), the location
+ geofence subscriptions, and the pickup-geofence (re-)registration
all live in one hook. Live deliveries land in `useGpsStore`, which
exposes six selector hooks (`useGpsCurrentLocation`,
`useGpsCurrentOdometer`, `useGpsCurrentSpeed`,
`useGpsLastGeofenceEvent`, `useGpsIsInsidePickupGeofence`,
`useGpsPermissionStatus`). Location events also fan out to
`useUpdateLocationMutation` so `locations/{userId}` Firestore docs
get fresh writes per delivery. End of turn 2: **152 suites / 1162
tests passing**. **No view-model has been swapped onto the GPS
store yet** — that's Turn 3's job.

Your job this session is **Phase 7 Turn 3: swap RideMonitor +
DriverMonitor onto the live GPS store, retire the foreground-tick
geofence path and the stub odometer, then close Phase 7**. Three
surgical view-model edits, three test updates, and the phase-close
documentation. By end of turn, Phase 7 → ✅ across both phase
tables in CLAUDE.md, `docs/PHASE_7_TURN_3.md` is written, and the
Phase 8 (Google Navigation SDK) kickoff prompt is staged for the
next session.

## Required reading (in order)

1. `CLAUDE.md` at the repo root — current state, layered
   architecture, conventions. The Phase 7 Turn 2 acceptance
   paragraph (just past the project-status block) is the most
   recent entry. Note the **Driver-side specifics (Phase 4)**
   section — the `arrivedAtPickup` and `stubOdometerMeters`
   patterns are documented as Phase 7 swap-sites.
2. `docs/PHASE_7_TURN_2.md` — what Turn 2 shipped, the design
   decisions baked into the lifecycle hook + the store, the risks
   surfaced (the "act warnings in tests" and the "worker process
   leak" notes are pre-existing — don't chase them).
3. `docs/PHASE_7_KICKOFF.md` — original phase-level kickoff. Scope
   decisions 7 (driver auto-flip) and 8 (real odometer for Start /
   RequestPayment) are exactly what this turn delivers.
4. The Turn-2 surface you'll consume:
   - `src/presentation/stores/useGpsStore.ts` — read the six
     selector hooks. `useGpsLastGeofenceEvent` returns the latest
     `BgGeofenceEvent | null` (with action, identifier, rideId,
     timestampMs). `useGpsIsInsidePickupGeofence` is auto-derived
     from `event.action`. `useGpsCurrentOdometer` is metres
     cumulative since last `resetOdometer`.
   - `src/presentation/hooks/useGpsLifecycle.ts` — read the
     **AppContent-only** docstring guard. Reminder: NEVER mount
     this hook from a screen or VM.
   - `src/presentation/AppContent.tsx` — already passes
     `activeRideForGeofence` derived from the live `observeRide`
     subscription. The geofence is registered / deregistered for
     you; Turn 3 just consumes the resulting events.
   - `src/data/services/BackgroundGeolocationClient.ts` — note the
     `BgGeofenceEvent.identifier === 'pickup'` and `action: 'ENTER'
     | 'EXIT'` shape. Pickup-only geofence in Phase 7 (Decision 6).
5. The view-models you'll edit:
   - `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`
     — currently runs `EvaluateExitWarning` against
     `useCurrentLocation().coordinates` on every render while the
     ride is `'dispatched'`. Replace this with a
     `useGpsLastGeofenceEvent`-driven derivation that flips
     `useGeofenceUiStore.pickupExitWarningVisible` on EXIT and
     dismisses on ENTER.
   - `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`
     — has the manual `arrivedAtPickup` state machine and the
     `stubOdometerMeters` derivation. Two swaps:
     1. `arrivedAtPickup` becomes `useGpsIsInsidePickupGeofence()`
        OR the manual button (kickoff Decision 7 — manual override
        retained). Replace `useState` + `setArrivedAtPickup` with a
        derived value + a "manual override" flag for the button
        path.
     2. Replace `stubOdometerMeters(ride)` with a real reading.
        Two options: pull `useGpsCurrentOdometer()` from the store
        and pass it into the mutations, OR call
        `bgGeolocation.getOdometer()` at mutation time for an
        always-fresh reading. Recommend the store path
        (`useGpsCurrentOdometer()` reflects the latest delivery the
        SDK pushed, no extra await on the click); confirm in
        kickoff scope decision 1.
6. The existing tests you'll update:
   - `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`
     — rewrite the geofence-evaluation tests to drive
     `useGpsStore.setGeofenceEvent` directly (act + setState) and
     assert on `useGeofenceUiStore.pickupExitWarningVisible`.
     Retire any tests that drive `currentLocation` for geofence
     purposes.
   - `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`
     — rewrite the `arrivedAtPickup` tests to drive
     `useGpsStore.setIsInsidePickupGeofence(true | false)` and
     assert on the VM's `arrivedAtPickup` output. Retain the
     manual-button override tests (the button path stays).
     Rewrite the `Start ride` / `Request payment` tests to seed
     `useGpsStore.setLocation({...odometerMeters: N})` and assert
     the mutation is called with the seeded N (not `0 + 1`).

## Starting state — what's already wired

- **GPS lifecycle**: `useGpsLifecycle` is owned by AppContent. SDK
  init, permission, start/stop, location subscription, geofence
  subscription, pickup-geofence (re-)registration, synchronous
  chain-ordered teardown — all done.
- **GPS store**: `useGpsStore` is the canonical mirror. Selector
  hooks ready. `setIsInsidePickupGeofence(false)` is the
  manual escape hatch the lifecycle hook uses on geofence
  deregistration.
- **Active-ride resolution**: `useActiveRideForGeofence(user)` runs
  at AppContent. When the user has a `'dispatched'` ride, the
  geofence is registered with the right rideId / pickupCoords /
  200m radius.
- **Location writes**: `useUpdateLocationMutation` fires per SDK
  delivery; `locations/{userId}` doc gets refreshed every ~200m of
  motion / ~30s idle. **Don't add another write path** in the
  view-models — that would create double-writes.
- **Sign-out store reset**: AppContent resets `useGpsStore` on
  `'unauthenticated'` transition. Don't reset from the VMs.
- **Existing foreground hook**: `useCurrentLocation` is the Phase
  3 foreground reader. Turn 3 deprecates its **trip-tracking**
  callers (geofence tick in RideMonitorVM); the hook itself stays
  in place because RiderHome / DriverHome / RouteSearch still use
  it for the initial map centre. Don't delete the hook.
- **Cloud Functions**: `completeTrip` / `cancelTrip` callables are
  wired through `RequestPayment` / `CancelRideByDriver`. The fare
  math runs server-side; the VM just passes whatever odometer it
  derives. No use-case-shape changes needed for Turn 3.

## Scope decisions (lock these at kickoff)

These need confirmation in the first message back, then don't
re-debate them mid-turn — surface objections as deferred items.

1. **Odometer source: `useGpsCurrentOdometer()` from the store,
   not a fresh `bgGeolocation.getOdometer()` call at mutation
   time.** The store value is set from the most recent SDK
   delivery (≤200m / 30s old). Calling `getOdometer()` at click
   time would buy a few metres of freshness at the cost of an
   await on the user-facing tap. Take the staleness; field
   telemetry Phase 9 can revisit if it matters.

2. **Manual `Arrived at pickup` button: kept as override.** The
   driver can tap it even when the geofence reports `outside` (GPS
   drift, cellular dead zone, etc.). The VM's `arrivedAtPickup`
   becomes `useGpsIsInsidePickupGeofence() || manualOverride`. The
   override flag is local `useState`; it doesn't need to outlive
   the screen. Manual button hides while the geofence already
   reports `inside` (no-op).

3. **Rider-side EXIT banner: event-driven from
   `useGpsLastGeofenceEvent`.** Drive a `useEffect` watching the
   event identity:
   - Action `'EXIT'` + identifier `'pickup'` + status
     `'dispatched'` → `useGeofenceUiStore.showPickupExitWarning()`.
   - Action `'ENTER'` (rider walked back into pickup area) →
     `dismissPickupExitWarning()`.
   - Status leaves `'dispatched'` (driver started the ride) →
     `dismissPickupExitWarning()` (cleanup so the banner doesn't
     survive into Started view).
   The legacy `EvaluateExitWarning` use case is no longer the
   trigger; it's pure-domain logic that's still useful for
   distance-based fallback testing but isn't called from the live
   path. Don't delete it — Phase 9 may re-use it for a "you're
   X metres away" surface.

4. **`arrivedAtPickup` is a derived value, not stored.** Replace
   `useState<boolean>(false)` + `setArrivedAtPickup` with:
   ```ts
   const fromGps = useGpsIsInsidePickupGeofence();
   const [manualOverride, setManualOverride] = useState(false);
   const arrivedAtPickup = fromGps || manualOverride;
   ```
   `onArriveAtPickup()` flips `manualOverride` true.
   `onBackToEnRoute()` flips it false. The geofence's flip-back-on-
   server-status-change is already handled by `useGpsLifecycle` (it
   calls `setIsInsidePickupGeofence(false)` on geofence
   deregistration). No extra cleanup in the VM.

5. **No new TanStack queries / use cases this turn.** This is pure
   view-model rewiring. The Cloud Function side stays untouched.

6. **Test fakes: drive `useGpsStore` directly via
   `getState().setX()` calls in `act()`.** No need to mount
   `useGpsLifecycle` in VM tests — the store IS the seam between
   the lifecycle and the VMs. `TestContainerProvider` doesn't need
   to care about `bgGeolocation` for these test files.

7. **Phase 7 close + Phase 8 kickoff:**
   - `docs/PHASE_7_TURN_3.md` — turn record, same shape as
     `PHASE_7_TURN_1.md` / `PHASE_7_TURN_2.md`.
   - `docs/PHASE_8_KICKOFF.md` — Phase 8 kickoff for the next
     session (Google Navigation SDK — driver in-app navigation).
     Mirror the Phase 7 kickoff shape. Touchpoint: legacy
     `yeride/src/driver/screens/DriverNavigation.js` and the
     `@googlemaps/react-native-navigation-sdk@0.14.1` plumbing
     that's already in `app.config.ts` plugin block (legacy app
     uses the same package; no install needed). The plan
     document at `docs/plans/2026-03-04-google-navigation-sdk-design.md`
     in the legacy repo is required reading.
   - `CLAUDE.md` — Phase 7 turn 3 → ✅ in both phase tables;
     close-of-Phase-7 acceptance paragraph; Phase 8 → Next; test
     counts bumped.

## Scope (in / out)

**In:**

- **`useRideMonitorViewModel`**:
  - Drop the `EvaluateExitWarning` import + the per-render call.
  - Add `useGpsLastGeofenceEvent()` + `useEffect` event-driven
    banner trigger.
  - Drop the `currentLocation` prop / `useCurrentLocation` call
    if it's used only for the exit-warning evaluation. If the VM
    still needs a foreground coord for any other purpose,
    confirm the use site and keep it; otherwise remove the prop.
  - Update tests to drive `useGpsStore.setGeofenceEvent` directly.

- **`useDriverMonitorViewModel`**:
  - Replace `arrivedAtPickup` state machine with the derived
    pattern from scope decision 4.
  - Replace `stubOdometerMeters` with `useGpsCurrentOdometer()`
    reading at the moment of mutation. Both `Start ride` and
    `Request payment` mutations now pass the real odometer.
  - The mode mirror into `useDriverStatusStore` stays unchanged
    (it's status-derived, not GPS-derived).
  - Update tests to drive `useGpsStore.setIsInsidePickupGeofence`
    + `useGpsStore.setLocation` for odometer; assert mutations
    are called with the seeded values.

- **Documentation**:
  - `docs/PHASE_7_TURN_3.md` — turn record.
  - `docs/PHASE_8_KICKOFF.md` — next-phase kickoff.
  - `CLAUDE.md` — Phase 7 close acceptance paragraph; both phase
    tables marked ✅; test counts bumped; Critical files refreshed
    to note the new VM swap-sites.

**Out (deferred — do not build in Turn 3):**

- **"Open Settings" CTA UI**. `useGpsPermissionStatus` is
  populated; deep-linking to system settings on
  `'denied' | 'when_in_use'` is Phase 9 polish.
- **`resetOdometer()` per ride start**. Adapter exposes the method
  but Turn 3 doesn't call it. The cumulative session odometer is
  fine for Phase 7's monotonicity checks; Phase 9 can decide if
  trip-start should reset.
- **AppState-triggered resume listener**. SDK manages its own
  foreground/background lifecycle.
- **Driver-side EXIT warnings** ("you're leaving without starting
  / completing"). Out of Phase 7 scope per the original kickoff.
- **Foreground hook removal**. `useCurrentLocation` stays — it's
  still used by RiderHome / DriverHome / RouteSearch for the
  initial map centre. Phase 9 polish can audit whether the
  foreground hook should be replaced everywhere by
  `useGpsCurrentLocation()`.
- **Phase 8 implementation**. Turn 3 only writes the kickoff
  document; the actual Navigation-SDK work is the next session.

## Suggested implementation order

1. **Rider-side first** (`useRideMonitorViewModel`). Smaller diff,
   fewer mutations to reason about. Land it, run the VM test
   suite, confirm green.
2. **Driver-side `arrivedAtPickup` swap**. Pure UI logic, no
   mutation surface change. Land it, confirm tests green.
3. **Driver-side `stubOdometerMeters` → `useGpsCurrentOdometer()`**.
   Mutation surface change (`Start ride` / `Request payment` now
   pass real values). Update tests to seed via
   `useGpsStore.setLocation({odometerMeters: N})` and assert
   mutation call args.
4. **Documentation pass**. Write `PHASE_7_TURN_3.md`, then the
   Phase 8 kickoff. Update `CLAUDE.md`.
5. **Verify gates**. typecheck + lint + format + test all green.
   Run `npm run android` if a device is available — confirm a
   driver flow end-to-end touches the new code paths cleanly.

## Risks + mitigations

- **`useGpsLastGeofenceEvent` event identity churn.** The store
  emits a new event object on every `setGeofenceEvent` call (which
  is once per dedup-passed delivery). A naive `useEffect` on the
  event will re-fire on every emission, including duplicates that
  the dedup somehow missed. Mitigation: compare event identity
  (`prev?.timestampMs === next?.timestampMs && prev?.action ===
next?.action`) inside the effect, or use a `useRef` to remember the
  last-handled event. Don't write a `JSON.stringify` comparator —
  the event objects are reference-stable from the dedup layer in
  `BackgroundGeolocationClient`.

- **`arrivedAtPickup` derived from `fromGps || manualOverride`
  semantics.** If the driver taps the manual button while inside
  the geofence (geofence already reports `inside`), the override
  flag flips to `true` but has no visible effect. That's fine —
  the next `EXIT` event will flip the geofence false, and the
  override flag carries the at-pickup state forward. Mitigation:
  on `'started'` status (driver pressed Start ride), reset
  `manualOverride` to `false` to keep the flag bounded.

- **`useGpsCurrentOdometer()` reads zero before first SDK
  delivery.** A driver who taps `Start ride` in the same second
  as the SDK starts could see odometer=0. The `Ride.start({
odometerMeters })` validation accepts 0; fare math goes through.
  But `Ride.requestPayment` enforces `>= start.odometerMeters` —
  if start was 0 and payment is also 0, it passes; if start was
  0 and payment is 100m, it passes. The risk is negligible.
  Mitigation: tag the kickoff scope-decision-1 paragraph above as
  "accepted staleness".

- **VM tests mounting `useGpsStore`**. The store is module-scoped
  Zustand, so cross-test pollution is real. Mitigation: every
  test file's `beforeEach` calls `useGpsStore.getState().reset()`.
  Same pattern the existing store-test files use.

- **`useCurrentLocation` removal vs. retention.** If the rider VM
  was only using `useCurrentLocation` for the geofence tick,
  retiring the hook is clean. If it was also feeding a map prop,
  the swap is more involved (consider `useGpsCurrentLocation` from
  the store as a replacement). Read the VM end-to-end before
  deciding. Don't break unrelated map rendering.

- **Sandbox virtiofs unlink**. Same family as prior phases — if
  we end up replacing files (e.g. retiring a deprecated hook),
  prefer leaving deprecation stubs rather than `rm`-ing. The
  legacy `useCurrentLocation` should stay; only the imports
  change.

## Acceptance for end of Turn 3 (and Phase 7)

- A signed-in rider on an active trip in `'dispatched'` who walks
  out of the pickup-area sees the "you've left your pickup area"
  banner appear within ~5 seconds of crossing the 200m radius.
  Walking back in dismisses the banner automatically. The
  `useCurrentLocation` foreground tick is no longer in the
  geofence path.
- A signed-in driver who accepts a ride and drives toward the
  pickup point sees `AtPickupView` automatically replace
  `EnRouteToPickupView` once their location enters the pickup
  geofence. Manual button still works as an override.
- A driver who taps `Start ride` sees the trip transition with a
  real odometer reading from the SDK (typically `>0` after pickup
  travel). Tapping `Request payment` later passes the same
  odometer source — the entity's monotonicity check passes
  against real GPS data.
- Test suite stays green; the `useRideMonitorViewModel` and
  `useDriverMonitorViewModel` test files are updated to drive the
  GPS store directly. Net test gain: ~+10 to +15 tests covering
  the new event-driven paths and the manual override.
- typecheck + lint + format + test all green.
- `docs/PHASE_7_TURN_3.md` written; `docs/PHASE_8_KICKOFF.md`
  written; `CLAUDE.md` updated (Phase 7 → ✅ across both phase
  tables, acceptance paragraph for Turn 3, Phase 8 → Next, test
  counts bumped, Critical files cheat-sheet refreshed).
- A first device smoke (post-prebuild if needed) confirms the
  rider banner fires from a real walk and the driver
  `arrivedAtPickup` flips at the geofence boundary.

## Conventions (non-negotiable — same as Phases 3–7 turns 1–2)

- `Result.ok` / `Result.err` for every expected failure. None of
  the Turn 3 work introduces new use cases or domain types, but
  the rewiring stays inside the existing pattern.
- View-model tests via `TestContainerProvider` plus direct
  `useGpsStore` driving. No new mocking layer needed.
- Logger only: `LOG.extend('RideMonitorVM')` /
  `LOG.extend('DriverMonitorVM')`. Never `console.*`.
- AppContent is the ONLY place that calls `useGpsLifecycle`. VMs
  read via `useGpsStore` selector hooks.
- `npm run verify` (typecheck + lint + format + test) before
  declaring the turn done.

## Start with

1. Read `CLAUDE.md`'s Phase 7 Turn 2 acceptance paragraph + the
   `Driver-side specifics (Phase 4)` section.
2. Read `docs/PHASE_7_TURN_2.md` end-to-end.
3. Read `useGpsStore.ts` end-to-end — six selector hooks, five
   actions.
4. Read `useRideMonitorViewModel.ts` end-to-end — note the current
   `EvaluateExitWarning` call site and any `useCurrentLocation`
   dependencies.
5. Read `useDriverMonitorViewModel.ts` end-to-end — note the
   `arrivedAtPickup` state machine, the `onArriveAtPickup` /
   `onBackToEnRoute` callbacks, and the `stubOdometerMeters`
   derivation.
6. Read both VM test files end-to-end so you know which existing
   tests need rewriting vs. which can stay as-is.
7. Then propose **Turn 3 scope** as a numbered punch list (files
   to touch, tests to update, deferred items, risks) and wait
   for confirmation before writing code.

Tip: this is a SMALL turn. Three view-model edits + two test
updates + a documentation pass. Resist the urge to wander into
Phase 8 territory or "while I'm here, let me also …" cleanups.
The Phase 7 close is the deliverable; Phase 8 starts in a fresh
session against a clean baseline.
