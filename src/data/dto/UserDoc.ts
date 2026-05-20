import { z } from 'zod';

/**
 * The shape of a Firestore `users/{uid}` document.
 *
 * We share the dev + stage Firebase projects with the legacy `yeride` app
 * (REFACTOR_PLAN.md §7 Decision 6), so this schema must read documents the
 * legacy app writes AND write documents the legacy app can read. Strictness
 * is therefore one-sided: parsing is permissive (unknown fields ignored,
 * legacy field names accepted, legacy Google-Places-shape savedPlaces
 * entries and Firestore `Timestamp` instances on date fields both
 * normalized at the DTO boundary), serialization is canonical (the new
 * field names, ISO date strings).
 *
 * Legacy fields preserved:
 *   - `createdDateTime` — accepts ISO string OR Firestore Timestamp; some
 *     older accounts were written with `serverTimestamp()` / `Timestamp`
 *     fields rather than ISO strings.
 *   - `phoneNumber` (string) — alias accepted.
 *   - `avatar` (URL string) — kept.
 *   - `savedPlaces[]` — accepts the canonical
 *     `{place_id, label, address, latitude, longitude}` shape AND the
 *     legacy raw-Google-Places shape
 *     (`{place_id, name, formatted_address|vicinity|description,
 *     geometry: { location: { lat, lng } }}`) that the legacy yeride
 *     `RideRouteSearch.onSavePlace` flow writes. Entries that can't be
 *     normalized are silently dropped (preserves the principle that a
 *     single malformed value doesn't crash the whole user hydration).
 *
 * Legacy Stripe fields (Phase 6 reads + writes both shapes):
 *   - Riders store the Stripe customer flat as `stripeCustomerId` (legacy
 *     and rewrite agree — see legacy `src/auth/screens/Register.js:103` and
 *     `Wallet.js`).
 *   - Drivers historically store the Stripe Connect account NESTED as
 *     `stripe: { id, charges_enabled, payouts_enabled, ... }` (legacy
 *     spreads the full Stripe `accounts.create` response into the user
 *     doc — see `Register.js:455` and `Earnings.js:110`). The rewrite
 *     reads either shape, prefers the flat fields, and writes both for
 *     legacy compatibility under `setDoc { merge: true }`.
 *
 * Push token (Phase 9 turn 2):
 *   - `pushToken` is a top-level string (matches legacy `users/{uid}.pushToken`
 *     written by `yeride/src/api/firebase/AuthUser.js:savePushToken`).
 *     Two on-the-wire formats: Expo wrapped (`ExponentPushToken[...]`) and
 *     raw FCM/APNs. The deployed `yeride-functions/lib/notifications.js`
 *     `sendNotification` is shape-agnostic via `Expo.isExpoPushToken()`.
 *
 * Fields not yet populated in the rewrite:
 *   - vehicleIds / activeVehicleId — Phase 5.
 */

const SavedPlaceCanonicalSchema = z.object({
  place_id: z.string().min(1).max(200),
  label: z.string().min(1).max(60),
  address: z.string().min(1).max(500),
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
});

export type SavedPlaceDoc = z.infer<typeof SavedPlaceCanonicalSchema>;

/**
 * Normalize a `savedPlaces[i]` entry from either shape to the canonical
 * shape. Returns the entry unchanged if it's already canonical (`label`,
 * `address`, `latitude`, `longitude` present with the right types).
 * Otherwise extracts those fields from the legacy raw-Google-Places shape:
 * `name` / `description` / `formatted_address` / `vicinity` for the human
 * labels, `geometry.location.{lat,lng}` (or `.latitude`/`.longitude`) for
 * the coords.
 *
 * Returns the input unchanged if it isn't an object — the entry will then
 * fail strict validation and get dropped at the array boundary below
 * rather than crashing the whole user-doc parse.
 */
function normalizeLegacySavedPlace(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;

  if (
    typeof r.label === 'string' &&
    typeof r.address === 'string' &&
    typeof r.latitude === 'number' &&
    typeof r.longitude === 'number'
  ) {
    return r;
  }

  const geometry =
    r.geometry !== null && typeof r.geometry === 'object'
      ? (r.geometry as Record<string, unknown>)
      : {};
  const location =
    geometry.location !== null && typeof geometry.location === 'object'
      ? (geometry.location as Record<string, unknown>)
      : {};

  const label = r.label ?? r.name ?? r.description ?? r.vicinity;
  const address =
    r.address ?? r.formatted_address ?? r.vicinity ?? r.description;
  const latitude = r.latitude ?? location.lat ?? location.latitude;
  const longitude = r.longitude ?? location.lng ?? location.longitude;

  return {
    place_id: r.place_id,
    label,
    address,
    latitude,
    longitude,
  };
}

/**
 * Array-level schema for `savedPlaces`. Each raw entry is run through
 * `normalizeLegacySavedPlace` (translating the legacy raw-Google-Places
 * shape to the canonical shape), then validated against
 * `SavedPlaceCanonicalSchema` via `.catch(undefined)` so a single
 * malformed entry doesn't fail the whole parse — bad entries become
 * `undefined` and are filtered out at the array transform.
 */
