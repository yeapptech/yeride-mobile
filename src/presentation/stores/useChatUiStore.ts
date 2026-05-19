import { create } from 'zustand';

import type { RideId } from '@domain/entities/RideId';

/**
 * UI-only state for the in-trip chat surface.
 *
 * State shape:
 *   - `isOpen` — whether the chat modal is currently mounted.
 *   - `openRideId` — when open, which trip's thread is being viewed. The
 *     foreground notification handler in `AppContent` reads this to
 *     suppress banner / toast notifications for `chat_message` pushes
 *     whose `tripId` matches the currently-open thread (legacy parity:
 *     legacy `ChatModal.js:18-19` keeps a module-scoped `openChatId` ref
 *     for exactly this purpose; the rewrite uses Zustand for the same
 *     signal).
 *   - `lastReadAt` — wall-clock time of the last local `markRead`. The
 *     unread-dot memo on `useRideMonitorViewModel` /
 *     `useDriverMonitorViewModel` derives dot-visibility by comparing
 *     the latest message's `createdAt` against this timestamp; bumping
 *     `lastReadAt` on chat-open clears the local dot immediately,
 *     ahead of the server-side `lastSeenBy*` write completing.
 *
 * Why this is separate from `useGeofenceUiStore`:
 *   - Different lifecycles: chat-open is high-frequency (per-tap), banner
 *     visibility is rare. Keeping them split avoids spurious re-renders.
 *   - Phase 10 turn 8 promoted this store from a Phase 3 stub: it carried
 *     just `{isOpen, lastReadAt}` then; the typed `open(rideId)` /
 *     `openRideId` surface lands with the real chat thread.
 *
 * `lastReadAt` is local-only (not persisted across sessions). The
 * authoritative cross-app unread signal is the parent-trip-doc
 * `lastSeenByRiderAt` / `lastSeenByDriverAt` field, written by
 * `ChatRepository.markMessagesRead`. The local mirror exists for
 * instant optimistic dot-clearing.
 */

interface ChatUiState {
  readonly isOpen: boolean;
  readonly openRideId: RideId | null;
  readonly lastReadAt: Date | null;

  /** Opens the modal for a specific ride. The `rideId` is the signal the
   *  foreground notification handler matches against to suppress banners
   *  for messages on the currently-open thread. */
  open: (rideId: RideId) => void;
  close: () => void;
  /** Record that the user just read the thread. */
  markRead: (at?: Date) => void;
  reset: () => void;
}

const INITIAL = {
  isOpen: false,
  openRideId: null,
  lastReadAt: null,
} as const;

export const useChatUiStore = create<ChatUiState>((set) => ({
  ...INITIAL,

  open: (rideId) => set({ isOpen: true, openRideId: rideId }),
  close: () => set({ isOpen: false, openRideId: null }),
  markRead: (at) => set({ lastReadAt: at ?? new Date() }),
  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useChatIsOpen = (): boolean => useChatUiStore((s) => s.isOpen);

export const useChatOpenRideId = (): RideId | null =>
  useChatUiStore((s) => s.openRideId);

export const useChatLastReadAt = (): Date | null =>
  useChatUiStore((s) => s.lastReadAt);
