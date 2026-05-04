# Phase 9 — Turn 10: Permission-denied UX

Phase 9 Turn 9 closed the SDK-adapter telemetry flips
(BackgroundGeolocationClient.ts → 4 LOG.warn → LOG.error sites
routed through the rawMeta channel to Crashlytics `recordError`).
Field-side telemetry on the GPS pipeline is now lit end-to-end.

Turn 10 picks up a deferred Phase 9 polish item Turn 8's kickoff
named explicitly: the user-facing "Open Settings" recovery affordance
for riders / drivers who decline the OS location dialog. Pre-Turn-10,
`useGpsLifecycle.ts:L207` logged at info ("permission not granted")
and silently no-op'd the SDK; the user had no path to recover short
of killing the app, toggling the OS permission, and re-launching —
even after granting via Settings and returning, the lifecycle hook's
effect deps (`[bgGeolocation, enabled, setPermissionStatus]`) didn't
include `permissionStatus`, so the SDK never restarted.

Acceptance: **184 test suites / 1599 tests passing** (+3 suites,
+26 tests over Turn 9's 181/1573 — at the floor of the kickoff's
"+3 to +5 suites" estimate band for suites and slightly above the
upper bound on tests, +26 vs +25 estimated).

## Pre-checklist answers (from kickoff)

All four pre-checklist questions answered with the Recommended option:

1. **Banner mounting strategy** — Per-screen on DriverHome + RideMonitor.
   Each surface owns its copy; no global coupling. Two component
   instances, same shared `<PermissionDeniedBanner/>`.
2. **Driver online-toggle gating** — Disabled + banner explains why.
   Mirrors the existing `noActiveVehicle` empty-state pattern. Toggle
   visually shows "Go online" but is non-interactive when permission
   is denied; the banner above carries the "Open Settings" CTA.
3. **Rider banner timing** — Only during active trip statuses
   (`'dispatched'` / `'started'`). Pre-trip and post-trip statuses
   don't surface the banner — degraded ETA on a not-yet-dispatched or
   already-completed trip isn't actionable.
4. **AppState refresh wiring** — Sibling hook in AppContent +
   selector-based banner + toast on grant edge. New
   `usePermissionRefresh()` hook listens on `AppState 'change' →
'active'`, calls `requestAuthorizationIfNeeded()`, updates the
   store. Banner reads `useGpsPermissionStatus()` and re-renders.
   Toast fires on `'denied' → 'always' | 'when_in_use'` edge.

## What's in

### 1. New shared component — `<PermissionDeniedBanner/>`

`src/presentation/components/permission/PermissionDeniedBanner.tsx`
(plus `index.ts` barrel).

