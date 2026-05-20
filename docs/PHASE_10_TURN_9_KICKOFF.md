# Phase 10 Turn 9 Kickoff — BG-geolocation test regression fix (audit §10.1)

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 8
closed 2026-05-19** (in-trip chat: `ChatModal`, `ChatRepository`,
`SendChatMessage` / `MarkMessagesRead` / `ObserveChatMessages`,
foreground-banner suppression via `useChatUiStore.openRideId`; plus
the same-day post-review fix set in
[`PHASE_10_TURN_8_REVIEW_FIXES.md`](PHASE_10_TURN_8_REVIEW_FIXES.md)
for the `senderId`-gated unread dot, per-ride `lastReadAtByRide`,
peer-name projection, dedup'd `markMessagesRead`, send-failure Toast,
effect-split race window, driver-side terminal gating, and the
static-import of `expo-notifications`).

Post-Turn-8 audit shows **1 ❌ / 0 🟡 / 0 ⚠️** remaining: **§10.1 —
`BackgroundGeolocationClient` jest suite broken at HEAD**. Turn 9
closes that one row. With it closed, the audit headline flips
`1 ❌ → 0 ❌` and Turn 10 (audit-v3 re-run + cutover sign-off) is
unblocked — `PHASE_10_CUTOVER_PLAN.md` §0 gate clears.

Size per audit §8 row 9: **small (1d)**. Scope is intentionally
narrow — single adapter, single test file, no domain / use-case /
view-model changes.

## Context — why this turn now

**The regression.** Phase 9 closed with a chore that wasn't part of
Phase 9's stated scope but had to land: the
`react-native-background-geolocation` upgrade 4.19.4 → 5.1.1
(commit `56c273c`). v5 fixed the `rapidActivityLaunch` SIGKILL loop
that had been killing dev builds on the Android emulator, but
shipped a separate `tslocationmanager:4.1.5` regression:
`buildLocationRequest` passes the SDK's internal `DesiredAccuracy`
sentinel (`-1` for `High`) straight to GMS's `LocationRequest.setPriority()`
instead of translating it to `Priority.PRIORITY_HIGH_ACCURACY` (100).
`play-services-location:21.x` strictly validates and throws
`IllegalArgumentException: priority -1 must be a Priority.PRIORITY_* constant`
from `TSLocationManagerActivity.onCreate`, killing the app the first
time `start()` triggers a settings refine on the emulator.

Three Gradle workarounds (`ext { tslocationmanagerVersion = '4.1.4' }`,
`resolutionStrategy.force`, direct SDK `android/build.gradle` pin)
all failed because the Expo SDK 55 build graph runs
`expoAutolinking.useExpoVersionCatalog()`, which overrides the pin
in a way reachable only by patching the catalog or using
`dependencyConstraints` (memory: `expo_sdk_55_version_catalog_overrides.md`).

**The chore's mitigation** dropped `if (__DEV__) return Result.ok(true);`
short-circuits at the top of every public adapter method:

```
src/data/services/BackgroundGeolocationClient.ts:169   init
src/data/services/BackgroundGeolocationClient.ts:248   start
src/data/services/BackgroundGeolocationClient.ts:271   stop
src/data/services/BackgroundGeolocationClient.ts:295   addPickupGeofence
src/data/services/BackgroundGeolocationClient.ts:325   removePickupGeofence
src/data/services/BackgroundGeolocationClient.ts:343   removeAllGeofences
src/data/services/BackgroundGeolocationClient.ts:371   getOdometer
src/data/services/BackgroundGeolocationClient.ts:428   resetOdometer
src/data/services/BackgroundGeolocationClient.ts:495   requestPermission
```

(Plus the in-body `__DEV__` guard inside `init` at L169-L177 that
prints the workaround banner and sets `this.initialized = true`
before the SDK call.)

