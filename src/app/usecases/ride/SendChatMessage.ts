import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { PersonName } from '@domain/entities/PersonName';
import type { RideId } from '@domain/entities/RideId';
import type { UserId } from '@domain/entities/UserId';
import { ValidationError, type NetworkError } from '@domain/errors';
import type { ChatRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/** Domain-level cap mirroring `ChatMessage.create`'s rule. Centralized
 *  here as a defense-in-depth check so VM-level validation reports the
 *  same error code without round-tripping through the entity. */
const MAX_TEXT_LENGTH = 1000;

/**
 * Append a new message to a ride's chat thread.
 *
 * Pre-validates the trimmed text (empty / whitespace-only / overlong
 * are rejected with the SAME error codes the `ChatMessage.create`
 * factory uses — `chat_message_empty_text` / `chat_message_text_too_long`).
 * The adapter ALSO validates inside `repo.send` via the entity factory,
 * so this layer is strict defense-in-depth: any caller that bypasses
 * the VM still gets a meaningful validation error.
 *
 * On success, the constructed `ChatMessage` is returned so the caller
 * can optimistically extend its local message list while the snapshot
 * re-fires with the resolved server timestamp.
 *
 * The Cloud Function trigger `onMessageCreated`
 * (`yeride-functions/handlers/message-created.js`) fires on the doc
 * write and dispatches a push to the OTHER party — no further wiring
 * required on the client.
 */
export class SendChatMessage {
  constructor(private readonly repo: ChatRepository) {}

  async execute(args: {
    rideId: RideId;
    sender: { id: UserId; name: PersonName };
    text: string;
  }): Promise<Result<ChatMessage, ValidationError | NetworkError>> {
    if (typeof args.text !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'chat_message_text_not_a_string',
          message: 'chat message text must be a string',
          field: 'text',
        }),
      );
    }
    const trimmed = args.text.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_empty_text',
          message: 'chat message text must not be empty',
          field: 'text',
        }),
      );
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_text_too_long',
          message: `chat message text must be ≤ ${String(MAX_TEXT_LENGTH)} characters`,
          field: 'text',
        }),
      );
    }
    return this.repo.send({
      rideId: args.rideId,
      sender: args.sender,
      text: trimmed,
    });
  }
}