Pure prop-driven. Surface: `{title, message, onOpenSettings, onDismiss?,
testID?}`. NativeWind tokens — `bg-warning/10` background +
`text-warning` foreground match the existing `'permission_denied'` and
`'out_of_coverage'` banners on DriverHome/RiderHome (semantic tokens
from `docs/DESIGN_SYSTEM.md`). The dismiss button is opt-in via
`onDismiss` — both DriverHome and RideMonitor mount without it (the
banner re-appears as long as the underlying state stays denied; the
user can't dismiss away the gate). Kept in the surface for a future
"dismissable on RiderHome" variant (kickoff Q3 option (c)) and for
symmetry with `<NotificationPermissionSheet/>`.

### 2. New hook — `useOpenSettings()`

`src/presentation/hooks/useOpenSettings.ts`.

Wraps `Linking.openSettings()` so:

- Tests mock at one well-known seam
  (`jest.spyOn(Linking, 'openSettings')`) instead of every call site.
- The async/Promise plumbing stays out of consumer code — the
  returned callback is `() => void`, fire-and-forget. We log on
  rejection at warn level but don't surface mid-tap (the only
  plausible failure modes — Linking unavailable, OS denied the
  deep-link — aren't actionable).

`Linking.openSettings()` works on both iOS and Android out of the
box; no permission strings, no plugin changes, no native rebuild.

### 3. New hook — `usePermissionRefresh()`

`src/presentation/hooks/usePermissionRefresh.ts`.

Mounted exactly once in AppContent (sibling to `useGpsLifecycle`).
On every `AppState 'change' → 'active'`:

1. Calls `bgGeolocation.requestAuthorizationIfNeeded()` (after the
   first prompt the OS dialog never re-appears; this returns the
   cached granted level synchronously).
2. Pushes the result into `useGpsStore.permissionStatus`.
3. On `'denied' | 'undetermined' → 'always' | 'when_in_use'` edge:
   - Fires a one-shot `Toast.show({type: 'success', text1: 'Location
access enabled — thanks!'})`.
   - When `enabled === true` (same gate `useGpsLifecycle` uses), calls
     `bgGeolocation.start()` directly. **This is necessary** because
     adding `permissionStatus` to `useGpsLifecycle`'s effect deps
     would create a feedback loop — the effect itself sets
     `permissionStatus`, so listing it would cause infinite re-runs.
     Calling `start()` here is the cleanest decoupling and keeps
     existing `useGpsLifecycle.test.tsx` untouched (kickoff
     constraint).

The previous status is tracked in a ref, not state, so the edge-
detection doesn't trigger re-renders. Initialised to `null` so the
first poll doesn't fire the toast (a fresh launch with a granted
permission shouldn't toast).

`AppState` subscription cleanup is synchronous via `sub.remove()`
(RN ignores async cleanup functions). Same pattern as
`useDriverEarningsViewModel`'s AppState listener (Phase 6 Turn 4).

### 4. AppContent integration

`src/presentation/AppContent.tsx`. New hook mount alongside the
existing `useGpsLifecycle`:

```tsx
useGpsLifecycle({ enabled, userId: user?.id ?? null, activeRideForGeofence });
usePermissionRefresh({ enabled });
```

Same `enabled` predicate threaded through. JSDoc explains the
architectural split (why the refresh path lives in a sibling hook
rather than folded into the lifecycle hook).

### 5. DriverHome integration

`useDriverHomeViewModel` surfaces `bgPermissionDenied: boolean` (via
`useGpsPermissionStatus()` selector → `=== 'denied'`) and
`onOpenSettings: () => void`. The `onToggleOnline` callback gates
defensively: returns early when `bgPermissionDenied === true` (defense
in depth — the screen also disables the toggle).

`DriverHomeScreen.tsx` mounts the banner inside the bottom action
panel above the no-active-vehicle / active-vehicle / toggle stack.
The toggle's `canToggle` flag becomes `vm.status === 'ready' &&
!vm.bgPermissionDenied`.

### 6. RideMonitor integration

`useRideMonitorViewModel` surfaces `bgPermissionDenied: boolean`
(true only when status is `'dispatched'` or `'started'` AND the BG
permission is denied) and `onOpenSettings: () => void`.

`RideMonitorScreen.tsx` mounts the banner as a sibling above the
bottom-sheet, anchored to the top safe area. Visible across all
status views during the gated window — the status-router doesn't
need to know about permission state.

### 7. ESLint boundaries-rule override

`usePermissionRefresh.ts` added to the architectural-exception list
in `eslint.config.js`. Mirrors the precedent set by
`useGpsLifecycle.ts` / `useGpsStore.ts` (Phase 7 Turn 2) and
`useNavigationSdkConnector.ts` / `useDriverNavigationViewModel.ts`
(Phase 8 Turn 2): the file is a presentation-layer SDK seam that
type-imports `BackgroundGeolocationClient` /
`BgPermissionStatus` from the data layer for the call signature and
the branded permission union.

### 8. Notable design call — banner condition

The banner fires on `permissionStatus === 'denied'` only — NOT the
broader `!== 'always' && !== 'when_in_use'` from the kickoff prompt.
That broader condition would catch `'undetermined'` and flash a
banner during the brief window before the OS dialog appears.
`'denied'` is the only state where `Linking.openSettings()` is the
right CTA — re-prompting via `requestPermission()` returns the
cached denied state synchronously without re-triggering the dialog.
For `'undetermined'`, `useGpsLifecycle` fires the OS dialog on next
`enabled === true`; deep-linking to Settings before the user has
been asked would be confusing.

## What's out

- **iOS Settings sub-pane deep-link.** `Linking.openSettings()` opens
  the app's Settings page; a more granular deep-link
  (`App-Prefs:Privacy&path=LOCATION`) is iOS-only and brittle across
  versions.
- **In-app permission education flow.** Modal sequence ("here's why
  we need GPS, here's how it's used, are you ready?") before showing
  the OS dialog. Larger UX project — this turn surfaces the recovery
  path only.
- **`'when_in_use'` vs `'always'` distinction.** Foreground-only
  permission degrades the geofence pipeline; the banner copy could
  prompt for the upgrade. Defer until field telemetry shows the
  difference matters.
- **Notification-permission denial recovery.** Out of scope for this
  turn — Phase 9 Turn 2's soft-ask sheet handles the initial prompt;
  a "Settings" affordance for declined notifications is a separate
  follow-up.
- **One-shot dismissable on RiderHome** (kickoff Q3 option (c)). Not
  implemented; the banner re-appears as long as the trip status
  warrants it.
- **Folding the foreground (`useCurrentLocation`) and background
  (`useGpsStore`) permission paths.** DriverHome's existing
  `'permission_denied'` status branch reads the foreground permission
  from `useCurrentLocation`; the new `bgPermissionDenied` reads the
  background permission. On iOS they're coupled via the same OS
  dialog; on Android post-10 they're separate prompts. Unifying
  them would be a meaningful UX cleanup but is out of band.

## Test deltas

| Suite                                   | Before | After | Δ   |
| --------------------------------------- | ------ | ----- | --- |
| `PermissionDeniedBanner.test.tsx` (new) | 0      | 5     | +5  |
| `useOpenSettings.test.ts` (new)         | 0      | 3     | +3  |
| `usePermissionRefresh.test.tsx` (new)   | 0      | 7     | +7  |
| `useDriverHomeViewModel.test.tsx`       | 11     | 17    | +6  |
| `useRideMonitorViewModel.test.tsx`      | 21     | 26    | +5  |

Total: **+3 suites / +26 tests** (181/1573 → 184/1599).

## Acceptance

```
npm run typecheck        ✅ green
node node_modules/eslint/bin/eslint.js .   ✅ green
npm run format:check     ✅ green
npm test (chunked)       ✅ 184 suites / 1599 tests passing
```

No native rebuild required (`Linking.openSettings()` works on both
platforms without any plugin/permission setup; no new dependencies).

## Smoke checklist (user-driven)

Real-device or simulator validation requires actually denying the OS
permission and grant-via-Settings round-trip:

1. Sign in as a fully-registered driver.
2. **First-launch decline path:** when the OS location dialog
   appears, tap "Don't Allow". Expected:
   - The bottom panel on DriverHome shows the
     `<PermissionDeniedBanner/>` ("Location access is off").
   - The "Go online" toggle is greyed out / non-interactive.
   - Tapping the toggle does nothing (defense-in-depth).
3. Tap "Open settings" — expected: native Settings opens to the
   YeRide app's permissions page.
4. Toggle Location → Allow While Using App (or Always). Return to
   YeRide.
5. **Recovery path:** within a second of returning, expected:
   - Success toast: "Location access enabled — thanks!"
   - Banner disappears.
   - Toggle becomes interactive.
   - Tapping "Go online" succeeds.
6. **Rider banner:** sign in as a rider, accept a ride request that
   reaches `'dispatched'`. Verify the banner appears above the
   bottom-sheet ONLY when permission is denied AND the trip is
   `'dispatched'` or `'started'`. Pre-dispatch (`'awaiting_driver'`)
   should NOT show the banner even if permission is denied.
7. **Pre-trip silence:** as a rider, deny location at sign-in and
   confirm RiderHome / Activity / Wallet / Profile do NOT surface
   the banner. The rider banner is intentionally trip-status-gated.

## Files added

```
docs/PHASE_9_TURN_10.md                                              (this file)
src/presentation/components/permission/PermissionDeniedBanner.tsx
src/presentation/components/permission/index.ts
src/presentation/components/permission/__tests__/PermissionDeniedBanner.test.tsx
src/presentation/hooks/useOpenSettings.ts
src/presentation/hooks/usePermissionRefresh.ts
src/presentation/hooks/__tests__/useOpenSettings.test.ts
src/presentation/hooks/__tests__/usePermissionRefresh.test.tsx
```

## Files touched

```
CLAUDE.md                                                            (top status block + phase-tables row)
eslint.config.js                                                     (boundaries-rule override extends to usePermissionRefresh.ts)
src/presentation/AppContent.tsx                                       (mount usePermissionRefresh)
src/presentation/features/driver/screens/DriverHomeScreen.tsx         (banner + toggle gating)
src/presentation/features/driver/view-models/useDriverHomeViewModel.ts (bgPermissionDenied + onOpenSettings + onToggleOnline gate)
src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx (gating tests)
src/presentation/features/rider/screens/RideMonitorScreen.tsx          (banner)
src/presentation/features/rider/view-models/useRideMonitorViewModel.ts (bgPermissionDenied + onOpenSettings)
src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx (gating tests)
src/presentation/hooks/index.ts                                       (export new hooks)
```