**Why it broke jest.** jest-expo defaults `__DEV__ === true`. The
adapter's test suite at
`src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
constructs a real `BackgroundGeolocationClient` against the
SDK mock from `jest.setup.ts:220` and asserts the mock's
`sdk.ready` / `sdk.start` / `sdk.addGeofence` / etc. were called
with the right shapes. With `__DEV__===true`, the short-circuit
returns `Result.ok(true)` before reaching any SDK call — every
"was called with" assertion fails.

**Count.** 21 failed assertions across the suite (Phase 9 Turn 1
verification). The full grand-total in the most recent run
(post-Turn-8): `1909 passing / 21 failing`, with all 21 failures
confined to this one file. No carry-over outside this set.

**Why it matters for cutover.** `PHASE_10_CUTOVER_PLAN.md` §3.1
requires `npm run verify` green at the cutover SHA. `npm run verify`
runs `tsc --noEmit && eslint . && prettier --check . && jest`. Jest
currently fails. The cutover SHA cannot be selected until this is
green.

**Why it's a real fix, not a deletion.** The `__DEV__` short-circuit
is load-bearing on the Android emulator dev build. Reverting it
re-introduces the `tslocationmanager:4.1.5` priority crash on
trip-start, killing developer-loop velocity. The fix has to keep
the workaround behavior while letting jest exercise the native-path
code under the SDK mock.

## Pre-checklist (resolve before writing code)

1. **Verify HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   git log -1 --oneline                # capture for the close doc
   git status                          # working tree clean modulo this kickoff
   ```

2. **Reproduce the failure cleanly.** Confirm the 21 failures all
   live in the one file and look like "was called X times — was 0":
   ```bash
   npm test -- src/data/services/__tests__/BackgroundGeolocationClient.test.ts \
       --no-coverage 2>&1 | tail -80
   ```
   You should see assertions of the form
   `expect(jest.fn()).toHaveBeenCalledTimes(1)  Number of calls: 0`
   on `sdk.ready`, `sdk.start`, `sdk.stop`, `sdk.addGeofence`,
   `sdk.removeGeofence`, `sdk.removeGeofences`, `sdk.getOdometer`,
   `sdk.resetOdometer`, `sdk.requestPermission` — that's the
   short-circuit signature.

3. **Re-read the v5 upgrade memory.** `memory/rn_bg_geolocation_v5_android_loop.md`
   captures the priority-translation regression in depth — read it
   before touching the short-circuit so you don't accidentally
   weaken the emulator workaround. Also re-read
   `memory/expo_sdk_55_version_catalog_overrides.md` for the Gradle
   side; this turn does NOT attempt another Gradle pin (Path 4
   stays out of scope; Transistor's upstream fix is the real path
   forward).

4. **Confirm jest-expo's `__DEV__` default.** Sanity check:
   ```bash
   grep -n "__DEV__" node_modules/jest-expo/config/preset/setup.js \
                     node_modules/jest-expo/config/preset.js 2>/dev/null
   ```
   Expect: `global.__DEV__ = true` (or equivalent) wired by the
   preset. The kickoff's premise is that jest-expo runs with
   `__DEV__===true`, and you'll want to confirm before deciding
   whether the short-circuit can be re-gated cheaply.

5. **Confirm the SDK mock surface.** Re-read
   `jest.setup.ts:220` (the `jest.mock('react-native-background-geolocation', ...)` factory)
   and the test-helper interface at
   `src/data/services/__tests__/BackgroundGeolocationClient.test.ts:19-45` (the `BgMock` type).
   The mock exposes `ready`, `start`, `stop`, `getState`,
   `addGeofence`, `removeGeofence`, `removeGeofences`, `getOdometer`,
   `resetOdometer`, `requestPermission`, `removeAllListeners`,
   `onLocation`, `onGeofence`, plus `__emitLocation` /
   `__emitGeofence` / `__emitLocationError` / `__reset` helpers and
   `AUTHORIZATION_STATUS_*` constants. The chosen fix should not
   require touching the mock surface — it should let the existing
   mocks be hit by the real adapter.

