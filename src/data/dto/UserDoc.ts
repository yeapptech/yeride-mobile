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
 * Fields not yet populated in the rewrite:
 *   - Stripe customer/account/charges/payouts — Phase 6.
 *   - vehicleIds / activeVehicleId — Phase 5.
 *   - pushToken — Phase 9.
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
});

const RiderDocSchema = BaseUserDocSchema.extend({
  role: z.literal('rider'),
  stripeCustomerId: z.string().nullish(),
});

const DriverDocSchema = BaseUserDocSchema.extend({
  role: z.literal('driver'),
  stripeAccountId: z.string().nullish(),
  stripeChargesEnabled: z.boolean().nullish(),
  stripePayoutsEnabled: z.boolean().nullish(),
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
