import { z } from 'zod';

/**
 * Shape of a Firestore `trips/{tripId}` document. Mirrors the legacy yeride
 * schema field-for-field so the rewrite reads + writes documents the legacy
 * app also processes.
 *
 * Wire-shape conventions to keep in mind:
 *   - Money fields (`baseFare`, `minimumFare`, `cancelationFee`,
 *     `costPerKm`, `costPerMinute`, payment.amount) are stored as PLAIN
 *     NUMBERS IN DOLLARS. The mapper converts to `Money` minor units.
 *   - Date fields (`createdDateTime`, `pickup.startedAt`, `dropoff.startedAt`,
 *     etc.) are stored as ISO strings, NOT Firestore Timestamps. Converted
 *     to JS `Date` at the mapper boundary.
 *   - `seat` (singular) is the legacy field name for seat capacity. We
 *     accept it; mappers prefer the newer `seatCapacity` alias if present.
 *   - `pickup.directions` and `dropoff.directions` are embedded route
 *     subobjects with the same shape the Routes API returns — distance/
 *     duration in SI units, encoded polyline, route token, etc.
 *
 * Status is constrained to the union, not a freeform string, so unknown
 * values fail parsing rather than silently round-tripping.
 */

const ISO_DATE = z.string().min(1);

const VehicleSnapshotDocSchema = z.object({
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  year: z.number().int().gte(1900).lte(2100),
  color: z.string().min(1).max(80),
  licensePlate: z.string().min(1).max(40),
  stockPhoto: z.string().nullish(),
  photos: z.array(z.string()).default([]),
});

const PassengerDocSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  pushToken: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  defaultPaymentMethod: z.string().nullish(),
});

const DriverDocSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  stripeAccountId: z.string().min(1),
  pushToken: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  vehicle: VehicleSnapshotDocSchema.nullish(),
});

const RideServiceEmbeddedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  baseFare: z.number().finite().gte(0),
  minimumFare: z.number().finite().gte(0),
  cancelationFee: z.number().finite().gte(0),
  costPerKm: z.number().finite().gte(0),
  costPerMinute: z.number().finite().gte(0),
  // Legacy uses `seat`; newer writers may use `seatCapacity`. Accept both.
  seat: z.number().int().gte(1).lte(16).optional(),
  seatCapacity: z.number().int().gte(1).lte(16).optional(),
});

/**
 * Embedded route directions. The schema is intentionally permissive — the
 * legacy app started writing this object before the rewrite's curated
 * FieldMask was finalised, so older documents are missing fields like
 * `routeToken` or `localizedValues`. Anything not present becomes `null`
 * at the mapper boundary.
 */
