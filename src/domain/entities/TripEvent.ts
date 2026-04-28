/**
 * An entry in a trip's append-only audit log
 * (`trips/{tripId}/events/{eventId}`). Read-only on the client — written
 * by Cloud Functions on every state transition. Lightweight value object
 * (no behaviour beyond presentation), so we keep it as a type alias rather
 * than a class.
 */
export interface TripEvent {
  /** ISO-string doc id Firestore stores. Stable for sorting. */
  readonly id: string;
  /** Short machine code: 'dispatch', 'started', 'cancelled', etc. */
  readonly type: string;
  /** Human-readable verb: 'Driver accepted', 'Trip cancelled by rider', etc. */
  readonly event: string;
  /** Free-form bag — extras vary by event type (push tokens, source app). */
  readonly extras: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}
