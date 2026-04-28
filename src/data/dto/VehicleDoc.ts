import { z } from 'zod';

/**
 * Shape of a Firestore `vehicles/{vin}` document. Mirrors the legacy
 * yeride schema (see `yeride/src/api/firebase/Vehicle.js`) so the rewrite
 * reads + writes documents the legacy app also processes.
 *
 * Wire-shape conventions:
 *   - VIN is the document id (never duplicated as a field on the doc; the
 *     mapper carries it in via `docId`). Legacy also stores `vin` ON the
 *     doc redundantly — the mapper accepts that field but the canonical
 *     write does not include it (the doc id is the source of truth).
 *   - Date fields (`createdAt`, `updatedAt`, `verifiedAt`, `deletedAt`)
 *     are stored as ISO strings, matching legacy (`new Date().toISOString()`).
 *     The schema accepts strings; the mapper parses them into JS Date.
 *   - `photos` is a map of `{front, back, left, right, interior}` to URL
 *     or null. The legacy default is the all-null shape; older docs may
 *     omit the field entirely — the schema permits that.
 *   - `status` is constrained to the union (incl. 'deleted' for soft-
 *     deletes legacy writes via `deleteVehicle`).
 *   - `eligibleServices` is the derived list of service-tier slugs
 *     (`'economy'`, `'comfort'`, `'luxury'`, `'xl'`, `'deliver'`). The
 *     mapper validates each entry as a `RideServiceId`.
 *   - `vehicleSpecs` is the free-form NHTSA-derived specs blob. Every
 *     field is optional; unknown fields are dropped at parse time.
 *   - `dataSource` distinguishes VIN-decoded vs. manual-entry registrations
 *     (audit trail). Legacy `'manual_entry'` literal preserved.
 *
 * Permissive on read, canonical on write: parsing accepts every legacy
 * field shape the rewrite has ever seen; serialization writes the
 * canonical (newer) shape.
 */

const ISO_DATE = z.string().min(1);

const VehiclePhotosSchema = z
  .object({
    front: z.string().nullish(),
    back: z.string().nullish(),
    left: z.string().nullish(),
    right: z.string().nullish(),
    interior: z.string().nullish(),
  })
  .nullish();

const VehicleEngineSpecsSchema = z
  .object({
    cylinders: z.number().int().nullish(),
    displacementL: z.number().nullish(),
    fuelType: z.string().nullish(),
    configuration: z.string().nullish(),
    model: z.string().nullish(),
    turbo: z.string().nullish(),
  })
  .partial()
  .passthrough()
  .nullish();

const VehicleTransmissionSpecsSchema = z
  .object({
    style: z.string().nullish(),
    speeds: z.number().int().nullish(),
  })
  .partial()
  .passthrough()
  .nullish();

const VehicleSafetySpecsSchema = z
  .object({
    airbagLocations: z.string().nullish(),
    seatBelts: z.string().nullish(),
    abs: z.string().nullish(),
    esc: z.string().nullish(),
    tractionControl: z.string().nullish(),
  })
  .partial()
  .passthrough()
  .nullish();

const VehicleDimensionSpecsSchema = z
  .object({
    doors: z.number().int().nullish(),
    seats: z.number().int().nullish(),
    wheelBase: z.number().nullish(),
    gvwr: z.string().nullish(),
  })
  .partial()
  .passthrough()
  .nullish();

const VehicleManufacturerSpecsSchema = z
  .object({
    manufacturer: z.string().nullish(),
    plantCity: z.string().nullish(),
    plantState: z.string().nullish(),
    plantCountry: z.string().nullish(),
  })
  .partial()
  .passthrough()
  .nullish();

const VehicleSpecsDocSchema = z
  .object({
    engine: VehicleEngineSpecsSchema,
    transmission: VehicleTransmissionSpecsSchema,
    safety: VehicleSafetySpecsSchema,
    dimensions: VehicleDimensionSpecsSchema,
    manufacturer: VehicleManufacturerSpecsSchema,
  })
  .partial()
  .nullish();

export const VehicleDocSchema = z.object({
  /**
   * Legacy stores VIN on the doc redundantly with the doc id. We accept
   * the field but never trust it over the doc id (the mapper passes the
   * doc id explicitly).
   */
  vin: z.string().nullish(),
  status: z.enum(['pending', 'approved', 'rejected', 'suspended', 'deleted']),
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  year: z.number().int().gte(1900).lte(2100),
  trim: z.string().nullish(),
  bodyClass: z.string().nullish(),
  vehicleClass: z.enum(['economy', 'comfort', 'luxury', 'xl']),
  seats: z.number().int().nullish(),
  doors: z.number().int().nullish(),
  eligibleServices: z.array(z.string()).default([]),
  photos: VehiclePhotosSchema,
  stockPhoto: z.string().nullish(),
  vehicleSpecs: VehicleSpecsDocSchema,
  dataSource: z.enum(['vin_decoded', 'manual_entry']).default('vin_decoded'),
  verificationNotes: z.string().nullish(),
  verifiedAt: ISO_DATE.nullish(),
  deletedAt: ISO_DATE.nullish(),
  createdAt: ISO_DATE,
  updatedAt: ISO_DATE.nullish(),
});

export type VehicleDoc = z.infer<typeof VehicleDocSchema>;
export type VehiclePhotosDoc = z.infer<typeof VehiclePhotosSchema>;
export type VehicleSpecsDoc = z.infer<typeof VehicleSpecsDocSchema>;

/**
 * Canonical write shape. `vehicleMapper.toDoc` produces this; it's a
 * subset/refinement of the read shape with no legacy aliases. Use
 * `setDoc { merge: true }` so any forward-compat fields legacy reads but
 * we don't yet model are preserved.
 */
export interface VehicleWriteDoc {
  status: VehicleDoc['status'];
  make: string;
  model: string;
  year: number;
  trim: string | null;
  bodyClass: string | null;
  vehicleClass: VehicleDoc['vehicleClass'];
  seats: number | null;
  doors: number | null;
  eligibleServices: readonly string[];
  photos: {
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    interior: string | null;
  };
  stockPhoto: string | null;
  vehicleSpecs: VehicleSpecsDoc;
  dataSource: VehicleDoc['dataSource'];
  verificationNotes: string | null;
  verifiedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
