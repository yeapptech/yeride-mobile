# UI Review Workflow — Design Spec

**Date:** 2026-06-14  
**Status:** Approved

## Goal

A reusable, hybrid UI review system for the YeRide mobile app that:

1. Runs a one-time comprehensive audit of all ~35 screens (iOS first, then Android)
2. Provides a fast, repeatable workflow for reviewing UI changes going forward
3. Produces a structured findings report and Maestro regression tests for confirmed critical issues

## Scope

**One-time audit:** All ~35 production screens across auth, rider, driver, vehicle, payments, and shared.

**Reusable workflow:** The 15 critical screens (core user flows):

- Auth: LogInScreen, RegisterScreen, ForgotPasswordScreen, UserProfileScreen
- Rider: RiderHomeScreen, RouteSearchScreen, RouteSelectScreen, RideMonitorScreen, WalletScreen, ActivityScreen (rider), AddPaymentMethodScreen
- Driver: DriverHomeScreen, DriverDispatchScreen, DriverMonitorScreen, DriverActivityScreen

## Workflow Architecture

Saved at `.claude/workflows/ui-review.js`.

**Invocation:**

```js
// Full audit (first run)
Workflow({ name: 'ui-review', args: { platform: 'ios' } });
Workflow({ name: 'ui-review', args: { platform: 'android' } });

// Change review (scope to changed files)
Workflow({
  name: 'ui-review',
  args: {
    platform: 'ios',
    files: ['src/presentation/features/auth/screens/RegisterScreen.tsx'],
  },
});
```

### Phase 1 — Static Analysis (~2 min, no simulator needed)

Five agents fan out in parallel, one per screen group:

- `auth` — LogIn, Register, ForgotPassword, EmailVerification, UserProfile
- `rider` — RiderHome, RouteSearch, RouteSelect, RideMonitor, RideReceipt, RideScheduledConfirmation, ActivityScreen, WalletScreen, AddPaymentMethod
- `driver` — DriverHome, DriverDispatch, DriverMonitor, DriverNavigation, DriverActivity, DriverEarnings
- `vehicle-payments` — VehicleList, VehicleRegistration, VehiclePhotos, VehicleDetails
- `shared` — TripDetailScreen

Each agent reads assigned screen files and checks:

**Keyboard & input safety**

- `TextInput` not inside a `ScrollView` with `keyboardShouldPersistTaps="handled"`
- Form screens missing `KeyboardAvoidingView` (or wrong `behavior` prop — `"padding"` on iOS, `"height"` on Android)
- `TextInput` near the bottom of the screen with no bottom offset (keyboard will cover it)

**Scroll & overflow**

- Lists or long content not wrapped in `ScrollView` / `FlatList`
- `FlatList` nested inside a `ScrollView` (causes RN crash)
- Fixed-height containers that overflow on small devices (iPhone SE / small Android)

**Safe area & chrome**

- Screens missing `SafeAreaView` or `useSafeAreaInsets` (content bleeds under notch or home indicator)
- Bottom actions (buttons, inputs) without bottom inset accounting (hidden behind tab bar or home indicator)

**Visual/style consistency**

- Hardcoded color values (`#`, `rgb(`) instead of NativeWind theme tokens
- Mixed spacing: raw `style={{padding: 16}}` alongside `className="p-4"`

**Navigation**

- Screen registered in a navigator but missing from the typed param list
- Screens calling `navigation.goBack()` without a guaranteed prior screen

Each finding is tagged: `critical` (blocks user action), `warning` (degrades UX), `info` (style drift).

### Phase 2 — Maestro Run (~5-8 min, simulator must be booted)

Runs existing flows plus four new targeted flows in `e2e/maestro/ui-review/`:

| Flow                       | Screens Covered                                                                                                           | What It Tests                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `keyboard-inputs.yaml`     | Login, Register, ForgotPassword, RouteSearch, UserProfile, VehicleRegistration, VehicleDetails                            | Taps every TextInput; asserts it remains visible and tappable after keyboard opens  |
| `scroll-reachability.yaml` | ActivityScreen (rider+driver), WalletScreen, VehicleListScreen, TripDetailScreen, RideReceiptScreen, DriverEarningsScreen | Scrolls to bottom; asserts last element is visible                                  |
| `bottom-actions.yaml`      | RouteSelectScreen, VehicleRegistrationScreen, AddPaymentMethodScreen                                                      | Asserts sticky bottom button/input is visible and not obscured after keyboard opens |
| `tab-navigation.yaml`      | RiderTabsNavigator, DriverTabsNavigator                                                                                   | Walks every tab; asserts correct screen renders without crash                       |

The one-time full audit additionally runs `rider/walkthrough.yaml` and `driver/walkthrough.yaml` to cover remaining screens.

### Phase 3 — Synthesis & Output

Merges Phase 1 and Phase 2 findings and writes:

**Report:** `docs/ui-audit/YYYY-MM-DD-{platform}.md`

Structure:

```
# UI Audit — {Platform} — {Date}

## Summary
| Severity | Count |
|----------|-------|
| Critical |  N   |
| Warning  |  N   |
| Info     |  N   |

## Findings by Screen
### {ScreenName}  {status icon}
- **[severity] Issue title** — description. Fix: suggested fix.

## Maestro Results
| Flow | Result |
|------|--------|
| ...  | ✅/❌  |
```

**Maestro regression stubs:** For each `critical` finding with a reproducible interaction, writes a minimal `.yaml` stub in `e2e/maestro/regression/` named `{screen}-{issue-slug}.yaml`. Info/warning findings are noted in the report only.

## Platform Handling

Runs as two separate passes — iOS first, then Android. Platform-specific checks:

- `KeyboardAvoidingView behavior` — `"padding"` is correct on iOS, `"height"` on Android; the agent flags mismatches per platform
- Safe area — iOS notch/Dynamic Island vs. Android status bar height
- Maestro flows target the appropriate simulator/emulator per platform arg

## Outputs

| Artifact         | Location                                 | Purpose                                               |
| ---------------- | ---------------------------------------- | ----------------------------------------------------- |
| Findings report  | `docs/ui-audit/YYYY-MM-DD-{platform}.md` | Human-readable per-screen findings                    |
| Regression tests | `e2e/maestro/regression/*.yaml`          | Permanent Maestro tests for confirmed critical issues |
| Maestro flows    | `e2e/maestro/ui-review/*.yaml`           | Four new reusable flows (part of the workflow)        |

## Out of Scope

- Automated visual regression (screenshot diffing) — requires a paid service; style consistency is covered by code analysis + manual spot-check
- Performance / frame rate profiling
- Accessibility (a11y) audit — separate concern, different tooling
