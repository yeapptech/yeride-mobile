import {
  collection,
  doc,
  getFirestore,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';

import { ChatMessage, ChatMessageId } from '@domain/entities/ChatMessage';
import type { PersonName } from '@domain/entities/PersonName';
import type { RideId } from '@domain/entities/RideId';
import type { UserId } from '@domain/entities/UserId';
import { NetworkError, ValidationError } from '@domain/errors';
import type { ChatRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import * as chatMessageMapper from '../mappers/chatMessageMapper';

const logger = LOG.extend('FirestoreChat');

const TRIPS = 'trips';
const MESSAGES = 'messages';

/**
 * Concrete `ChatRepository` backed by `@react-native-firebase/firestore`.
 *
 * Read paths use `onSnapshot` with `orderBy('createdAt', 'desc')` so the
 * caller (gifted-chat is bottom-up) renders the most-recent message at
 * the top of its list. Per-doc validation failures are logged and
 * skipped — a single legacy / corrupt doc never poisons the stream.
 *
 * Write paths pre-validate via `ChatMessage.create` (catches empty +
 * overlong text before any network hop), then issue a single `setDoc`
 * with the canonical wire shape (see `chatMessageMapper.toDocOnSend`).
 * The doc id is pre-allocated client-side via `doc(collection).id` so
 * the returned domain `ChatMessage` carries a stable id the caller can
 * use for optimistic insert.
 *
 * `markMessagesRead` writes the matching `lastSeenByRiderAt` /
 * `lastSeenByDriverAt` field onto the parent `trips/{rideId}` doc via
 * `updateDoc` (single-field merge — sibling ride state is preserved).
 * Invalid role rejects with `ValidationError` before any network call.
 *
 * Subscription methods return synchronous unsubscribe to satisfy
 * React's effect-cleanup contract.
 *
 * Cloud Function trigger note: `onMessageCreated`
 * (yeride-functions/handlers/message-created.js) fires on the resulting
 * doc create and dispatches a push to the OTHER party. No additional
 * client-side wiring is required for cross-party notifications.
 */
export class FirestoreChatRepository implements ChatRepository {
  private readonly firestore = getFirestore();

  observeMessages(args: {
    rideId: RideId;
    callback: (messages: readonly ChatMessage[]) => void;
  }): () => void {
    const subcoll = collection(
      this.firestore,
      TRIPS,
      String(args.rideId),
      MESSAGES,
    );
    const q = query(subcoll, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const out: ChatMessage[] = [];
        snap.forEach((d) => {
          const parsed = chatMessageMapper.parseDoc(d.data());
          if (!parsed.ok) {
            // Per-doc schema failure — log + skip so one bad doc doesn't
            // hide the whole thread. Stays warn (per-doc reads are
            // expected to surface legacy shape drift; flipping to error
            // would flood Crashlytics on every active chat).
            logger.warn('observeMessages: skipping malformed message doc', {
              rideId: String(args.rideId),
              docId: d.id,
              code: parsed.error.code,
            });
            return;
          }
          const domain = chatMessageMapper.toDomain(d.id, parsed.value);
          if (!domain.ok) {
            logger.warn(
              'observeMessages: skipping message doc that failed entity construction',
              {
                rideId: String(args.rideId),
                docId: d.id,
                code: domain.error.code,
              },
            );
            return;
          }
          out.push(domain.value);
        });
        args.callback(out);
      },
      (e) => {
        // Stream error (network outage, permission flip mid-stream).
        // Surface as an empty list so the UI doesn't hang on a stale
        // thread; the synthetic disconnection mirrors
        // `FirestoreRideRepository.observeById` (Phase 9 turn 11 audit
        // decision — skip Firestore SDK-catch wrappers, stays warn).
        logger.warn('observeMessages error', {
          rideId: String(args.rideId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }

  observeLatestMessage(args: {
    rideId: RideId;
    callback: (message: ChatMessage | null) => void;
  }): () => void {
    const subcoll = collection(
      this.firestore,
      TRIPS,
      String(args.rideId),
      MESSAGES,
    );
    const q = query(subcoll, orderBy('createdAt', 'desc'), fsLimit(1));
    return onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          args.callback(null);
          return;
        }
        const d = snap.docs[0];
        if (!d) {
          args.callback(null);
          return;
        }
        const parsed = chatMessageMapper.parseDoc(d.data());
        if (!parsed.ok) {
          logger.warn(
            'observeLatestMessage: latest doc failed schema validation',
            {
              rideId: String(args.rideId),
              docId: d.id,
              code: parsed.error.code,
            },
          );
          args.callback(null);
          return;
        }
        const domain = chatMessageMapper.toDomain(d.id, parsed.value);
        if (!domain.ok) {
          logger.warn(
            'observeLatestMessage: latest doc failed entity construction',
            {
              rideId: String(args.rideId),
              docId: d.id,
              code: domain.error.code,
            },
          );
          args.callback(null);
          return;
        }
        args.callback(domain.value);
      },
      (e) => {
        logger.warn('observeLatestMessage error', {
          rideId: String(args.rideId),
          code: errCode(e),
        });
        args.callback(null);
      },
    );
  }

  async send(args: {
    rideId: RideId;
    sender: { id: UserId; name: PersonName };
    text: string;
  }): Promise<Result<ChatMessage, ValidationError | NetworkError>> {
    // Pre-allocate the doc id so the optimistic insert + on-disk doc id
    // agree. `doc(subcoll)` without args mints a 20-char Firestore auto-id
    // without writing anything.
    const subcoll = collection(
      this.firestore,
      TRIPS,
      String(args.rideId),
      MESSAGES,
    );
    const ref = doc(subcoll);
    const idR = ChatMessageId.create(ref.id);
    if (!idR.ok) return idR;

    // Pre-validate text + construct the domain message. This catches
    // empty / overlong before any network call. We seed `createdAt` with
    // the local now() so the returned ChatMessage carries a sortable
    // timestamp for the optimistic insert; the next snapshot will re-fire
    // with the resolved server timestamp.
    const now = new Date();
    const msgR = ChatMessage.create({
      id: idR.value,
      senderId: args.sender.id,
      text: args.text,
      createdAt: now,
      readAt: null,
    });
    if (!msgR.ok) return msgR;
    const msg = msgR.value;

    const wire = chatMessageMapper.toDocOnSend({
      messageId: ref.id,
      sender: { id: String(args.sender.id), name: args.sender.name },
      text: msg.text,
      // `serverTimestamp()` returns a FieldValue sentinel — the Cloud
      // Function trigger `onMessageCreated` reads `msg.createdAt` from
      // the resolved server clock to order pushes and we want to keep
      // legacy parity (legacy `ChatModal.js:94` uses the same sentinel).
      serverTimestamp: serverTimestamp(),
    });

    try {
      await setDoc(ref, wire);
      return Result.ok(msg);
    } catch (e) {
      const code = errCode(e);
      // Log at warn — `send` failures land back in the view-model which
      // surfaces a toast to the user. Crashlytics escalation isn't
      // useful for transient send failures (per-message retries are the
      // norm; Cloud Function trigger fires on the eventual successful
      // write, not on every retry).
      logger.warn('send failed', {
        rideId: String(args.rideId),
        code,
      });
      return Result.err(
        new NetworkError({
          code: 'chat_send_failed',
          message: 'Could not send chat message',
          cause: e,
        }),
      );
    }
  }

  async markMessagesRead(args: {
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
    const field =
      args.role === 'rider' ? 'lastSeenByRiderAt' : 'lastSeenByDriverAt';
    const ref = doc(this.firestore, TRIPS, String(args.rideId));
    try {
      await updateDoc(ref, { [field]: serverTimestamp() });
      return Result.ok(undefined);
    } catch (e) {
      // `markMessagesRead` failures are best-effort cleanup — the
      // OTHER party's unread dot fails to clear, but the user-facing
      // chat still works. Stays warn so we don't escalate cleanup
      // failures into Crashlytics non-fatals.
      logger.warn('markMessagesRead failed', {
        rideId: String(args.rideId),
        role: args.role,
        code: errCode(e),
      });
      return Result.err(
        new NetworkError({
          code: 'chat_mark_read_failed',
          message: 'Could not mark messages as read',
          cause: e,
        }),
      );
    }
  }
}

function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return String((e as { code: unknown }).code);
  }
  return 'unknown';
}
