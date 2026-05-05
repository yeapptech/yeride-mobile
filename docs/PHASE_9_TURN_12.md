# Phase 9 Turn 12 — NavigationSdk subscriber-threw telemetry flip

**Closed:** May 4, 2026
**Baseline:** Phase 9 Turn 11 close (commit `c13c170`) — 187 suites /
1616 tests
**This turn:** **187 suites / 1617 tests** — +0 suites / +1 test, at
the floor of the kickoff's "+0 suites / +1-2 tests" band.

## Scope

The smallest follow-up Turn 11's cross-cutting Firestore-mapper
telemetry audit logged. From Turn 11's stays-warn audit table:

> NavigationSdkClient L512 — same shape as Turn 9's BG subscriber-threw
> flips (L502/L547), but Turn 11's audit explicitly scoped this out;
> tagged stays-warn with a follow-up note. Flipping is a logical
> follow-up turn — would surface domain-side subscriber bugs in the
> navigation arrival fan-out via Crashlytics.

Turn 12 flips it. Pure mechanical extension of Turn 9's pattern.

## Pre-checklist (asked at kickoff)

| #   | Question                                                                       | Answer                      | Notes                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Scope — flip just L512 or audit the rest of NavigationSdkClient?               | **Just L512 (Recommended)** | One flip mirroring Turn 9's L502/L547 verbatim. Other warn sites in the file (L387/L415/L428) are cleanup-best-effort teardown swallows that Turn 11's audit already classified as stays-warn — re-walking is duplicate work. |
| 2   | Add explicit `// stays warn — best-effort cleanup` comments on L387/L415/L428? | **Skip (Recommended)**      | Their inline message text (e.g. `'threw — swallowing'`, `'threw — continuing to cleanup'`) is self-documenting; Turn 11's audit table already classified them.                                                                |

## What shipped

### One flip

**`src/data/services/NavigationSdkClient.ts:520`** — the `handleArrival`
fan-out loop's defensive `try/catch` around each subscriber callback.

Pre-Turn-12:

```ts
for (const cb of [...this.arrivalCallbacks]) {
  try {
    cb(domainEvent);
  } catch (e) {
    // stays warn — same shape as Turn 9's BackgroundGeolocation
    // subscriber-threw flips (L502/L547), but the cross-cutting
    // Firestore mapper audit (Phase 9 turn 11) explicitly scoped
    // this out. ...
    logger.warn('handleArrival: subscriber threw', e);
  }
}
```

Post-Turn-12:

```ts
for (const cb of [...this.arrivalCallbacks]) {
  try {
    cb(domainEvent);
  } catch (e) {
    // Phase 9 turn 12 — flipped from LOG.warn to LOG.error so the
    // rawMeta channel fans this out to `recordError`. A throwing
    // arrival subscriber is a domain-side bug ...
    logger.error('handleArrival: subscriber threw', e);
  }
}
```

`e` is already a real `Error` from the synchronously-throwing
subscriber, so no constructed-Error wrapper is needed — the rawMeta
channel's `extractError(rawMeta ?? meta)` resolves the reference
directly through to `recordError`. Mirrors Turn 9's
`BackgroundGeolocationClient` L502 / L547 flips verbatim.

The fan-out resilience invariant (one bad subscriber doesn't take
down the others) is preserved by the surrounding `for`-loop's
`try/catch`; the new telemetry just makes the bug visible.

### Stays-warn audit (other NavigationSdkClient sites — no re-walk)

Turn 11's audit table classified these as cleanup-best-effort
teardown swallows; no Turn 12 re-walk per pre-checklist Q2. Their
inline message text is self-documenting:

| Site           | Message                                               | Classification      |
| -------------- | ----------------------------------------------------- | ------------------- |
| L387 (cleanup) | `cleanup: stopGuidance threw — continuing to cleanup` | cleanup-best-effort |
| L415 (cleanup) | `cleanup: controller.cleanup threw — swallowing`      | cleanup-best-effort |
| L428 (cleanup) | `cleanup: setController null threw — swallowing`      | cleanup-best-effort |

(Line numbers approximate; check file for current values.)

### One regression test

`src/data/services/__tests__/NavigationSdkClient.test.ts` — new
describe block `'telemetry — recordError fan-out via rawMeta channel
(Phase 9 turn 12)'` with one test:

> `arrival subscriber throws → recordError fires with the thrown
Error (fan-out continues)`

Pattern mirrors Turn 9's `BackgroundGeolocationClient.test.ts:537-571`
location subscriber-threw test verbatim. Uses the existing
`__emitArrival` SDK mock helper; no new mock infrastructure.
Asserts:

- Reference identity on the recorded `Error` (the rawMeta channel
  preserves the throw through `sanitizeForLogging`).
- `seededRecord.name === 'YeRide:NavigationSdk'` so Firebase Console
  groups non-fatals under the correct scope (catches future scope
  renames that would silently re-cluster).
- Peer subscriber DID receive the event (fan-out resilience).
- Throwing subscriber was called once before throwing.

`try/finally { LOG.removeTransport(transport) }` per Turn 4 / Turn 8
/ Turn 9 / Turn 11 hygiene.

## Acceptance

