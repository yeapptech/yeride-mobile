import { create } from 'zustand';

import type { PushPermissionStatus } from '@domain/entities/PushPermissionStatus';

/**
 * UI state for the notification-permission soft-ask flow.
 *
 * Why this is its own store:
 *   - The current OS permission status is read from the SDK at app
 *     boot; mirroring it here lets the soft-ask sheet and the
 *     `usePushTokenRegistration` hook share a single source of truth
 *     without prop-threading through 5 layers. Same pattern as
 *     `useGpsStore.permissionStatus`.
 *   - The "user soft-dismissed the sheet this session" flag is purely
 *     UI state — not derivable from the SDK, not worth persisting
 *     across launches (re-prompting on next launch is fine; iOS won't
 *     re-show its prompt until the user flips Settings, but our soft-
 *     ask sheet WILL re-show, which is the desired UX).
 *
 * Reset rule: `useNotificationPermissionUiStore.reset()` fires on
 * sign-out so the next sign-in sees a clean slate (especially the
 * soft-dismiss flag).
 *
 * Permission status semantics:
 *   - `undetermined`: OS prompt has never been answered. Soft-ask
 *     sheet eligible to show (subject to `softDismissedAt`).
 *   - `granted`: token registration runs unconditionally on
 *     `usePushTokenRegistration` mount + on every refresh event.
 *   - `denied`: token registration short-circuits in the use case
 *     (no token to read). The soft-ask sheet does NOT re-show in this
 *     state — once denied, the user has to flip Settings (iOS) /
 *     re-prompt themselves on Android 13+. A future polish turn can
 *     add a "go to Settings" CTA.
 */

interface NotificationPermissionUiState {
  readonly permissionStatus: PushPermissionStatus;
  /**
   * Timestamp (ms) when the user tapped "Not now" on the soft-ask
   * sheet, OR null if they haven't dismissed this session. Stored as
   * a timestamp rather than a boolean so a future polish turn can
   * surface "you dismissed N hours ago — try again?" without
   * structural changes to this store.
   */
  readonly softDismissedAt: number | null;

  setPermissionStatus: (status: PushPermissionStatus) => void;
  setSoftDismissed: (now: number) => void;
  /** Reset to defaults — fired on sign-out by AppContent. */
  reset: () => void;
}

const INITIAL = {
  permissionStatus: 'undetermined' as PushPermissionStatus,
  softDismissedAt: null as number | null,
} as const;

export const useNotificationPermissionUiStore =
  create<NotificationPermissionUiState>((set) => ({
    ...INITIAL,

    setPermissionStatus: (status) => set({ permissionStatus: status }),
    setSoftDismissed: (now) => set({ softDismissedAt: now }),

    reset: () => set(INITIAL),
  }));

/* ───── Selector hooks ───── */

export const useNotificationPermissionStatus = (): PushPermissionStatus =>
  useNotificationPermissionUiStore((s) => s.permissionStatus);

export const useNotificationSoftDismissedAt = (): number | null =>
  useNotificationPermissionUiStore((s) => s.softDismissedAt);
