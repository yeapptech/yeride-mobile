import { z } from 'zod';

/**
 * Shape of a Firestore `locations/{userId}` document. Mirrors the legacy
 * yeride schema field-for-field so the rewrite reads + writes documents
 * the legacy app also processes.
 *
 * Field semantics:
 *   - `latitude` / `longitude`: lat/lng pair (decimal degrees).
 *   - `speed`: metres per second from the GPS sensor. Optional — sensors
 *     may not provide it on cold start.
 *   - `updatedAt`: ISO-8601 string (legacy convention; not a Firestore
 *     Timestamp).
 *   - `tripTracking`: present only while the user is the driver of an
 *     active trip. Carries the destination and trip status so the rider's
 *     UI can compute ETA without re-fetching the trip doc.
 *
 * The `tripTracking.destination` shape uses `type` (pickup / dropoff) so
 * the consumer knows which leg is being measured. Cleared (set to
 * undefined) when the trip terminates.
 */

export const TripTrackingDocSchema = z.object({
  tripId: z.string().min(1),
  tripStatus: z.enum(['dispatched', 'started']),
  destination: z.object({
    type: z.enum(['pickup', 'dropoff']),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
  }),
});

export const UserLocationDocSchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  speed: z.number().finite().gte(0).nullish(),
  updatedAt: z.string().min(1),
  tripTracking: TripTrackingDocSchema.nullish(),
});

export type UserLocationDoc = z.infer<typeof UserLocationDocSchema>;
export type TripTrackingDoc = z.infer<typeof TripTrackingDocSchema>;
