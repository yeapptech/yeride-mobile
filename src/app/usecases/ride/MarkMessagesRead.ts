import type { RideId } from '@domain/entities/RideId';
import { ValidationError, type NetworkError } from '@domain/errors';
import type { ChatRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Mark the current viewer's chat read pointer for a ride. Writes the
 * matching `lastSeenByRiderAt` / `lastSeenByDriverAt` field onto the
 * parent `trips/{rideId}` doc with `serverTimestamp()`.
 *
 * The OTHER party's UI uses the parent-doc field (their
 * `lastSeenBy*<self>At` vs. the most-recent message `createdAt`) to
 * derive the unread badge. The local viewer additionally relies on
 * `useChatUiStore.lastReadAt` for instant optimistic dot-clearing —
 * the two mechanisms are complementary, not redundant.
 *
 * Reject an invalid `role` value via the adapter (no leakage from
 * presentation typos). Defense-in-depth here keeps the use case error
 * code stable even when the repo is swapped (e.g. for an
 * `InMemoryChatRepository` test fake) — the same `chat_invalid_role`
 * surfaces either way.
 */
export class MarkMessagesRead {
  constructor(private readonly repo: ChatRepository) {}

  async execute(args: {
    rideId: RideId;
    role: 'rider' | 'driver';
  }): Promise<Result<void, ValidationError | NetworkError>> {
    if (args.role !== 'rider' && args.role !== 'driver') {
      return Result.err(
        new ValidationError({
          code: 'chat_invalid_role',
          message: `Invalid role: ${String(args.role)}; expected 'rider' or 'driver'`,
          field: 'role',
        }),
      );
    }
    return this.repo.markMessagesRead(args);
  }
}
