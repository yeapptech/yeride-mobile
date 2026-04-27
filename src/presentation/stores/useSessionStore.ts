import { create } from 'zustand';

import type { UserId } from '@domain/entities/UserId';

/**
 * Session state tracked here:
 *
 *   - 'initializing' (boot state) — `AppContent` hasn't yet heard back from
 *     Firebase Auth's onAuthStateChanged. Render a splash / loading screen.
 *
 *   - 'unauthenticated' — no user signed in. Show the AuthNavigator.
 *
 *   - 'needs-verification' — user is signed in via Firebase Auth, but their
 *     email isn't verified yet. Show the EmailVerification screen as a
 *     dedicated stack so the rest of the app can't be reached. The user can
 *     click "Use a different account" to sign out and return to AuthStack.
 *
 *   - 'authenticated'  — user signed in AND email is verified. We have their
 *     UID. Show the MainNavigator (rider tabs / driver tabs).
 *
 * Notes:
 *   - This store ONLY tracks auth state. The full User profile object is
 *     served by TanStack Query (`useCurrentUserQuery`), seeded from a
 *     Firestore subscription that turns on when status flips to
 *     'authenticated'.
 *   - We deliberately separate `initializing` from `unauthenticated` so the
 *     UI doesn't flash the LogIn screen for users who *are* signed in.
 *     This carries the legacy lesson from CLAUDE.md ("Login flash" / 5-sec
 *     safety timeout).
 *   - All state transitions go through the named action methods (no direct
 *     `set` calls from outside the store) so misuse is hard.
 *   - 'needs-verification' carries a userId because the EmailVerification
 *     screen + view-model need it to call `sendEmailVerification` /
 *     `checkEmailVerified`. The same userId is reused when we flip to
 *     'authenticated' after the email is verified.
 */

export type SessionStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'needs-verification'
  | 'authenticated';

interface SessionState {
  readonly status: SessionStatus;
  readonly userId: UserId | null;

  /** Mark the session as actively being resolved at boot. */
  setInitializing: () => void;

  /**
   * Move to 'needs-verification' state with the given UID. AppContent's auth
   * listener calls this when a user is signed in but `emailVerified` is false.
   */
  setNeedsVerification: (userId: UserId) => void;

  /** Move to authenticated state with the given UID. */
  setSignedIn: (userId: UserId) => void;

  /** Move to unauthenticated state and clear the UID. */
  setSignedOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'initializing',
  userId: null,

  setInitializing: () => set({ status: 'initializing', userId: null }),

  setNeedsVerification: (userId) =>
    set({ status: 'needs-verification', userId }),

  setSignedIn: (userId) => set({ status: 'authenticated', userId }),

  setSignedOut: () => set({ status: 'unauthenticated', userId: null }),
}));

/* ───── Selector hooks ─────
 *
 * Each is a thin wrapper around `useSessionStore` with a selector function,
 * so consumers only re-render when the slice they read changes. Using these
 * is preferred over `useSessionStore()` for performance.
 */

export const useSessionStatus = (): SessionStatus =>
  useSessionStore((s) => s.status);

export const useCurrentUserId = (): UserId | null =>
  useSessionStore((s) => s.userId);

export const useIsAuthenticated = (): boolean =>
  useSessionStore((s) => s.status === 'authenticated');

export const useIsSessionInitializing = (): boolean =>
  useSessionStore((s) => s.status === 'initializing');

export const useNeedsEmailVerification = (): boolean =>
  useSessionStore((s) => s.status === 'needs-verification');
