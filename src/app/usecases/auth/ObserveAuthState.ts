import type { AuthObserverState, AuthRepository } from '@domain/repositories';

/**
 * Subscribe to auth-state changes. Differs from the other use cases in this
 * folder because it's inherently subscription-shaped, not request/response —
 * we don't try to force it into an `execute(): Promise<Result>` mould.
 *
 *   const unsubscribe = observeAuthState.execute(state => { ... });
 *   // later:
 *   unsubscribe();
 *
 * Used by `AppContent` to drive the Zustand session store.
 */
export class ObserveAuthState {
  constructor(private readonly auth: AuthRepository) {}

  execute(callback: (state: AuthObserverState | null) => void): () => void {
    return this.auth.observeAuthState(callback);
  }
}
