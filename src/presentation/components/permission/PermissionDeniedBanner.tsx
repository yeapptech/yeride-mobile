import { Pressable, Text, View } from 'react-native';

/**
 * Surfaces the OS-denied location-permission state with an "Open
 * Settings" CTA so the user has a path to recover. Pure presentational
 * — no DI, no store reads, no SDK calls. Wire it from a screen or
 * view-model that owns the state, mirroring the
 * `<NotificationPermissionSheet/>` pattern from Phase 9 turn 2.
 *
 * When to mount (Phase 9 turn 10):
 *   - **DriverHome** — gate visibility on
 *     `useGpsPermissionStatus() === 'denied' && !noActiveVehicle`. The
 *     online toggle should ALSO be disabled in this state (defense in
 *     depth — `useGpsLifecycle.enabled` already gates the SDK on a
 *     granted permission, but a disabled toggle is a clearer signal
 *     than a no-op tap).
 *   - **RideMonitor** — gate on `useGpsPermissionStatus() === 'denied'
 *     && ['dispatched','started'].includes(ride.status)`. Mount as a
 *     sibling above the bottom-sheet so it stays visible across all
 *     status views (the status-router shouldn't have to know about
 *     permission state).
 *
 * Banner condition is `=== 'denied'` only (NOT
 * `!== 'always' && !== 'when_in_use'` which would catch
 * `'undetermined'`):
 *
 *   - `'undetermined'` — pre-OS-dialog. `useGpsLifecycle` will fire
 *     `requestAuthorizationIfNeeded()` next time `enabled` flips
 *     true; `Linking.openSettings()` is the wrong CTA here.
 *   - `'denied'` — OS one-shot is exhausted; re-calling
 *     `requestPermission()` returns `'denied'` synchronously without
 *     re-triggering the dialog. Settings is the only path back.
 *   - `'when_in_use'` / `'always'` — granted; nothing to surface.
 *
 * Test boundary: every callback (onOpenSettings, onDismiss) is a prop,
 * and the banner contains no business logic — render-only assertions
 * cover the surface.
 */
export interface PermissionDeniedBannerProps {
  /**
   * Headline text — short, role-appropriate.
   * Example (driver): "Location access is off"
   * Example (rider):  "We can't see where you are"
   */
  readonly title: string;
  /**
   * Body text — explain WHY the app needs location and what flips on
   * once the user grants it. Two-line max for visual weight parity
   * with the `'permission_denied'` branch on DriverHome.
   */
  readonly message: string;
  /**
   * Tap handler for the primary CTA. The mounting screen wires this
   * to `useOpenSettings()` so the test surface only needs to mock one
   * point (`Linking.openSettings`).
   */
  readonly onOpenSettings: () => void;
  /**
   * Optional dismiss handler. Currently unused by both DriverHome and
   * RideMonitor (the banner re-appears as long as permission is
   * denied — the user can't dismiss away the underlying state). Kept
   * in the surface for a future "dismissable on RiderHome" variant
   * (kickoff Q3 option (c)) and for symmetry with
   * `<NotificationPermissionSheet/>`.
   */
  readonly onDismiss?: () => void;
  readonly testID?: string;
}

export function PermissionDeniedBanner({
  title,
  message,
  onOpenSettings,
  onDismiss,
  testID,
}: PermissionDeniedBannerProps) {
  return (
    <View
      // bg-warning/10 + text-warning matches the existing
      // `'permission_denied'` and `'out_of_coverage'` banners on
      // DriverHome / RiderHome (semantic tokens from
      // docs/DESIGN_SYSTEM.md). Keeps the visual language
      // consistent with the rest of the location-related UI.
      className="rounded-lg bg-warning/10 p-3"
      testID={testID ?? 'permission-denied-banner'}
      accessibilityRole="alert"
    >
      <Text className="text-sm font-medium text-warning">{title}</Text>
      <Text className="mt-0.5 text-xs text-warning">{message}</Text>

      <View className="mt-2 flex-row items-center gap-2">
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          testID={
            testID
              ? `${testID}-open-settings`
              : 'permission-denied-open-settings'
          }
          className="self-start rounded-md bg-warning/20 px-3 py-1"
        >
          <Text className="text-sm font-medium text-warning">
            Open settings
          </Text>
        </Pressable>

        {onDismiss !== undefined && (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            testID={testID ? `${testID}-dismiss` : 'permission-denied-dismiss'}
            className="self-start rounded-md px-3 py-1"
          >
            <Text className="text-sm text-muted-foreground">Not now</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
