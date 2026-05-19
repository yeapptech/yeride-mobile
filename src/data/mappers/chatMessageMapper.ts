import { ChatMessage, ChatMessageId } from '@domain/entities/ChatMessage';
import type { PersonName } from '@domain/entities/PersonName';
import { UserId } from '@domain/entities/UserId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  ChatMessageDocSchema,
  type ChatMessageDoc,
} from '../dto/ChatMessageDoc';

/**
 * Mapper between Firestore `trips/{tripId}/messages/{messageId}` documents
 * and the domain `ChatMessage` value object.
 *
 * Bidirectional, with the canonical-on-write / permissive-on-read pattern
 * used across the project:
 *
 *   - `parseDoc(raw)` runs the Zod DTO schema and returns a parsed
 *     `ChatMessageDoc`. Schema failures surface as `ValidationError`
 *     wrapping the ZodError as `cause`.
 *
 *   - `toDomain(docId, doc)` constructs a `ChatMessage` from the parsed
 *     DTO + the Firestore-assigned doc id. Branded `ChatMessageId` /
 *     `UserId` factories validate the ids on the way through. Empty /
 *     overlong text is rejected at the entity level. A `null` `createdAt`
 *     (Firestore's server-timestamp placeholder during the local
 *     snapshot before the server roundtrip resolves) is replaced with
 *     the current client time so optimistic inserts have a valid Date
 *     until the snapshot re-fires.
 *
 *   - `toDocOnSend({rideId-ignored, messageId, sender, text, serverTimestamp})`
 *     emits the canonical wire shape:
 *
 *       {
 *         _id: <messageId>,
 *         text: <trimmed>,
 *         senderId: <sender.id>,
 *         createdAt: <serverTimestamp sentinel>,
 *         user: { _id: <sender.id>, name: <sender.name.full> },
 *       }
 *
 *     `createdAt` is the Firestore `serverTimestamp()` sentinel value —
 *     NOT a `Date` — because the Cloud Function trigger `onMessageCreated`
 *     depends on server-clock ordering for the "OTHER party gets the
 *     push" semantics. The repository imports `serverTimestamp` from
 *     `@react-native-firebase/firestore` and passes its return value
 *     into this mapper as `serverTimestamp`.
 *
 * Errors are scoped:
 *   - Schema failures → `chat_message_doc_invalid_shape`.
 *   - Branded-id failures → propagated as-is from the brand factory
 *     (e.g. `user_id_invalid_length`).
 *   - Entity-level failures (empty / overlong text, NaN-Date) →
 *     propagated as-is from `ChatMessage.create`.
 */

export function parseDoc(
  raw: unknown,
): Result<ChatMessageDoc, ValidationError> {
  const r = ChatMessageDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'chat_message_doc_invalid_shape',
        message: `ChatMessageDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  docId: string,
  doc: ChatMessageDoc,
  now: () => Date = () => new Date(),
): Result<ChatMessage, ValidationError> {
  const idR = ChatMessageId.create(docId);
  if (!idR.ok) return idR;
  const senderR = UserId.create(doc.senderId);
  if (!senderR.ok) return senderR;
  // `createdAt` can land as `null` during the local-snapshot phase of a
  // freshly-sent message — Firestore's `serverTimestamp()` sentinel
  // resolves on the server roundtrip, not the local insert. Substitute
  // the current client time so the optimistic UI inserts a valid Date;
  // the next snapshot will re-fire with the resolved server timestamp.
  const createdAt = doc.createdAt ?? now();
  return ChatMessage.create({
    id: idR.value,
    senderId: senderR.value,
    text: doc.text,
    createdAt,
    readAt: null,
  });
}

/**
 * Canonical wire shape for a send. Caller supplies the Firestore
 * `serverTimestamp()` sentinel as `serverTimestamp` — DO NOT inline a
 * `new Date()` here, the Cloud Function's ordering semantics depend on
 * the server clock, not the client clock.
 *
 * Returns a plain object suitable for `setDoc(ref, value)`. The caller
 * is expected to have pre-allocated the doc id (`doc(collection).id`)
 * and passes it as `messageId` so the on-disk `_id` field matches.
 */
export function toDocOnSend(args: {
  messageId: string;
  sender: { id: string; name: PersonName };
  text: string;
  serverTimestamp: unknown;
}): {
  _id: string;
  text: string;
  senderId: string;
  createdAt: unknown;
  user: { _id: string; name: string };
} {
  return {
    _id: args.messageId,
    text: args.text,
    senderId: args.sender.id,
    createdAt: args.serverTimestamp,
    user: { _id: args.sender.id, name: args.sender.name.full },
  };
}
