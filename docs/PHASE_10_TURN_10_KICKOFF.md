# Phase 10 Turn 10 Kickoff — Audit v3 + cutover sign-off

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 10.5
closed 2026-05-26** (synchronous-error payment-failure surfacing,
both repos; verify-green at 1986 passing in the rewrite, 21 passing
in `yeride-functions`). Turn 10 is the last remaining Phase 10 turn
and the gate-keeper for `PHASE_10_CUTOVER_PLAN.md` §1.

Turn 10 is a **verification-only turn**. No production code lands.
Sized **small (½d)** — re-walk the parity audit at post-10.5 HEAD,
re-run verify on both repos, flip the §0 gate in the cutover plan.

## Context — why this turn now

Phase 10 Turns 1-9 closed the parity gaps surfaced by the v2 audit.
Turn 10.5 then landed a UX correctness fix the rewrite is shipping
ahead of legacy (rewrite-ahead, not a parity gap). Before
`PHASE_10_CUTOVER_PLAN.md` §1 unlocks and the staged rollout in §6
can start, the audit needs a v3 pass that:

1. Confirms no row regressed since Turn 9 close.
2. Captures the Turn 10.5 rewrite-ahead delta explicitly (so the
   on-call engineer in cutover doesn't get confused by a row that
   used to say "matches legacy" and now says "rewrite ships better
   behavior").
3. Flips the §0 gate from "GATE CLEARED pending Turn 10 audit-v3
   sign-off" to "GATE CLEARED."

There is no code change in scope. If the audit re-walk surfaces a
new ❌/⚠️, that becomes Turn 10.1 (or whichever number is free) and
Turn 10 holds open until it closes.

## Pre-checklist (resolve before writing the audit doc)

1. **Verify HEAD SHAs + working tree state across all three repos.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile && git log -1 --oneline && git status --short
   cd /Users/papagallo/yeapptech/dev/yeride-functions && git log -1 --oneline && git status --short
   cd /Users/papagallo/yeapptech/dev/yeride-stripe-server && git log -1 --oneline && git status --short
   cd /Users/papagallo/yeapptech/dev/yeride && git log -1 --oneline && git status --short
   ```
   Capture all four SHAs for the close doc — the cutover SHA is
   chosen here.

2. **Confirm Turn 10.5 close-out is in `main`.** The Turn 10.5 close
   doc lives at `docs/PHASE_10_TURN_10.5.md`. The kickoff calls out
   that Turn 10 re-runs audit-v3 against the post-10.5 SHA — verify
   that's what HEAD is, not a later untracked commit.

3. **Re-read the v2 audit headline + closure annotations.**
   `docs/PHASE_10_PARITY_AUDIT.md` §1 should still read
   `0 ❌ / 0 🟡 / 0 ⚠️`. Skim §2-§7 to refresh the row-by-row state
   before the re-walk. Note that §10 ("Newly-discovered gaps (Turn 1)")
   may have rows that need a final state.

4. **Confirm `PHASE_10_CUTOVER_PLAN.md` §0 status line.** Should read
   "GATE CLEARED 2026-05-19 pending Turn 10 audit-v3 sign-off." If
   it's already flipped to a different status, the kickoff context
   is stale — re-read the latest cutover plan before proceeding.

## Scope — what Turn 10 actually does

### 1. Re-walk the audit at post-10.5 HEAD (static)

For each section of `PHASE_10_PARITY_AUDIT.md`, re-verify the rows
still hold:

- **§2 (Screens & navigation).** Spot-check each screen row by
  reading the cited rewrite file and confirming the screen still
  exists at the same path with the same role-routing.
- **§3 (Feature-level gaps).** This is the big section. Most rows
  closed in Turns 5-8; re-confirm each still ✅. Pay extra attention
  to §3.5 (live ETA, Turn 5), §3.3 (Activity tab, Turn 6), §3.2
  (scheduled rides, Turn 7), §3.4 (chat, Turn 8) — those are the
  most recent and the most likely to have drifted.
- **§4 (App config diff).** Re-diff `app.config.js` (legacy) vs
  `app.config.ts` (rewrite) for `notifications.iosDisplayInForeground`,
  scheme handlers, deep-link URLs, background modes, intent filters,
  Android `queries`, plugin list. Capture any new drift; if any,
  this is a new ❌.
- **§5 (Cloud Function callables).** Grep `httpsCallable(` in legacy
  `/yeride/src` and rewrite `/yeride-mobile/src`. Confirm every
  legacy callable name has a rewrite call site (or an explicit
  de-scope row in §3). The set is small: `completeTrip`,
  `cancelTrip`, `tipDriver`, `sendPushNotification`.
- **§6 (Notifications).** Re-grep for push-payload type strings on
  both sides; confirm parity.
- **§7 (Firestore writes).** Grep `firestore().collection(` write
  sites on both sides; spot-check each collection has a matching
  rewrite write path.

For each section, capture a one-line "re-verified at HEAD `<sha>`,
status unchanged" note OR a deviation. Roll up into §1 headline.

### 2. Add Turn 10.5 delta row(s) to the audit

Turn 10.5 introduced a rewrite-ahead delta: synchronous-error
PaymentFailure now flips trip status to `'payment_failed'` with a
structured `paymentError` field, surfacing the failure in
`PaymentFailedView`. Legacy yeride still silently completes the
trip in this case.

Add a row to §3 (or wherever it best fits — possibly a new §3.x
sub-section "Payment failure surfacing") marked:

- 🟡 **rewrite-ahead** — rewrite ships better behavior than legacy.
  Cite `docs/PHASE_10_TURN_10.5.md`. Note: legacy yeride is unchanged
  and still silently completes trips on synchronous Stripe error;
  the rewrite explicitly does not. This is acceptable — the rewrite
  is what's about to ship, and legacy will be retired post-rollout.

The headline (`0 ❌ / 0 🟡 / 0 ⚠️`) becomes `0 ❌ / 1 🟡 / 0 ⚠️`
after this row lands. The 🟡 row is rewrite-ahead, not a missing
port — the gate clears regardless.

### 3. Re-run verify on the rewrite + backend

```bash
cd /Users/papagallo/yeapptech/dev/yeride-mobile
npm run typecheck
npm run lint
npm run format:check
npm test            # may need to be partitioned per Turn 10.5 note
                    # ("npm test runs longer than the sandbox's 45s bash limit")

cd /Users/papagallo/yeapptech/dev/yeride-functions
npm test
npm run lint        # expect 3 pre-existing errors per Turn 10.5
                    # (handlers/complete-trip.js:130, lib/notifications.js:45,76)
```

Capture exact passing test counts in the close doc. The Turn 10.5
baseline was 213 suites / 1986 tests in the rewrite, 1 suite / 21
tests in functions. Audit-v3 should match (no code changed).

The 3 pre-existing yeride-functions lint errors are documented as
out-of-scope cleanup in Turn 10.5; carry that forward (do not fix
them in this turn — that's a separate chore).

### 4. Flip the §0 gate in `PHASE_10_CUTOVER_PLAN.md`

In `docs/PHASE_10_CUTOVER_PLAN.md`:

- Header `Status:` line — change "Draft v2 — runbook. **§0
  feature-parity gate cleared 2026-05-19 pending Turn 10 sign-off.**"
  to "**§0 feature-parity gate cleared 2026-05-30.** Phase 10
  complete. §1 below is the active workstream."
- §0 status line — change "**Status: GATE CLEARED 2026-05-19 pending
  Turn 10 audit-v3 sign-off.**" to "**Status: GATE CLEARED
  2026-05-30. Phase 10 complete.**" Replace the "Turn 10 (audit
  re-run + final sign-off) remains. When Turn 10 closes, §1 below
  takes over." sentence with "§1 below is the active workstream."
- Header date row (line 10-11) — append "· Turn 10 closed 2026-05-30".
- §3.1 (verify-status) — update the in-line status note with the new
  test counts and the Turn-10 close SHA.

### 5. Update `docs/PHASE_10_PARITY_AUDIT.md` to v3

- Bump `**Status:** v2 …` to `**Status:** v3 — Turn 10 closed
  2026-05-30. All Phase 10.x turns closed.`
- Append the Turn 10 closure annotation to the date row.
- Update §1 headline to reflect any new 🟡 rows from step 2.
- Update §8 turn table — strike Turn 10 with ✅ **CLOSED 2026-05-30**
  citation pointing at `PHASE_10_TURN_10.md`. Add a Turn 10.5 row
  (or footnote) noting the interstitial turn between 10 and §1.
- Update §11 sign-off checklist — tick all three remaining boxes.

### 6. Update `yeride-mobile/CLAUDE.md`

- Status table: Phase 10 row → ✅ (was 90%).
- Top-of-file narrative paragraph: drop the "Turn 10 (audit-v3 +
  cutover sign-off) is the last remaining Phase 10 turn" sentence
  and replace with "Phase 10 complete; cutover is unblocked, see
  `docs/PHASE_10_CUTOVER_PLAN.md` §1 for the active workstream."

### 7. Write the close doc

`docs/PHASE_10_TURN_10.md` — same convention as Turn 10.5's close
doc. Sections: Why · Pre-checklist outcomes · What shipped (audit
v3 diff vs v2; cutover plan §0 flip; CLAUDE.md status update) ·
Verify gate counts · Cutover-plan impact · Rollback · Follow-ons.

## Decisions to lock at kickoff time

### Decision 1 — does the Turn 10.5 rewrite-ahead delta become a 🟡 row or a footnote

**🟡 row, recommended.** The audit's row vocabulary (✅/🟡/❌/⚠️)
already covers "ported with known differences" — that's exactly
what rewrite-ahead is from the audit's POV. A footnote risks being
missed in a future skim; a row is grep-able and shows up in the
headline count. Mark the row clearly as "rewrite-ahead, not a
missing port" so the on-call engineer doesn't mistake it for a
gap.

### Decision 2 — does this turn block on a real-device manual smoke pass

**No.** Per `PHASE_10_PARITY_AUDIT.md` §9 ("Out of scope"), the
real-device manual parity smoke is covered by
`PHASE_10_CUTOVER_PLAN.md` §3.2, not by the audit. The audit is
static inspection. Turn 10 closes the static inspection;
real-device smoke happens during §3 of the cutover plan, after the
gate clears.

If the close doc explicitly notes "real-device smoke pending §3.2,
not gated by Turn 10," the cutover plan's §3.2 row remains the
load-bearing check.

### Decision 3 — does the backend (`yeride-functions`) deploy land in this turn

**No.** The Turn 10.5 close-out note says "§3.4 (backend health)
needs a verify pass once `payments.js` is deployed to `yeapp-stage`;
the deploy command is unchanged (`cd functions && npm run
deploy-stage`)." That deploy is a cutover-plan §3.4 line item, not
part of Turn 10. Turn 10 verifies the code is green and ready to
deploy; the deploy itself happens as part of cutover §3.4.

If Hernando wants to deploy as part of this turn for convenience,
that's fine — but flag it in the close doc as "ran §3.4 backend
deploy ahead of cutover §3.4" so the cutover-day on-call engineer
knows.

### Decision 4 — does Turn 10 fix the 3 pre-existing yeride-functions lint errors

**No.** Turn 10.5 explicitly punted these as out-of-scope cleanup
("not introduced by this turn; sized small but lives outside Turn
10.5 scope"). Same posture here — Turn 10 is verification, not
cleanup. The cleanup chore can land as Turn 10.6 or as a follow-on
PR after cutover lands.

## Out of scope

- Any code changes to `yeride-mobile`, `yeride-functions`, or
  `yeride-stripe-server`. If the audit re-walk surfaces a new ❌
  that requires code, that's a new turn (Turn 10.1+); Turn 10
  itself holds until the new turn closes.
- The real-device two-device manual smoke pass — covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.2.
- The backend (`yeride-functions`) deploy to `yeapp-stage` — covered
  by cutover §3.4.
- The 3 pre-existing yeride-functions lint errors — punted to a
  separate cleanup chore per Decision 4.
- Touching the legacy yeride app. The audit reads legacy; doesn't
  modify it.

## Verify gates

Same as every turn:

- `cd yeride-mobile && npm run verify` — typecheck + lint + format
  + tests all green at the close SHA.
- `cd yeride-functions && npm test && npm run lint` — tests green;
  lint shows exactly 3 pre-existing errors (no new ones).

The §3.1 verify gate in `PHASE_10_CUTOVER_PLAN.md` stays green
post-Turn-10 (no code change).

## Rollback

There's nothing to roll back code-wise — Turn 10 doesn't touch
code. If something in the audit re-walk turns out to be wrong
post-cutover (e.g. a row marked ✅ that was actually 🟡 or ❌),
amend the audit doc and flip §0 back to "pending re-audit" + open
a new turn. No production impact from getting the audit wrong;
production impact comes from missing a real parity gap, which is
what the audit is designed to catch.

## Cutover-plan impact

Turn 10 IS the §0 gate flip. After this turn closes:

- §0 cleared (no longer "pending Turn 10 sign-off").
- §1 (Locked decisions) is the entry point for the next workstream.
- §3 (Pre-cutover gates) becomes the active checklist.
- §6 (Staged rollout) is now ready to start when the §3 gates tick.

Phase 10 is 100% complete at Turn 10 close. The rewrite is in a
cutover-ready state; the actual cutover is a separate workstream
governed by `PHASE_10_CUTOVER_PLAN.md`.

## References

- `PHASE_10_PARITY_AUDIT.md` (current v2; this turn produces v3).
- `PHASE_10_CUTOVER_PLAN.md` §0 (gate to flip), §1 (next
  workstream), §3.1 (verify gate), §3.2 (manual smoke), §3.4
  (backend deploy).
- `docs/PHASE_10_TURN_10.5.md` (predecessor close doc — Turn 10
  re-runs audit-v3 against the post-10.5 SHA).
- `docs/PHASE_10_TURN_9.md` (Turn 9 close — verify-green baseline
  before Turn 10.5 landed).
- `yeride-mobile/CLAUDE.md` status table (Phase 10 row to flip to ✅).