`npm run typecheck` + `node node_modules/eslint/bin/eslint.js .` +
`npm run format:check` + chunked `npm test` all green.

**187 test suites / 1617 tests** passing.

Delta vs. Phase 9 Turn 11 close baseline (187 suites / 1616 tests):
**+0 suites / +1 test**. At the floor of the kickoff's "+0 suites /
+1-2 tests" estimate band.

Test-suite breakdown verified across 5 chunks:

| Chunk pattern                                                                                         | Suites | Tests |
| ----------------------------------------------------------------------------------------------------- | -----: | ----: |
| `src/(domain\|app)`                                                                                   |     88 |   662 |
| `src/(shared\|presentation/(di\|hooks\|components))`                                                  |     34 |   306 |
| `src/presentation/features/(rider\|driver)`                                                           |     38 |   292 |
| `src/presentation/(features/(auth\|serviceArea)\|stores\|queries\|navigation\|AppContent\|__tests__)` |      8 |    61 |
| `src/data`                                                                                            |     19 |   296 |
| **Total**                                                                                             |    187 |  1617 |

End-of-Turn-12 acceptance criteria, all met:

1. L512 site flipped from `LOG.warn` to `LOG.error`. Inline JSDoc
   replaces the prior stays-warn comment block, explaining the level
   and Error-shape choice (no constructed-Error wrapper needed; pass
   `e` directly).
2. One new regression test proves `recordError` fan-out works
   end-to-end and the surrounding `try/catch` still preserves
   fan-out resilience (peer subscriber received the event).
3. Audit table references Turn 11's classification of the other
   three cleanup-best-effort sites (no re-walk).
4. All four verify gates green (each step individually under the
   sandbox's 45s bash timeout; chunked test run as in prior turns).
5. `docs/PHASE_9_TURN_12.md` written (this file).
6. `CLAUDE.md` top status block + phase-tables row updated.
7. Smoke checklist documented for user-driven validation (mostly
   N/A — pure telemetry; field-validation note for after deploy).
8. Clean commit on `main` via the sandbox `GIT_INDEX_FILE` shadow
   plumbing pattern.

No native config changes. No new dependencies. No prebuild required.
No DI container changes. No cross-repo work.

## Smoke checklist (user-driven)

The smoke for this turn is mostly N/A — the change is pure telemetry,
not user-facing. The flipped site fires only when an arrival
subscriber callback (a domain-side hook / VM `onArrival` handler)
throws synchronously inside the SDK fan-out. Driving it
deterministically requires either:

- Inserting a deliberate throw inside an arrival subscriber via a
  `__DEV__`-gated debug shortcut (no such shortcut exists today);
  the unit test covers the wire-up.
- Waiting for field telemetry to surface real-world incidents —
  domain-side bugs that always throw the same string will cluster
  under one Firebase Console issue (Crashlytics groups by
  `name + message`).

### Field-validation note (after deploy)

After the next deploy lands, watch Firebase Console → Crashlytics →
Non-fatals for `yeapp-stage` for the new `YeRide:NavigationSdk`
issue with message starting `[YeRide:NavigationSdk] handleArrival:
subscriber threw`. Expected behavior:

- A sustained zero-rate means either (a) no real failures hit it
  (the level was wrong — no signal recorded), OR (b) the arrival
  subscribers (currently just `useDriverNavigationViewModel`'s
  arrival → `'arrived'` state-flip) are genuinely robust.
- A sustained non-zero rate flags a domain-side subscriber bug
  worth investigating — likely a stale closure inside a
  `useDriverNavigationViewModel` re-render or an unhandled
  exception inside the auto-pop `useEffect`.

Per Turn 11's pattern, if a sustained zero-rate makes this site
look like dead telemetry, the warn-stay decision should be
revisited. If the site fires at high volume, sample-and-suppress
becomes a legitimate Phase 10 polish item.

## Why this turn was the right size

- One flip + one test + one doc + one commit. Mechanical extension
  of Turn 9's pattern; no new mock infrastructure; no cross-cutting
  audit re-walk; no DI / native rebuild / cross-repo work.
- Closes the Turn 11 follow-up note explicitly without expanding
  scope.
- The +1 test delta is the smallest possible Turn 12 surface — the
  optional sanity check (scope-pin assertion) is folded into the
  one test rather than split into a separate test.

## Phase 9 Turn 13+ candidates (not in scope this turn)

Per Turn 11's deferred list, still pending after Turn 12:

- **Per-brand SVG glyphs.** Replace the `WalletCardRow` PNG glyphs
  with `react-native-svg` per-brand assets so receipt-row
  rendering is resolution-independent. Trade-off: adds a native
  dep where the PNG path has zero.
- **RNFirebase modular API migration.** Phase 9 Turn 6 close logged
  this; still its own turn or Phase 10 cutover-prep work.
- **Receipt PDF.** Phase 9 polish — render a printable / shareable
  PDF of `RideReceiptScreen` for the rider.
- **NavigationSdk teardown telemetry (L387/L415/L428).** If field
  telemetry shows the cleanup-best-effort sites are firing at
  meaningful rates after Phase 10 cutover, revisit the warn-stay
  decision. Currently classified as stays-warn for legitimate
  reasons (next session's init recovers cleanly).

---

**End of Phase 9 Turn 12.**
