# Phase 9 Turn 15 — NavigationSdk teardown telemetry flips

**Closed:** May 4, 2026
**Baseline:** Phase 9 Turn 14 close (commit `977cbee`) — 187 suites /
1621 tests
**This turn:** **187 suites / 1624 tests** — +0 suites / +3 tests, at
the floor of the kickoff's "+0 suites / +3 tests" estimate band.

## Scope

The smaller of the two remaining Phase 9 polish items the Turn 14
close logged. From the kickoff's `9 turn 15+` Pending row:

> Future Phase 9 polish (receipt PDF / NavigationSdk teardown
> telemetry L387/L415/L428)

Turn 12's close documented the three sites explicitly:

> **NavigationSdk teardown telemetry (L387/L415/L428).** If field
> telemetry shows the cleanup-best-effort sites are firing at
> meaningful rates after Phase 10 cutover, revisit the warn-stay
> decision. Currently classified as stays-warn for legitimate
> reasons (next session's init recovers cleanly).

Turn 15 flips them now (rather than waiting for post-cutover field
signals) on the rationale that:

1. Crashlytics is graceful about non-actionable noise — sample rates
   are observable and the warn-stay decision can be reverted with a
   single LOG-level demote if any of the three sites fire at high
   volume in production. The reverse (waiting for field telemetry,
   then flipping post-cutover) requires a deploy with no upfront
   visibility into which site is the noisy one.
2. Two of the three (L415, L428) currently have **zero** telemetry
   surface — the failures are intentionally swallowed inside
   `cleanup()` and never propagate up the Result channel. Flipping
   is the only way to ever see them.
3. The standalone L387 path's `Result.err(NetworkError)` IS visible
   to the navigation VM via `onEndNavigation`'s fire-and-forget call
   path (which discards the Result) and the unmount-cleanup chain
   (which logs at `LOG.warn`, not fanning out). Flipping the SDK-side
   breadcrumb to error captures both call paths in one place.

## Pre-checklist (asked at kickoff)

| #   | Question                                                                          | Answer                                     | Notes                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope — which of the 3 teardown sites do we flip this turn?                       | **All three (Recommended)**                | Uniform telemetry across the teardown surface; +3 tests; trade-off is +potential noise in production, demotable if needed. Worst case is non-actionable Crashlytics chatter from genuine cleanup churn — single-line revert per site.                                                                                              |
| 2   | Adapter↔VM duplicate-noise tradeoff — flip VM warns at the same time?             | **No duplicate today (Recommended)**       | The VM-side teardown sites at `useDriverNavigationViewModel.ts` L296/L300 are at `LOG.warn`, which does NOT fan out through rawMeta to `recordError` (Phase 9 Turn 6 contract — only `LOG.error` does). Flipping the SDK adapter sites produces zero duplicate Crashlytics records today. The Turn 9 framing doesn't apply.        |
| 3   | Pass `e` directly or wrap with a constructed `Error`?                             | **Pass `e` directly (Recommended)**        | All three sites have `e` from a synchronously-thrown SDK call (rejected Promise from `stopGuidance` / `setOnArrival`), so `e instanceof Error` is already true. Reference identity flows through rawMeta directly. Mirrors Turn 12's L520 verbatim.                                                                                |
| 4   | Test approach — +1 test per flipped site or headline-only with coverage comments? | **+1 test per flipped site (Recommended)** | Same shape as Turn 12's headline test. New describe block `'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 15)'`. Each test attaches `CrashlyticsLogTransport(fakeCrash)` to LOG, drives the failure path, asserts `getRecordedErrors()` contains a record with reference identity + scope + message substring. |

## What shipped

### Three flips

All in `src/data/services/NavigationSdkClient.ts`. Each flip carries
an inline JSDoc comment block explaining the level + Error-shape
choice (mirrors Turn 12's L520 / Turn 9's L502/L547 inline comments).

#### L387 → L405: `stopGuidance` standalone catch

