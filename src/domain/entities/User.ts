import type { Email } from './Email';
import type { PersonName } from './PersonName';
import type { PhoneNumber } from './PhoneNumber';
import type { Role } from './Role';
import type { SavedPlace, SavedPlaceId } from './SavedPlace';
import type { UserId } from './UserId';

/**
 * The authoritative shape of a YeRide user, after `data → mapper → entity`
 * conversion at the repository boundary.
 *
 * `User` is a discriminated union on `role`. Use it as a sum type:
 *
 *   if (user.role === 'driver') {
 *     // user is Driver here — TS narrows automatically
 *   }
 *
 * Updates use the immutable `update*` helpers. Repositories never mutate the
 * instance they handed out; they return a fresh User on every read.
 *
 * We intentionally store profile fields as value objects (Email, PhoneNumber,
 * PersonName) so the User type is impossible to construct in an invalid state.
 * Repositories validate the wire shape via mappers before returning; the
 * factories in this file enforce invariants on direct construction.
 */

export interface UserBase {
  readonly id: UserId;
  readonly email: Email;
  readonly emailVerified: boolean;
  readonly name: PersonName;
  readonly phone: PhoneNumber | null;
  readonly avatarUrl: string | null;
  readonly savedPlaces: readonly SavedPlace[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Rider-specific fields. Stripe customer + payment-method state lives here
 * but is populated in Phase 6 (payments). For Phase 1 the field exists as
 * `null` and we don't require it for any rider-facing flow yet.
 */
export interface Rider extends UserBase {
  readonly role: 'rider';
  readonly stripeCustomerId: string | null;
}

/**
 * Driver-specific fields. Stripe Connect onboarding (account id, charges
 * enabled, payouts enabled) lives here, also populated in Phase 6. Vehicle
 * ownership and active-vehicle pointer arrive in Phase 5.
 */
export interface Driver extends UserBase {
  readonly role: 'driver';
  readonly stripeAccountId: string | null;
  readonly stripeChargesEnabled: boolean;
  readonly stripePayoutsEnabled: boolean;
  readonly activeVehicleId: string | null;
  readonly vehicleIds: readonly string[];
}

export type User = Rider | Driver;

/* ─────────────────────────── Factories ─────────────────────────── */

interface NewUserCommon {
  id: UserId;
  email: Email;
  emailVerified?: boolean;
  name: PersonName;
  phone?: PhoneNumber | null;
  avatarUrl?: string | null;
  savedPlaces?: readonly SavedPlace[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Construct a freshly-registered Rider. All Stripe fields default to null —
 * Phase 6 will populate them on first card-add.
 */
export function makeRider(
  args: NewUserCommon & { stripeCustomerId?: string | null },
): Rider {
  return {
    role: 'rider',
    id: args.id,
    email: args.email,
    emailVerified: args.emailVerified ?? false,
    name: args.name,
    phone: args.phone ?? null,
    avatarUrl: args.avatarUrl ?? null,
    savedPlaces: args.savedPlaces ?? [],
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    stripeCustomerId: args.stripeCustomerId ?? null,
  };
}

/**
 * Construct a freshly-registered Driver. All Stripe Connect + vehicle fields
 * default to empty — Phase 5 (vehicles) and Phase 6 (Connect) populate them.
 */
export function makeDriver(
  args: NewUserCommon & {
    stripeAccountId?: string | null;
    stripeChargesEnabled?: boolean;
    stripePayoutsEnabled?: boolean;
    activeVehicleId?: string | null;
    vehicleIds?: readonly string[];
  },
): Driver {
  return {
    role: 'driver',
    id: args.id,
    email: args.email,
    emailVerified: args.emailVerified ?? false,
    name: args.name,
    phone: args.phone ?? null,
    avatarUrl: args.avatarUrl ?? null,
    savedPlaces: args.savedPlaces ?? [],
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
    stripeAccountId: args.stripeAccountId ?? null,
    stripeChargesEnabled: args.stripeChargesEnabled ?? false,
    stripePayoutsEnabled: args.stripePayoutsEnabled ?? false,
    activeVehicleId: args.activeVehicleId ?? null,
    vehicleIds: args.vehicleIds ?? [],
  };
}

/**
 * Branch factory: produces a Rider or Driver based on the role. Used by use
 * cases that don't know the role at compile time (e.g. registration).
 */
export function makeUser(role: Role, args: NewUserCommon): User {
  return role === 'rider' ? makeRider(args) : makeDriver(args);
}

/* ─────────────────────────── Update helpers ─────────────────────── */

/**
 * Return a new User with the given email-verified state. Triggers a fresh
 * `updatedAt`.
 */
export function setEmailVerified(
  user: User,
  emailVerified: boolean,
  now: Date,
): User {
  if (user.emailVerified === emailVerified) return user;
  return { ...user, emailVerified, updatedAt: now };
}

/**
 * Return a new User with an updated email. Use cases should ensure
 * verification status follows the email change (i.e. set `emailVerified` to
 * `false` until the new email is re-verified).
 */
export function setEmail(user: User, email: Email, now: Date): User {
  return { ...user, email, emailVerified: false, updatedAt: now };
}

/**
 * Return a new User with an updated profile (name and/or phone).
 */
export function updateProfile(
  user: User,
  patch: { name?: PersonName; phone?: PhoneNumber | null },
  now: Date,
): User {
  return {
    ...user,
    name: patch.name ?? user.name,
    phone: patch.phone === undefined ? user.phone : patch.phone,
    updatedAt: now,
  };
}

/**
 * Return a new User with a different avatar URL. `null` clears it.
 */
export function setAvatarUrl(
  user: User,
  avatarUrl: string | null,
  now: Date,
): User {
  return { ...user, avatarUrl, updatedAt: now };
}

/* ─────────────────────────── Saved-places helpers ──────────────── */

/**
 * Append a saved place. Caller is expected to have ensured the id is unique;
 * if a place with the same id exists, this replaces it (upsert semantics).
 */
export function upsertSavedPlace(
  user: User,
  place: SavedPlace,
  now: Date,
): User {
  const without = user.savedPlaces.filter((p) => p.id !== place.id);
  return {
    ...user,
    savedPlaces: [...without, place],
    updatedAt: now,
  };
}

/**
 * Remove a saved place by id. No-op if not present.
 */
export function removeSavedPlace(
  user: User,
  id: SavedPlaceId,
  now: Date,
): User {
  const next = user.savedPlaces.filter((p) => p.id !== id);
  if (next.length === user.savedPlaces.length) return user;
  return { ...user, savedPlaces: next, updatedAt: now };
}

/* ─────────────────────────── Type guards ───────────────────────── */

export function isRider(user: User): user is Rider {
  return user.role === 'rider';
}

export function isDriver(user: User): user is Driver {
  return user.role === 'driver';
}