const EmbeddedDirectionsSchema = z.object({
  distanceMeters: z.number().finite().gte(0).optional(),
  durationSeconds: z.number().finite().gte(0).optional(),
  distanceText: z.string().optional(),
  durationText: z.string().optional(),
  polyline: z.string().optional(),
  encodedPolyline: z.string().optional(),
  routeToken: z.string().optional(),
  description: z.string().optional(),
  routeLabels: z.array(z.string()).optional(),
  startLocation: z
    .object({
      latitude: z.number().finite(),
      longitude: z.number().finite(),
    })
    .optional(),
  endLocation: z
    .object({
      latitude: z.number().finite(),
      longitude: z.number().finite(),
    })
    .optional(),
  tollInfo: z
    .object({
      estimatedPrice: z
        .array(
          z.object({
            currencyCode: z.string(),
            units: z.string().optional(),
            nanos: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const PickupEndpointDocSchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  address: z.string().min(1).max(500),
  placeName: z.string().nullish(),
  startedAt: ISO_DATE.nullish(),
  completedAt: ISO_DATE.nullish(),
  /** Pickup odometer in METRES at pickup-completion. Legacy field. */
  odometer: z.number().finite().gte(0).nullish(),
  /** Wall-clock seconds dispatched→pickup-completed. Legacy field. */
  elapsedTime: z.number().finite().gte(0).nullish(),
  directions: EmbeddedDirectionsSchema.nullish(),
});

const DropoffEndpointDocSchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  address: z.string().min(1).max(500),
  placeName: z.string().nullish(),
  startedAt: ISO_DATE.nullish(),
  completedAt: ISO_DATE.nullish(),
  odometer: z.number().finite().gte(0).nullish(),
  directions: EmbeddedDirectionsSchema.nullish(),
});

/**
 * Cancellation subdoc. Legacy stores the `by` field as either 'rider' or
 * 'driver'. The `at` field exists on rewrite writes; legacy may not have
 * written it for older trips, so it's optional at parse time.
 */
const CancellationDocSchema = z.object({
  code: z.string().min(1),
  reasonText: z.string().nullish(),
  by: z.enum(['rider', 'driver']),
  at: ISO_DATE.nullish(),
  odometer: z.number().finite().gte(0).nullish(),
});

/**
 * Two on-disk shapes for cancel state co-exist:
 *
 *   1. **Canonical (rewrite writes this)** — `cancelReason` is a nested
 *      `CancellationDocSchema` object containing `code` / `reasonText` /
 *      `by` / `at` / `odometer` together. Direct-write rewrite path.
 *
 *   2. **Legacy (Cloud Function writes this)** — the deployed
 *      `cancelTrip` Cloud Function (yeride-functions) writes a FLAT
 *      shape: `cancelReason` is a top-level *string* (the bare reason
 *      code), and the rest of the cancellation context lives as
 *      sibling top-level fields: `canceledBy`, `canceledAt`,
 *      `cancelReasonText`. The rewrite's `RideRepository.cancel`
 *      delegates to this function, so any cancel-completed ride doc
 *      will land in this shape.
 *
 * Permissive read: accept both via `z.union([string, object])` and let
 * the mapper fold the flat top-level fields into the nested domain
 * `RideCancellation` when the string variant is encountered. The
 * top-level legacy fields (`canceledBy`, `canceledAt`,
 * `cancelReasonText`) need to be declared on `RideDocSchema` because
 * Zod's `z.object()` default-strips unknown keys — we want the mapper
 * to see them. `previousStatus` is also legacy-only; we don't read it,
 * but allowing it through here keeps the schema honest.
 */
const CancelReasonDocSchema = z.union([
  z.string().min(1),
  CancellationDocSchema,
]);

const RoutePreferenceDocSchema = z.object({
  avoidTolls: z.boolean().default(false),
  selectedRouteSummary: z.string().nullish(),
  routeToken: z.string().nullish(),
});

export const RideDocSchema = z.object({
  passenger: PassengerDocSchema,
  driver: DriverDocSchema.nullish(),
  rideService: RideServiceEmbeddedSchema,
  // Status enum accepts BOTH the canonical rewrite value (`'cancelled'`)
  // and the two legacy values written by the Cloud Function
  // (`'passenger_canceled'`, `'driver_canceled'`). The mapper normalizes
  // both legacy values to canonical `'cancelled'` at the domain
  // boundary; the `by` field of the resulting `RideCancellation` carries
  // the rider/driver provenance. See rideMapper.toDomain.
  status: z.enum([
    'awaiting_driver',
    'scheduled',
    'scheduled_driver_accepted',
    'dispatched',
    'started',
    'payment_requested',
    'completed',
    'payment_failed',
    'cancelled',
    'passenger_canceled',
    'driver_canceled',
  ]),
  createdDateTime: ISO_DATE,
  pickup: PickupEndpointDocSchema,
  dropoff: DropoffEndpointDocSchema,
  cancelReason: CancelReasonDocSchema.nullish(),
  // Legacy flat-shape siblings of `cancelReason` — see
  // CancelReasonDocSchema's JSDoc. Declared so Zod doesn't strip them.
  canceledAt: ISO_DATE.nullish(),
  canceledBy: z.enum(['rider', 'driver']).nullish(),
  cancelReasonText: z.string().nullish(),
  previousStatus: z.string().nullish(),
  routePreference: RoutePreferenceDocSchema.nullish(),
});

export type RideDoc = z.infer<typeof RideDocSchema>;
export type EmbeddedDirectionsDoc = z.infer<typeof EmbeddedDirectionsSchema>;
export type PassengerDoc = z.infer<typeof PassengerDocSchema>;
export type DriverDoc = z.infer<typeof DriverDocSchema>;
export type VehicleSnapshotDoc = z.infer<typeof VehicleSnapshotDocSchema>;
export type RideServiceEmbeddedDoc = z.infer<typeof RideServiceEmbeddedSchema>;
export type PickupEndpointDoc = z.infer<typeof PickupEndpointDocSchema>;
export type DropoffEndpointDoc = z.infer<typeof DropoffEndpointDocSchema>;
export type CancellationDoc = z.infer<typeof CancellationDocSchema>;
export type RoutePreferenceDoc = z.infer<typeof RoutePreferenceDocSchema>;
