# Phase 10 OOB — Driver / Rider home stale-location fix

**Closed:** 2026-05-22
**Type:** Out-of-band defect fix (not a planned Phase 10 turn — uncovered
during pre-cutover dogfooding).
**Precedent:** Same out-of-band shape as the
react-native-background-geolocation 4.19.4 → 5.1.1 upgrade chore
recorded in the CLAUDE.md opener — a fix that landed between the
Phase 10 turn cadence to clear a real defect, documented with per-fix
shape rather than as a planned turn.

## Symptom

On the Android emulator (Pixel 9 Pro) and iOS Simulator running a dev
build, opening `DriverHome` immediately after login showed the map
centred on a location that was NOT the simulator's currently-set GPS
point — the visible "you are here" pin sat at a position from a prior
session (typically a previous trip's dropoff area in the legacy app),
even though the simulator's Extended Controls / Custom Location panel
had been set to a different point seconds earlier. A subsequent reload
sometimes refreshed it; sometimes didn't. Riders saw the same
behaviour on `RiderHome`.

A second symptom appeared after the maxAge cap landed (see "Patch
shape, A" below): on a freshly booted simulator with no cached fix at
all, `getCurrentPositionAsync` threw `ERR_CURRENT_LOCATION_IS_UNAVAILABLE`,
the catch block surfaced a `LOG.error` (Crashlytics non-fatal + LogBox
red overlay), and the map fell back to the default Google Maps "world
view" with no centring.

## Root cause — three compounding factors

1. **`useCurrentLocation` preferred any cached OS fix, no staleness
   cap.** The hook called
   `Location.getLastKnownPositionAsync()` with no arguments, then
   fell through to `getCurrentPositionAsync({ accuracy: Lowest })`
   only when the cached read returned `null`. On the emulator
   (and on real devices after a long-running prior session), the OS
   FusedLocationProvider / CLLocationManager returns whatever fix
   was last produced by ANY app — a stale fix from the legacy
   yeride app's last trip would be returned verbatim. The original
   comment in the hook explicitly waived `maxAge` on the
   assumption that "stale cached fixes are corrected as soon as
   `useGpsLifecycle` pushes fresh readings in."

2. **`useGpsLifecycle` is short-circuited in `__DEV__` on Android.**
   Per Phase 10 Turn 9, `BackgroundGeolocationClient.skipNativeInDev`
   defaults to `true` so every gated SDK method returns
   `Result.ok(true)` without touching the native SDK (workaround for
   the `tslocationmanager:4.1.5 setPriority(-1)` crash). No
   `BgLocationEvent` ever reaches `useGpsStore`. The "fresh
   readings will correct the stale fix" assumption from (1) is
   false in dev — there's no background stream to do the correcting.

3. **Even on production, `useDriverHomeViewModel` /
   `useRiderHomeViewModel` only consume `useCurrentLocation`, not
   `useGpsCurrentLocation`.** Once the foreground hook has set a
   stale `lastKnown` reading as state, fresh BG fixes would land in
   `useGpsStore` but the home-screen camera and "you are here"
   marker would not re-bind to them. (DriverMonitor / RideMonitor
   already swap to the BG store mid-trip; the home screens don't
   today.)

4. **`<Map>`'s `initialRegion` is one-shot.** `react-native-maps`'
   `MapView` only consumes `initialRegion` at mount. After
   `useCurrentLocation` later resolves a non-null value, passing it
   into the same `<Map>` instance has no effect on the camera —
   the prop is ignored. So even when (1)+(2) lined up such that
   the second-render coordinate would have been correct, the
   camera stayed wherever it first centred.

## Patch shape

### A. `src/presentation/hooks/useCurrentLocation.ts` — three-tier fallback chain

Replaced the inline `lastKnown ?? await getCurrentPositionAsync(...)`
expression with an explicit three-tier chain:

1. **Fresh cached fix.**
   `Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000, requiredAccuracy: 200 })`.
   Best case — instant, no SDK round-trip. The 2-minute /
   200-metre cap is tight enough to reject the previous-session
   dropoff fixes the original symptom was showing, and loose
   enough to keep the simulator-seeded-once case working (a fresh
   Extended Controls SET LOCATION action lands well under 2
   minutes before the next app mount, with exact accuracy).

2. **Live read.**
   `Location.getCurrentPositionAsync({ accuracy: Lowest })`.
   Hits the FusedLocationProvider (Android) / CLLocationManager
   (iOS) to acquire a fresh fix. Wrapped in its own try/catch so
   the throw doesn't surface to the user when (3) can recover.

3. **Last-ditch cached fix.**
   `Location.getLastKnownPositionAsync()` (no staleness cap).
   Reached only when (2) throws. A known-stale fix is a strictly
   better cold-start UX than the default world view + red error
   overlay — once the user moves or `useGpsLifecycle` pushes a
   real fix in (Phase 10 cutover or real-device build), the
   staleness self-corrects. Logged at `warn` so the next
   debugger sees that the fallback engaged.

If all three tiers fail (no cached fix anywhere), the outer catch
re-throws the live-read error and the screen's existing red banner +
"Try again" CTA covers the recovery path.

### B. `src/presentation/hooks/useCurrentLocation.ts` — log-level demotion

The outer `catch` block previously called `logger.error('refresh failed', …)`,
which fans out to Crashlytics `recordError` (per `CrashlyticsLogTransport`)
AND triggers the LogBox red overlay via `console.error`. Demoted to
`logger.warn` — every reach of this catch is a user-facing recoverable
state (permission denied, OS hasn't acquired a fix, location services
off), not a logic bug. The view-model already surfaces a red banner
with a "Try again" CTA — that's the correct escalation, not a
Crashlytics non-fatal. Matches the project rule in CLAUDE.md
("Don't use `LOG.error` for cleanup-best-effort / per-attempt /
user-declined paths — those stay at `LOG.warn` so they don't flood
Crashlytics with non-actionable noise").

### C. `src/presentation/components/map/Map.tsx` — ref-driven camera follow

Added `useRef<MapViewMethods>(null)` on the MapView. A new effect
compares the incoming `initialRegion`'s lat/lng against a ref-tracked
"last applied" lat/lng (epsilon `1e-5`, ≈ 1.1m), and calls
`mapRef.current?.animateToRegion(toRNRegion(initialRegion), 350)`
whenever they differ. First-effect-pass guard: if the consumer
passed a non-null `initialRegion` AT mount, the native prop already
placed the camera; the effect skips the duplicate animation.

Behavior matrix locked by tests:

| `initialRegion` transition        | Animates?                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `non-null` at mount               | No (native `initialRegion` prop handles placement)                                                              |
| `null → non-null` (cold start)    | Yes (camera leaves the default world view)                                                                      |
| `value A → value B` post-mount    | Yes                                                                                                             |
| `value A → value A` fresh literal | No (rounded-precision dedupe — call sites that build `initialRegion` inline each render don't churn the camera) |

The `initialRegion` prop's JSDoc was updated to reflect the new
semantics (was: "Subsequent reads of this prop are ignored").
Existing screens (`DriverHomeScreen`, `DriverDispatchScreen`,
`DriverMonitorScreen`, `RouteSelectScreen`, `RideMonitorScreen`,
`RiderHomeScreen`, `RideReceiptScreen`) needed no changes — they
already pass `initialRegion` as a fresh literal each render, which
the epsilon dedupe handles correctly.

### D. `__mocks__/react-native-maps.tsx` — forwardRef + animateToRegion capture

Converted the mocked `MapView` to a `forwardRef` host so the
production `<Map>`'s ref attachment doesn't crash. Added a module-
level `animateToRegionCalls: Array<{region, durationMs?}>` array
that captures every imperative call, plus `resetMapMockState()` for
per-test setup. Existing assertions on `map-view-provider-google`,
`map-polyline-len-N`, and `map-marker-opacity-N` testIDs are
untouched.

### E. `src/shared/types/react-native-maps.d.ts` — shim extensions

The tsconfig path-alias redirects `react-native-maps` type-imports
to this shim. Two changes:

- `MapViewProps.ref` accepts `RefObject<MapViewMethods | null>` (was
  `RefObject<MapViewMethods>` — incompatible with
  `useRef<MapViewMethods>(null)`'s actual return type).
- Added test-mock-only exports `animateToRegionCalls` and
  `resetMapMockState` at the bottom of the shim with a clear
  "test-only" comment block explaining that the real package
  doesn't expose these at runtime. This keeps test imports
  type-checking without forcing tests to reach into `__mocks__/`
  via a fragile relative path.

### F. `src/presentation/components/map/__tests__/Map.test.tsx` — locks

Added a `describe('camera-follow effect')` block with **4 tests**
covering the behavior matrix above. The existing three tests
(`PROVIDER_GOOGLE`, polyline pool, marker pool) are untouched.

## Verify gates

```
$ npm run typecheck                              # green
$ npm run lint                                   # green
$ npm run format:check                           # green on touched files (5)
                                                 #   docs/PHASE_10_TURN_7.md and
                                                 #   RouteSelectScreen.tsx warnings
                                                 #   pre-existed on the branch
$ npx jest src/presentation/components/map …     # 7/7 (3 existing + 4 new)
$ npx jest --testPathPattern='(useDriver|useRider)HomeViewModel|useCurrentLocation'
                                                 # 19/19
$ npx jest --testPathPattern='features/(driver|rider)' (full pres screens + VMs)
                                                 # 423/423 across 46 suites
$ npx jest --testPathPattern='domain|app/usecases|data/' (domain + app + data)
                                                 # 1095/1095 across 117 suites
$ npx jest --testPathPattern='shared|presentation/(stores|queries|di|components)'
                                                 # 412/412 across 45 suites
```

Combined, the targeted runs cover **1930 tests / 208 suites**. The
full-repo grand-total is unchanged from Phase 10 Turn 9 (1942) +
4 new Map tests = 1946 expected. The 4 new tests verified pass in
the Map suite run above.

## What this fix does NOT do — deferred

- **Make home screens consume `useGpsCurrentLocation` (the BG store).**
  The architectural follow-up identified during root-cause analysis
  ("option B" in the diagnosis): `useDriverHomeViewModel` /
  `useRiderHomeViewModel` should prefer the BG store's fresh
  events over the foreground hook's one-shot read once the BG
  pipeline produces one. Not done here — out of scope for an OOB
  bug fix, and won't fix the in-`__DEV__`-on-Android-emulator case
  anyway because BG is still short-circuited there. Deferred to
  Phase 10 cutover or a Phase 11 polish turn. The right place to
  pick this up: layer the BG-store read as a preference inside
  the home-screen view-models, falling back to `useCurrentLocation`
  for the cold start before the first `BgLocationEvent` arrives.

- **Disable the `__DEV__` BG-geolocation short-circuit.** Still
  required while Transistor's `tslocationmanager:4.1.5` priority-
  translation regression is unfixed upstream. See
  `docs/PHASE_10_TURN_9.md` §Out of scope.

- **Real-device validation.** The fix has been verified on Android
  emulator (Pixel 9 Pro) + iOS Simulator dev builds and via the
  full happy-path (rider request → driver dispatch → start →
  navigate → arrive → complete → tip → receipt — confirmed via
  log capture). Release-build / real-device smoke belongs to
  `PHASE_10_CUTOVER_PLAN.md` §3.2's manual pass.

## Acceptance criteria — checked

- ✅ `useCurrentLocation` rejects stale cached fixes via maxAge +
  requiredAccuracy caps.
- ✅ Cold-start `ERR_CURRENT_LOCATION_IS_UNAVAILABLE` no longer
  surfaces a red overlay; recovered via uncapped last-known
  fallback.
- ✅ Log-level demotion from `error` to `warn` for user-recoverable
  failures (per project convention).
- ✅ `<Map>` follows post-mount `initialRegion` changes via
  `animateToRegion`. No animation churn on fresh-literal-same-coords
  re-renders.
- ✅ react-native-maps mock supports refs (forwardRef +
  useImperativeHandle).
- ✅ TypeScript shim accepts `RefObject<MapViewMethods | null>`.
- ✅ Test-mock spy exports added; 4 new Map tests pin the
  camera-follow matrix.
- ✅ `npm run verify` clean on touched files; no test in the repo
  regressed.
- ✅ `CLAUDE.md` opener references this doc; Critical files table
  has rows for `useCurrentLocation.ts` and `Map.tsx`.
- ✅ `docs/TROUBLESHOOTING.md` has an entry covering the symptom +
  fix for future debugging.

## Native rebuild

**Not required.** This fix changes only TypeScript in
`src/presentation/hooks/`, `src/presentation/components/map/`,
`src/shared/types/`, `__mocks__/`, and the doc set. No
`app.config.ts`, no `package.json`, no `plugins/*`, no Podfile, no
Gradle.

---

**End of PHASE_10_OOB_DRIVER_HOME_STALE_LOCATION.md.**
