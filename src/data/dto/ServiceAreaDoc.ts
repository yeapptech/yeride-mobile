import { z } from 'zod';

/**
 * The shape of a Firestore `serviceAreas/{areaId}` document, mirroring the
 * legacy yeride schema exactly. Phase 2 turn 1 — see the architectural brief
 * dropped into REFACTOR_PLAN.md.
 *
 * Schema reminders from the legacy data:
 *   - `identifier`: slug stored as a field (e.g. "us-fl-south-florida"), in
 *     addition to the Firestore document id.
 *   - `latitude`, `longitude`, `radius` (metres): a CIRCULAR region.
 *     Polygons are not used.
 *   - `notifyOnEntry / Dwell / Exit`: boolean flags consumed by the
 *     background-geolocation SDK (relevant in Phase 3).
 *
 * Read-only on the client side per Firestore rules — admins write via Cloud
 * Functions. So we only need a parser; no `toDoc` mapper, no write path.
 */
export const ServiceAreaDocSchema = z.object({
  identifier: z.string().min(1).max(80),
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  // Tightened to a sane range. `radius` in the legacy data is metres.
  radius: z.number().finite().gt(0).lte(20_000_000),
  notifyOnEntry: z.boolean().default(true),
  notifyOnDwell: z.boolean().default(false),
  notifyOnExit: z.boolean().default(true),
});

export type ServiceAreaDoc = z.infer<typeof ServiceAreaDocSchema>;
