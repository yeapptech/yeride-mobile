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

/**
 * `schedulePickupAt` accepter for scheduled rides.
 *
 * The on-disk shape is a Firestore `Timestamp`: the deployed Cloud
 * Function `yeride-functions/handlers/trip-created.js:121` reads
 * `tripData.schedulePickupAt.toDate()`, so this field MUST persist
 * as a Timestamp (not the ISO-string convention the rest of
 * `RideDoc`'s date fields use). When the modular Firestore SDK
 * serializes the document for read, `Timestamp` lands as a class
 * instance with `.toDate()` / `.toMillis()` methods on it. We
 * duck-type and coerce to a JS Date so the mapper sees a uniform
 * shape.
 *
 * Permissive on reads:
 *   - Firestore `Timestamp` instance → `Date` (canonical). Identified
 *     by `toDate()` method AND the Firestore-specific numeric
 *     `seconds` field — both must be present to qualify, which keeps
 *     the duck-type from matching an unrelated `{toDate}` object.
 *   - ISO string → `Date` (defensive: tolerates any legacy backfill
 *     or rewrite-side miswrite that emitted an ISO string).
 *   - `null` / missing → `null`.
 *
 * Note: an `instanceof Timestamp` check would be slightly more direct,
 * but requires importing the class from `@react-native-firebase/firestore`
 * — which pulls the native SDK into module-load time for the DTO. The
 * combined-duck-type approach below is sufficiently specific to the
 * Timestamp shape (real Timestamps always carry `seconds`+`nanoseconds`
 * numeric fields) without that import dependency.
 *
 * The output of this preprocess is `Date | null`, fed straight into
 * `rideMapper.toDomain` without further coercion.
 */
const SchedulePickupAtSchema = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'string') {
    if (val.length === 0) return null;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (
    typeof val === 'object' &&
    val !== null &&
    'toDate' in val &&
    typeof (val as { toDate: unknown }).toDate === 'function' &&
    'seconds' in val &&
    typeof (val as { seconds: unknown }).seconds === 'number'
  ) {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  return null;
}, z.date().nullable());

const VehicleSnapshotDocSchema = z.object({
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  year: z.number().int().gte(1900).lte(2100),
  color: z.string().min(1).max(80),
  licensePlate: z.string().min(1).max(40),
  stockPhoto: z.string().nullish(),
  photos: z.array(z.string()).default([]),
});

/**
 * Three on-disk shapes for `passenger.defaultPaymentMethod` co-exist:
 *
 *   1. **Canonical (rewrite writes this post Phase 9 turn 4)** — minimum
 *      shape `{id, type}` carrying the payment-method id and the
 *      `'card' | 'cash'` discriminant. The deployed
 *      `processPaymentForTrip` reads `.id` for the Stripe `/direct-charge`
 *      call and `.type` for cash-vs-card branching; nothing else on the
 *      server side reads off this object.
 *
 *   2. **Legacy yeride** — the FULL Stripe `PaymentMethod` object
 *      (`{id, type, card: {brand, last4, exp_month, exp_year, ...}, ...}`).
 *      The preprocess strips it down to the canonical shape — `.id` and
 *      `.type` are always present on a real Stripe PaymentMethod. See
 *      `RideSelect.handlePaymentMethodSelected` in legacy yeride for the
 *      source of the object shape.
 *
 *   3. **Rewrite pre-Phase-9-turn-4** — a bare id string. The rewrite
 *      shipped with this shape but it never satisfied the deployed
 *      Cloud Function (validator throws on `passenger.stripeCustomerId
 *      is missing`, then would have failed downstream on
 *      `defaultPaymentMethod?.id` being undefined). Treated as `'card'`
 *      since cash rides aren't supported in the rewrite yet.
 *
 * Permissive read across all three; strict write of canonical shape only.
 */
const PassengerDefaultPaymentMethodSchema = z.preprocess(
  (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : null;
      if (id === null || id.length === 0) return null;
      const type = obj.type === 'cash' ? 'cash' : 'card';
      return { id, type };
    }
    // Legacy rewrite (pre-Phase-9-turn-4) wrote a bare id string. Synthesize
    // `{id, type:'card'}` since cash rides aren't supported in the rewrite.
    if (typeof val === 'string' && val.length > 0) {
      return { id: val, type: 'card' };
    }
    return null;
  },
  z
    .object({
      id: z.string().min(1),
      type: z.enum(['card', 'cash']),
    })
    .nullable(),
);

const PassengerDocSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phoneNumber: z.string().min(1),
  pushToken: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  /**
   * Rider's Stripe customer id (`cus_...`). Required by the deployed
   * `processPaymentForTrip` validator for any non-cash trip; null only
   * before the rider has taken any wallet action (`EnsureStripeCustomer`
   * writes it on first card-add). Schema accepts null for back-compat
   * with rewrite trips written before Phase 9 turn 4.
   */
  stripeCustomerId: z.string().nullish(),
  defaultPaymentMethod: PassengerDefaultPaymentMethodSchema,
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

/**
 * Legacy yeride's `TripContext` initialState writes `driver: {}` (empty
 * object) for awaiting_driver trips — a placeholder before any driver is
 * assigned. The rewrite writes `driver: <full DriverDoc>` post-dispatch
 * and omits the field pre-dispatch. To read both shapes, preprocess any
 * empty-or-id-less object value down to `null` BEFORE the inner schema
 * validates.
 */
const DriverDocOrNullishSchema = z.preprocess((val) => {
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if (Object.keys(obj).length === 0) return null;
    // Defensive: if `id` is missing or empty the doc carries no real
    // driver info even if a few fields are populated. Treat as absent.
    if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
  }
  return val;
}, DriverDocSchema.nullish());

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
 * Legacy yeride's `GoogleMapsAPI.computeRoutes` stores leg endpoints
 * as `{lat, lng}` (Google Maps JS SDK convention); the rewrite writes
 * `{latitude, longitude}` (Routes API convention). Preprocess to map
 * the legacy form to the canonical form before the inner schema
 * validates. See legacy yeride `GoogleMapsAPI.js:407-418`.
 */
const LegOrLatLngEndpointSchema = z.preprocess(
  (val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (
        typeof obj.lat === 'number' &&
        typeof obj.lng === 'number' &&
        typeof obj.latitude !== 'number' &&
        typeof obj.longitude !== 'number'
      ) {
        return { latitude: obj.lat, longitude: obj.lng };
      }
    }
    return val;
  },
  z
    .object({
      latitude: z.number().finite(),
      longitude: z.number().finite(),
    })
    .optional(),
);

/**
 * Embedded route directions. The schema is intentionally permissive — the
 * legacy app started writing this object before the rewrite's curated
 * FieldMask was finalised, so older documents are missing fields like
 * `routeToken` or `localizedValues`. Anything not present becomes `null`
 * at the mapper boundary.
 *
 * Two legacy shape concessions:
 *   - `startLocation` / `endLocation` may be `{lat, lng}` instead of
 *     `{latitude, longitude}` — legacy `GoogleMapsAPI.computeRoutes`
 *     normalises Routes API output to the lat/lng form for storage.
 *     Preprocessed via `LegOrLatLngEndpointSchema`.
 *   - `tollInfo` may be `null` (legacy writes `route.travelAdvisory?
 *     .tollInfo || null` — explicit null when no tolls). The rewrite's
 *     prior `.optional()` only allowed `undefined`. Switched to
 *     `.nullish()`.
 */
const EmbeddedDirectionsSchema = z.object({
  distanceMeters: z.number().finite().gte(0).optional(),
  durationSeconds: z.number().finite().gte(0).optional(),
  distanceText: z.string().optional(),
  durationText: z.string().optional(),
  polyline: z.string().optional(),
  encodedPolyline: z.string().optional(),
  routeToken: z.string().nullish(),
  description: z.string().optional(),
  routeLabels: z.array(z.string()).optional(),
  startLocation: LegOrLatLngEndpointSchema,
  endLocation: LegOrLatLngEndpointSchema,
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
    .nullish(),
});

/**
 * Legacy yeride writes endpoint addresses as the FULL Google Places
 * details object (`{description, formatted_address, geometry: {location:
 * {lat, lng}}, name, place_id, types, vicinity}`); the rewrite writes a
 * bare string. We accept either shape at parse time and let the mapper
 * extract the canonical address string + (when needed) the coordinates.
 * See legacy yeride `RideRouteSearch.onSetPickupAddress` for the source.
 *
 * `passthrough()` so unknown Google fields don't get stripped — the
 * mapper may reach for any of them.
 */
