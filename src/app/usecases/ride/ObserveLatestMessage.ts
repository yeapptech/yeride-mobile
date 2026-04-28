import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { RideId } from '@domain/entities/RideId';

/**
 * Phase 3 stub for the chat-button unread dot. Returns the synchronous
 * `(callback) => unsubscribe` shape the real Phase 3.5 implementation will
 * have, but always emits `null` once and never again.
 *
 * Why this exists in Phase 3:
 *   - `useRideMonitorViewModel` wires the chat unread dot through this use
 *     case so the integration point is real and tested.
 *   - When Phase 3.5 lands, swapping in the live ChatRepository-backed
 *     implementation requires zero changes to the view-model.
 *
 * This is a use case, not a domain interface, so the stub does NOT add an
 * `observeLatestMessage` method to `RideRepository`. Phase 3.5 introduces a
 * dedicated `ChatRepository` and replaces the body of `execute()` to call
 * into it.
 */
export class ObserveLatestMessage {
  execute(args: {
    rideId: RideId;
    callback: (message: ChatMessage | null) => void;
  }): () => void {
    // Phase 3: there is no chat backend yet. Emit `null` synchronously so
    // the consumer can render the un-dotted chat button without a loading
    // flicker.
    args.callback(null);
    return () => {
      // No-op. Phase 3.5 wires real Firestore unsubscribe here.
    };
  }
}
