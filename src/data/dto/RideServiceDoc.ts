import { z } from 'zod';

/**
 * The shape of a Firestore
 * `serviceAreas/{areaId}/rideServices/{rideServiceId}` document.
 *
 * Field-level notes mirroring the legacy yeride data:
 *   - `id`: stored as a field on the doc in addition to the Firestore doc
 *     id. The legacy code keys off either; we prefer the doc id at the
 *     mapper boundary.
 *   - `baseFare / minimumFare / cancelationFee / costPerKm / costPerMinute`
 *     are stored as PLAIN NUMBERS in DOLLARS. The mapper converts to Money
 *     (minor units, USD) on the way into the domain so business code never
 *     touches floats.
 *   - `seat` (legacy field name) is the seat capacity. Aliased via Zod
 *     transform.
 *
 * Read-only — see ServiceAreaDoc.
 */
export const RideServiceDocSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  description: z.string().min(0).max(500).default(''),
  baseFare: z.number().finite().gte(0),
  minimumFare: z.number().finite().gte(0),
  cancelationFee: z.number().finite().gte(0),
  // Legacy field name is `seat` (singular). Accept either.
  seat: z.number().int().gte(1).lte(16).optional(),
  seatCapacity: z.number().int().gte(1).lte(16).optional(),
  costPerKm: z.number().finite().gte(0),
  costPerMinute: z.number().finite().gte(0),
});

export type RideServiceDoc = z.infer<typeof RideServiceDocSchema>;
