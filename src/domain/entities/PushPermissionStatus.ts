/**
 * Resolved status of the user's notification permission.
 *
 * Mirrors the `Notifications.PermissionStatus` shape from
 * `expo-notifications` but stays in the domain layer so use cases /
 * view-models don't import the SDK directly.
 *
 *   - `granted`      — the OS permission prompt has been answered "allow".
 *   - `denied`       — the OS permission prompt has been answered "deny".
 *                      On iOS this is sticky: a denied user has to flip the
 *                      OS Settings toggle to re-grant. On Android the
 *                      permission can be re-prompted (Android 13+).
 *   - `undetermined` — the OS prompt has never been answered. The
 *                      `RegisterPushToken` use case should fire the
 *                      permission flow before reading a token.
 *
 * Provisional / ephemeral iOS states (e.g. `provisional` for delivered-quiet
 * notifications) are intentionally collapsed into `granted` at the data
 * layer to keep the domain enum small. If a future phase needs the
 * provisional state, extend this union with care — every consuming
 * `switch` becomes non-exhaustive.
 */
export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined';