The standalone `stopGuidance()` method's SDK-throw catch. The method
also returns `Result.err(NetworkError({code:
'navigation_stop_guidance_failed'}))`, but the caller-side telemetry
on the unmount-cleanup path (`useDriverNavigationViewModel.ts` L296)
is at `LOG.warn` — so without this flip the failure has zero
Crashlytics fan-out from either side.

#### L415 → L442: `cleanup: setOnArrival(null)` listener-removal catch

Internal to `cleanup()`. The function CONTINUES past this catch
(doesn't return early; the surrounding cleanup proceeds to the
controller). No Result.err propagates from this site — caller-side
has no awareness. Flipping is the only way to surface this failure.

#### L428 → L466: `cleanup: stopGuidance` cleanup-internal catch

Internal to `cleanup()`. The function CONTINUES to
`controller.cleanup()` after this catch (so a hung stop doesn't
strand the session). The post-`controller.cleanup()` catch (L472,
already at `LOG.error` via Phase 8 Turn 1's original wiring) handles
the second leg. Flipping L466 surfaces stale-controller bugs that
manifest only in the cleanup-internal stopGuidance call.

### Three new regression tests

`src/data/services/__tests__/NavigationSdkClient.test.ts` gains a
new describe block at file end:

```
'telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 15)'
```

Each test:

1. Constructs a `FakeCrashReportingService` and a
   `CrashlyticsLogTransport(fakeCrash)`.
2. Attaches the transport to the singleton `LOG` via
   `LOG.addTransport(transport)`.
3. Wraps the body in `try { ... } finally { LOG.removeTransport(transport) }`
   per the Turn 4 / 8 / 9 / 11 / 12 / 14 hygiene pattern.
4. Drives the failure path (`controller.stopGuidance.mockRejectedValueOnce`
   or `listeners.setOnArrival.mockImplementation` to throw on the
   `null` arg).
5. Asserts on `fakeCrash.getRecordedErrors()`:
   - reference identity on the recorded `Error` instance — proves
     the rawMeta channel preserved the seeded throw through
     `sanitizeForLogging`,
   - `name === 'YeRide:NavigationSdk'` — Firebase Console issue
     scope; pinning catches future scope renames that would silently
     re-cluster reports,
   - message substring matching the seeded throw — pinning the
     leading text catches cosmetic edits to the inline message that
     would change the Crashlytics grouping key.

The L415 test uses `mockImplementation` (not `mockImplementationOnce`)
on `setOnArrival` because the listener is called once on
`subscribeToArrival` (with the handler) and again during cleanup
(with `null`); the test throws only on the `null` arg so the
subscribe path proceeds normally.

### Stays-warn audit

After Turn 15 there are zero `logger.warn` sites in
`NavigationSdkClient.ts`:

```
$ grep -c "logger\.warn" src/data/services/NavigationSdkClient.ts
0
```

All 9 LOG sites in the file are at `error` level (8 with
constructed-Error or rejected-Promise `e`, all reaching `recordError`
via rawMeta).

The VM-side teardown logs at `useDriverNavigationViewModel.ts` L296
(`teardown stopGuidance error`) and L300 (`teardown cleanup error`)
are intentionally left at `LOG.warn` per pre-checklist Q2. They
don't fan out today; if field telemetry from the SDK-side flips
points at a real bug worth surfacing from BOTH sides for triage
breadth, a follow-up turn can promote them.

## Acceptance

- `npm run typecheck`: green
- `node node_modules/eslint/bin/eslint.js .`: green (zero warnings)
- `npm run format:check`: green (Prettier reformatted
  `NavigationSdkClient.ts` once during the turn — comment-block
  wrapping; no semantic change)
- Chunked test runs (8 patterns, fits the 45 s sandbox bash limit):
  - `src/domain` — 38 / 420
  - `src/data` — 19 / 301 (includes the +3 new tests)
  - `src/app` — 50 / 242
  - `src/shared` — 15 / 166
  - `src/presentation/(hooks|components)` — 17 / 136
  - `src/presentation/features/(rider|auth)` — 14 / 114
  - `src/presentation/features/driver` — 24 / 178
  - `src/presentation/(di|stores|queries|tests|navigation|App|features/__tests__)` — 9 / 61
  - `src/presentation/__tests__` — 1 / 6 (`AppContent.test.tsx`)
- Total: **187 suites / 1624 tests**, all green.

## Native rebuild

**Not required.** Pure JS-side refactor. No `app.config.ts` plugin
changes, no new dependencies, no DI container changes, no
cross-repo work. The next iOS / Android build can pick up the
change without a `npm run prebuild` cycle.

## Smoke checklist (user-driven)

This turn ships pure telemetry. Field validation runs in production
and is asynchronous to the deploy:

1. After the next stage / production deploy lands, watch Firebase
   Console → Crashlytics → Non-fatals for new `YeRide:NavigationSdk`
   issues with messages starting:
   - `stopGuidance threw — swallowing`
   - `cleanup: setOnArrival(null) threw — swallowing`
   - `cleanup: stopGuidance threw — continuing to cleanup`

2. **Sustained zero-rate** on any of the three sites flags either
   dead telemetry (revisit the flip) or genuinely robust SDK-state
   handling (the warn-stay decision was correct; no harm from the
   extra error-level breadcrumb).

3. **Sustained non-zero rate** flags a real SDK-state bug worth
   investigating — the most likely root cause is a stale-controller
   race between React Navigation's screen unmount and the SDK's
   internal lifecycle. Triage via the breadcrumb stack: each issue
   carries the full `Error.stack` from the rejected Promise.

4. **High-volume firing** (e.g. >1% of trip-end flows) → demote
   the offending site back to `LOG.warn` via single-line revert
   while the underlying bug is investigated separately.

## Why this turn was the right size

- Three flips + three tests + one doc + one commit. Mechanical
  extension of Turn 12's L520 pattern; no new mock infrastructure
  beyond the `mockImplementation`-on-`setOnArrival` seam (which
  the test mock already supports); no DI / native rebuild /
  cross-repo work.
- Closes the Turn 12 follow-up note ("revisit the warn-stay
  decision") explicitly. The remaining Phase 9 polish item is
  Receipt PDF, which is feature-shaped rather than telemetry-
  shaped — a natural Phase boundary.
- The +3 test delta is exactly one regression test per flipped
  site. No optional sanity-check tests. Each test asserts the
  three properties (reference identity, scope name, message
  substring) the rawMeta contract guarantees.

## Rollback

Single `git revert` deep. The flipped lines are uniform comment +
single-token edits (`logger.warn` → `logger.error`) co-located in
one file; the regression tests live under one new describe block
with no dependencies on production code other than the
already-imported types. No DTO / schema / wire-format changes; no
breaking changes to caller surfaces (the Result return shapes
on `stopGuidance` and `cleanup` are unchanged).

## Phase 9 Turn 16+ candidates (not in scope this turn)

After Turn 15, the only Phase 9 polish item still on the table is:

- **Receipt PDF.** Render a printable / shareable PDF of
  `RideReceiptScreen` for the rider. Feature-shaped (not telemetry-
  shaped); blast radius depends on the chosen rendering path
  (`react-native-view-shot` + `expo-print`, or a server-side
  Cloud Function call). Discuss during close-out whether to ship
  as Turn 16 or roll into Phase 10 cutover prep — the latter
  changes the constraint surface (fresh `yeapp-prod`, no legacy
  co-existence rule).

The "stays-warn" audit logged in Turn 11 / Turn 12 is now empty
for `NavigationSdkClient.ts`. Cross-repo Crashlytics telemetry
across the data layer is at the saturation point the rawMeta
channel was designed to support.

---

**End of Phase 9 Turn 15.**
