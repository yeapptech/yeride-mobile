import type { Brand } from '../shared/Brand';

import type { UserId } from './UserId';

/**
 * Chat-thread message id. Branded so a `ChatMessageId` can never be passed
 * where a `RideId` or `UserId` is expected.
 */
export type ChatMessageId = Brand<string, 'ChatMessageId'>;

/**
 * A single message inside a ride's `messages` subcollection. Read shape only
 * for Phase 3 — the `ObserveLatestMessage` use case returns this (or null
 * for "no messages yet") to drive the chat-button unread dot.
 *
 * Phase 3.5 fills in `SendChatMessage`, `ObserveChatThread`, and
 * `MarkMessagesRead`. For Phase 3 we only need the value shape so the
 * stubbed observer can return `null` against it.
 */
export interface ChatMessage {
  readonly id: ChatMessageId;
  readonly senderId: UserId;
  readonly text: string;
  readonly createdAt: Date;
  /**
   * `null` until the recipient opens the thread; set by `MarkMessagesRead`
   * (Phase 3.5). The chat-button unread dot is gated on
   * `latestMessage.readAt === null && latestMessage.senderId !== self`.
   */
  readonly readAt: Date | null;
}
