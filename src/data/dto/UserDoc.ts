import { z } from 'zod';

/**
 * The shape of a Firestore `users/{uid}` document.
 *
 * We share the dev + stage Firebase projects with the legacy `yeride` app
 * (REFACTOR_PLAN.md §7 Decision 6), so this schema must read documents the
 * legacy app writes AND write documents the legacy app can read. Strictness
 * is therefore one-sided: parsing is permissive (unknown fields ignored,
 * legacy field names accepted), serialization is canonical (the new field
 * names).
 *
 * Legacy fields preserved:
 *   - `createdDateTime` (ISO string) — kept; a new `updatedDateTime` is added.
 *   - `phoneNumber` (string) — alias accepted.
 *   - `avatar` (URL string) — kept.
 *   - `savedPlaces[].place_id` — kept; the new `id` is an alias.
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

const SavedPlaceDocSchema = z.object({
  place_id: z.string().min(1).max(200),
  label: z.string().min(1).max(60),
  address: z.string().min(1).max(500),
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
});

export type SavedPlaceDoc = z.infer<typeof SavedPlaceDocSchema>;

const BaseUserDocSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  // Legacy stores phone as `phoneNumber` (sometimes `phone`); accept either.
  phoneNumber: z.string().nullish(),
  phone: z.string().nullish(),
  emailVerified: z.boolean().default(false),
  avatar: z.string().nullish(),
  savedPlaces: z.array(SavedPlaceDocSchema).default([]),
  createdDateTime: z.string().min(1),
  updatedDateTime: z.string().nullish(),
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