const LegacyPlaceAddressSchema = z
  .object({
    description: z.string().optional(),
    formatted_address: z.string().optional(),
    name: z.string().optional(),
    vicinity: z.string().optional(),
    place_id: z.string().optional(),
    geometry: z
      .object({
        location: z
          .object({
            lat: z.number().finite().optional(),
            lng: z.number().finite().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export const EndpointAddressFieldSchema = z.union([
  z.string(),
  LegacyPlaceAddressSchema,
]);

/**
 * Pickup / dropoff endpoint shape.
 *
 * Three legacy shape concessions vs. the canonical rewrite shape:
 *   1. `latitude` / `longitude` may be absent at the top level — legacy
 *      stores them nested at `address.geometry.location.{lat,lng}` (or in
 *      `directions.startLocation/endLocation`). The mapper sources from
 *      whichever path is populated.
 *   2. `address` may be the Google Places object instead of a bare
 *      string. Mapper extracts `formatted_address` (preferred),
 *      `description`, `name`, or `vicinity` in that order.
 *   3. All three may be absent/null on a partially-filled trip the
 *      legacy app never finalised — mapper returns ValidationError so
 *      the read path skips the doc cleanly instead of crashing.
 */
const PickupEndpointDocSchema = z.object({
  latitude: z.number().finite().gte(-90).lte(90).optional(),
  longitude: z.number().finite().gte(-180).lte(180).optional(),
  address: EndpointAddressFieldSchema.nullish(),
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
  latitude: z.number().finite().gte(-90).lte(90).optional(),
  longitude: z.number().finite().gte(-180).lte(180).optional(),
  address: EndpointAddressFieldSchema.nullish(),
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
  driver: DriverDocOrNullishSchema,
  rideService: RideServiceEmbeddedSchema,
  // Status enum accepts BOTH the canonical rewrite values and the
  // legacy values written by the deployed Cloud Functions / Stripe
  // webhook. The mapper normalizes legacy values at the domain
  // boundary. See rideMapper.toDomain.
  //
  // Cancel pipeline (Phase 8 turn 3 sub-turn 5b):
  //   - 'passenger_canceled' / 'driver_canceled' → 'cancelled'.
  //     The `by` field of the resulting `RideCancellation` carries
  //     the rider/driver provenance.
  //
  // Payment pipeline (Phase 9 turn 4 smoke fix):
  //   - 'payment_intent' → 'payment_requested'. Written by
  //     yeride-functions/lib/payments.js after `processPayment`
  //     initiates the Stripe charge. The charge is in flight; the
  //     receipt should still render as the rider waits for it to
  //     settle.
  //   - 'closed' → 'completed'. Written by yeride-stripe-server/
  //     stripe/routes.js after the Stripe `charge.succeeded` webhook
  //     fires. Terminal-success state; the fare cleared and the trip
  //     is finished.
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
    'payment_intent',
    'closed',
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
  // Phase 9 turn 4 smoke fix — Stripe webhook writes `closedAt`
  // alongside `status: 'closed'` in the same transaction. Declared
  // here (mirroring the canceledAt pattern) so it's visible in the
  // `topLevelKeys` diagnostics output rather than silently stripped.
  // The mapper currently doesn't read it — `dropoff.completedAt` is
  // the canonical pickup→dropoff completion timestamp.
  closedAt: ISO_DATE.nullish(),
  routePreference: RoutePreferenceDocSchema.nullish(),
  // Scheduled-ride future pickup datetime. See SchedulePickupAtSchema's
  // JSDoc for the on-disk Firestore Timestamp expectation and the
  // permissive-read coercion. `.optional()` (not `.nullish()`) so the
  // post-parse type is `Date | null | undefined`; the mapper treats
  // undefined the same as null.
  schedulePickupAt: SchedulePickupAtSchema.optional(),
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
export type EndpointAddressField = z.infer<typeof EndpointAddressFieldSchema>;
export type LegacyPlaceAddress = z.infer<typeof LegacyPlaceAddressSchema>;