const SavedPlacesArraySchema = z.preprocess(
  (raw) => (Array.isArray(raw) ? raw.map(normalizeLegacySavedPlace) : raw),
  z
    .array(
      SavedPlaceCanonicalSchema.catch(undefined as unknown as SavedPlaceDoc),
    )
    .transform((arr) => arr.filter((p): p is SavedPlaceDoc => p !== undefined)),
);

/**
 * Date field that accepts either an ISO string or a Firestore `Timestamp`
 * instance. The rewrite always writes ISO strings (matches legacy
 * `AuthUser.js:registerWithEmail`), but some legacy accounts were created
 * via paths that wrote `serverTimestamp()` / a Firestore Timestamp object
 * to `createdDateTime`. Convert Timestamp → ISO string at the boundary so
 * the rest of the mapper / domain stays string-typed.
 *
 * Detect by duck-typing on `.toDate()` rather than `instanceof` so the
 * preprocessor doesn't need to import `firestore` at the DTO layer (data
 * layer keeps its boundaries clean).
 */
const IsoStringOrTimestamp = z.preprocess((v) => {
  if (typeof v === 'string') return v;
  if (v !== null && typeof v === 'object') {
    const maybeToDate = (v as { toDate?: unknown }).toDate;
    if (typeof maybeToDate === 'function') {
      try {
        const d = (v as { toDate(): Date }).toDate();
        if (d instanceof Date && Number.isFinite(d.getTime())) {
          return d.toISOString();
        }
      } catch {
        // fall through — the strict z.string() will reject below
      }
    }
  }
  return v;
}, z.string().min(1));

const IsoStringOrTimestampNullish = z.preprocess((v) => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const maybeToDate = (v as { toDate?: unknown }).toDate;
    if (typeof maybeToDate === 'function') {
      try {
        const d = (v as { toDate(): Date }).toDate();
        if (d instanceof Date && Number.isFinite(d.getTime())) {
          return d.toISOString();
        }
      } catch {
        // fall through
      }
    }
  }
  return v;
}, z.string().nullish());

const BaseUserDocSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  // Legacy stores phone as `phoneNumber` (sometimes `phone`); accept either.
  phoneNumber: z.string().nullish(),
  phone: z.string().nullish(),
  emailVerified: z.boolean().default(false),
  avatar: z.string().nullish(),
  savedPlaces: SavedPlacesArraySchema.default([]),
  createdDateTime: IsoStringOrTimestamp,
  updatedDateTime: IsoStringOrTimestampNullish,
  // Phase 9 turn 2: device push-notification token. Stored permissively
  // (any non-empty string passes zod parsing); the mapper validates the
  // shape via `PushToken.create` and falls back to `null` on shape failure
  // rather than crashing user hydration on a single malformed doc.
  pushToken: z.string().nullish(),
});

const RiderDocSchema = BaseUserDocSchema.extend({
  role: z.literal('rider'),
  stripeCustomerId: z.string().nullish(),
  /**
   * Phase 6 turn 2: which saved card the rider has tagged as default.
   * Persisted as a raw `pm_*` string for read efficiency; the mapper
   * validates against `PaymentMethodId.create` on hydration. Legacy
   * yeride doesn't read this field — it stores the default in React
   * Context only — so the rewrite owns it. Safe to extend without
   * coordinating with the legacy clients.
   */
  defaultPaymentMethodId: z.string().nullish(),
});

/**
 * Legacy nested Stripe Connect shape produced by the original yeride
 * Register flow. The full Stripe `accounts.create` response is spread into
 * the user doc, so we accept the four fields the rewrite cares about and
 * leave the rest opaque via `passthrough()` so writes don't strip them.
 *
 * Field names use Stripe's snake_case (`charges_enabled` /
 * `payouts_enabled`) because that's what gets spread in.
 */
const LegacyStripeDriverNestedSchema = z
  .object({
    id: z.string().min(1),
    charges_enabled: z.boolean().nullish(),
    payouts_enabled: z.boolean().nullish(),
  })
  .passthrough();

export type LegacyStripeDriverNested = z.infer<
  typeof LegacyStripeDriverNestedSchema
>;

const DriverDocSchema = BaseUserDocSchema.extend({
  role: z.literal('driver'),
  // Canonical (rewrite-written) flat fields:
  stripeAccountId: z.string().nullish(),
  stripeChargesEnabled: z.boolean().nullish(),
  stripePayoutsEnabled: z.boolean().nullish(),
  // Legacy nested shape — accepted on read; mapper folds into the flat
  // fields below if the flat fields are absent.
  stripe: LegacyStripeDriverNestedSchema.nullish(),
  activeVehicleId: z.string().nullish(),
  vehicleIds: z.array(z.string()).default([]),
});

export const UserDocSchema = z.discriminatedUnion('role', [
  RiderDocSchema,
  DriverDocSchema,
]);

export type UserDoc = z.infer<typeof UserDocSchema>;
export type RiderDoc = z.infer<typeof RiderDocSchema>;
export type DriverDoc = z.infer<typeof DriverDocSchema>;
