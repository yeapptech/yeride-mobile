import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { RideId } from '@domain/entities/RideId';
import type { ChatRepository } from '@domain/repositories';

/**
 * Live "most recent message or null" for a ride's chat thread. Drives
 * the chat-button unread dot on the rider + driver trip-monitor surfaces.
 *
 * Subscription-shaped — synchronous unsubscribe. Mirrors
 * `ObserveChatMessages` but with the `.limit(1)` constraint applied
 * at the adapter boundary for efficiency.
 *
 * Phase 3 shipped this use case as a stub that emitted `null` once and
 * never again — the chat backend didn't exist yet. Phase 10 turn 8
 * rewires the body to delegate to `ChatRepository.observeLatestMessage`,
 * so the unread dot now reflects real message arrivals (and the
 * caller's `useChatUiStore.lastReadAt` clears it on open).
 */
export class ObserveLatestMessage {
  constructor(private readonly repo: ChatRepository) {}

  execute(args: {
    rideId: RideId;
    callback: (message: ChatMessage | null) => void;
  }): () => void {
    return this.repo.observeLatestMessage(args);
  }
}
