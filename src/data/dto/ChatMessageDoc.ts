import { z } from 'zod';

/**
 * Shape of a Firestore `trips/{tripId}/messages/{messageId}` document.
 * Written exclusively by the rider / driver clients (Firestore rules deny
 * any other writer; updates and deletes are blocked at the rule level too —
 * messages are immutable once sent).
 *
 * Wire-shape conventions to keep in mind:
 *
 *   - `text` is the trimmed user input. The Cloud Function trigger
 *     `onMessageCreated` reads it for the push body (truncating to 120 chars
 *     server-side via `notifications.js:9`); the rewrite never truncates on
 *     read.
 *
 *   - `senderId` is the Firebase Auth UID of whichever party (rider /
 *     driver) sent the message. The Firestore rule
 *     `request.resource.data.senderId == request.auth.uid` enforces this
 *     at the boundary, so the wire-shape is structurally guaranteed.
 *
 *   - `createdAt` is a Firestore `Timestamp` (the rewrite writes
 *     `serverTimestamp()` on send; legacy yeride does the same — see
 *     legacy `ChatModal.js:94`). On read, `@react-native-firebase/firestore`
 *     deserializes Timestamps to a class instance with `.toDate()` /
 *     `.toMillis()` methods. We duck-type and coerce to a JS Date so the
 *     mapper sees a uniform shape — identical pattern to
 *     `SchedulePickupAtSchema` in `RideDoc.ts`.
 *
 *   - `user: {_id, name}` is a gifted-chat compatibility object. The Cloud
 *     Function `onMessageCreated` reads `msg.user?.name` for the push title
 *     (`yeride-functions/handlers/message-created.js:45`). The rewrite
 *     ALWAYS writes this with `name = senderName`; legacy yeride does the
 *     same. Both fields are required on writes; on reads we accept the
 *     legacy `{_id, name}` shape and stay tolerant of any additional
 *     gifted-chat fields (`avatar`, etc.) the legacy SDK may have written.
 *
 *   - `_id` (top-level, redundant with the Firestore doc id) is a
 *     gifted-chat-ism that legacy locked in: `ChatModal.js:91` reads
 *     `message._id` on send. We don't currently consume the field on read
 *     (the mapper uses Firestore's doc id as `ChatMessageId`), but the DTO
 *     accepts it so reads don't fail on legacy docs.
 *
 * The Cloud Function trigger `onMessageCreated` reads three fields from
 * the message doc: `senderId` (to pick the recipient), `text` (for the
 * push body), `user.name` (for the push title). Writing any of these
 * malformed will break server-side push dispatch — the schema below
 * enforces all three on write-time via `ChatMessage.create` ahead of the
 * Firestore call.
 */

/**
 * Permissive accepter for the `createdAt` Firestore `Timestamp` field.
 *
 * On-disk shape is always a `Timestamp` (clients write `serverTimestamp()`
 * on send), but we accept three additional shapes on read:
 *   - `Date` instance — defensive, in case a backfill ever lands one.
 *   - ISO string — defensive, in case a legacy backfill emitted one.
 *   - `null` / missing — yields the synthesized "right now" placeholder
 *     emitted while the local server-timestamp resolves on a fresh send
 *     (Firestore's `serverTimestamp()` returns `null` on the local
 *     snapshot until the server roundtrip lands). The mapper handles this
 *     by emitting the current client time so optimistic inserts have a
 *     valid `createdAt` until the snapshot re-fires with the server clock.
 *
 * Duck-types `Timestamp` by checking BOTH `.toDate()` (method) and
 * `.seconds` (number) — same combined check as `SchedulePickupAtSchema`
 * in `RideDoc.ts`. Single-method duck-types would falsely match unrelated
 * objects with a `.toDate` field.
 */
const ChatMessageCreatedAtSchema = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'string') {
    if (val.length === 0) return null;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: unknown }).toDate === 'function' &&
    'seconds' in val &&
    typeof (val as { seconds: unknown }).seconds === 'number'
  ) {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  return null;
}, z.date().nullable());

const ChatMessageUserSchema = z
  .object({
    _id: z.string().min(1),
    // Permissive on read — legacy / cross-app writers may have stored
    // surprisingly long display names (org-prefixed handles, joined
    // first/last with affiliations, etc.). We don't render the field
    // as-is anyway: the mapper passes it through the entity, and
    // gifted-chat clamps the visible bubble label. An empty name is
    // the only edge that's never useful, so keep `min(1)`.
    name: z.string().min(1),
  })
  .passthrough();

export const ChatMessageDocSchema = z.object({
  /** Trimmed user input; ≤ 1000 chars enforced by domain validation. */
  text: z.string().min(1),
  /** Firebase Auth UID of the sender; enforced server-side via the
   *  `senderId == request.auth.uid` rule. */
  senderId: z.string().min(1),
  /** Firestore `serverTimestamp()` on writes; coerced to `Date | null` on
   *  reads (see `ChatMessageCreatedAtSchema` JSDoc). */
  createdAt: ChatMessageCreatedAtSchema,
  /** Gifted-chat compatibility object. The Cloud Function reads `user.name`
   *  for the push title. */
  user: ChatMessageUserSchema.nullish(),
  /** Gifted-chat-id legacy locked in. Redundant with the Firestore doc id;
   *  declared so Zod doesn't strip it. */
  _id: z.string().min(1).nullish(),
});

export type ChatMessageDoc = z.infer<typeof ChatMessageDocSchema>;
