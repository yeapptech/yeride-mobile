import type { ChatMessage } from '../entities/ChatMessage';
import type { PersonName } from '../entities/PersonName';
import type { RideId } from '../entities/RideId';
import type { UserId } from '../entities/UserId';
import type { NetworkError, ValidationError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Live read/write access to `trips/{tripId}/messages/{messageId}` documents
 * and to the parent-doc `lastSeenByRiderAt` / `lastSeenByDriverAt` fields
 * used to derive the recipient's unread badge.
 *
 * Subscription methods (`observeMessages`, `observeLatestMessage`) return
 * synchronous unsubscribe functions to satisfy React's effect-cleanup
 * contract. The Phase 3 footgun where the legacy `subscribeToUserLocation`
 * returned a Promise (and forced consumers into `cancelled`-flag dances)
 * was explicitly rewritten away — don't reintroduce async-unsubscribe.
 *
 * Mutation methods (`send`, `markMessagesRead`) return Result-shaped
 * Promises. Pre-validation (empty text, role check) happens at the adapter
 * boundary; defense-in-depth in the use case is fine but optional.
 *
 * Wire shape on `send` (legacy parity — the deployed `onMessageCreated`
 * Cloud Function reads `msg.senderId`, `msg.user.name`, and `msg.text`,
 * and dispatches a push to the OTHER party):
 *
 *   {
 *     _id: <messageId>,                                     // gifted-chat parity
 *     text: <trimmed>,
 *     senderId: <UserId>,
 *     createdAt: FieldValue.serverTimestamp(),
 *     user: { _id: <UserId>, name: <PersonName.value> },
 *   }
 *
 * `markMessagesRead` writes ONE of `lastSeenByRiderAt` /
 * `lastSeenByDriverAt` (selected by `role`) onto the parent `trips/{rideId}`
 * doc using a merge-aware update — this preserves every other ride field
 * (legacy `setDoc { merge: true }` parity; see
 * `FirestoreRideRepository.ts:219`).
 */
export interface ChatRepository {
  /**
   * Live, time-descending message list for the given ride. Emits the full
   * snapshot every time anything changes — gifted-chat re-renders from the
   * full list on every prop change, so there's no value in delta-emit.
   *
   * The adapter ignores any single doc that fails `ChatMessage.create` so a
   * corrupt write (legacy doc missing required fields) never poisons the
   * stream — it just doesn't appear.
   */
  observeMessages(args: {
    rideId: RideId;
    callback: (messages: readonly ChatMessage[]) => void;
  }): () => void;

  /**
   * Live "most recent message or null" for the given ride. Drives the
   * chat-button unread dot on the trip-monitor surfaces. Emits `null`
   * when no messages exist yet (rare — the rider can't open the chat
   * before dispatch, and a fresh trip starts empty).
   */
  observeLatestMessage(args: {
    rideId: RideId;
    callback: (message: ChatMessage | null) => void;
  }): () => void;

  /**
   * Append a new message to `trips/{rideId}/messages`. Pre-validates the
   * `text` via `ChatMessage.create` (empty / overlong are rejected before
   * any network call) and returns the constructed `ChatMessage` on
   * success so callers can optimistically extend their local list.
   *
   * Network failures wrap as `NetworkError`. Validation failures from the
   * entity factory surface as `ValidationError`.
   */
  send(args: {
    rideId: RideId;
    sender: { id: UserId; name: PersonName };
    text: string;
  }): Promise<Result<ChatMessage, ValidationError | NetworkError>>;

  /**
   * Stamp the parent-trip doc with `lastSeenByRiderAt` /
   * `lastSeenByDriverAt: serverTimestamp()`. This is the cross-app
   * unread-badge signal — both legacy yeride and the rewrite read it to
   * clear the OTHER party's unread dot.
   *
   * Rejects an invalid `role` with `ValidationError({code:
   *  'chat_invalid_role'})`. Network failures wrap as `NetworkError`.
   */
  markMessagesRead(args: {
    rideId: RideId;
    role: 'rider' | 'driver';
  }): Promise<Result<void, ValidationError | NetworkError>>;
}
