import type { CancellationReasonCode } from '@domain/entities/CancellationReason';
import { CancellationReason } from '@domain/entities/CancellationReason';
import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import {
  Ride,
  type RideCancellation,
  type RideDropoffTiming,
  type RidePickupTiming,
  type RideRoutePreference,
} from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  RideDocSchema,
  type CancellationDoc,
  type DropoffEndpointDoc,
  type EmbeddedDirectionsDoc,
  type DriverDoc as LegacyDriverDoc,
  type PassengerDoc as LegacyPassengerDoc,
  type RideServiceEmbeddedDoc as LegacyRideServiceEmbeddedDoc,
  type VehicleSnapshotDoc as LegacyVehicleSnapshotDoc,
  type PickupEndpointDoc,
  type RideDoc,
  type RoutePreferenceDoc,
} from '../dto/RideDoc';

/**
 * Bidirectional mapper between Firestore `trips/{tripId}` documents and the
 * domain `Ride` entity.
 *
 * `parseRideDoc` validates an unknown blob and returns a typed RideDoc.
 * `toDomain` rebuilds the full Ride entity from a parsed doc + the doc's
 * Firestore id; total over already-validated inputs.
 * `toDoc` converts a Ride back to the wire shape, with Money minor units
 * converted back to plain dollar numbers and Date instances back to ISO
 * strings — exactly the shape legacy yeride writes and reads.
 *
 * The mapper is intentionally robust to legacy field omissions: missing
 * `directions` becomes `null`, missing `seatCapacity` falls back to `seat`,
 * missing `routeToken` becomes empty string, etc. We never throw on a
 * legacy field gap; we surface a ValidationError if a field violates a
 * domain invariant (e.g. malformed email, lat/lng out of range).
 */

/* ─────────────────────────── Parse (raw → DTO) ───────────────── */

