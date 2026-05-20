import { ChatMessage, ChatMessageId } from '@domain/entities/ChatMessage';
import type { PersonName } from '@domain/entities/PersonName';
import type { RideId } from '@domain/entities/RideId';
import type { UserId } from '@domain/entities/UserId';
import { type NetworkError, type ValidationError } from '@domain/errors';
import { ValidationError as ValidationErrorClass } from '@domain/errors/ValidationError';
import type { ChatRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `ChatRepository` for use-case + view-model tests and the
 * fakes-only branch of the DI container.
 *
 * Storage: a `Map<RideId, ChatMessage[]>` keyed by the ride id, ordered
 * by insertion (which is also the natural send-order). All `observe*`
 * subscribers receive the current state synchronously on subscribe to
 * mirror Firestore's `onSnapshot` first-emit semantics.
 *
 * Mirroring the Firestore adapter:
 *   - `observeMessages` emits a defensive copy of the list every time
 *     anything changes, in `createdAt`-DESCENDING order (gifted-chat
 *     renders bottom-up; the Firestore adapter does the same).
 *   - `observeLatestMessage` emits `null` when no messages exist, or the
 *     most-recent `ChatMessage` otherwise.
 *   - `send` allocates a `ChatMessageId`, constructs the entity (via
 *     `ChatMessage.create` — same validation as the real adapter),
 *     appends to the list, notifies observers, returns the entity.
 *   - `markMessagesRead` is a no-op on success (just tracks the call).
 *
 * Test seams:
 *   - `seed(rideId, messages)` populates without going through send.
 *   - `mockNextSendResult({error})` makes the next `send` return a
 *     specific error (use a `NetworkError` or `ValidationError`).
 *   - `mockNextMarkReadResult({error})` for `markMessagesRead`.
 *   - `getMarkReadCallsFor(rideId, role)` returns the count of
 *     `markMessagesRead` calls matching the args.
 *   - `getSentMessages(rideId)` returns the in-memory list.
 *   - `spies` exposes counts + last-args.
 */
export class InMemoryChatRepository implements ChatRepository {
  private messages = new Map<string, ChatMessage[]>();

  private messageObservers = new Map<
    string,
    Set<(messages: readonly ChatMessage[]) => void>
  >();
  private latestObservers = new Map<
    string,
    Set<(message: ChatMessage | null) => void>
  >();

  /** Counts of `markMessagesRead` calls, keyed by `${rideId}:${role}`. */
  private markReadCallCounts = new Map<string, number>();

  private nextSendError: ValidationError | NetworkError | null = null;
  private nextMarkReadError: ValidationError | NetworkError | null = null;

  /** Monotonic id counter so synthesized ChatMessageId values stay unique
   *  across rides without depending on Math.random. */
  private nextSyntheticId = 0;

  public spies = {
    send: 0,
    markMessagesRead: 0,
    lastSendArgs: null as null | {
      rideId: RideId;
      sender: { id: UserId; name: PersonName };
      text: string;
    },
    lastMarkReadArgs: null as null | {
      rideId: RideId;
      role: 'rider' | 'driver';
    },
  };

  /* ────────── seeding / test seams ────────── */

  seed(rideId: RideId, messages: readonly ChatMessage[]): void {
    this.messages.set(String(rideId), [...messages]);
    this.notify(rideId);
  }

  reset(): void {
    this.messages.clear();
    this.markReadCallCounts.clear();
    this.nextSendError = null;
    this.nextMarkReadError = null;
    this.nextSyntheticId = 0;
    this.spies = {
      send: 0,
      markMessagesRead: 0,
      lastSendArgs: null,
      lastMarkReadArgs: null,
    };
    // Don't drop observers — tests that share a single instance across
    // multiple renders rely on them persisting across resets.
  }

  mockNextSendResult(args: { error: ValidationError | NetworkError }): void {
    this.nextSendError = args.error;
  }

  mockNextMarkReadResult(args: {
    error: ValidationError | NetworkError;
  }): void {
    this.nextMarkReadError = args.error;
  }

  getMarkReadCallsFor(rideId: RideId, role: 'rider' | 'driver'): number {
    return this.markReadCallCounts.get(`${String(rideId)}:${role}`) ?? 0;
  }

  getSentMessages(rideId: RideId): readonly ChatMessage[] {
    return this.messages.get(String(rideId)) ?? [];
  }

  /* ────────── ChatRepository ────────── */

  observeMessages(args: {
    rideId: RideId;
    callback: (messages: readonly ChatMessage[]) => void;
  }): () => void {
    const key = String(args.rideId);
    if (!this.messageObservers.has(key)) {
      this.messageObservers.set(key, new Set());
    }
    const set = this.messageObservers.get(key);
    if (set === undefined) {
      // Unreachable — we just set it above. The conditional keeps
      // TypeScript happy under `noUncheckedIndexedAccess`.
      args.callback([]);
      return () => undefined;
    }
    set.add(args.callback);
    // Match Firestore: emit current state synchronously on subscribe.
    args.callback(this.snapshot(args.rideId));
    return () => {
      const s = this.messageObservers.get(key);
      if (s !== undefined) s.delete(args.callback);
    };
  }

  observeLatestMessage(args: {
    rideId: RideId;
    callback: (message: ChatMessage | null) => void;
  }): () => void {
    const key = String(args.rideId);
    if (!this.latestObservers.has(key)) {
      this.latestObservers.set(key, new Set());
    }
    const set = this.latestObservers.get(key);
    if (set === undefined) {
      args.callback(null);
      return () => undefined;
    }
    set.add(args.callback);
    args.callback(this.latestOf(args.rideId));
    return () => {
      const s = this.latestObservers.get(key);
      if (s !== undefined) s.delete(args.callback);
    };
  }

  async send(args: {
    rideId: RideId;
    sender: { id: UserId; name: PersonName };
    text: string;
  }): Promise<Result<ChatMessage, ValidationError | NetworkError>> {
    this.spies.send += 1;
    this.spies.lastSendArgs = args;
    if (this.nextSendError !== null) {
      const error = this.nextSendError;
      this.nextSendError = null;
      return Result.err(error);
    }
    this.nextSyntheticId += 1;
    const rawId = `fake_msg_${String(this.nextSyntheticId).padStart(8, '0')}`;
    const idR = ChatMessageId.create(rawId);
    if (!idR.ok) return idR;
    const msgR = ChatMessage.create({
      id: idR.value,
      senderId: args.sender.id,
      text: args.text,
      createdAt: new Date(),
      readAt: null,
      // Mirror FirestoreChatRepository.send — the optimistic insert
      // carries the local user's display name so peer-rendering in
      // gifted-chat sees a populated bubble label.
      senderName: args.sender.name.full,
    });
    if (!msgR.ok) return msgR;
    const list = this.messages.get(String(args.rideId)) ?? [];
    list.push(msgR.value);
    this.messages.set(String(args.rideId), list);
    this.notify(args.rideId);
    return Result.ok(msgR.value);
  }

  async markMessagesRead(args: {
    rideId: RideId;
    role: 'rider' | 'driver';
  }): Promise<Result<void, ValidationError | NetworkError>> {
    this.spies.markMessagesRead += 1;
    this.spies.lastMarkReadArgs = args;
    if (args.role !== 'rider' && args.role !== 'driver') {
      return Result.err(
        new ValidationErrorClass({
          code: 'chat_invalid_role',
          message: `Invalid role: ${String(args.role)}`,
          field: 'role',
        }),
      );
    }
    if (this.nextMarkReadError !== null) {
      const error = this.nextMarkReadError;
      this.nextMarkReadError = null;
      return Result.err(error);
    }
    const key = `${String(args.rideId)}:${args.role}`;
    this.markReadCallCounts.set(
      key,
      (this.markReadCallCounts.get(key) ?? 0) + 1,
    );
    return Result.ok(undefined);
  }

  /* ────────── internals ────────── */

  /** Snapshot of the message list in `createdAt`-DESCENDING order to
   *  match the Firestore adapter's emission order.
   *
   *  Sort is stable on insertion order — messages added back-to-back
   *  in the same millisecond stay in insertion order (which is also
   *  their semantic order). A naive `(a, b) => b - a` comparator on
   *  equal timestamps would shuffle them based on the engine's sort
   *  algorithm; we tag each entry with its insertion index and use it
   *  as the tiebreaker. */
  private snapshot(rideId: RideId): readonly ChatMessage[] {
    const list = this.messages.get(String(rideId)) ?? [];
    return list
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const dt = b.m.createdAt.getTime() - a.m.createdAt.getTime();
        if (dt !== 0) return dt;
        // Equal timestamps → newer-inserted wins (legacy parity:
        // gifted-chat renders bottom-up by createdAt then by insertion).
        return b.i - a.i;
      })
      .map(({ m }) => m);
  }

  /** Most-recent message by `createdAt`, or null when none exist. */
  private latestOf(rideId: RideId): ChatMessage | null {
    const ordered = this.snapshot(rideId);
    return ordered[0] ?? null;
  }

  /** Notify both observer sets for the given ride. */
  private notify(rideId: RideId): void {
    const key = String(rideId);
    const msgSet = this.messageObservers.get(key);
    if (msgSet !== undefined) {
      const list = this.snapshot(rideId);
      for (const cb of [...msgSet]) cb(list);
    }
    const latestSet = this.latestObservers.get(key);
    if (latestSet !== undefined) {
      const latest = this.latestOf(rideId);
      for (const cb of [...latestSet]) cb(latest);
    }
  }
}
