import { create } from 'zustand';

/**
 * UI-only state for the in-trip chat surface.
 *
 * Phase 3 scope: this store carries the open/closed flag and a
 * `lastReadAt` timestamp the unread-dot derives from. The full chat thread
 * + send/markRead use cases land in Phase 3.5; until then the store
 * remains write-only from the chat-stub button (which sets `isOpen` long
 * enough to show a "Chat lands in Phase 3.5" toast).
 *
 * Why this is separate from `useGeofenceUiStore`:
 *   - Different lifecycles: chat-open is high-frequency (per-tap), banner
 *     visibility is rare. Keeping them split avoids spurious re-renders.
 *   - Phase 3.5 will likely add `unreadCount`, `composing`, and the like
 *     here without touching geofence state.
 *
 * `lastReadAt` is local-only (not persisted across sessions). When Phase
 * 3.5 lands, this becomes a write-through to a Firestore field on the
 * trip's chat thread doc; the local cache remains for offline UX.
 */

interface ChatUiState {
  readonly isOpen: boolean;
  /**
   * Wall-clock time of the last `markRead`. `null` means the rider has
   * never opened the chat in this session.
   */
  readonly lastReadAt: Date | null;

  open: () => void;
  close: () => void;
  /** Record that the user just read the thread. */
  markRead: (at?: Date) => void;
  reset: () => void;
}

const INITIAL = {
  isOpen: false,
  lastReadAt: null,
} as const;

export const useChatUiStore = create<ChatUiState>((set) => ({
  ...INITIAL,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  markRead: (at) => set({ lastReadAt: at ?? new Date() }),
  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useChatIsOpen = (): boolean => useChatUiStore((s) => s.isOpen);

export const useChatLastReadAt = (): Date | null =>
  useChatUiStore((s) => s.lastReadAt);
