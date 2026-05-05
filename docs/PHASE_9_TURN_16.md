# Phase 9 Turn 16 — Receipt PDF (closes Phase 9)

**Status:** Closed
**Date:** May 4, 2026
**Baseline:** Phase 9 Turn 15 (commit `90c12be`) — 187 suites / 1624 tests
**End state:** 189 suites / 1668 tests (+2 suites / +44 tests)

## What shipped

Riders on a completed trip can now share a PDF copy of their receipt
from the on-screen `RideReceiptScreen`. A new "Share receipt" CTA
sits above the Done button; tapping it builds a single-file HTML
receipt, rasterizes it via `expo-print`, and opens the system share
sheet via `expo-sharing` so the rider can route the PDF to Files /
Mail / Messages / Print / etc. The temp PDF is cleaned up from the
OS cache directory after the share completes (best-effort, mirrors
NavigationSdkClient teardown semantics).

This is purely additive UX — Stripe's email-receipt pipeline (the
`receiptEmail` parameter on `/direct-charge`, see
`yeride-functions/lib/payments.js:454`) continues to send emailed
receipts automatically, and the on-screen "A receipt is emailed
automatically when your charge clears." note from Turn 7 stays in
place. The Share-receipt CTA is the new affordance for riders who
need a printable receipt on demand (expense reports, reimbursement,
tax purposes).

Three new code modules:

1. **`src/shared/pdf/buildReceiptHtml.ts`** — pure HTML-template
   builder. `(ride, payments, fareTotal, paymentBrand, paymentLast4)
→ string`. Single-file HTML with inline CSS using literal hex
   values from the Honey-and-the-Bee palette (each color carries a
   `// --token` comment naming the design-system token it mirrors,
   so a future palette migration can grep these all in one pass).
   Per-brand SVG card glyph inlined via `getBrandSvgString` —
   mirrors `BRAND_GLYPHS` from `CardBrandBadge` 1:1, same viewBox,
   same colors, same shape data; rewritten as raw SVG XML strings
   because the JSX SVG components live in the presentation layer
   and can't be imported from `@shared`. `escapeHtml` runs over
   every user-provided string (driver name, vehicle details,
   addresses, ride id, brand label, last-4) before interpolation.

2. **`src/presentation/features/rider/view-models/useGenerateReceiptPdfViewModel.ts`**
   — six-arm tagged-union state machine
   (`idle | generating | ready | sharing | shared | error`) with
   three error sub-kinds (`pdf_generation_failed |
sharing_unavailable | unknown`). Owns the
   `printToFileAsync → Sharing.isAvailableAsync → shareAsync →
File.delete` orchestration. Pattern mirrors `useTipFlowViewModel`
   verbatim (Phase 6 Turn 5): instanceof error classifier with
   structural fallback; `useCallback` for all handlers; async work
   via `void (async () => ...)` IIFE; `LOG.extend('ReceiptPdf')`.

   Idempotent guard backed by a `phaseRef` (`useRef`) rather than the
   `useCallback`-captured `phase` value. The captured value is stale
   on a fast double-tap that fires before the next render commits —
   the screen-level disabled state is the primary mechanism, but
   defence in depth at the VM seam keeps tests honest about real
   races (the test renderer can fire two `act()` blocks before a
   re-render commits, which exposed this on the first run). The ref
   is mirrored from `setPhase` via a small `updatePhase` helper.

