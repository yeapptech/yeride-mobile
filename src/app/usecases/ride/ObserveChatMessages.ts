import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { RideId } from '@domain/entities/RideId';
import type { ChatRepository } from '@domain/repositories';

/**
 * Live subscription to the full chat thread for a given ride
 * (`trips/{rideId}/messages/{messageId}`). Subscription-shaped — synchronous
 * unsubscribe. Same pattern as `ObserveTripEvents` and `ObserveRide`.
 *
 *   const unsubscribe = observeChatMessages.execute({
 *     rideId,
 *     callback: (messages) => { ... },
 *   });
 *   // later:
 *   unsubscribe();
 *
 * Used by the rider + driver chat surfaces to drive the gifted-chat
 * message list. Messages emit in `createdAt`-DESCENDING order
 * (gifted-chat renders bottom-up). Per-doc validation failures are
 * skipped at the adapter boundary so a single legacy / corrupt doc
 * never poisons the stream.
 */
export class ObserveChatMessages {
  constructor(private readonly repo: ChatRepository) {}

  execute(args: {
    rideId: RideId;
    callback: (messages: readonly ChatMessage[]) => void;
  }): () => void {
    return this.repo.observeMessages(args);
  }
}
