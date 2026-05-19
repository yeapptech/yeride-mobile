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
 *
 * Phase 10 turn 5 — live-ETA telemetry on `tripTracking`:
 *
 *   The legacy `distanceTrackingService` writes a nested
 *   `{distance: {value, text}, duration: {value, text}, calculatedAt}`
 *   shape into the tripTracking blob. The rewrite emits a canonical
 *   flat shape (`distanceMeters`, `durationSeconds`, `updatedAt`) AND
 *   the legacy nested shape — dual-write so legacy yeride clients
 *   reading the same `locations/{uid}` doc keep rendering ETA
 *   correctly during the side-by-side cutover (same rationale as
 *   `userMapper`'s Stripe Connect shape dual-write).
 *
 *   Read-side: `z.preprocess` normalizes both shapes into the
 *   canonical flat schema before validation, so the mapper sees one
 *   stable shape regardless of which app wrote the doc. Preferred
 *   source on conflict is the flat fields.
 */

export const TripTrackingDocSchema = z.object({
  tripId: z.string().min(1),
  tripStatus: z.enum(['dispatched', 'started']),
  destination: z.object({
    type: z.enum(['pickup', 'dropoff']),
    latitude: z.number().finite().gte(-90).lte(90),
    longitude: z.number().finite().gte(-180).lte(180),
  }),
  /**
   * Canonical flat fields (Phase 10 turn 5). All optional — pre-Turn-5
   * legacy docs lacked them entirely, and the moment between trip
   * dispatch and the first NavSdk telemetry callback has the route
   * metadata without the live ETA. `null` and `undefined` are both
   * accepted via `.nullish()` for forward-compat with future writers.
   *
   * `updatedAtMs` is epoch milliseconds (number) for portability — the
   * mapper converts to Date on read; the wire-side ISO string sits
   * alongside it (see `legacyCalculatedAt` below) for legacy parity.
   */
  distanceMeters: z.number().finite().gte(0).nullish(),
  durationSeconds: z.number().finite().gte(0).nullish(),
  updatedAtMs: z.number().finite().gte(0).nullish(),
});

/**
 * Phase 10 turn 5 — preprocessor for `TripTrackingDocSchema` that
 * normalises the legacy nested `{distance, duration, calculatedAt}`
 * shape into the canonical flat fields BEFORE Zod validates.
 *
 * Strategy: copy the input, then for each (canonical, nested) pair,
 * fill the canonical field from the nested one ONLY if the canonical
 * is missing. Flat fields win on conflict (e.g. dual-write doc) —
 * matches the "permissive read / canonical write" convention.
 *
 * Mirrors the same z.preprocess pattern used by
 * `PassengerSnapshotDocSchema.defaultPaymentMethod`.
 */
const tripTrackingPreprocess = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  // distance: {value, text} → distanceMeters
  if (
    (out['distanceMeters'] === undefined || out['distanceMeters'] === null) &&
    out['distance'] &&
    typeof out['distance'] === 'object' &&
    !Array.isArray(out['distance'])
  ) {
    const d = out['distance'] as Record<string, unknown>;
    if (typeof d['value'] === 'number') {
      out['distanceMeters'] = d['value'];
    }
  }

  // duration: {value, text} → durationSeconds
  if (
    (out['durationSeconds'] === undefined || out['durationSeconds'] === null) &&
    out['duration'] &&
    typeof out['duration'] === 'object' &&
    !Array.isArray(out['duration'])
  ) {
    const dr = out['duration'] as Record<string, unknown>;
    if (typeof dr['value'] === 'number') {
      out['durationSeconds'] = dr['value'];
    }
  }

  // calculatedAt: ISO string → updatedAtMs
  if (
    (out['updatedAtMs'] === undefined || out['updatedAtMs'] === null) &&
    typeof out['calculatedAt'] === 'string' &&
    out['calculatedAt'].length > 0
  ) {
    const parsed = Date.parse(out['calculatedAt']);
    if (!Number.isNaN(parsed)) {
      out['updatedAtMs'] = parsed;
    }
  }

  return out;
};

export const TripTrackingDocSchemaWithLegacy = z.preprocess(
  tripTrackingPreprocess,
  TripTrackingDocSchema,
);

export const UserLocationDocSchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  speed: z.number().finite().gte(0).nullish(),
  updatedAt: z.string().min(1),
  tripTracking: TripTrackingDocSchemaWithLegacy.nullish(),
});

export type UserLocationDoc = z.infer<typeof UserLocationDocSchema>;
export type TripTrackingDoc = z.infer<typeof TripTrackingDocSchema>;