export function parseRideDoc(raw: unknown): Result<RideDoc, ValidationError> {
  const r = RideDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'ride_doc_invalid_shape',
        message: `RideDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

/* ─────────────────────────── DTO → domain ───────────────── */

export function toDomain(
  docId: string,
  doc: RideDoc,
): Result<Ride, ValidationError> {
  const idR = RideId.create(docId);
  if (!idR.ok) return idR;

  const passengerR = passengerToDomain(doc.passenger);
  if (!passengerR.ok) return passengerR;

  const driverR = doc.driver ? driverToDomain(doc.driver) : Result.ok(null);
  if (!driverR.ok) return driverR;

  const rideServiceR = rideServiceToDomain(doc.rideService);
  if (!rideServiceR.ok) return rideServiceR;

  const pickupR = pickupToDomain(doc.pickup);
  if (!pickupR.ok) return pickupR;

  const dropoffR = dropoffToDomain(doc.dropoff);
  if (!dropoffR.ok) return dropoffR;

  const cancellationR = doc.cancelReason
    ? cancellationToDomain(doc.cancelReason)
    : Result.ok(null);
  if (!cancellationR.ok) return cancellationR;

  const pickupTiming: RidePickupTiming = {
    startedAt: parseDate(doc.pickup.startedAt),
    completedAt: parseDate(doc.pickup.completedAt),
    odometerMeters:
      typeof doc.pickup.odometer === 'number' ? doc.pickup.odometer : null,
    elapsedSeconds:
      typeof doc.pickup.elapsedTime === 'number'
        ? doc.pickup.elapsedTime
        : null,
  };
  const dropoffTiming: RideDropoffTiming = {
    startedAt: parseDate(doc.dropoff.startedAt),
    completedAt: parseDate(doc.dropoff.completedAt),
    odometerMeters:
      typeof doc.dropoff.odometer === 'number' ? doc.dropoff.odometer : null,
  };

  const routePreference: RideRoutePreference | null = doc.routePreference
    ? routePreferenceToDomain(doc.routePreference)
    : null;

  return Ride.fromProps({
    id: idR.value,
    status: doc.status,
    passenger: passengerR.value,
    driver: driverR.value,
    rideService: rideServiceR.value,
    pickup: pickupR.value,
    dropoff: dropoffR.value,
    createdAt: new Date(doc.createdDateTime),
    pickupTiming,
    dropoffTiming,
    cancellation: cancellationR.value,
    routePreference,
  });
}

function passengerToDomain(
  p: LegacyPassengerDoc,
): Result<PassengerSnapshot, ValidationError> {
  const idR = UserId.create(p.id);
  if (!idR.ok) return idR;
  const nameR = PersonName.create({ first: p.firstName, last: p.lastName });
  if (!nameR.ok) return nameR;
  const emailR = Email.create(p.email);
  if (!emailR.ok) return emailR;
  const phoneR = PhoneNumber.create(p.phoneNumber);
  if (!phoneR.ok) return phoneR;
  return PassengerSnapshot.create({
    id: idR.value,
    name: nameR.value,
    email: emailR.value,
    phoneNumber: phoneR.value,
    pushToken: p.pushToken ?? null,
    avatarUrl: p.avatarUrl ?? null,
    defaultPaymentMethod: p.defaultPaymentMethod ?? null,
  });
}

function driverToDomain(
  d: LegacyDriverDoc,
): Result<DriverSnapshot, ValidationError> {
  const idR = UserId.create(d.id);
  if (!idR.ok) return idR;
  const nameR = PersonName.create({ first: d.firstName, last: d.lastName });
  if (!nameR.ok) return nameR;
  const emailR = Email.create(d.email);
  if (!emailR.ok) return emailR;
  const phoneR = PhoneNumber.create(d.phoneNumber);
  if (!phoneR.ok) return phoneR;
  let vehicle: VehicleSnapshot | null = null;
  if (d.vehicle) {
    const vR = vehicleToDomain(d.vehicle);
    if (!vR.ok) return vR;
    vehicle = vR.value;
  }
  return DriverSnapshot.create({
    id: idR.value,
    name: nameR.value,
    email: emailR.value,
    phoneNumber: phoneR.value,
    stripeAccountId: d.stripeAccountId,
    pushToken: d.pushToken ?? null,
    avatarUrl: d.avatarUrl ?? null,
    vehicle,
  });
}

function vehicleToDomain(
  v: LegacyVehicleSnapshotDoc,
): Result<VehicleSnapshot, ValidationError> {
  return VehicleSnapshot.create({
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    licensePlate: v.licensePlate,
    stockPhoto: v.stockPhoto ?? null,
    photos: v.photos,
  });
}

function rideServiceToDomain(
  s: LegacyRideServiceEmbeddedDoc,
): Result<RideServiceSnapshot, ValidationError> {
  const idR = RideServiceId.create(s.id);
  if (!idR.ok) return idR;
  const seats = s.seatCapacity ?? s.seat;
  if (seats === undefined) {
    return Result.err(
      new ValidationError({
        code: 'ride_doc_missing_seats',
        message: 'rideService has neither `seat` nor `seatCapacity`',
        field: 'rideService.seat',
      }),
    );
  }
  const baseFareR = Money.fromMajor(s.baseFare, 'USD');
  if (!baseFareR.ok) return baseFareR;
  const minimumFareR = Money.fromMajor(s.minimumFare, 'USD');
  if (!minimumFareR.ok) return minimumFareR;
  const cancelationFeeR = Money.fromMajor(s.cancelationFee, 'USD');
  if (!cancelationFeeR.ok) return cancelationFeeR;
  const costPerKmR = Money.fromMajor(s.costPerKm, 'USD');
  if (!costPerKmR.ok) return costPerKmR;
  const costPerMinuteR = Money.fromMajor(s.costPerMinute, 'USD');
  if (!costPerMinuteR.ok) return costPerMinuteR;
  return RideServiceSnapshot.create({
    id: idR.value,
    name: s.name,
    baseFare: baseFareR.value,
    minimumFare: minimumFareR.value,
    cancelationFee: cancelationFeeR.value,
    costPerKm: costPerKmR.value,
    costPerMinute: costPerMinuteR.value,
    seatCapacity: seats,
  });
}

function pickupToDomain(
  p: PickupEndpointDoc,
): Result<Endpoint, ValidationError> {
  const locR = Coordinates.create(p.latitude, p.longitude);
  if (!locR.ok) return locR;
  const directionsR = embeddedDirectionsToRoute(p.directions ?? null);
  if (!directionsR.ok) return directionsR;
  return Endpoint.create({
    location: locR.value,
    address: p.address,
    placeName: p.placeName ?? null,
    directions: directionsR.value,
  });
}

function dropoffToDomain(
  d: DropoffEndpointDoc,
): Result<Endpoint, ValidationError> {
  const locR = Coordinates.create(d.latitude, d.longitude);
  if (!locR.ok) return locR;
  const directionsR = embeddedDirectionsToRoute(d.directions ?? null);
  if (!directionsR.ok) return directionsR;
  return Endpoint.create({
    location: locR.value,
    address: d.address,
    placeName: d.placeName ?? null,
    directions: directionsR.value,
  });
}

function embeddedDirectionsToRoute(
  d: EmbeddedDirectionsDoc | null,
): Result<Route | null, ValidationError> {
  if (d === null) return Result.ok(null);
  // Legacy uses `polyline` for the encoded string; newer writers use
  // `encodedPolyline`. Prefer the newer field if present.
  const encoded =
    typeof d.encodedPolyline === 'string'
      ? d.encodedPolyline
      : typeof d.polyline === 'string'
        ? d.polyline
        : '';
  const startCoords = d.startLocation
    ? Coordinates.create(d.startLocation.latitude, d.startLocation.longitude)
    : Coordinates.create(0, 0);
  if (!startCoords.ok) return startCoords;
  const endCoords = d.endLocation
    ? Coordinates.create(d.endLocation.latitude, d.endLocation.longitude)
    : Coordinates.create(0, 0);
  if (!endCoords.ok) return endCoords;

  let tollPrice: Money | null = null;
  if (
    d.tollInfo?.estimatedPrice &&
    d.tollInfo.estimatedPrice.length > 0 &&
    d.tollInfo.estimatedPrice[0]?.currencyCode === 'USD'
  ) {
    const p = d.tollInfo.estimatedPrice[0];
    const units = Number.parseInt(p.units ?? '0', 10);
    const nanos = typeof p.nanos === 'number' ? p.nanos : 0;
    if (Number.isFinite(units) && units >= 0) {
      const minor = units * 100 + Math.round(nanos / 1e7);
      const m = Money.create(minor, 'USD');
      if (m.ok) tollPrice = m.value;
    }
  }
  return Route.create({
    distanceMeters: d.distanceMeters ?? 0,
    durationSeconds: d.durationSeconds ?? 0,
    distanceText: d.distanceText ?? '',
    durationText: d.durationText ?? '',
    encodedPolyline: encoded,
    startLocation: startCoords.value,
    endLocation: endCoords.value,
    routeLabels: d.routeLabels ?? [],
    tollPrice,
    routeToken: d.routeToken ?? '',
    description: d.description ?? '',
  });
}

function cancellationToDomain(
  c: CancellationDoc,
): Result<RideCancellation, ValidationError> {
  // Legacy stores the code as a freeform string; the domain enum is the
  // narrow set. If legacy ever wrote a code we don't recognise, the
  // CancellationReason factory will reject — we let that bubble up so a
  // garbled doc fails at parse time rather than silently round-tripping.
  const reasonR = CancellationReason.create({
    code: c.code as CancellationReasonCode,
    reasonText: c.reasonText ?? null,
  });
  if (!reasonR.ok) return reasonR;
  return Result.ok({
    reason: reasonR.value,
    by: c.by,
    at: c.at ? new Date(c.at) : new Date(0),
    odometerMeters: typeof c.odometer === 'number' ? c.odometer : null,
  });
}

function routePreferenceToDomain(rp: RoutePreferenceDoc): RideRoutePreference {
  return {
    avoidTolls: rp.avoidTolls,
    selectedRouteSummary: rp.selectedRouteSummary ?? null,
    routeToken: rp.routeToken ?? null,
  };
}

function parseDate(s: string | null | undefined): Date | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ─────────────────────────── domain → DTO ───────────────── */

/**
 * Convert a Ride entity back to the Firestore wire shape — what legacy
 * yeride writes and reads. Money minor units → plain dollar numbers;
 * Date → ISO strings; nulls are omitted from optional fields.
 */
export function toDoc(ride: Ride): RideDoc {
  return {
    passenger: passengerToDoc(ride.passenger),
    ...(ride.driver ? { driver: driverToDoc(ride.driver) } : {}),
    rideService: rideServiceToDoc(ride.rideService),
    status: ride.status,
    createdDateTime: ride.createdAt.toISOString(),
    pickup: pickupToDoc(ride),
    dropoff: dropoffToDoc(ride),
    ...(ride.cancellation
      ? { cancelReason: cancellationToDoc(ride.cancellation) }
      : {}),
    ...(ride.routePreference
      ? { routePreference: routePreferenceToDoc(ride.routePreference) }
      : {}),
  };
}

function passengerToDoc(p: PassengerSnapshot): RideDoc['passenger'] {
  return {
    id: String(p.id),
    firstName: p.name.first,
    lastName: p.name.last,
    email: p.email.value,
    phoneNumber: p.phoneNumber.value,
    pushToken: p.pushToken,
    avatarUrl: p.avatarUrl,
    defaultPaymentMethod: p.defaultPaymentMethod,
  };
}

function driverToDoc(d: DriverSnapshot): NonNullable<RideDoc['driver']> {
  return {
    id: String(d.id),
    firstName: d.name.first,
    lastName: d.name.last,
    email: d.email.value,
    phoneNumber: d.phoneNumber.value,
    stripeAccountId: d.stripeAccountId,
    pushToken: d.pushToken,
    avatarUrl: d.avatarUrl,
    vehicle: d.vehicle ? vehicleToDoc(d.vehicle) : null,
  };
}

function vehicleToDoc(
  v: VehicleSnapshot,
): NonNullable<NonNullable<RideDoc['driver']>['vehicle']> {
  return {
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    licensePlate: v.licensePlate,
    stockPhoto: v.stockPhoto,
    photos: [...v.photos],
  };
}

function rideServiceToDoc(s: RideServiceSnapshot): RideDoc['rideService'] {
  return {
    id: String(s.id),
    name: s.name,
    baseFare: s.baseFare.majorUnits,
    minimumFare: s.minimumFare.majorUnits,
    cancelationFee: s.cancelationFee.majorUnits,
    costPerKm: s.costPerKm.majorUnits,
    costPerMinute: s.costPerMinute.majorUnits,
    seat: s.seatCapacity,
    seatCapacity: s.seatCapacity,
  };
}

function pickupToDoc(ride: Ride): RideDoc['pickup'] {
  return {
    latitude: ride.pickup.location.latitude,
    longitude: ride.pickup.location.longitude,
    address: ride.pickup.address,
    placeName: ride.pickup.placeName,
    startedAt: ride.pickupTiming.startedAt?.toISOString() ?? null,
    completedAt: ride.pickupTiming.completedAt?.toISOString() ?? null,
    odometer: ride.pickupTiming.odometerMeters,
    elapsedTime: ride.pickupTiming.elapsedSeconds,
    directions: ride.pickup.directions
      ? routeToEmbedded(ride.pickup.directions)
      : null,
  };
}

function dropoffToDoc(ride: Ride): RideDoc['dropoff'] {
  return {
    latitude: ride.dropoff.location.latitude,
    longitude: ride.dropoff.location.longitude,
    address: ride.dropoff.address,
    placeName: ride.dropoff.placeName,
    startedAt: ride.dropoffTiming.startedAt?.toISOString() ?? null,
    completedAt: ride.dropoffTiming.completedAt?.toISOString() ?? null,
    odometer: ride.dropoffTiming.odometerMeters,
    directions: ride.dropoff.directions
      ? routeToEmbedded(ride.dropoff.directions)
      : null,
  };
}

function routeToEmbedded(r: Route): EmbeddedDirectionsDoc {
  const out: EmbeddedDirectionsDoc = {
    distanceMeters: r.distanceMeters,
    durationSeconds: r.durationSeconds,
    distanceText: r.distanceText,
    durationText: r.durationText,
    encodedPolyline: r.encodedPolyline,
    routeToken: r.routeToken,
    description: r.description,
    routeLabels: [...r.routeLabels],
    startLocation: {
      latitude: r.startLocation.latitude,
      longitude: r.startLocation.longitude,
    },
    endLocation: {
      latitude: r.endLocation.latitude,
      longitude: r.endLocation.longitude,
    },
  };
  if (r.tollPrice) {
    const dollars = r.tollPrice.minorUnits / 100;
    const units = Math.floor(dollars);
    const nanos = Math.round((dollars - units) * 1e9);
    out.tollInfo = {
      estimatedPrice: [
        {
          currencyCode: 'USD',
          units: String(units),
          nanos,
        },
      ],
    };
  }
  return out;
}

function cancellationToDoc(c: RideCancellation): CancellationDoc {
  return {
    code: c.reason.code,
    reasonText: c.reason.reasonText,
    by: c.by,
    at: c.at.toISOString(),
    odometer: c.odometerMeters,
  };
}

function routePreferenceToDoc(rp: RideRoutePreference): RoutePreferenceDoc {
  return {
    avoidTolls: rp.avoidTolls,
    selectedRouteSummary: rp.selectedRouteSummary,
    routeToken: rp.routeToken,
  };
}