6. **Confirm the seam isn't reached by the container in jest.**
   `src/presentation/di/container.ts:625-630` lazy-requires
   `BackgroundGeolocationClient`. Per the docstring at L611-624, no
   test exercises this builder under jest — every test path uses
   `TestContainerProvider`'s `bgGeolocation` override slot to inject
   `FakeBackgroundGeolocationClient` directly. So container wiring
   does not need to change in this turn; verify this is still true
   by `grep -rn 'buildBackgroundGeolocationClient' src/`. Expected
   matches: one definition site, one call site (`buildContainer`).

7. **Confirm `FakeBackgroundGeolocationClient` stays untouched.**
   The fake lives at `src/shared/testing/FakeBackgroundGeolocationClient.ts`
   (338 lines). It has nothing to do with the `__DEV__` issue —
   it's a pure in-memory implementation that never references
   `__DEV__`. Just spot-check `grep -n '__DEV__' src/shared/testing/FakeBackgroundGeolocationClient.ts`
   returns nothing.

8. **Confirm no other adapter has the same pattern.** Spot-check
   nearby SDK seams to make sure the `__DEV__` mitigation didn't
   spread elsewhere:
   ```bash
   grep -rn 'if (__DEV__)' src/data/services/
   ```
   Expected: only `BackgroundGeolocationClient.ts` matches.

## Decisions to lock at kickoff time

Make these explicit in the Turn 9 close doc. The recommended pick
for each is listed first.

### Decision 1 — fix shape

**(a) Constructor-injected flag (recommended).** Add an optional
constructor argument:
```ts
constructor(opts?: { skipNativeInDev?: boolean }) {
  this.skipNativeInDev = opts?.skipNativeInDev ?? true;
}
```
Replace every `if (__DEV__)` with `if (__DEV__ && this.skipNativeInDev)`
in the adapter. Tests construct with
`new BackgroundGeolocationClient({ skipNativeInDev: false })`.
Container builder leaves the default. **Pros:** minimal surface
change; no global state; preserves emulator workaround by default;
explicit at the call site; trivially documentable in JSDoc on the
constructor; matches the "constructor flag" approach the audit §8
row 9 verdict suggests.

**(b) Environment-variable gate.** Read `process.env.NODE_ENV === 'test'`
(or a custom `EXPO_PUBLIC_BG_GEOLOCATION_FORCE_NATIVE_IN_DEV`) inside
the adapter. **Pros:** zero test-file change. **Cons:** hidden
global; mixes test detection into production code; the rewrite has
no precedent for that pattern in the data layer.

**(c) Replace short-circuit with a "do nothing native" private
method, mocked via `jest.spyOn`.** Extract the SDK call into a
protected method; tests `jest.spyOn(adapter, 'callNative')`.
**Pros:** clean OO seam. **Cons:** invasive refactor of every
method; subclassing-style coupling foreign to the rest of the
codebase; doesn't change the `__DEV__` behavior on the emulator at
all (which is what we want), but does it at high cost.

**Pick (a).** Section §H of the patch shape assumes (a). If (b) or
(c) is picked, redo §H accordingly and update the test-file diff.

### Decision 2 — default value

**Default `skipNativeInDev: true` (recommended).** Preserves the
existing emulator workaround behavior for every production code
path. Only the test file passes `false`. Anyone wiring the adapter
in a script / story / integration harness gets the workaround
behavior unless they opt out explicitly.

The alternative ("default `false`, opt INTO the workaround") flips
the responsibility — container builder + every consumer must pass
`{skipNativeInDev: true}` to keep the emulator working. Too many
moving parts and easy to miss; pick the safe default.

### Decision 3 — flag name + plumbing reach

**Local instance field, no env-var bridge (recommended).** The flag
lives on `BackgroundGeolocationClient` only. Don't surface it on
the `BackgroundGeolocationService` interface — it's an
implementation detail of the real adapter, not part of the
domain contract. The fake doesn't need an equivalent because it
never touches the SDK.

