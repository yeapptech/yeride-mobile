import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

import type { UserId } from './UserId';

/**
 * Chat-thread message id. Branded so a `ChatMessageId` can never be passed
 * where a `RideId` or `UserId` is expected.
 *
 * Legacy yeride writes one message doc per `add()` call on
 * `trips/{tripId}/messages`, so the id is a Firestore auto-id (20-char
 * alphanumeric). The rewrite mints the id client-side via
 * `firestore().collection(...).doc().id` BEFORE the write so the message can
 * be inserted optimistically into the gifted-chat list. Either path lands at
 * the same on-disk shape; the constraint here mirrors `RideId` (loose
 * Firestore-doc-safe charset, 6..64 chars).
 */
export type ChatMessageId = Brand<string, 'ChatMessageId'>;

const CHAT_MESSAGE_ID_MIN_LEN = 6;
const CHAT_MESSAGE_ID_MAX_LEN = 64;
const FIRESTORE_DOC_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export const ChatMessageId = {
  create(value: string): Result<ChatMessageId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'chat_message_id_not_a_string',
          message: 'ChatMessageId must be a string',
          field: 'chatMessageId',
        }),
      );
    }
    if (
      value.length < CHAT_MESSAGE_ID_MIN_LEN ||
      value.length > CHAT_MESSAGE_ID_MAX_LEN
    ) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_id_invalid_length',
          message: `ChatMessageId must be ${String(CHAT_MESSAGE_ID_MIN_LEN)}–${String(CHAT_MESSAGE_ID_MAX_LEN)} characters`,
          field: 'chatMessageId',
        }),
      );
    }
    if (!FIRESTORE_DOC_ID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_id_invalid_format',
          message:
            'ChatMessageId must contain only Firestore-doc-safe characters (alphanumeric, underscore, hyphen)',
          field: 'chatMessageId',
        }),
      );
    }
    return Result.ok(brand<string, 'ChatMessageId'>(value));
  },
};

/** Domain ceiling for a single chat message body. Riders/drivers exchange
 *  short location-and-status notes; legacy yeride's Cloud Function truncates
 *  the push body at 120 chars but does not cap storage. We cap storage at
 *  1000 — generous enough for dictation-driven paragraphs, mean enough to
 *  reject pathological pastes. The push-truncation logic is server-side
 *  (`yeride-functions/handlers/message-created.js:9`); we don't mirror it
 *  here. */
const MAX_TEXT_LENGTH = 1000;

/**
 * A single message inside a ride's `messages` subcollection.
 *
 * Wire shape on disk (matches legacy yeride for cross-app parity):
 *   {
 *     _id: <client-minted doc id>,
 *     text: <trimmed user input>,
 *     senderId: <UserId>,
 *     createdAt: <server timestamp>,
 *     user: { _id: <UserId>, name: <person name> },
 *   }
 *
 * The redundant `_id` on the doc body (in addition to Firestore's own doc
 * id) is a gifted-chat-ism legacy locked in; the Cloud Function trigger
 * (`onMessageCreated`) reads `msg.user?.name` for the push title and
 * `msg.senderId` to pick the recipient — both fields are mandatory on the
 * write path.
 *
 * Domain rules:
 *   - `text` is non-empty after `.trim()` and ≤ 1000 chars.
 *   - `senderId` is a branded `UserId` (validated upstream).
 *   - `createdAt` is a valid `Date` (NaN-Date rejected).
 *   - `readAt` is `Date | null`; `markRead(at)` evolves immutably.
 */
export class ChatMessage {
  private constructor(
    public readonly id: ChatMessageId,
    public readonly senderId: UserId,
    public readonly text: string,
    public readonly createdAt: Date,
    public readonly readAt: Date | null,
  ) {}

  static create(props: {
    id: ChatMessageId;
    senderId: UserId;
    text: string;
    createdAt: Date;
    readAt?: Date | null;
  }): Result<ChatMessage, ValidationError> {
    if (typeof props.text !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'chat_message_text_not_a_string',
          message: 'ChatMessage.text must be a string',
          field: 'text',
        }),
      );
    }
    const trimmed = props.text.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_empty_text',
          message: 'ChatMessage.text must not be empty or whitespace-only',
          field: 'text',
        }),
      );
    }
    if (trimmed.length > MAX_TEXT_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_text_too_long',
          message: `ChatMessage.text must be ≤ ${String(MAX_TEXT_LENGTH)} characters`,
          field: 'text',
        }),
      );
    }
    if (
      !(props.createdAt instanceof Date) ||
      Number.isNaN(props.createdAt.getTime())
    ) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_invalid_created_at',
          message: 'ChatMessage.createdAt must be a valid Date',
          field: 'createdAt',
        }),
      );
    }
    const readAt = props.readAt ?? null;
    if (
      readAt !== null &&
      (!(readAt instanceof Date) || Number.isNaN(readAt.getTime()))
    ) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_invalid_read_at',
          message: 'ChatMessage.readAt must be null or a valid Date',
          field: 'readAt',
        }),
      );
    }
    return Result.ok(
      new ChatMessage(
        props.id,
        props.senderId,
        trimmed,
        props.createdAt,
        readAt,
      ),
    );
  }

  /** Immutable evolve — return a new entity with `readAt` set. Validates
   *  the timestamp; rejects NaN-Date with `chat_message_invalid_read_at`. */
  markRead(at: Date): Result<ChatMessage, ValidationError> {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      return Result.err(
        new ValidationError({
          code: 'chat_message_invalid_read_at',
          message: 'ChatMessage.markRead expects a valid Date',
          field: 'readAt',
        }),
      );
    }
    return Result.ok(
      new ChatMessage(this.id, this.senderId, this.text, this.createdAt, at),
    );
  }
}
