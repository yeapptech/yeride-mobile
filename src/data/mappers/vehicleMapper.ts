import { RideServiceId } from '@domain/entities/RideServiceId';
import {
  EMPTY_VEHICLE_PHOTOS,
  Vehicle,
  type VehiclePhotos,
  type VehicleProps,
} from '@domain/entities/Vehicle';
import type { VehicleSpecs } from '@domain/entities/VehicleSpecs';
import { Vin } from '@domain/entities/Vin';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  VehicleDocSchema,
  type VehicleDoc,
  type VehicleSpecsDoc,
  type VehicleWriteDoc,
} from '../dto/VehicleDoc';

/**
 * Bidirectional mapper between Firestore `vehicles/{vin}` documents and
 * the domain `Vehicle` entity.
 *
 * `parseVehicleDoc` validates an unknown Firestore blob against the Zod
 * schema, surfacing schema failures as ValidationError.
 *
 * `toDomain` reconstructs a Vehicle from the doc id (the VIN string) plus
 * a parsed VehicleDoc. Returns ValidationError if any value-object
 * factory rejects (defense in depth — most invariants are already
 * enforced by the schema).
 *
 * `toDoc` emits the canonical write shape — never the legacy aliases.
 * Caller uses `setDoc { merge: true }` so forward-compat fields the
 * legacy app may have written (and we don't model yet) are preserved.
 */

/* ─────────────────────────── Parse (raw → DTO) ───────────────── */

export function parseVehicleDoc(
  raw: unknown,
): Result<VehicleDoc, ValidationError> {
  const r = VehicleDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_doc_invalid_shape',
        message: `VehicleDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

/* ─────────────────────────── DTO → domain ─────────────────────── */

/**
 * Construct a domain `Vehicle` from a parsed VehicleDoc + the doc id.
 * The doc id is the VIN string straight off Firestore (legacy convention
 * preserved); we run it through `Vin.create` for check-digit validation.
 */
export function toDomain(
  docId: string,
  doc: VehicleDoc,
): Result<Vehicle, ValidationError> {
  const vinR = Vin.create(docId);
  if (!vinR.ok) return vinR;

  const eligibleR = mapEligibleServices(doc.eligibleServices);
  if (!eligibleR.ok) return eligibleR;

  const createdAtR = parseIsoDate(doc.createdAt, 'createdAt');
  if (!createdAtR.ok) return createdAtR;

  const updatedAtR = doc.updatedAt
    ? parseIsoDate(doc.updatedAt, 'updatedAt')
    : Result.ok(createdAtR.value);
  if (!updatedAtR.ok) return updatedAtR;

  const verifiedAtR = doc.verifiedAt
    ? parseIsoDate(doc.verifiedAt, 'verifiedAt')
    : Result.ok(null as Date | null);
  if (!verifiedAtR.ok) return verifiedAtR;

  const deletedAtR = doc.deletedAt
    ? parseIsoDate(doc.deletedAt, 'deletedAt')
    : Result.ok(null as Date | null);
  if (!deletedAtR.ok) return deletedAtR;

  const props: VehicleProps = {
    vin: vinR.value,
    status: doc.status,
    make: doc.make,
    model: doc.model,
    year: doc.year,
    trim: doc.trim ?? null,
    bodyClass: doc.bodyClass ?? null,
    vehicleClass: doc.vehicleClass,
    seats: doc.seats ?? null,
    doors: doc.doors ?? null,
    eligibleServices: eligibleR.value,
    photos: photosFromDoc(doc.photos),
    stockPhoto: doc.stockPhoto ?? null,
    specs: specsFromDoc(doc.vehicleSpecs),
    dataSource: doc.dataSource,
    verificationNotes: doc.verificationNotes ?? null,
    verifiedAt: verifiedAtR.value,
    deletedAt: deletedAtR.value,
    createdAt: createdAtR.value,
    updatedAt: updatedAtR.value,
  };

  return Vehicle.fromProps(props);
}

/* ─────────────────────────── domain → DTO ─────────────────────── */

export function toDoc(vehicle: Vehicle): VehicleWriteDoc {
  return {
    status: vehicle.status,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    trim: vehicle.trim,
    bodyClass: vehicle.bodyClass,
    vehicleClass: vehicle.vehicleClass,
    seats: vehicle.seats,
    doors: vehicle.doors,
    eligibleServices: vehicle.eligibleServices.map(String),
    photos: {
      front: vehicle.photos.front,
      back: vehicle.photos.back,
      left: vehicle.photos.left,
      right: vehicle.photos.right,
      interior: vehicle.photos.interior,
    },
    stockPhoto: vehicle.stockPhoto,
    vehicleSpecs: specsToDoc(vehicle.specs),
    dataSource: vehicle.dataSource,
    verificationNotes: vehicle.verificationNotes,
    verifiedAt: vehicle.verifiedAt?.toISOString() ?? null,
    deletedAt: vehicle.deletedAt?.toISOString() ?? null,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

/* ─────────────────────────── helpers ──────────────────────────── */

function mapEligibleServices(
  raw: readonly string[],
): Result<readonly RideServiceId[], ValidationError> {
  const out: RideServiceId[] = [];
  for (const slug of raw) {
    const r = RideServiceId.create(slug);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return Result.ok(out);
}

function photosFromDoc(raw: VehicleDoc['photos']): VehiclePhotos {
  if (!raw) return EMPTY_VEHICLE_PHOTOS;
  return {
    front: raw.front ?? null,
    back: raw.back ?? null,
    left: raw.left ?? null,
    right: raw.right ?? null,
    interior: raw.interior ?? null,
  };
}

function specsFromDoc(raw: VehicleSpecsDoc | null | undefined): VehicleSpecs {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  if (raw.engine) {
    out['engine'] = stripUndefined(raw.engine);
  }
  if (raw.transmission) {
    out['transmission'] = stripUndefined(raw.transmission);
  }
  if (raw.safety) {
    out['safety'] = stripUndefined(raw.safety);
  }
  if (raw.dimensions) {
    out['dimensions'] = stripUndefined(raw.dimensions);
  }
  if (raw.manufacturer) {
    out['manufacturer'] = stripUndefined(raw.manufacturer);
  }
  return out as VehicleSpecs;
}

function specsToDoc(specs: VehicleSpecs): VehicleSpecsDoc {
  const out: Record<string, unknown> = {};
  if (specs.engine) out['engine'] = { ...specs.engine };
  if (specs.transmission) out['transmission'] = { ...specs.transmission };
  if (specs.safety) out['safety'] = { ...specs.safety };
  if (specs.dimensions) out['dimensions'] = { ...specs.dimensions };
  if (specs.manufacturer) out['manufacturer'] = { ...specs.manufacturer };
  return out as VehicleSpecsDoc;
}

function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // Convert nulls to undefined-shaped omissions where the domain prefers
    // optional-not-present. Domain VehicleSpecs fields are all optional;
    // we treat null and undefined alike on read.
    if (v !== null && v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

function parseIsoDate(
  iso: string,
  field: string,
): Result<Date, ValidationError> {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_doc_invalid_date',
        message: `${field} is not a valid ISO date string`,
        field,
      }),
    );
  }
  return Result.ok(new Date(ms));
}
