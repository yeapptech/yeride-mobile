import { Money } from '@domain/entities/Money';
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  RideServiceDocSchema,
  type RideServiceDoc,
} from '../dto/RideServiceDoc';

/**
 * One-way mapper: Firestore
 * `serviceAreas/{areaId}/rideServices/{rideServiceId}` doc → domain
 * RideService.
 *
 * Read-only. Admins write via Cloud Functions; client cannot write.
 *
 * Pricing fields in the legacy doc are PLAIN NUMBERS in DOLLARS. The mapper
 * converts to Money (USD, minor units) so business code never touches floats
 * for math. If a price overflows the Money max-cap, we surface that as a
 * ValidationError rather than silently truncating.
 *
 * Seat capacity has two possible legacy field names: `seat` (singular,
 * common in legacy data) and `seatCapacity` (newer alias). We prefer
 * `seatCapacity` if present, fall back to `seat`, and refuse the doc if
 * neither is set.
 */

export function parseRideServiceDoc(
  raw: unknown,
): Result<RideServiceDoc, ValidationError> {
  const r = RideServiceDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'ride_service_doc_invalid_shape',
        message: `RideServiceDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  docId: string,
  areaId: ServiceAreaId,
  doc: RideServiceDoc,
): Result<RideService, ValidationError> {
  const idR = RideServiceId.create(docId);
  if (!idR.ok) return idR;

  const seats = doc.seatCapacity ?? doc.seat;
  if (seats === undefined) {
    return Result.err(
      new ValidationError({
        code: 'ride_service_doc_missing_seats',
        message: 'RideServiceDoc has neither seatCapacity nor seat field',
        field: 'seatCapacity',
      }),
    );
  }

  const baseFareR = Money.fromMajor(doc.baseFare, 'USD');
  if (!baseFareR.ok) return baseFareR;
  const minimumFareR = Money.fromMajor(doc.minimumFare, 'USD');
  if (!minimumFareR.ok) return minimumFareR;
  const cancelationFeeR = Money.fromMajor(doc.cancelationFee, 'USD');
  if (!cancelationFeeR.ok) return cancelationFeeR;
  const costPerKmR = Money.fromMajor(doc.costPerKm, 'USD');
  if (!costPerKmR.ok) return costPerKmR;
  const costPerMinuteR = Money.fromMajor(doc.costPerMinute, 'USD');
  if (!costPerMinuteR.ok) return costPerMinuteR;

  return RideService.create({
    id: idR.value,
    areaId,
    name: doc.name,
    description: doc.description,
    baseFare: baseFareR.value,
    minimumFare: minimumFareR.value,
    cancelationFee: cancelationFeeR.value,
    seatCapacity: seats,
    costPerKm: costPerKmR.value,
    costPerMinute: costPerMinuteR.value,
  });
}
