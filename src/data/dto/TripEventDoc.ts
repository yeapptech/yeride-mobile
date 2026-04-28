import { z } from 'zod';

/**
 * Shape of a Firestore `trips/{tripId}/events/{eventId}` document. Append-only
 * audit log of trip-state transitions, written by the rider/driver clients
 * + Cloud Functions and consumed read-only by both sides.
 *
 * Legacy data layout:
 *   - The doc id is a `new Date().toISOString()` string — unique, but NOT
 *     ordered numerically. Don't rely on doc-id sort. Sort by `createdAt`
 *     instead at the consumer.
 *   - `extras` is a free-form bag (`tripId`, `source`, `passengerPushToken`,
 *     `driverPushToken`, etc.). The mapper passes it through as a
 *     `Record<string, unknown>` since each consumer reads its own keys.
 *   - `event` is a human-readable verb ("Driver accepted", "Rider arrived
 *     at pickup", "Trip cancelled by rider"). Free text.
 *   - `type` is a short machine code ("dispatch", "started", "cancelled",
 *     "completed", etc.) used by analytics filters.
 */

export const TripEventDocSchema = z.object({
  type: z.string().min(1).max(64),
  event: z.string().min(1).max(500),
  extras: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
});

export type TripEventDoc = z.infer<typeof TripEventDocSchema>;
