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
 *   - `lastReadAtByRide` — per-ride wall-clock of the last local
 *     `markRead` call, keyed by `String(RideId)`. The unread-dot memo
 *     on `useRideMonitorViewModel` / `useDriverMonitorViewModel` derives
 *     dot-visibility by comparing the latest message's `createdAt`
 *     against THIS RIDE's entry; bumping `lastReadAtByRide[rideId]` on
 *     chat-open clears the local dot immediately, ahead of the
 *     server-side `lastSeenBy*` write completing.
 *
 *     Per-review (Phase 10 turn 8 follow-up): the previous shape held
 *     a single global `lastReadAt: Date | null`, which carried across
 *     ride boundaries. A driver closing a chat on ride A and then
 *     immediately dispatching to ride B would inherit ride A's
 *     `lastReadAt`, and ride B's first inbound message could be
 *     wrongly hidden if its `createdAt` happened to be older than the
 *     ride-A stamp. Keying by ride id closes the bleed.
 *
 * Why this is separate from `useGeofenceUiStore`:
 *   - Different lifecycles: chat-open is high-frequency (per-tap), banner
 *     visibility is rare. Keeping them split avoids spurious re-renders.
 *   - Phase 10 turn 8 promoted this store from a Phase 3 stub: it carried
 *     just `{isOpen, lastReadAt}` then; the typed `open(rideId)` /
 *     `openRideId` surface lands with the real chat thread.
 *
 * `lastReadAtByRide` is local-only (not persisted across sessions). The
 * authoritative cross-app unread signal is the parent-trip-doc
 * `lastSeenByRiderAt` / `lastSeenByDriverAt` field, written by
 * `ChatRepository.markMessagesRead`. The local mirror exists for
 * instant optimistic dot-clearing.
 */

interface ChatUiState {
  readonly isOpen: boolean;
  readonly openRideId: RideId | null;
  readonly lastReadAtByRide: Readonly<Record<string, Date>>;

  /** Opens the modal for a specific ride. The `rideId` is the signal the
   *  foreground notification handler matches against to suppress banners
   *  for messages on the currently-open thread. */
  open: (rideId: RideId) => void;
  close: () => void;
  /** Record that the user just read the thread for the given ride. */
  markRead: (rideId: RideId, at?: Date) => void;
  reset: () => void;
}

const INITIAL = {
  isOpen: false,
  openRideId: null,
  lastReadAtByRide: Object.freeze({}) as Readonly<Record<string, Date>>,
} as const;

export const useChatUiStore = create<ChatUiState>((set) => ({
  ...INITIAL,

  open: (rideId) => set({ isOpen: true, openRideId: rideId }),
  close: () => set({ isOpen: false, openRideId: null }),
  markRead: (rideId, at) =>
    set((s) => ({
      lastReadAtByRide: {
        ...s.lastReadAtByRide,
        [String(rideId)]: at ?? new Date(),
      },
    })),
  reset: () => set(INITIAL),
}));

/* ───── Selector hooks ───── */

export const useChatIsOpen = (): boolean => useChatUiStore((s) => s.isOpen);

export const useChatOpenRideId = (): RideId | null =>
  useChatUiStore((s) => s.openRideId);

/** Per-ride lastReadAt selector. Returns `null` when this ride has no
 *  recorded read yet — the unread memo treats null as "dot visible if
 *  there's a peer message at all". */
export const useChatLastReadAtForRide = (rideId: RideId): Date | null =>
  useChatUiStore((s) => s.lastReadAtByRide[String(rideId)] ?? null);