If you find yourself wanting to thread the flag through env vars
or container config, stop — that's a smell. The container builder
should construct with the default; tests construct directly with
the override.

### Decision 4 — `init`'s in-body `__DEV__` block (L169-L177)

The `init` method has a richer dev-mode branch that sets
`this.initialized = true` + emits a `logger.warn` banner before
returning. Same treatment — gate on `__DEV__ && this.skipNativeInDev`.
When the flag is false in tests, control falls through to the
normal `try { await BackgroundGeolocation.ready(...) }` block, and
the existing test assertions on `sdk.ready` mock-call shape pass.

The warn banner stays — when the workaround engages, it's still
useful diagnostic output in the dev console.

### Decision 5 — JSDoc additions

Add a constructor-level JSDoc explaining what `skipNativeInDev`
does, why the default is `true`, and what the test convention is
("Pass `false` in jest suites that exercise the SDK mock; production
and dev builds leave it default."). Cross-link the v5 upgrade
memory and `PHASE_10_TURN_9.md` (you'll write it). Also leave a
one-line comment at each `__DEV__` site clarifying that the
short-circuit is gated for test access.

### Decision 6 — should the SDK mock itself bypass the short-circuit?

**No (recommended).** Mocking out `__DEV__` to `false` only for
the BG-geo suite would work, but it's a hack:
- `__DEV__` is a global, and toggling it per-test risks bleed across
  parallel jest workers.
- jest-expo's preset sets `__DEV__===true` by design; fighting it
  is brittle.
- The constructor flag from Decision 1 is mechanically cleaner and
  doesn't touch global state at all.

Confirm no test file currently mucks with `__DEV__`:
`grep -rn '__DEV__' src/ jest.setup.ts | grep -v '/__tests__/.*__DEV__'`
should return no test-side `__DEV__` overrides.

### Decision 7 — release-mode behavior

Production / release builds run `__DEV__ === false`, so the gate is
already off in release regardless of `skipNativeInDev`. No
behavior change in production. Worth a one-liner note in the close
doc's "release-mode behavior" subsection.

## Required reading (in order)

1. **`docs/PHASE_10_PARITY_AUDIT.md`** §1 headline (the `1 ❌`
   row), §10.1 (the discovery), and §8 row 9 (the size estimate).
   §10.1 already names the two fix paths (constructor flag /
   DI-seam-by-fake); we're picking the constructor-flag path here.

2. **`docs/PHASE_10_CUTOVER_PLAN.md` §0 and §3.1.** §0 is the gate
   ("every ❌ resolved or de-scoped"). §3.1 is the `npm run verify`
   gate that's currently red. After Turn 9, both gates clear.

3. **`docs/PHASE_10_TURN_8.md`** §"Notes for the next turn" — the
   hand-off paragraph identifies Turn 9 as scoping exactly this
   one fix.

4. **`memory/rn_bg_geolocation_v5_android_loop.md`** — the
   full incident narrative on the v5 upgrade. Read before touching
   the short-circuit so you understand what the workaround is
   protecting against on the Android emulator.

5. **`memory/expo_sdk_55_version_catalog_overrides.md`** — the
   adjacent piece of the story (why we couldn't pin
   `tslocationmanager:4.1.4` via Gradle). Confirms why the
   `__DEV__` mitigation has to stay engaged in dev / stage builds
   pending Transistor's upstream fix.

6. **`src/data/services/BackgroundGeolocationClient.ts`** — read
   the whole file (673 lines). Pay attention to:
   - L70-L177: the `init` method, including the long workaround
     comment block (L131-L168) and the `__DEV__` branch (L169-L177).
   - L247-L501: the eight other public methods with `if (__DEV__) return Result.ok(true);`
     short-circuits at the top.
   - L502+: subscription methods (`subscribeToLocation`,
     `subscribeToGeofence`). These do NOT have `__DEV__`
     short-circuits and their tests are passing — leave alone.

7. **`src/data/services/__tests__/BackgroundGeolocationClient.test.ts`** —
   the full suite (606 lines). Note:
   - L19-L45: the `BgMock` interface for the global SDK mock.
   - L117-L141: `beforeEach` reset routine (already correct; no
     change needed).
   - L143-end: the 24 tests. The 21 currently-failing ones all
     instantiate `new BackgroundGeolocationClient()` with no args.
     After the patch, they instantiate
     `new BackgroundGeolocationClient({ skipNativeInDev: false })`.
   - The 3 passing tests (subscription / dedup / disposer) don't
     touch the gated methods — leave them alone (no constructor
     arg needed, but for consistency you may add it; see §H).

8. **`jest.setup.ts:220`** — the global SDK mock factory. Read
   for shape; don't change.

9. **`src/presentation/di/container.ts:611-630`** — the
   `buildBackgroundGeolocationClient` builder. Spot-check the
   docstring claims still hold: lazy-required, not exercised under
   jest, fake injected via TestContainerProvider. After the patch
   the builder line still reads
   `return new dataBg.BackgroundGeolocationClient();` (default
   flag); no change needed.

10. **`src/shared/testing/FakeBackgroundGeolocationClient.ts`** —
    quickly skim to confirm there's no `__DEV__` reference. The
    fake stays untouched in this turn.

## Patch shape (bottom-up)

### A. Adapter — gate the `__DEV__` short-circuits

| File                                              | Status   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/data/services/BackgroundGeolocationClient.ts` | **edit** | Add optional constructor opts `{skipNativeInDev?: boolean}` (default `true`). Store as `private readonly skipNativeInDev: boolean`. Replace every `if (__DEV__)` with `if (__DEV__ && this.skipNativeInDev)` (9 sites — see grep at L169, L248, L271, L295, L325, L343, L371, L428, L495). Constructor JSDoc explains the flag and points at the v5 upgrade memory. Each gate site keeps its existing log/banner; only the predicate changes.        |

Expected diff size: ~25-35 lines (1 constructor + 9 predicate
flips + ~5-8 lines of JSDoc).

### B. Tests — pass the override

| File                                                          | Status   | What                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/data/services/__tests__/BackgroundGeolocationClient.test.ts` | **edit** | Replace every `new BackgroundGeolocationClient()` with `new BackgroundGeolocationClient({ skipNativeInDev: false })`. Optional helper: define `const makeClient = () => new BackgroundGeolocationClient({ skipNativeInDev: false });` at the top of the file and use it everywhere — cuts repetition and makes the override visible at a glance. Add **2 new tests** covering the default-flag (skip in dev) behavior. |

The 2 new tests (recommended) — add a `describe('skipNativeInDev
default')` block:

- `'init defaults to skipNativeInDev=true and does NOT call SDK ready'`:
  `const client = new BackgroundGeolocationClient(); await client.init({ distanceFilter: 200 });` →
  `expect(sdk.ready).not.toHaveBeenCalled()` + assert the result is
  `Result.ok(true)` and `client` is considered initialized (next
  call to `init` no-ops, per the existing idempotency contract).
- `'start with default flag does NOT call SDK start and returns ok'`:
  symmetric assertion for `start`.

These two tests pin the workaround behavior so a future drive-by
removal of the predicate is caught by jest. Without them the only
thing exercising the dev short-circuit is the Android emulator
itself.

Expected diff size: ~30-50 lines (24 constructor swaps via the
helper + 2 new tests).

### C. Optional — barrel re-export

The constructor type addition does not need to be re-exported. The
opts shape is an implementation detail of the real adapter and not
part of the domain contract (see Decision 3). No
`src/data/services/index.ts` change.

### D. Container — no change

Per pre-checklist item 6, the builder at
`src/presentation/di/container.ts:625-630` doesn't need to thread
the new opt — the default-`true` value preserves current behavior.
**Do not** add a config-driven override here. If you find yourself
reaching for `process.env.*` to thread a value through the builder,
stop and re-read Decision 3.

### E. Documentation — close-the-loop

| File                                | Status   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `docs/PHASE_10_PARITY_AUDIT.md`     | **edit** | §1 headline: `1 ❌ / 0 🟡 / 0 ⚠️` → `0 ❌ / 0 🟡 / 0 ⚠️`. §10.1 closure annotation: ❌ → **✅ closed in Turn 9 (2026-05-DD)** with two-sentence rationale (constructor flag + tests opt out) pointing at `PHASE_10_TURN_9.md`. §8 row 9 strike-through with close date + doc reference. Header sublabel append "Turn 9 closed 2026-05-DD".                                                                                                                                                |
| `docs/PHASE_10_CUTOVER_PLAN.md`     | **edit** | §0 gate flips to "cleared" pending Turn 10 sign-off. §3.1 row notes `npm run verify` green at cutover SHA.                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/PHASE_10_TURN_9.md`           | **new**  | Per-turn record. Use Turn 8 as the template. Sections: Why, Pre-checklist outcomes, Decisions locked (1-7), Patch shape (A-E), Test additions / pass counts, Verify gates, Acceptance criteria, Out of scope, Native rebuild (none — no native config change in this turn), Notes for Turn 10.                                                                                                                                                                                                |
| `CLAUDE.md`                         | **edit** | Update the "Project status" table — Phase 10 audit closure row, if not already there. Update the Phase 10 Turn 9 reference in the opener paragraph.                                                                                                                                                                                                                                                                                                                                                |

### F. Memory updates

After the patch lands, update
`/Users/papagallo/Library/Application Support/Claude/local-agent-mode-sessions/0bedbc5f-f739-46b7-b524-36205a5a6321/3e6ba6e5-67d4-44a3-a9d0-f5de576038bf/spaces/84e3affa-6376-4e27-ac4e-9be4659755f0/memory/rn_bg_geolocation_v5_android_loop.md`
with a short appendix:

> **Test ergonomics (2026-05-DD, Phase 10 Turn 9):** the `__DEV__`
> short-circuits are now gated by a constructor flag
> `skipNativeInDev` (default `true`). Test suites pass `false` to
> exercise the SDK mock; production / dev / stage builds keep the
> default and continue to dodge the priority crash. See
> `docs/PHASE_10_TURN_9.md`.

No new memory file. The existing entry stays authoritative on
why the workaround is engaged.

### G. Out of scope (deferred)

- **Removing the `__DEV__` short-circuit entirely.** Blocked on
  Transistor's upstream `tslocationmanager:4.1.5` priority-
  translation fix (or a real Android-emulator workaround that
  doesn't kill `start()`). Until then the workaround stays —
  Turn 9 only makes it test-friendly, not optional.

- **Patching `tslocationmanager` via the version catalog.**
  Memory `expo_sdk_55_version_catalog_overrides.md` explains the
  catalog-patching path that would let us pin
  `tslocationmanager:4.1.4`. Out of scope for this turn — that's
  a Gradle change with native-rebuild + smoke fallout, and Turn 9
  is intentionally narrow.

- **Real-device validation of the workaround.** The `__DEV__`
  short-circuit means GPS / geofence features are dark in dev
  builds. A real-device check on a release-flavour build of the
  rewrite (where `__DEV__===false`) belongs to Turn 10's manual
  smoke pass + `PHASE_10_CUTOVER_PLAN.md` §3.2.

- **`PHASE_10_TURN_8` review-fix carry-overs.**
  `PHASE_10_TURN_8_REVIEW_FIXES.md` §"Deliberately deferred" lists
  three items (Firestore rules field-level enforcement for
  `lastSeenBy*`, stream-error callback on `ChatRepository`,
  ChatMessageId charset). All remain deferred; Turn 9 doesn't
  touch chat.

- **Audit v3 + cutover sign-off.** Turn 10.

- **Native rebuild.** Not required — Turn 9 changes only JS / TS
  in `src/data/services/` and a documentation set. No
  `app.config.ts` change, no `package.json` change, no
  `plugins/*` change, no Podfile / Gradle change.

### H. Constructor + predicate diff — concrete shape (recommended)

```ts
// src/data/services/BackgroundGeolocationClient.ts

export class BackgroundGeolocationClient implements BackgroundGeolocationService {
  private initialized = false;
  private lastLocationKey: string | null = null;
  private lastGeofenceKey: string | null = null;
  private readonly skipNativeInDev: boolean;
  // ... existing listener/subscriber fields ...

  /**
   * @param opts.skipNativeInDev — when `true` (default), the
   * adapter's `init`/`start`/`stop`/geofence/odometer/permission
   * methods short-circuit to `Result.ok(true)` in dev builds
   * (`__DEV__ === true`) without touching the native SDK. This
   * dodges the `tslocationmanager:4.1.5` priority-translation
   * crash on the Android emulator (memory:
   * `rn_bg_geolocation_v5_android_loop.md`). Production /
   * release builds run `__DEV__ === false` and are unaffected.
   *
   * Tests pass `skipNativeInDev: false` to let the global SDK
   * mock in `jest.setup.ts` see the native-path calls. The
   * default stays `true` so a dev consumer that constructs the
   * adapter without opts inherits the emulator workaround.
   */
  constructor(opts?: { skipNativeInDev?: boolean }) {
    this.skipNativeInDev = opts?.skipNativeInDev ?? true;
  }

  async init(args: { distanceFilter: number; debug?: boolean }): Promise<Result<true, NetworkError>> {
    if (this.initialized) {
      logger.info('init: already initialized — no-op');
      return Result.ok(true);
    }
    // ... existing comment block ...
    if (__DEV__ && this.skipNativeInDev) {
      this.initialized = true;
      logger.warn(
        'init: skipping native init in __DEV__ (Android emulator ' +
          'tslocationmanager:4.1.5 setPriority(-1) crash workaround). ' +
          'GPS/geofence features disabled until tested on a real device.',
      );
      return Result.ok(true);
    }
    // ... existing try/catch with BackgroundGeolocation.ready(...) ...
  }

  async start(): Promise<Result<true, NetworkError>> {
    if (__DEV__ && this.skipNativeInDev) return Result.ok(true);
    // ... existing body ...
  }

  // ... apply the same flip to stop / addPickupGeofence /
  //     removePickupGeofence / removeAllGeofences / getOdometer /
  //     resetOdometer / requestPermission ...
}
```

```ts
// src/data/services/__tests__/BackgroundGeolocationClient.test.ts

// Top of file, after the existing helpers:
const makeClient = (): BackgroundGeolocationClient =>
  new BackgroundGeolocationClient({ skipNativeInDev: false });

// Replace every `new BackgroundGeolocationClient()` in the existing
// 24 tests with `makeClient()`.

// New describe block:
describe('skipNativeInDev default (workaround engagement)', () => {
  it('init with default opts does NOT call SDK ready', async () => {
    const client = new BackgroundGeolocationClient();
    const result = await client.init({ distanceFilter: 200 });
    expect(result.ok).toBe(true);
    expect(sdk.ready).not.toHaveBeenCalled();
  });

  it('start with default opts does NOT call SDK start', async () => {
    const client = new BackgroundGeolocationClient();
    const result = await client.start();
    expect(result.ok).toBe(true);
    expect(sdk.start).not.toHaveBeenCalled();
  });
});
```

## Test additions and pass-count targets

- 21 currently-failing tests in
  `BackgroundGeolocationClient.test.ts` → all 21 green after the
  constructor-arg swap.
- 2 new tests for the default-flag behavior (workaround
  engagement) per §H.
- Grand-total target post-Turn-9: **1932 passing / 0 failing**
  (1909 passing + 21 newly-green + 2 new = 1932).
- No regressions outside the BG-geo set; jest's full run is green.

## Verify gates

After the patch, every gate must be clean:

```bash
$ npm run typecheck   # green
$ npm run lint        # green
$ npm run format:check
# Expect the 4 pre-existing format warnings on out-of-scope files
# (CLAUDE.md, docs/PHASE_10_PARITY_AUDIT.md, docs/PHASE_10_TURN_7.md,
#  src/presentation/features/rider/screens/RouteSelectScreen.tsx).
# Do NOT format-fix them in this turn (out-of-scope policy).
$ npm test            # 1932 passing, 0 failing
$ npm run verify      # all four — green
```

`npm run verify` going green closes
`PHASE_10_CUTOVER_PLAN.md` §3.1.

## Acceptance criteria

- ✅ Decisions 1-7 documented in `PHASE_10_TURN_9.md`.
- ✅ `BackgroundGeolocationClient` accepts
  `constructor(opts?: { skipNativeInDev?: boolean })` with default
  `true`. JSDoc explains semantics and the dev / test convention.
- ✅ All 9 `if (__DEV__)` sites in the adapter (1 in `init` body
  + 8 method tops) are predicate-flipped to
  `if (__DEV__ && this.skipNativeInDev)`. No semantic change in
  release builds (`__DEV__ === false`).
- ✅ `FakeBackgroundGeolocationClient` is untouched.
- ✅ Container builder `buildBackgroundGeolocationClient` is
  untouched (default opt preserves prior behavior).
- ✅ Test suite swaps every `new BackgroundGeolocationClient()` to
  `new BackgroundGeolocationClient({ skipNativeInDev: false })`
  (or uses a `makeClient()` helper).
- ✅ Two new tests pin the default-flag workaround behavior
  (`init` / `start` skip native, return ok).
- ✅ `npm run verify` green. Grand-total: 1932 passing / 0 failing.
- ✅ Audit §1 headline `1 ❌` → `0 ❌`. §10.1 closure annotation
  added with Turn 9 doc reference. §8 row 9 struck through with
  close date.
- ✅ Cutover plan §0 gate flips to "cleared." §3.1 row notes
  verify-green at cutover SHA.
- ✅ `docs/PHASE_10_TURN_9.md` written per the template.
- ✅ Memory `rn_bg_geolocation_v5_android_loop.md` appended with
  the test-ergonomics note.
- ✅ `CLAUDE.md` updated (Project status table closure row +
  opener paragraph reference).
- ✅ No native config change. No `app.config.ts`, no
  `package.json`, no `plugins/*`, no Podfile / Gradle.

## Notes for Turn 10

- **Turn 10 — audit v3 + cutover sign-off** is the last Phase 10
  turn. Scope:
  - Re-run the static-inspection audit against the post-Turn-9
    HEAD. Every row should be ✅ or 🟡-with-explicit-de-scope; no
    ❌ remains.
  - Flip `PHASE_10_CUTOVER_PLAN.md` §0 gate to "cleared."
  - Trigger §3.2 real-device manual parity smoke (separate task —
    not engineering work in the rewrite repo).
  - Trigger §3.1's `eas build` for the side-by-side
    TestFlight / Internal-Testing rollout, with the Turn 8 native
    rebuild (keyboard-controller pod / gradle module from Turn 8's
    `react-native-gifted-chat` dependency chain) picked up
    automatically.
  - Confirm the `yeride.com/stripe-return` 302-bridge (§10.3) is
    live for the production deep-link scheme before cutover —
    this is ops work on the marketing domain, NOT rewrite-repo
    engineering, but the cutover plan can't sign off without it.

- **Native rebuild from Turn 8** lands on the next
  `eas build` / `expo run:*`. Watch for
  `react-native-keyboard-controller` autolinking on both
  platforms — no diagnosis expected with RN 0.83 + Reanimated
  4.2.1, but worth a smoke per Turn 8's "Notes for the next turn."

- **Once Turn 10 closes:** Phase 10 done. Phase 11 = cutover
  execution (legacy yeride retire, `yeapp-prod` migration, dual-
  write removal). Not in the Phase 10 audit scope.

---

**End of PHASE_10_TURN_9_KICKOFF.md.**