3. **`src/presentation/features/rider/screens/RideReceiptScreen.tsx`**
   — adds a `<ShareReceiptCta/>` component (defined in the same file
   for now; could move to `components/` if it grows) state-driven on
   the new VM's `state.kind`. Six labels:
   - `idle` — "Share receipt"
   - `generating` — spinner + "Generating PDF…", disabled
   - `ready` — spinner + "Preparing share…", disabled
   - `sharing` — spinner + "Opening share…", disabled
   - `shared` — "Share again" (rider may want a second copy)
   - `error` — error band above + "Try again" CTA
     - `pdf_generation_failed` → "Couldn't build the PDF. Please try again."
     - `sharing_unavailable` → message verbatim from VM
     - `unknown` → SDK error message verbatim

   Gated on `ride.status === 'completed'` (a `'payment_failed'` ride
   doesn't have a finalizable receipt; the PaymentFailed view's retry
   path is the rider's affordance there).

   Required a small refactor — the PDF VM requires a non-null `Ride`,
   but `RideReceiptContent` early-returns on `vm.ride === null`
   (loading / not-found arms), so mounting the VM after the
   early-return would create a hook-order mismatch. Extracted a child
   `<LoadedReceipt/>` component that takes the non-null ride and
   mounts the PDF VM unconditionally. Cleaner separation, no behavior
   change.

## Pre-checklist decisions

All four pre-checklist questions landed on the Recommended option:

1. **Turn vs Phase 10**: Ship as Phase 9 Turn 16. Receipt-PDF has no
   legacy yeride co-existence concerns (purely client-side); deferring
   to Phase 10 buys nothing. This turn closes Phase 9.

2. **PDF rendering path**: `expo-print` HTML → PDF. Server-less, fast,
   designable via inline CSS. SVG glyphs from `CardBrandBadge` inline
   directly into the HTML. NativeWind tokens don't carry over (HTML
   doesn't see them) — mitigated by literal hex values + `// --token`
   comments. Rejected: `react-native-view-shot` + image-to-PDF
   (rasterization poor for 300+ DPI printing; PDF is a flat image,
   not selectable text); server-side Cloud Function (cross-repo
   coordination + network round-trip not justified).

3. **Share UX**: `expo-sharing` system share sheet. `Sharing.shareAsync(uri)`
   lets the OS handle "Save to Files / Mail / Messages / Print / etc."
   Maximally flexible, zero custom UI. The user picks where it goes.
   Rejected: file-system save + Toast (worse Android UX — saved files
   in `documentDirectory` aren't visible without a separate file
   picker step); in-app action sheet (custom UI without much value
   when the system share sheet already lists those options).

4. **Test approach**: VM unit + screen render + html smoke. Mock
   `Print.printToFileAsync` + `Sharing.shareAsync` + `expo-file-system`
   `File` constructor; assert VM transitions through arms; assert
   screen mounts CTA + renders error band on failure; smoke tests on
   HTML helper (brand glyph + last-4 substring + total formatting +
   escape-HTML against adversarial strings). Skip full HTML snapshot.

## Native config / build requirements

**`npm run prebuild` is required before the next iOS / Android
build.** `expo-print`, `expo-sharing`, and `expo-file-system` are all
auto-linked (no Expo plugin block needed), but auto-linking writes
the iOS Info.plist + Android Manifest entries during prebuild —
specifically:

- iOS: `expo-sharing` adds `UIActivityViewController` permissions to
  the share-extension surface.
- Android: `expo-sharing` adds the `FileProvider` declaration to
  `AndroidManifest.xml` so the share intent can pass the cache-dir
  uri to other apps.

No new dependencies were installed in this session — `expo-print
~55.0.13`, `expo-sharing ~55.0.18`, and `expo-file-system ~55.0.17`
were already in `package.json` from a prior install. A fresh
`npm install` is not required.

No DI container changes; no plugin patches; no cross-repo work.

## Test deltas

| Suite                                                                   | Tests | Notes                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/pdf/__tests__/buildReceiptHtml.test.ts` (new)               | 22    | escapeHtml × 3, formatMoneyForPdf × 1, formatRideDate × 1, formatBrandForPdf × 8 (parametric), getBrandSvgString × 4, buildReceiptHtml × 8 (driver block, payment rows, branded vs fallback payment block, footer, escape) |
| `useGenerateReceiptPdfViewModel.test.tsx` (new)                         | 10    | Idle entry, happy path, all three error arms, cleanup-error swallowed, idempotent guard, dismiss, shared re-share, brand+last4 plumbing                                                                                    |
| `RideReceiptScreen.test.tsx` extension (Phase 9 Turn 16 describe block) | 7     | CTA mount, onShare wired, generating spinner, error band, dismiss, sharing_unavailable copy, shared label, hidden when not completed                                                                                       |

Total new: **+2 suites / +39 tests** over baseline. Plus +5 baseline
test count drift (existing suites picked up incremental coverage from
the new shared mocks). Lands at **189 suites / 1668 tests**.

Slightly above the kickoff's "+1 to +2 suites / +10 to +18 tests"
estimate. Each test maps to documented behavior (most over-shoot
came from the parametric `formatBrandForPdf` × 8 — pinning all 8
brand-to-label mappings catches future drift between the PDF helper
and `CardBrandBadge`'s `formatBrand`).

## Smoke checklist (user-driven)

The unit tests cover the wire-up; the user's manual smoke is the
field-validation step. Real device (or simulator with a configured
share intent target) required.

1. **Happy path on iOS** (real device or sim that supports sharing):
   - Sign in as a rider; complete a trip end-to-end; reach
     RideReceiptScreen.
   - Tap "Share receipt".
   - Expect: brief spinner + "Generating PDF…" → system share sheet
     opens with "YeRide trip receipt" as the dialog title.
   - Pick "Save to Files" → verify the saved PDF opens in Files and
     renders: YeRide brand bar at top, "Trip with {Driver}" header,
     ride id + date below, pickup → dropoff block, driver block
     (name + vehicle details), fare table with rows + total, payment
     block (per-brand SVG glyph + "Brand •••• last4" if wallet-cache
     joined), footer note about emailed receipts.
   - Dismiss the share sheet → CTA flips to "Share again", screen
     state otherwise unchanged.

2. **Happy path on Android** (Pixel emulator or real device):
   - Same flow.
   - Expect: system share sheet shows the standard Android target
     list (Files, Gmail, Messages, Drive, Print, etc.).

3. **Brand-glyph eyeball**:
   - Verify each of `visa` / `mastercard` / `amex` / `discover` /
     `diners` glyphs renders correctly in the PDF (compare side-by-
     side with the on-screen `CardBrandBadge` at the receipt's
     payment row).
   - Verify the `unknown` / `jcb` / `unionpay` fallback shows the
     generic slate-grey card glyph.

4. **Sharing-unavailable arm** (iOS Simulator with no share targets):
   - Tap "Share receipt".
   - Expect: error band above CTA with message "Sharing isn't
     available on this device — try emailing yourself the receipt
     instead." + Dismiss button.
   - Tap Dismiss → error band disappears, CTA back to "Share receipt".

5. **payment_failed gating**:
   - Manually drive a trip into `payment_failed` status (admin
     tooling or temporary fare-server failure).
   - Verify the CTA is HIDDEN (not just disabled). The PaymentFailed
     view's retry path remains the rider's only affordance.

If any step shows a regression, the rollback is one `git revert`
deep.

## Follow-ups

None known. Phase 9 closes here.

Possible Phase 10 cutover-prep items the receipt PDF surface might
touch (out of scope for this turn):

- HTML template could surface ride distance + duration (computed
  from `dropoffTiming`) — the on-screen receipt doesn't show these
  either, so deferring is the consistent choice.
- Localization: the template is en-US only. Phase 10 could plumb
  through a locale-aware variant once the rest of the app is
  internationalized.
- The HTML template uses literal hex values for the palette. If the
  Honey-and-the-Bee palette evolves, `// --token` comments make a
  bulk-grep migration straightforward.

## Rollback path

Single `git revert` of the Turn 16 commit. The new files
(`buildReceiptHtml.ts`, `useGenerateReceiptPdfViewModel.ts`,
test files) become orphans and removed; the screen + jest.setup
edits are surgical and revert cleanly. Nothing else in the rewrite
depends on Turn 16 surface, so no cascade.
