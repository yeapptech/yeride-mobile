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
import {
  PassengerSnapshot,
  type PassengerPaymentMethod,
} from '@domain/entities/PassengerSnapshot';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
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
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { UserId } from '@domain/entities/UserId';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RideMapper');

import {
  RideDocSchema,
  type CancellationDoc,
  type DropoffEndpointDoc,
  type EmbeddedDirectionsDoc,
  type EndpointAddressField,
  type DriverDoc as LegacyDriverDoc,
  type PassengerDoc as LegacyPassengerDoc,
  type RideServiceEmbeddedDoc as LegacyRideServiceEmbeddedDoc,
  type VehicleSnapshotDoc as LegacyVehicleSnapshotDoc,
  type LegacyPlaceAddress,
  type PickupEndpointDoc,
  type RideDoc,
  type RoutePreferenceDoc,
} from '../dto/RideDoc';

import { normalizeLegacyPhone } from './_shared/normalizeLegacyPhone';

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

  const cancellationR = cancellationFromDoc(doc);
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

  // Legacy Cloud Function writes `'passenger_canceled'` / `'driver_canceled'`
  // for cancelled trips; rewrite domain only knows canonical `'cancelled'`.
  // The `by` distinction is preserved in the cancellation subdoc.
  const normalizedStatus =
    doc.status === 'passenger_canceled' || doc.status === 'driver_canceled'
      ? 'cancelled'
      : doc.status;

  return Ride.fromProps({
    id: idR.value,
    status: normalizedStatus,
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
  const phoneR = PhoneNumber.create(normalizeLegacyPhone(p.phoneNumber));
  if (!phoneR.ok) return phoneR;
  // stripeCustomerId / defaultPaymentMethod parse defensively — a
  // malformed id on disk falls back to null with a warn rather than
  // crashing the whole trip-doc read. Mirrors `userMapper`'s behavior on
  // the user doc's Stripe ids.
  let stripeCustomerId: StripeCustomerId | null = null;
  if (typeof p.stripeCustomerId === 'string' && p.stripeCustomerId.length > 0) {
    const cusR = StripeCustomerId.create(p.stripeCustomerId);
    if (cusR.ok) {
      stripeCustomerId = cusR.value;
    } else {
      logger.warn('passengerToDomain: malformed stripeCustomerId on trip doc', {
        passengerId: p.id,
        code: cusR.error.code,
      });
    }
  }
  let defaultPaymentMethod: PassengerPaymentMethod | null = null;
  if (p.defaultPaymentMethod) {
    const pmR = PaymentMethodId.create(p.defaultPaymentMethod.id);
    if (pmR.ok) {
      defaultPaymentMethod = {
        id: pmR.value,
        type: p.defaultPaymentMethod.type,
      };
    } else {
      logger.warn(
        'passengerToDomain: malformed defaultPaymentMethod.id on trip doc',
        { passengerId: p.id, code: pmR.error.code },
      );
    }
  }
  return PassengerSnapshot.create({
    id: idR.value,
    name: nameR.value,
    email: emailR.value,
    phoneNumber: phoneR.value,
    pushToken: p.pushToken ?? null,
    avatarUrl: p.avatarUrl ?? null,
    stripeCustomerId,
    defaultPaymentMethod,
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
  const phoneR = PhoneNumber.create(normalizeLegacyPhone(d.phoneNumber));
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
  return endpointToDomain(p, 'pickup');
}

function dropoffToDomain(
  d: DropoffEndpointDoc,
): Result<Endpoint, ValidationError> {
  return endpointToDomain(d, 'dropoff');
}

/**
 * Shared pickup/dropoff → domain mapper. Sources coordinates and address
 * from whichever legacy or canonical path is populated:
 *
 *   coords:  top-level lat/lng
 *         → address.geometry.location.{lat,lng}  (legacy Google Places)
 *         → directions.startLocation/endLocation (legacy Routes API)
 *
 *   address: top-level string  (canonical rewrite)
 *         → address.formatted_address           (legacy Places — preferred)
 *         → address.description / .name / .vicinity  (legacy fallbacks)
 *
 * Returns ValidationError when neither source yields a usable value, so
 * the read path skips a partially-filled trip cleanly instead of
 * crashing. The error code distinguishes coords-vs-address misses so
 * downstream observability can spot which legacy field is the gap.
 */
function endpointToDomain(
  e: PickupEndpointDoc | DropoffEndpointDoc,
  kind: 'pickup' | 'dropoff',
): Result<Endpoint, ValidationError> {
  const coords = resolveEndpointCoords(e, kind);
  if (!coords) {
    return Result.err(
      new ValidationError({
        code:
          kind === 'pickup'
            ? 'ride_doc_missing_pickup_coords'
            : 'ride_doc_missing_dropoff_coords',
        message: `${kind} has no resolvable coordinates (top-level / address.geometry / directions.${kind === 'pickup' ? 'startLocation' : 'endLocation'} all empty)`,
        field: kind,
      }),
    );
  }
  const locR = Coordinates.create(coords.lat, coords.lng);
  if (!locR.ok) return locR;

  const addressStr = resolveEndpointAddressString(e.address);
  if (addressStr === null) {
    return Result.err(
      new ValidationError({
        code:
          kind === 'pickup'
            ? 'ride_doc_missing_pickup_address'
            : 'ride_doc_missing_dropoff_address',
        message: `${kind} has no resolvable address string`,
        field: `${kind}.address`,
      }),
    );
  }

  const placeName = resolveEndpointPlaceName(e.address, e.placeName);

  const directionsR = embeddedDirectionsToRoute(e.directions ?? null);
  if (!directionsR.ok) return directionsR;
  return Endpoint.create({
    location: locR.value,
    address: addressStr,
    placeName,
    directions: directionsR.value,
  });
}

function resolveEndpointCoords(
  e: PickupEndpointDoc | DropoffEndpointDoc,
  kind: 'pickup' | 'dropoff',
): { lat: number; lng: number } | null {
  if (typeof e.latitude === 'number' && typeof e.longitude === 'number') {
    return { lat: e.latitude, lng: e.longitude };
  }
  // Try legacy `address.geometry.location.{lat,lng}` (Google Places shape).
  if (
    e.address !== null &&
    e.address !== undefined &&
    isPlaceObject(e.address)
  ) {
    const loc = e.address.geometry?.location;
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
      return { lat: loc.lat, lng: loc.lng };
    }
  }
  // Fall through to embedded directions endpoint coords.
  if (e.directions) {
    const fallback =
      kind === 'pickup' ? e.directions.startLocation : e.directions.endLocation;
    if (
      fallback &&
      typeof fallback.latitude === 'number' &&
      typeof fallback.longitude === 'number' &&
      // Skip the {0,0} placeholder Routes API helper writes for missing
      // endpoints — would silently misplace a pickup at the equator.
      !(fallback.latitude === 0 && fallback.longitude === 0)
    ) {
      return { lat: fallback.latitude, lng: fallback.longitude };
    }
  }
  return null;
}

function resolveEndpointAddressString(
  addr: EndpointAddressField | null | undefined,
): string | null {
  if (typeof addr === 'string') {
    return addr.length > 0 ? addr : null;
  }
  if (addr === null || addr === undefined) return null;
  // Legacy Google Places object — prefer the most specific human-readable
  // string available. Order matches what the legacy app surfaces in UI.
  const candidate =
    addr.formatted_address ?? addr.description ?? addr.name ?? addr.vicinity;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

function resolveEndpointPlaceName(
  addr: EndpointAddressField | null | undefined,
  explicitPlaceName: string | null | undefined,
): string | null {
  if (typeof explicitPlaceName === 'string' && explicitPlaceName.length > 0) {
    return explicitPlaceName;
  }
  if (addr !== null && addr !== undefined && isPlaceObject(addr)) {
    if (typeof addr.name === 'string' && addr.name.length > 0) return addr.name;
  }
  return null;
}

function isPlaceObject(addr: EndpointAddressField): addr is LegacyPlaceAddress {
  return typeof addr === 'object' && addr !== null;
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

/**
 * Build the domain `RideCancellation` from whichever on-disk shape is
 * present. The Cloud Function writes the FLAT legacy shape:
 * `cancelReason` is a top-level *string*, with sibling top-level
 * `canceledBy` / `canceledAt` / `cancelReasonText`. The rewrite's
 * direct-write path uses the nested canonical `CancellationDocSchema`
 * object. See `CancelReasonDocSchema` JSDoc in RideDoc.ts.
 *
 * Returns `null` when no cancellation context is present. Returns a
 * partial best-effort `RideCancellation` when the doc has the legacy
 * status set (`'passenger_canceled'` / `'driver_canceled'`) but the
 * Cloud Function payload was truncated (no top-level `cancelReason`) —
 * we don't want a malformed disk record to crash a live trip read.
 */
function cancellationFromDoc(
  doc: RideDoc,
): Result<RideCancellation | null, ValidationError> {
  const raw = doc.cancelReason;
  if (raw === undefined || raw === null) {
    // No cancel context. Synthesize a minimal one only if the status
    // explicitly says cancelled — otherwise return null (active trip).
    if (
      doc.status === 'passenger_canceled' ||
      doc.status === 'driver_canceled' ||
      doc.status === 'cancelled'
    ) {
      const by =
        doc.canceledBy ??
        (doc.status === 'driver_canceled' ? 'driver' : 'rider');
      // Use `'changed_mind'` as a stub code — it's a common code valid
      // for both rider and driver and doesn't require `reasonText`.
      // We hit this branch only when the doc is malformed (status says
      // cancelled but no reason recorded); preserving the read with a
      // best-effort reason beats crashing the trip read.
      const reasonR = CancellationReason.create({
        code: 'changed_mind' as CancellationReasonCode,
        reasonText: null,
      });
      if (!reasonR.ok) return reasonR;
      return Result.ok({
        reason: reasonR.value,
        by,
        at: doc.canceledAt ? new Date(doc.canceledAt) : new Date(0),
        odometerMeters: null,
      });
    }
    return Result.ok(null);
  }

  if (typeof raw === 'string') {
    // Legacy flat shape: the code lives at the top level as a string;
    // sibling fields carry the rest of the cancellation context.
    const reasonR = CancellationReason.create({
      code: raw as CancellationReasonCode,
      reasonText: doc.cancelReasonText ?? null,
    });
    if (!reasonR.ok) return reasonR;
    const by =
      doc.canceledBy ?? (doc.status === 'driver_canceled' ? 'driver' : 'rider');
    return Result.ok({
      reason: reasonR.value,
      by,
      at: doc.canceledAt ? new Date(doc.canceledAt) : new Date(0),
      odometerMeters: null,
    });
  }

  // Canonical nested shape. The domain enum is the narrow set; if
  // legacy ever wrote an unrecognised code, the CancellationReason
  // factory rejects — we let that bubble up so a garbled doc fails
  // at parse time rather than silently round-tripping.
  const reasonR = CancellationReason.create({
    code: raw.code as CancellationReasonCode,
    reasonText: raw.reasonText ?? null,
  });
  if (!reasonR.ok) return reasonR;
  return Result.ok({
    reason: reasonR.value,
    by: raw.by,
    at: raw.at ? new Date(raw.at) : new Date(0),
    odometerMeters: typeof raw.odometer === 'number' ? raw.odometer : null,
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
    stripeCustomerId: p.stripeCustomerId ? String(p.stripeCustomerId) : null,
    defaultPaymentMethod: p.defaultPaymentMethod
      ? {
          id: String(p.defaultPaymentMethod.id),
          type: p.defaultPaymentMethod.type,
        }
      : null,
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
