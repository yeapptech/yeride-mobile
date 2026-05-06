# Phase 9 Turn 18 — Document the SDK-seam vs. direct-consumption policy

**Status:** ✅ closed.

## Why

Phase 9 Turn 17 promoted `BackgroundGeolocation` and `NavigationSdk`
seam types from `@data/services` into `@domain/services` and shrank
the ESLint `boundaries` override list from five entries to one. After
that turn the project rule for SDK adapters is unambiguous: domain
interface in `@domain/services`, real adapter in `@data/services`,
in-memory fake in `@shared/testing`, `Container.<seam>` typed as the
interface.

The rule applies to five SDKs today: `BackgroundGeolocationClient`,
`NavigationSdkClient`, `ExpoNotificationsAdapter`,
`FirebaseCrashlyticsAdapter`, and the RNFirebase
Auth/Firestore/Storage/Functions adapters.

But three Phase-9-era view-models still consume SDKs directly without
a domain interface:

- `src/presentation/features/rider/view-models/useGenerateReceiptPdfViewModel.ts:1-3`
  — `expo-print`, `expo-sharing`, `expo-file-system` (Phase 9 Turn 16).
- `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts:2`
  — `expo-image-picker` (Phase 5 Turn 4).
- `src/presentation/features/driver/view-models/useDriverEarningsViewModel.ts:277`
  — `expo-web-browser` (Phase 6 Turn 4; also reached via
  `useStripeConnectOnboarding`).

Turn 17 explicitly listed these as out-of-scope ("function-style
seams, not class adapters; the interface-promotion pattern doesn't
apply 1:1"). The pattern is real but undocumented. The next
contributor will guess.

This is a **decision turn**. No new code, no new tests. Document the
rule in CLAUDE.md, annotate the three exempted view-models with a
JSDoc note, and record the alternative (per-SDK seams for the three
exempted SDKs) as the explicitly-rejected option.

## Pre-checklist outcomes

All four pre-checklist questions landed on the Recommended option:

1. **Option A vs Option B.** Picked **Option B** — document a
   "single-call SDK escape hatch" rule rather than retroactively
   building three new domain interfaces. Rationale: each of
   `expo-print` / `expo-image-picker` / `expo-web-browser` would
   produce a one-method interface; the overhead of an interface +
   adapter + fake + DI wiring exceeds the value of the indirection
   when the call site is one tap with no lifecycle to manage. Option
   A's trigger conditions are documented inline (continuous listener,
   permission lifecycle, etc.) so a future change that violates them
   reopens the per-SDK seam discussion cleanly.

2. **Wording of the (a)/(b)/(c) test conditions.** Tightened the
   middle condition from the kickoff's "no permission lifecycle" to
   "no permission state to mirror." `expo-image-picker` does call
   `requestMediaLibraryPermissionsAsync` per tap; the relevant
   distinction is whether that permission is mirrored into a Zustand
   store / banner / AppState listener (which is what makes
   `BackgroundGeolocation` permission state seam-worthy) or just a
   one-shot ask per call (which is fine).

3. **Inclusion of `useStripeConnectOnboarding`.** Yes — covered by
   reference in the JSDoc note on `useDriverEarningsViewModel`. The
   onboarding hook is the direct consumer of
   `WebBrowser.openAuthSessionAsync`; the VM is the direct consumer
   of `WebBrowser.openBrowserAsync` (Express dashboard). One JSDoc
   note covers both because they're paired in the same feature
   surface.

4. **CLAUDE.md placement.** Inserted directly after the existing
   "SDK seams: domain interface + data adapter + fake" subsection in
   "Code conventions", so the "when to seam" rule and the "when not
   to seam" escape hatch read as a pair.

## What shipped

### CLAUDE.md (1 file)

New "Single-call SDK escape hatch" subsection inserted between the
existing "SDK seams: domain interface + data adapter + fake"
subsection and the "Status-router pattern for live trip surfaces"
subsection. Three paragraphs:

- Rule with three test conditions (a)/(b)/(c).
- Today's qualifying list (the three view-models named above) and
  the matching counter-example list (the five seamed SDKs from
  Turn 17 plus `ExpoNotificationsAdapter` and the RNFirebase
  adapters).
- Instruction to add a JSDoc note on every escape-hatch consumer
  naming which condition lets it skip the seam.

### View-model JSDocs (3 files)

- `src/presentation/features/rider/view-models/useGenerateReceiptPdfViewModel.ts`
  — added "**SDK seam status**" paragraph at the end of the existing
  JSDoc block. Lists `expo-print` + `expo-sharing` +
  `expo-file-system` and walks through (a)/(b)/(c). Names the
  promotion trigger (continuous share-completion listener or
  mirrored permission state).

- `src/presentation/features/driver/view-models/useVehiclePhotosViewModel.ts`
  — added the same paragraph. Lists `expo-image-picker` and walks
  through (a)/(b)/(c). Names the promotion trigger (camera-fallback
  UX with continuous capture state, or a permission banner mirroring
  permanent-deny status).

- `src/presentation/features/driver/view-models/useDriverEarningsViewModel.ts`
  — added the same paragraph. Lists `expo-web-browser` (covering
  both this VM and the sibling `useStripeConnectOnboarding` hook)
  and walks through (a)/(b)/(c). Notes that the existing `AppState`
  listener and `useFocusEffect` exist for Connect-status refresh
  triggering, not SDK lifecycle. Names the promotion trigger
  (continuous browser-session listener or mirrored consent state).

### Phase doc (1 file)

- `docs/PHASE_9_TURN_18.md` (this file).

## Acceptance

- New CLAUDE.md subsection in place.
- Three updated VM JSDocs.
- `npm run verify` green; test count unchanged (pure documentation
  turn — no code changes, no test changes).

## Out of scope

- **Building any of the three rejected interfaces.** Option A
  (creating `PdfGenerationService` / `MediaPickerService` /
  `SystemBrowserService` domain interfaces with adapters and fakes)
  was explicitly considered and rejected this turn. If that
  direction is revisited later, each SDK gets its own follow-up
  kickoff — don't bundle three of them into one turn.

- **Auditing other view-models for direct SDK consumption.** This
  turn covers the three known cases. If a future view-model lands
  with a direct SDK import, the author is expected to either route
  it through a domain interface (the default) or add a JSDoc note
  citing this rule (the escape hatch).

- **Promoting the existing JSDoc seam-status notes into a generated
  table or doc.** The notes are deliberately inline so a future
  reader of the VM file finds the rationale right next to the
  import statement, not in a separate index.

- **Re-examining the `<StripeProvider/>` / `<NavigationProvider/>`
  React-context-provider seams.** Turn 17 already classified those
  as out of the seam-promotion pattern; this turn doesn't revisit
  them.
