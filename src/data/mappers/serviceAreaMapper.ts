import { Coordinates } from '@domain/entities/Coordinates';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  ServiceAreaDocSchema,
  type ServiceAreaDoc,
} from '../dto/ServiceAreaDoc';

/**
 * One-way mapper: Firestore `serviceAreas/{areaId}` doc → domain ServiceArea.
 *
 * Read-only. The legacy app's Firestore rules deny client writes to
 * serviceAreas, so the rewrite has no `toDoc`. Admins manage service areas
 * via Cloud Functions.
 *
 * Two-step shape:
 *   1. `parseServiceAreaDoc(raw)` validates an unknown blob from Firestore
 *      and surfaces schema failures as ValidationError.
 *   2. `toDomain(docId, doc)` builds the entity. Total over already-parsed
 *      input.
 */

export function parseServiceAreaDoc(
  raw: unknown,
): Result<ServiceAreaDoc, ValidationError> {
  const r = ServiceAreaDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'service_area_doc_invalid_shape',
        message: `ServiceAreaDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  docId: string,
  doc: ServiceAreaDoc,
): Result<ServiceArea, ValidationError> {
  const idR = ServiceAreaId.create(docId);
  if (!idR.ok) return idR;
  const centerR = Coordinates.create(doc.latitude, doc.longitude);
  if (!centerR.ok) return centerR;
  return ServiceArea.create({
    id: idR.value,
    identifier: doc.identifier,
    center: centerR.value,
    radiusMeters: doc.radius,
    notifyOnEntry: doc.notifyOnEntry,
    notifyOnDwell: doc.notifyOnDwell,
    notifyOnExit: doc.notifyOnExit,
  });
}
